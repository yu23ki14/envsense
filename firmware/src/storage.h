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
// currently-open utterance file. Returns the entry count. The whole scan is one
// blocking call that can take seconds on a card with thousands of files (or a
// bloated FAT directory), so `onProgress` (if non-null) is invoked roughly every
// STORAGE_MANIFEST_PROGRESS_FILES files with the count scanned so far — the BLE
// sync uses it to emit a keep-alive so the app's manifest timer doesn't expire
// during the scan.
int storage_build_manifest(manifest_entry_t *entries, int maxEntries, void (*onProgress)(int scanned));
// Reads `len` bytes at `offset`; returns bytes actually read, < 0 on error.
// The transfer CRC32 is accumulated by the caller as it streams chunks.
int storage_read_file(const char *path, uint32_t offset, uint8_t *buf, size_t len);
bool storage_delete_file(const char *path, uint8_t type, uint32_t size);
// Delete-all (PURGE): reformat the card (f_mkfs) and recreate the dirs. This is
// O(1) regardless of file count and, crucially, resets the FAT directory table
// so openNextFile() never degrades from create/delete churn (see issue: a flat
// dir with thousands of churned entries made every SD op pathologically slow).
// Remounts and zeroes the in-RAM counters on success. Returns false on failure.
bool storage_format();
// Reset any unsynced directory that has drained to empty by rmdir+mkdir, which
// frees its (possibly bloated) FAT directory cluster chain. Cheap no-op when the
// dir still holds files. Call after a sync drains the backlog so long-lived,
// always-synced devices don't accumulate directory-table bloat over time.
void storage_compact_empty_dirs();
void storage_stats(uint16_t *audioCount, uint16_t *photoCount, uint32_t *totalBytes);

// Flush pending buffers and unmount (called before deep sleep).
void storage_shutdown();

#endif // STORAGE_H
