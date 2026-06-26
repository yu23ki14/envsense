#include "storage.h"

#include <SD.h>
#include <SPI.h>
#include <sys/time.h>

#include "ff.h" // f_mkfs / f_mount for storage_format() (FatFs, via the SD lib's diskio)
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

// FatFs logical drive used by the Arduino SD library for the single SPI card.
// ff_diskio_get_drive() hands out volume 0 first, so the only SD card is "0:".
#define SD_FATFS_DRIVE "0:"

// All SD access goes through this mutex: the audio task flushes utterance
// buffers from core1 while loop_app streams sync chunks and BLE callbacks
// queue deletes from core0, and neither the SPI driver nor FatFS tolerate
// interleaved access.
static SemaphoreHandle_t sdMutex = nullptr;
static bool sdAvailable = false;

// Unsynced-file counters, kept in RAM so SYNC_STATUS doesn't rescan the card.
// Initialized by a directory scan at mount; updated on every save/delete.
static uint16_t audioFileCount = 0;
static uint16_t photoFileCount = 0;
static uint32_t unsyncedBytes = 0;

// Open utterance state (audio task only, except the rename bookkeeping that
// storage_set_time updates under the mutex).
static File utteranceFile;
static bool utteranceOpen = false;
static char utterancePath[48];
static uint64_t utteranceStartEpochMs = 0;
static uint32_t utteranceFrames = 0;
static uint32_t utteranceBytes = 0;
static int64_t utterancePendingDelta = 0; // Clock correction to apply on close (file is open, can't rename yet)
static uint8_t *flushBuffer = nullptr;
static size_t flushPos = 0;

// Cached read handle so sequential sync-chunk reads don't reopen the file
// (a FAT path walk per 500-byte chunk would dominate the transfer time).
static File readFile;
static char readPath[48] = {0};

#define OPP_HEADER_SIZE 16

static void lock()
{
    xSemaphoreTake(sdMutex, portMAX_DELAY);
}

static void unlock()
{
    xSemaphoreGive(sdMutex);
}

bool storage_clock_valid()
{
    return storage_now_ms() >= CLOCK_VALID_MIN_EPOCH_MS;
}

uint64_t storage_now_ms()
{
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    return (uint64_t) tv.tv_sec * 1000ULL + (uint64_t) tv.tv_usec / 1000ULL;
}

// Parse the leading epoch-ms from a file name like "1749700000000_2.jpg".
static uint64_t epochFromName(const char *name)
{
    return strtoull(name, nullptr, 10);
}

static uint8_t orientationFromName(const char *name)
{
    const char *underscore = strchr(name, '_');
    return underscore != nullptr ? (uint8_t) atoi(underscore + 1) : 0;
}

static void scanDir(const char *dir, uint16_t *count, uint32_t *bytes)
{
    File root = SD.open(dir);
    if (!root) {
        return;
    }
    for (File f = root.openNextFile(); f; f = root.openNextFile()) {
        if (!f.isDirectory()) {
            (*count)++;
            *bytes += f.size();
        }
        f.close();
    }
    root.close();
}

