#include "storage.h"

#include <SD.h>
#include <SPI.h>
#include <sys/time.h>

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

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

    if (!SD.begin(SD_CS_PIN, SPI, SD_SPI_FREQ_HZ)) {
        Serial.println("storage: no SD card found - falling back to live streaming");
        return false;
    }

    SD.mkdir(AUDIO_DIR);
    SD.mkdir(PHOTO_DIR);

    flushBuffer = (uint8_t *) ps_malloc(STORAGE_FLUSH_BYTES + OPUS_OUTPUT_MAX_BYTES + 2);
    if (flushBuffer == nullptr) {
        Serial.println("storage: failed to allocate flush buffer");
        SD.end();
        return false;
    }

    audioFileCount = 0;
    photoFileCount = 0;
    unsyncedBytes = 0;
    scanDir(AUDIO_DIR, &audioFileCount, &unsyncedBytes);
    scanDir(PHOTO_DIR, &photoFileCount, &unsyncedBytes);

    sdAvailable = true;
    Serial.printf("storage: SD mounted (%llu MB), unsynced: %u audio / %u photo / %lu bytes\n",
                  SD.cardSize() / (1024ULL * 1024ULL), audioFileCount, photoFileCount,
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
    File root = SD.open(dir);
    if (!root) {
        return;
    }
    for (File f = root.openNextFile(); f; f = root.openNextFile()) {
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
        char newPath[64];
        snprintf(oldPath, sizeof(oldPath), "%s/%s", dir, name);
        if (utteranceOpen && strcmp(oldPath, utterancePath) == 0) {
            continue; // Open file: renamed on close via utterancePendingDelta
        }
        const char *suffix = strchr(name, '_') != nullptr ? strchr(name, '_') : strchr(name, '.');
        snprintf(newPath, sizeof(newPath), "%s/%llu%s", dir, (unsigned long long) (epoch + deltaMs),
                 suffix != nullptr ? suffix : "");
        SD.rename(oldPath, newPath);
    }
    root.close();
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
        snprintf(newPath, sizeof(newPath), AUDIO_DIR "/%llu.opp",
                 (unsigned long long) ((int64_t) utteranceStartEpochMs + utterancePendingDelta));
        SD.rename(utterancePath, newPath);
        utterancePendingDelta = 0;
    }
    unlock();
    utteranceOpen = false;
    audioFileCount++;
    unsyncedBytes += utteranceBytes;
    Serial.printf("storage: utterance closed (%lu frames, %lu bytes)\n", (unsigned long) utteranceFrames,
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
    snprintf(path, sizeof(path), PHOTO_DIR "/%llu_%u.jpg", (unsigned long long) storage_now_ms(),
             (unsigned) orientation);
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

static int addManifestDir(const char *dir, uint8_t type, manifest_entry_t *entries, int count, int maxEntries)
{
    File root = SD.open(dir);
    if (!root) {
        return count;
    }
    for (File f = root.openNextFile(); f && count < maxEntries; f = root.openNextFile()) {
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

int storage_build_manifest(manifest_entry_t *entries, int maxEntries)
{
    if (!sdAvailable) {
        return 0;
    }
    lock();
    int count = addManifestDir(AUDIO_DIR, SYNC_FILE_TYPE_AUDIO, entries, 0, maxEntries);
    count = addManifestDir(PHOTO_DIR, SYNC_FILE_TYPE_PHOTO, entries, count, maxEntries);
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

// Delete every file in `dir`, skipping the currently-open utterance. Only
// entries already returned by openNextFile() are removed, which is safe to do
// mid-iteration (readdir does not revisit them). Returns the count removed.
static int deleteAllInDir(const char *dir)
{
    File root = SD.open(dir);
    if (!root) {
        return 0;
    }
    int removed = 0;
    for (File f = root.openNextFile(); f; f = root.openNextFile()) {
        if (f.isDirectory()) {
            f.close();
            continue;
        }
        char path[64];
        snprintf(path, sizeof(path), "%s/%s", dir, f.name());
        f.close();
        if (utteranceOpen && strcmp(path, utterancePath) == 0) {
            continue; // Still recording into this one; leave it for the next sync.
        }
        if (SD.remove(path)) {
            removed++;
        }
    }
    root.close();
    return removed;
}

int storage_delete_all()
{
    if (!sdAvailable) {
        return 0;
    }
    lock();
    if (readFile) { // Cached read handle may point at a file we are about to drop.
        readFile.close();
        readPath[0] = '\0';
    }
    int removed = deleteAllInDir(AUDIO_DIR) + deleteAllInDir(PHOTO_DIR);
    // Recompute from disk so the open utterance (if any) is still accounted for.
    audioFileCount = 0;
    photoFileCount = 0;
    unsyncedBytes = 0;
    scanDir(AUDIO_DIR, &audioFileCount, &unsyncedBytes);
    scanDir(PHOTO_DIR, &photoFileCount, &unsyncedBytes);
    unlock();
    return removed;
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
