import { Platform } from 'react-native';
import type { WhisperEngine } from './types';

export type { WhisperEngine, WhisperEngineResult } from './types';

// BLE 層（ble/index.ts）と同じ遅延ロード方式。dispatcher は index.ts に置く
// （`engine.ts` にすると Metro が `./whisper/engine` を `.native` 拡張で解決して
// engine.native.ts を引き、dispatcher が握り潰される）。web バンドルに whisper.rn /
// react-native-audio-api のネイティブブリッジを持ち込まないための分離でもある。
let enginePromise: Promise<WhisperEngine> | null = null;

export function loadWhisperEngine(): Promise<WhisperEngine> {
  if (enginePromise) return enginePromise;
  enginePromise = (Platform.OS === 'web' ? import('./engine.web') : import('./engine.native')).then(
    (m) => m.whisperEngine,
  );
  return enginePromise;
}