bool storage_init()
{
    if (sdMutex == nullptr) {
        sdMutex = xSemaphoreCreateMutex();
    }

    Serial.println("storage: SD.begin()...");
    if (!SD.begin(SD_CS_PIN, SPI, SD_SPI_FREQ_HZ)) {
        Serial.println("storage: no SD card found - falling back to live streaming");
        return false;
    }
    Serial.println("storage: SD.begin() OK");

    flushBuffer = (uint8_t *) ps_malloc(STORAGE_FLUSH_BYTES + OPUS_OUTPUT_MAX_BYTES + 2);
    if (flushBuffer == nullptr) {
        Serial.println("storage: failed to allocate flush buffer");
        SD.end();
        return false;
    }

#if STORAGE_FORMAT_ON_BOOT
    // One-shot recovery: wipe a card whose directories are too bloated to scan
    // (set STORAGE_FORMAT_ON_BOOT back to 0 after the recovery flash). Skips the
    // slow scanDir entirely since the freshly formatted card is empty.
    Serial.println("storage: STORAGE_FORMAT_ON_BOOT -> formatting card");
    sdAvailable = true; // storage_format() guards on this
    return storage_format();
#endif

    Serial.println("storage: mkdir...");
    SD.mkdir(AUDIO_DIR);
    SD.mkdir(PHOTO_DIR);

    audioFileCount = 0;
    photoFileCount = 0;
    unsyncedBytes = 0;
    Serial.println("storage: scanDir(audio)...");
    scanDir(AUDIO_DIR, &audioFileCount, &unsyncedBytes);
    Serial.printf("storage: scanDir(audio) done (%u files)\n", audioFileCount);
    Serial.println("storage: scanDir(photo)...");
    scanDir(PHOTO_DIR, &photoFileCount, &unsyncedBytes);
    Serial.printf("storage: scanDir(photo) done (%u files)\n", photoFileCount);

    sdAvailable = true;
    Serial.printf("storage: SD mounted (%llu MB), unsynced: %u audio / %u photo / %lu bytes\n",
                  SD.cardSize() / (1024ULL * 1024ULL),
                  audioFileCount,
                  photoFileCount,
                  (unsigned long) unsyncedBytes);
    return true;
}

bool storage_available()
{
    return sdAvailable;
}

// Shift the timestamps of files recorded before the clock was set. Files from
// earlier unsynced boots get this boot's delta too -- an approximation that at
// least keeps them ordered before the current files.
static void correctDirTimestamps(const char *dir, int64_t deltaMs)
{
    // Collect a bounded batch of rename pairs while the directory is open, close
    // it, apply the renames, then rescan -- SD.rename() (f_rename) mid-walk
    // corrupts the open openNextFile() iterator on FatFs the same way SD.remove()
    // does. Renamed files get a valid epoch (epoch + deltaMs >= the valid-clock
    // threshold) so the next scan skips them, which makes the loop terminate; the
    // no-progress guard is a backstop in case a rename fails (e.g. name clash).
    static const int CLOCK_FIX_BATCH = 32;
    static char oldPaths[CLOCK_FIX_BATCH][64];
    static char newPaths[CLOCK_FIX_BATCH][64];
    for (;;) {
        File root = SD.open(dir);
        if (!root) {
            return;
        }
        int n = 0;
        for (File f = root.openNextFile(); f && n < CLOCK_FIX_BATCH; f = root.openNextFile()) {
            if (f.isDirectory()) {
                f.close();
                continue;
            }
            char name[48];
            strlcpy(name, f.name(), sizeof(name));
            f.close();
            uint64_t epoch = epochFromName(name);
            if (epoch >= CLOCK_VALID_MIN_EPOCH_MS) {
                continue;
            }
            char oldPath[64];
            snprintf(oldPath, sizeof(oldPath), "%s/%s", dir, name);
            if (utteranceOpen && strcmp(oldPath, utterancePath) == 0) {
                continue; // Open file: renamed on close via utterancePendingDelta
            }
            const char *suffix = strchr(name, '_') != nullptr ? strchr(name, '_') : strchr(name, '.');
            strlcpy(oldPaths[n], oldPath, sizeof(oldPaths[n]));
            snprintf(newPaths[n],
                     sizeof(newPaths[n]),
                     "%s/%llu%s",
                     dir,
                     (unsigned long long) (epoch + deltaMs),
                     suffix != nullptr ? suffix : "");
            n++;
        }
        root.close();
        if (n == 0) {
            return; // No more files needing correction.
        }
        int renamed = 0;
        for (int i = 0; i < n; i++) {
            if (SD.rename(oldPaths[i], newPaths[i])) {
                renamed++;
            }
        }
        if (renamed == 0) {
            return; // No progress (all renames failed) -- avoid spinning forever.
        }
    }
}

