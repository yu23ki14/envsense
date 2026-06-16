/**
 * 取り込み時の写真重複排除に使う知覚ハッシュ（dHash）。
 *
 * JPEG を 9×8 グレースケールへ縮小し、横方向の隣接画素の明暗関係から 64bit の
 * dHash を作る（16 桁 hex）。手ブレや明るさのわずかな差では値がほとんど変わらず、
 * 構図が変わると大きく変わるので、近傍写真とのハミング距離で「ほぼ同じ画像」を
 * 検出できる。純 JS の jpeg-js を使うため iOS / Android / web すべてで動く
 * （`useTArray: true` で Buffer 非依存）。
 */
import { decode } from 'jpeg-js';

// この距離以下なら「ほぼ同じ画像」とみなす（64bit 中の差分ビット数）。
export const DUPLICATE_HAMMING_THRESHOLD = 8;

// dHash のサンプル格子。横は隣接比較のため +1 列（9 列 = 8 比較）、縦 8 行で 64bit。
const SAMPLE_W = 9;
const SAMPLE_H = 8;

/** hex 1 桁（4bit）あたりの立っているビット数。ハミング距離の popcount 用。 */
const NIBBLE_POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * JPEG バイト列から dHash（16 桁 hex）を計算する。デコードできない、または
 * サイズが取れない場合は null を返す（呼び出し側は重複判定をスキップして通常保存。
 * 「迷ったら消さない」安全側）。
 */
export function computeDHash(jpegBytes: Uint8Array): string | null {
  let image: { width: number; height: number; data: Uint8Array };
  try {
    image = decode(jpegBytes, { useTArray: true, formatAsRGBA: true });
  } catch {
    return null;
  }
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) return null;

  // SAMPLE_W×SAMPLE_H へボックス平均で縮小しつつ輝度（ITU-R BT.601）に落とす。
  const gray = new Float64Array(SAMPLE_W * SAMPLE_H);
  for (let cy = 0; cy < SAMPLE_H; cy++) {
    const y0 = Math.floor((cy * height) / SAMPLE_H);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / SAMPLE_H));
    for (let cx = 0; cx < SAMPLE_W; cx++) {
      const x0 = Math.floor((cx * width) / SAMPLE_W);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / SAMPLE_W));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
          count += 1;
        }
      }
      gray[cy * SAMPLE_W + cx] = count > 0 ? sum / count : 0;
    }
  }

  // 各画素を右隣と比較して 1bit、行ごとに 8bit、計 64bit を 16 桁 hex に詰める。
  let hash = '';
  let nibble = 0;
  let bits = 0;
  for (let cy = 0; cy < SAMPLE_H; cy++) {
    for (let cx = 0; cx < SAMPLE_W - 1; cx++) {
      const left = gray[cy * SAMPLE_W + cx] ?? 0;
      const right = gray[cy * SAMPLE_W + cx + 1] ?? 0;
      nibble = (nibble << 1) | (left < right ? 1 : 0);
      bits += 1;
      if (bits === 4) {
        hash += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hash;
}

/** 2 つの dHash（同じ桁数の hex）のハミング距離。桁数が違えば比較不能として +∞。 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = Number.parseInt(a[i] ?? '0', 16) ^ Number.parseInt(b[i] ?? '0', 16);
    dist += NIBBLE_POPCOUNT[xor] ?? 0;
  }
  return dist;
}

/** 2 つの dHash が「ほぼ同じ画像」か。しきい値はビット差分の上限。 */
export function isDuplicateHash(
  a: string,
  b: string,
  threshold: number = DUPLICATE_HAMMING_THRESHOLD,
): boolean {
  return hammingDistance(a, b) <= threshold;
}
