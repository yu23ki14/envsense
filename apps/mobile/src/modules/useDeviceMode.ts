/**
 * キャプチャモードの状態管理フック。DeviceProvider が 1 回だけマウントする。
 *
 * 接続のたびに Settings.capture.captureMode（ユーザーの意図）をデバイスへ書き込み、
 * デバイスが notify で返す「実効モード」を deviceMode として保持する（SD 無しで
 * 'local' を要求すると 'streaming' になる等、意図と実効はずれうる）。
 * useDeviceCapture はこの実効モードでライブストリーミング経路の有無を決める。
 * 旧ファームウェア（MODE_CONTROL 無し）では supported が false になり、
 * deviceMode は null のまま = 従来の SD 有無による自動判定で動く。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSettings, updateSettings } from '../data';
import type { BleDevice } from './ble';
import {
  type CaptureMode,
  readCaptureMode,
  subscribeCaptureMode,
  writeCaptureMode,
} from './deviceMode';

export type DeviceModeState = {
  /** デバイスが報告する実効モード。未接続・旧ファームウェアは null。 */
  deviceMode: CaptureMode | null;
  /** 接続中のデバイスがモード切替に対応しているか（未接続時は true のまま）。 */
  supported: boolean;
  /** 設定を更新し、接続中ならデバイスへも書き込む。 */
  setMode: (mode: CaptureMode) => Promise<void>;
};

export function useDeviceMode(device: BleDevice | null): DeviceModeState {
  const [deviceMode, setDeviceMode] = useState<CaptureMode | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setDeviceMode(null);
    setSupported(true);
    if (device == null) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        unsubscribe = await subscribeCaptureMode(device, (mode) => {
          if (!cancelled) setDeviceMode(mode);
        });
        const current = await readCaptureMode(device);
        if (cancelled) return;
        if (current != null) setDeviceMode(current);
        // 設定（ユーザーの意図）をデバイスへ反映する。拒否された場合（SD 無しで
        // 'local' 等）は notify で実効モードが返ってくるので、ここでは結果を待たない。
        const desired = getSettings().capture.captureMode;
        if (current !== desired) {
          await writeCaptureMode(device, desired);
        }
      } catch (err) {
        if (!cancelled) {
          setSupported(false);
          console.warn('Capture mode characteristic unavailable (old firmware?)', err);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [device]);

  const setMode = useCallback(
    async (mode: CaptureMode) => {
      updateSettings((s) => ({ ...s, capture: { ...s.capture, captureMode: mode } }));
      if (device == null) return; // 次回接続時に書き込まれる
      try {
        await writeCaptureMode(device, mode);
      } catch (err) {
        console.warn('Capture mode write failed', err);
      }
    },
    [device],
  );

  return useMemo(() => ({ deviceMode, supported, setMode }), [deviceMode, supported, setMode]);
}