void storage_set_time(uint64_t epochMs)
{
    uint64_t before = storage_now_ms();
    struct timeval tv;
    tv.tv_sec = (time_t) (epochMs / 1000ULL);
    tv.tv_usec = (suseconds_t) ((epochMs % 1000ULL) * 1000ULL);
    settimeofday(&tv, nullptr);

    if (before >= CLOCK_VALID_MIN_EPOCH_MS || !sdAvailable) {
        return; // Clock was already valid (or nothing to correct)
    }
    int64_t delta = (int64_t) epochMs - (int64_t) before;
    Serial.printf("storage: clock set, correcting unsynced timestamps by %lld ms\n", (long long) delta);
    lock();
    if (utteranceOpen && utteranceStartEpochMs < CLOCK_VALID_MIN_EPOCH_MS) {
        utterancePendingDelta = delta;
    }
    correctDirTimestamps(AUDIO_DIR, delta);
    correctDirTimestamps(PHOTO_DIR, delta);
    unlock();
}

// --- Audio utterances --------------------------------------------------------

void storage_audio_begin_utterance(uint64_t startEpochMs)
{
    if (!sdAvailable || utteranceOpen) {
        return;
    }
    snprintf(utterancePath, sizeof(utterancePath), AUDIO_DIR "/%llu.opp", (unsigned long long) startEpochMs);
    lock();
    utteranceFile = SD.open(utterancePath, FILE_WRITE);
    if (!utteranceFile) {
        unlock();
        Serial.printf("storage: failed to open %s\n", utterancePath);
        return;
    }
    // Header: magic, sample rate, start epoch. The epoch here is best-effort;
    // the manifest timestamp (from the file name, clock-corrected) is what the
    // app trusts.
    uint8_t header[OPP_HEADER_SIZE] = {'O', 'P', 'P', '1'};
    uint32_t rate = MIC_SAMPLE_RATE;
    memcpy(&header[4], &rate, 4);
    memcpy(&header[8], &startEpochMs, 8);
    utteranceFile.write(header, OPP_HEADER_SIZE);
    unlock();

    utteranceOpen = true;
    utteranceStartEpochMs = startEpochMs;
    utteranceFrames = 0;
    utteranceBytes = OPP_HEADER_SIZE;
    utterancePendingDelta = 0;
    flushPos = 0;
}

static void flushUtteranceBuffer()
{
    if (flushPos == 0) {
        return;
    }
    lock();
    utteranceFile.write(flushBuffer, flushPos);
    unlock();
    flushPos = 0;
}

void storage_audio_write_frame(const uint8_t *frame, uint16_t len)
{
    if (!utteranceOpen || len == 0 || len > OPUS_OUTPUT_MAX_BYTES) {
        return;
    }
    flushBuffer[flushPos++] = len & 0xFF;
    flushBuffer[flushPos++] = (len >> 8) & 0xFF;
    memcpy(&flushBuffer[flushPos], frame, len);
    flushPos += len;
    utteranceFrames++;
    utteranceBytes += len + 2;
    if (flushPos >= STORAGE_FLUSH_BYTES) {
        flushUtteranceBuffer();
    }

    // Bound the BLE transfer unit: long conversations roll into a new file.
    uint32_t durationMs = utteranceFrames * (OPUS_FRAME_SAMPLES * 1000 / MIC_SAMPLE_RATE);
    if (durationMs >= AUDIO_FILE_MAX_MS) {
        uint64_t nextStart = utteranceStartEpochMs + durationMs;
        storage_audio_end_utterance();
        storage_audio_begin_utterance(nextStart);
    }
}

void storage_audio_end_utterance()
{
    if (!utteranceOpen) {
        return;
    }
    flushUtteranceBuffer();
    lock();
    utteranceFile.close();
    if (utterancePendingDelta != 0) {
        char newPath[64];
        snprintf(newPath,
                 sizeof(newPath),
                 AUDIO_DIR "/%llu.opp",
                 (unsigned long long) ((int64_t) utteranceStartEpochMs + utterancePendingDelta));
        SD.rename(utterancePath, newPath);
        utterancePendingDelta = 0;
    }
    unlock();
    utteranceOpen = false;
    audioFileCount++;
    unsyncedBytes += utteranceBytes;
    Serial.printf("storage: utterance closed (%lu frames, %lu bytes)\n",
                  (unsigned long) utteranceFrames,
                  (unsigned long) utteranceBytes);
}

