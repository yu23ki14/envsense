// Opus -> Ogg packaging for the transcription pipeline.
//
// The device streams raw Opus frames (20 ms each) over BLE. Groq's Whisper
// endpoint accepts Ogg-encapsulated Opus directly, so we only wrap the frames
// in an Ogg container here -- no decoding, no WebAssembly. This is pure
// TypeScript and runs identically on web and React Native (no Worker/WASM).

// The device encodes 20 ms frames. Opus granule positions are always counted
// at 48 kHz regardless of the input sample rate, so one frame == 960 samples.
const SAMPLES_PER_FRAME_48K = 960;
// Decoder pre-skip in 48 kHz samples (80 ms -- the libopus default). The exact
// value only trims a few ms of decoder warm-up and is irrelevant for STT.
const PRE_SKIP = 3840;
// Original input sample rate (informational only; decoders ignore it).
const INPUT_SAMPLE_RATE = 16000;
const CHANNELS = 1;
const MAX_SEGMENTS_PER_PAGE = 255;
const VENDOR = 'envsense';

// --- Ogg CRC-32 (poly 0x04c11db7, no input/output reflection, no final XOR) -
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n << 24;
    for (let k = 0; k < 8; k++) {
      c = (c & 0x80000000) !== 0 ? (c << 1) ^ 0x04c11db7 : c << 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function oggCrc32(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0x7f;
  }
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// Ogg lacing values for a packet: 255-byte segments, terminated by a final
// segment < 255 (a trailing 0 when the length is a multiple of 255).
function lacing(length: number): number[] {
  const segments: number[] = [];
  let remaining = length;
  while (remaining >= 255) {
    segments.push(255);
    remaining -= 255;
  }
  segments.push(remaining);
  return segments;
}

interface OggPageSpec {
  headerType: number; // 0x02 BOS, 0x04 EOS, 0x00 normal
  granulePosition: number;
  serial: number;
  sequence: number;
  segmentTable: number[];
  payload: Uint8Array;
}

function buildOggPage(spec: OggPageSpec): Uint8Array<ArrayBuffer> {
  const { headerType, granulePosition, serial, sequence, segmentTable, payload } = spec;
  const page = new Uint8Array(27 + segmentTable.length + payload.length);
  const view = new DataView(page.buffer);

  page.set(asciiBytes('OggS'), 0); // capture pattern
  page[4] = 0; // stream structure version
  page[5] = headerType;
  // granule position (64-bit LE); our values never exceed 32 bits.
  view.setUint32(6, granulePosition >>> 0, true);
  view.setUint32(10, Math.floor(granulePosition / 0x100000000) >>> 0, true);
  view.setUint32(14, serial >>> 0, true);
  view.setUint32(18, sequence >>> 0, true);
  view.setUint32(22, 0, true); // CRC placeholder
  page[26] = segmentTable.length;
  for (let i = 0; i < segmentTable.length; i++) {
    page[27 + i] = segmentTable[i];
  }
  page.set(payload, 27 + segmentTable.length);

  view.setUint32(22, oggCrc32(page), true);
  return page;
}

// Opus identification header (RFC 7845, channel mapping family 0).
function buildOpusHead(): Uint8Array {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set(asciiBytes('OpusHead'), 0);
  head[8] = 1; // version
  head[9] = CHANNELS;
  view.setUint16(10, PRE_SKIP, true);
  view.setUint32(12, INPUT_SAMPLE_RATE, true);
  view.setInt16(16, 0, true); // output gain
  head[18] = 0; // channel mapping family
  return head;
}

// Opus comment header (RFC 7845): vendor string + empty comment list.
function buildOpusTags(): Uint8Array {
  const vendor = asciiBytes(VENDOR);
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const view = new DataView(tags.buffer);
  tags.set(asciiBytes('OpusTags'), 0);
  view.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true); // user comment list length
  return tags;
}

// Header pages (OpusHead + OpusTags) occupy Ogg sequence numbers 0 and 1, so
// audio pages start at 2.
const FIRST_AUDIO_SEQUENCE = 2;

