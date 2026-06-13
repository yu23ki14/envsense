/**
 * 「バックグラウンドでも続けたい処理」が進行中かどうかの共有シグナル。
 *
 * 同期（runDeviceSync）と文字起こし（ingest キュー / 再開処理）が begin/end を
 * 呼び、useDeviceKeepAlive がこれを見て BLE 切断後もフォアグラウンドサービスを
 * 維持する（Android）。React の外からも使えるよう素のカウンタ + リスナで持つ。
 */
import { useSyncExternalStore } from 'react';

let activeCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 処理の開始を宣言する。戻り値の関数で終了を宣言する（多重呼び出しは無視）。 */
export function beginBackgroundWork(): () => void {
  activeCount += 1;
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeCount -= 1;
    emit();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isActive(): boolean {
  return activeCount > 0;
}

export function useBackgroundWorkActive(): boolean {
  return useSyncExternalStore(subscribe, isActive, isActive);
}