bool storage_audio_utterance_open()
{
    return utteranceOpen;
}

// --- Photos ------------------------------------------------------------------

bool storage_save_photo(const uint8_t *jpeg, size_t len, uint8_t orientation)
{
    if (!sdAvailable) {
        return false;
    }
    char path[64];
    snprintf(
        path, sizeof(path), PHOTO_DIR "/%llu_%u.jpg", (unsigned long long) storage_now_ms(), (unsigned) orientation);
    lock();
    File f = SD.open(path, FILE_WRITE);
    if (!f) {
        unlock();
        Serial.printf("storage: failed to open %s\n", path);
        return false;
    }
    size_t written = f.write(jpeg, len);
    f.close();
    unlock();
    if (written != len) {
        Serial.println("storage: short photo write");
        return false;
    }
    photoFileCount++;
    unsyncedBytes += len;
    return true;
}

// --- Sync support ------------------------------------------------------------

static int addManifestDir(const char *dir,
                          uint8_t type,
                          manifest_entry_t *entries,
                          int count,
                          int maxEntries,
                          void (*onProgress)(int scanned),
                          int *sinceProgress)
{
    File root = SD.open(dir);
    if (!root) {
        return count;
    }
    for (File f = root.openNextFile(); f && count < maxEntries; f = root.openNextFile()) {
        // Count every directory entry walked (not just kept files) toward the keep-alive cadence:
        // a bloated FAT directory is slow precisely because of the entries we skip.
        if (onProgress != nullptr && ++(*sinceProgress) >= STORAGE_MANIFEST_PROGRESS_FILES) {
            *sinceProgress = 0;
            onProgress(count);
        }
        if (f.isDirectory()) {
            f.close();
            continue;
        }
        manifest_entry_t *e = &entries[count];
        snprintf(e->path, sizeof(e->path), "%s/%s", dir, f.name());
        if (utteranceOpen && strcmp(e->path, utterancePath) == 0) {
            f.close();
            continue; // Still being written; it appears in the next manifest
        }
        e->id = (uint32_t) count + 1;
        e->type = type;
        e->size = f.size();
        e->epochMs = epochFromName(f.name());
        e->orientation = type == SYNC_FILE_TYPE_PHOTO ? orientationFromName(f.name()) : 0;
        f.close();
        count++;
    }
    root.close();
    return count;
}

int storage_build_manifest(manifest_entry_t *entries, int maxEntries, void (*onProgress)(int scanned))
{
    if (!sdAvailable) {
        return 0;
    }
    lock();
    int sinceProgress = 0;
    int count = addManifestDir(AUDIO_DIR, SYNC_FILE_TYPE_AUDIO, entries, 0, maxEntries, onProgress, &sinceProgress);
    count = addManifestDir(PHOTO_DIR, SYNC_FILE_TYPE_PHOTO, entries, count, maxEntries, onProgress, &sinceProgress);
    unlock();
    return count;
}

int storage_read_file(const char *path, uint32_t offset, uint8_t *buf, size_t len)
{
    if (!sdAvailable) {
        return -1;
    }
    lock();
    if (strcmp(readPath, path) != 0 || !readFile) {
        if (readFile) {
            readFile.close();
        }
        readFile = SD.open(path, FILE_READ);
        strlcpy(readPath, path, sizeof(readPath));
        if (!readFile) {
            readPath[0] = '\0';
            unlock();
            return -1;
        }
    }
    if (readFile.position() != offset && !readFile.seek(offset)) {
        unlock();
        return -1;
    }
    int n = readFile.read(buf, len);
    unlock();
    return n;
}

