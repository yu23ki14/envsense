#ifndef STORAGE_H
#define STORAGE_H

#include <Arduino.h>
#include <stdint.h>

#include "config.h"

// microSD persistence for SD-first capture: audio utterances (.opp = length-
// prefixed Opus frames), photos (JPEG), and the manifest/stats the BLE sync
// protocol serves to the app. All SD access is serialized behind an internal
// mutex so the audio task (core1) and loop_app/BLE callbacks (core0) can both
// call in safely.

typedef struct {
    uint32_t id;         // Connection-scoped id assigned at manifest build time
    uint8_t type;        // SYNC_FILE_TYPE_AUDIO / SYNC_FILE_TYPE_PHOTO
    uint32_t size;       // File size in bytes
    uint64_t epochMs;    // Capture start time
    uint8_t orientation; // Photos only (image_orientation_t); 0 for audio
    char path[48];
} manifest_entry_t;

// Mount the card and scan existing files into the unsynced counters.
// Returns false (and leaves storage unavailable) when no card responds --
// callers fall back to the legacy live-streaming behavior.
bool storage_init();
bool storage_available();

// --- Clock -----------------------------------------------------------------
// Backed by settimeofday(); the RTC keeps counting through deep sleep, so the
// clock only becomes invalid after a full power loss.
void storage_set_time(uint64_t epochMs);
uint64_t storage_now_ms();
bool storage_clock_valid();

// --- Audio utterances --------------------------------------------------------
// begin/write/end are called from the audio task only. Files longer than
// AUDIO_FILE_MAX_MS are split transparently inside write_frame.
void storage_audio_begin_utterance(uint64_t startEpochMs);
void storage_audio_write_frame(const uint8_t *frame, uint16_t len);
void storage_audio_end_utterance();
bool storage_audio_utterance_open();

// --- Photos ------------------------------------------------------------------
bool storage_save_photo(const uint8_t *jpeg, size_t len, uint8_t orientation);

// --- Sync support ------------------------------------------------------------
// Builds the manifest into `entries` (caller-allocated, PSRAM) excluding the
// currently-open utterance file. Returns the entry count.
int storage_build_manifest(manifest_entry_t *entries, int maxEntries);
// Reads `len` bytes at `offset`; returns bytes actually read, < 0 on error.
// The transfer CRC32 is accumulated by the caller as it streams chunks.
int storage_read_file(const char *path, uint32_t offset, uint8_t *buf, size_t len);
bool storage_delete_file(const char *path, uint8_t type, uint32_t size);
// Deletes every unsynced file (audio + photo) without transferring, skipping
// the currently-open utterance. Returns the number of files removed and resets
// the unsynced counters.
int storage_delete_all();
void storage_stats(uint16_t *audioCount, uint16_t *photoCount, uint32_t *totalBytes);

// Flush pending buffers and unmount (called before deep sleep).
void storage_shutdown();

#endif // STORAGE_H
