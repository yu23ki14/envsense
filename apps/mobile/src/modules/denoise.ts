// Gentle, dependency-free denoiser for the transcription input.
//
// Operates on mono Float32 PCM (typically 16 kHz, as decoded for STT). Two
// stages, both deliberately mild — Whisper/Gemma are already noise-robust and
// over-processing adds artifacts that HURT recognition, so this only takes the
// edge off stationary background noise:
//
//   1. One-pole high-pass to drop sub-speech rumble (HVAC, handling).
//   2. A conservative STFT spectral gate: estimate a per-bin noise floor by
//      minimum statistics over the clip, then apply a Wiener-style gain with a
//      high spectral floor so speech is never gutted and musical noise stays low.
//
// Pure TypeScript (own radix-2 FFT), so it runs identically on native and web.

export interface DenoiseOptions {
  sampleRate?: number;
  /** High-pass corner in Hz (0 disables). */
  highPassHz?: number;
  /** STFT window size; must be a power of two. */
  fftSize?: number;
  /** Noise estimate multiplier before subtraction (>= 1, higher = more cut). */
  noiseOversubtract?: number;
  /** Minimum per-bin gain in [0,1] (higher = gentler, less musical noise). */
  spectralFloor?: number;
}

const DEFAULTS = {
  highPassHz: 90,
  fftSize: 512,
  noiseOversubtract: 1.5,
  spectralFloor: 0.3,
} as const;

export function denoisePcm(input: Float32Array, opts?: DenoiseOptions): Float32Array {
  const sampleRate = opts?.sampleRate ?? 16000;
  const highPassHz = opts?.highPassHz ?? DEFAULTS.highPassHz;
  const fftSize = opts?.fftSize ?? DEFAULTS.fftSize;
  const oversub = opts?.noiseOversubtract ?? DEFAULTS.noiseOversubtract;
  const floor = opts?.spectralFloor ?? DEFAULTS.spectralFloor;

  const hp = highPassHz > 0 ? highPass(input, sampleRate, highPassHz) : input.slice();
  // Too short for even one STFT frame: the high-pass alone is all we can do.
  if (hp.length < fftSize) return hp;
  return spectralGate(hp, fftSize, oversub, floor);
}

/** One-pole high-pass: y[n] = a*(y[n-1] + x[n] - x[n-1]). */
function highPass(x: Float32Array, sampleRate: number, cornerHz: number): Float32Array {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cornerHz);
  const a = rc / (rc + dt);
  const y = new Float32Array(x.length);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < x.length; i++) {
    const cur = x[i];
    const out = a * (prevY + cur - prevX);
    y[i] = out;
    prevY = out;
    prevX = cur;
  }
  return y;
}

function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }
  return w;
}

/**
 * Weighted overlap-add spectral gate. Hann analysis window at 50% hop (COLA = 1),
 * so the unmodified path reconstructs the input exactly; the gain only attenuates
 * bins dominated by the estimated stationary noise floor.
 */
function spectralGate(x: Float32Array, n: number, oversub: number, floor: number): Float32Array {
  const hop = n >> 1;
  const win = hannWindow(n);
  const numFrames = 1 + Math.floor((x.length - n) / hop);
  if (numFrames <= 0) return x;
  const bins = n / 2 + 1;

  // Pass 1: per-bin minimum magnitude across the clip ≈ the stationary noise
  // floor (relies on the clip containing pauses, which VAD-gated audio does).
  const noise = new Float32Array(bins).fill(Number.POSITIVE_INFINITY);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let f = 0; f < numFrames; f++) {
    loadFrame(x, f * hop, win, re, im);
    fft(re, im, false);
    for (let k = 0; k < bins; k++) {
      const mag = Math.hypot(re[k], im[k]);
      if (mag < noise[k]) noise[k] = mag;
    }
  }
  for (let k = 0; k < bins; k++) {
    if (!Number.isFinite(noise[k])) noise[k] = 0;
    noise[k] *= oversub;
  }

  // Pass 2: re-transform, attenuate, overlap-add.
  const out = new Float32Array(x.length);
  const norm = new Float32Array(x.length);
  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    loadFrame(x, start, win, re, im);
    fft(re, im, false);
    for (let k = 0; k < bins; k++) {
      const mag = Math.hypot(re[k], im[k]);
      let g = 1 - (oversub > 0 ? noise[k] / (mag + 1e-9) : 0);
      if (g < floor) g = floor;
      else if (g > 1) g = 1;
      re[k] *= g;
      im[k] *= g;
      // Mirror the gain onto the conjugate-symmetric upper half.
      if (k > 0 && k < n - k) {
        re[n - k] *= g;
        im[n - k] *= g;
      }
    }
    fft(re, im, true);
    for (let i = 0; i < n; i++) {
      out[start + i] += re[i];
      norm[start + i] += win[i];
    }
  }

  // Normalise by the accumulated analysis window; fall back to the high-passed
  // signal on the uncovered head/tail samples (norm ≈ 0) to avoid edge dropouts.
  for (let i = 0; i < x.length; i++) {
    out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : x[i];
  }
  return out;
}

/** Window a frame of `x` at `offset` into the (re, im) FFT buffers (im = 0). */
function loadFrame(
  x: Float32Array,
  offset: number,
  win: Float32Array,
  re: Float32Array,
  im: Float32Array,
): void {
  const n = re.length;
  for (let i = 0; i < n; i++) {
    re[i] = x[offset + i] * win[i];
    im[i] = 0;
  }
}

/** In-place iterative radix-2 Cooley-Tukey FFT. `inverse` also scales by 1/n. */
function fft(re: Float32Array, im: Float32Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wre = Math.cos(ang);
    const wim = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cre = 1;
      let cim = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vre = re[b] * cre - im[b] * cim;
        const vim = re[b] * cim + im[b] * cre;
        re[b] = re[a] - vre;
        im[b] = im[a] - vim;
        re[a] += vre;
        im[a] += vim;
        const ncre = cre * wre - cim * wim;
        cim = cre * wim + cim * wre;
        cre = ncre;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}