bool storage_delete_file(const char *path, uint8_t type, uint32_t size)
{
    if (!sdAvailable) {
        return false;
    }
    lock();
    if (readFile && strcmp(readPath, path) == 0) {
        readFile.close();
        readPath[0] = '\0';
    }
    bool ok = SD.remove(path);
    unlock();
    if (ok) {
        if (type == SYNC_FILE_TYPE_AUDIO && audioFileCount > 0) {
            audioFileCount--;
        } else if (type == SYNC_FILE_TYPE_PHOTO && photoFileCount > 0) {
            photoFileCount--;
        }
        unsyncedBytes = unsyncedBytes >= size ? unsyncedBytes - size : 0;
    }
    return ok;
}

// Delete-all via reformat. f_mkfs wipes the volume in O(1) regardless of how many
// files (or stale directory-table entries) exist -- the only thing that reliably
// clears FAT directory bloat. Runs on the SD lib's FatFs diskio (still registered
// while mounted): unmount the logical drive, mkfs, then remount via SD.end()+
// SD.begin() (SD.end() also re-registers a fresh diskio for the next mount).
bool storage_format()
{
    lock();
    if (!sdAvailable) {
        unlock();
        return false;
    }
    sdAvailable = false; // make concurrent storage_* calls no-op during the wipe
    if (readFile) {
        readFile.close();
        readPath[0] = '\0';
    }
    if (utteranceOpen) {
        utteranceFile.close();
        utteranceOpen = false;
    }
    BYTE *work = (BYTE *) malloc(FF_MAX_SS);
    FRESULT res = FR_NOT_ENOUGH_CORE;
    if (work != nullptr) {
        f_mount(nullptr, SD_FATFS_DRIVE, 0); // unmount logical drive; diskio stays registered
        const MKFS_PARM opt = {(BYTE) FM_ANY, 0, 0, 0, 0};
        res = f_mkfs(SD_FATFS_DRIVE, &opt, work, FF_MAX_SS);
        free(work);
    }
    unlock();

    SD.end(); // drop the SD lib's now-stale mount + diskio registration
    if (res != FR_OK) {
        Serial.printf("storage: f_mkfs failed (%d)\n", (int) res);
        return false;
    }
    if (!SD.begin(SD_CS_PIN, SPI, SD_SPI_FREQ_HZ)) {
        Serial.println("storage: remount after format failed");
        return false;
    }
    SD.mkdir(AUDIO_DIR);
    SD.mkdir(PHOTO_DIR);
    audioFileCount = 0;
    photoFileCount = 0;
    unsyncedBytes = 0;
    sdAvailable = true;
    Serial.println("storage: format complete (card wiped)");
    return true;
}

void storage_compact_empty_dirs()
{
    lock();
    if (sdAvailable) {
        // rmdir frees the directory's (possibly bloated) cluster chain; mkdir
        // recreates a fresh 1-cluster table. Only acts when the dir is truly
        // empty (rmdir fails harmlessly otherwise, so a count desync is safe).
        if (audioFileCount == 0 && !utteranceOpen && SD.rmdir(AUDIO_DIR)) {
            SD.mkdir(AUDIO_DIR);
            Serial.println("storage: compacted empty /audio");
        }
        if (photoFileCount == 0 && SD.rmdir(PHOTO_DIR)) {
            SD.mkdir(PHOTO_DIR);
            Serial.println("storage: compacted empty /photo");
        }
    }
    unlock();
}

void storage_stats(uint16_t *audioCount, uint16_t *photoCount, uint32_t *totalBytes)
{
    *audioCount = audioFileCount;
    *photoCount = photoFileCount;
    *totalBytes = unsyncedBytes;
}

void storage_shutdown()
{
    if (!sdAvailable) {
        return;
    }
    storage_audio_end_utterance();
    lock();
    if (readFile) {
        readFile.close();
    }
    SD.end();
    unlock();
    sdAvailable = false;
    Serial.println("storage: unmounted");
}