/** A fresh random Ogg bitstream serial number. */
export function randomOggSerial(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

/**
 * The two beginning-of-stream header pages for a new Opus bitstream: OpusHead
 * (BOS, sequence 0) and OpusTags (sequence 1). Write these once when opening a
 * session file, then append audio pages with {@link oggOpusAudioPages}.
 */
export function oggOpusHeaderBytes(serial: number): Uint8Array {
  const head = buildOpusHead();
  const tags = buildOpusTags();
  return concat([
    buildOggPage({
      headerType: 0x02,
      granulePosition: 0,
      serial,
      sequence: 0,
      segmentTable: lacing(head.length),
      payload: head,
    }),
    buildOggPage({
      headerType: 0x00,
      granulePosition: 0,
      serial,
      sequence: 1,
      segmentTable: lacing(tags.length),
      payload: tags,
    }),
  ]);
}

export interface OggAudioPages {
  bytes: Uint8Array;
  /** Page sequence number to pass as `startSequence` on the next append. */
  nextSequence: number;
  /** Cumulative frame count to pass as `startGranuleFrames` on the next append. */
  nextGranuleFrames: number;
}

/**
 * Build audio pages for a run of Opus frames, continuing an existing bitstream.
 * Pass the previous call's `nextSequence` / `nextGranuleFrames` to keep the
 * page sequence and granule positions monotonic across appends. Set `eos` only
 * on the final append of a stream.
 */
export function oggOpusAudioPages(opts: {
  frames: Uint8Array[];
  serial: number;
  startSequence: number;
  startGranuleFrames: number;
  eos?: boolean;
}): OggAudioPages {
  const { frames, serial, startSequence, startGranuleFrames, eos = false } = opts;
  if (frames.length === 0) {
    return {
      bytes: new Uint8Array(0),
      nextSequence: startSequence,
      nextGranuleFrames: startGranuleFrames,
    };
  }

  const pages: Uint8Array<ArrayBuffer>[] = [];
  let sequence = startSequence;
  let cumulativeFrames = startGranuleFrames;
  let index = 0;
  // Pack whole packets per page, capped at 255 lacing segments.
  while (index < frames.length) {
    const segmentTable: number[] = [];
    const chunks: Uint8Array[] = [];
    while (index < frames.length) {
      const segments = lacing(frames[index].length);
      if (segments.length > MAX_SEGMENTS_PER_PAGE) {
        throw new Error('oggOpusAudioPages: Opus frame too large for a single Ogg page');
      }
      if (segmentTable.length + segments.length > MAX_SEGMENTS_PER_PAGE) {
        break;
      }
      segmentTable.push(...segments);
      chunks.push(frames[index]);
      index++;
    }
    cumulativeFrames += chunks.length;
    const isLastPage = index >= frames.length;
    pages.push(
      buildOggPage({
        headerType: eos && isLastPage ? 0x04 : 0x00,
        granulePosition: cumulativeFrames * SAMPLES_PER_FRAME_48K,
        serial,
        sequence: sequence++,
        segmentTable,
        payload: concat(chunks),
      }),
    );
  }

  return { bytes: concat(pages), nextSequence: sequence, nextGranuleFrames: cumulativeFrames };
}

/**
 * Wrap raw Opus frames (one 20 ms frame per array entry) in a complete,
 * EOS-terminated Ogg container. Used for the transient per-segment file sent to
 * the transcription API. For the durable session file, use the incremental
 * {@link oggOpusHeaderBytes} + {@link oggOpusAudioPages} instead.
 */
export function opusFramesToOgg(frames: Uint8Array[]): Uint8Array {
  if (frames.length === 0) {
    throw new Error('opusFramesToOgg: no Opus frames provided');
  }
  const serial = randomOggSerial();
  const audio = oggOpusAudioPages({
    frames,
    serial,
    startSequence: FIRST_AUDIO_SEQUENCE,
    startGranuleFrames: 0,
    eos: true,
  });
  return concat([oggOpusHeaderBytes(serial), audio.bytes]);
}

/**
 * Same as {@link opusFramesToOgg} but returns a Blob with `audio/ogg` MIME.
 */
export function opusFramesToOggBlob(frames: Uint8Array[]): Blob {
  const bytes = opusFramesToOgg(frames);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/ogg' });
}
