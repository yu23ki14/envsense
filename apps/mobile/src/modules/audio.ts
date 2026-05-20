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

/**
 * Wrap raw Opus frames (one 20 ms frame per array entry) in an Ogg container.
 * The result is a `audio/ogg` Blob suitable for Groq's Whisper endpoint.
 */
export function opusFramesToOgg(frames: Uint8Array[]): Blob {
  if (frames.length === 0) {
    throw new Error('opusFramesToOgg: no Opus frames provided');
  }

  const serial = (Math.random() * 0x100000000) >>> 0;
  const pages: Uint8Array<ArrayBuffer>[] = [];
  let sequence = 0;

  // Page 0 -- beginning of stream, OpusHead alone.
  const head = buildOpusHead();
  pages.push(
    buildOggPage({
      headerType: 0x02,
      granulePosition: 0,
      serial,
      sequence: sequence++,
      segmentTable: lacing(head.length),
      payload: head,
    }),
  );

  // Page 1 -- OpusTags alone.
  const tags = buildOpusTags();
  pages.push(
    buildOggPage({
      headerType: 0x00,
      granulePosition: 0,
      serial,
      sequence: sequence++,
      segmentTable: lacing(tags.length),
      payload: tags,
    }),
  );

  // Pages 2+ -- audio. Pack whole packets, capped at 255 lacing segments.
  let cumulativeFrames = 0;
  let index = 0;
  while (index < frames.length) {
    const segmentTable: number[] = [];
    const chunks: Uint8Array[] = [];
    while (index < frames.length) {
      const segments = lacing(frames[index].length);
      if (segments.length > MAX_SEGMENTS_PER_PAGE) {
        throw new Error('opusFramesToOgg: Opus frame too large for a single Ogg page');
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
        headerType: isLastPage ? 0x04 : 0x00,
        granulePosition: cumulativeFrames * SAMPLES_PER_FRAME_48K,
        serial,
        sequence: sequence++,
        segmentTable,
        payload: concat(chunks),
      }),
    );
  }

  return new Blob(pages, { type: 'audio/ogg' });
}
