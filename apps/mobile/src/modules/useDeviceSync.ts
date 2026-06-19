/**
 * デバイスの未同期状況の購読と、手動同期の実行状態を一手に持つフック。
 * DeviceProvider が 1 回だけマウントし、画面はコンテキスト経由で読む。
 *
 * 接続のたびに TIME_SYNC へ現在時刻を書き込む（デバイスは RTC を持つが電源
 * 喪失でリセットされるため、SD 上のファイルのタイムスタンプはこれが頼り）。
 * SYNC_STATUS が読めない場合は旧ファームウェア（または SD 無し）なので
 * status は null のまま = UI は同期 UI を出さない。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { beginBackgroundWork } from './backgroundWork';
import type { BleDevice } from './ble';
import {
  type DeleteProgress,
  type DeviceSyncStatus,
  deleteAllDeviceFiles,
  ENVSENSE_SERVICE_UUID,
  parseSyncStatus,
  runDeviceSync,
  SYNC_STATUS_UUID,
  type SyncProgress,
  writeTimeSync,
} from './deviceSync';

export type DeviceSyncState = {
  /** デバイス側の未同期ファイル状況。取得不能（旧FW・未接続）は null。 */
  status: DeviceSyncStatus | null;
  syncing: boolean;
  progress: SyncProgress | null;
  error: string | null;
  startSync: () => Promise<void>;
  /** 転送せずにデバイス上の未同期ファイルを全消去する。 */
  deleteAll: () => Promise<void>;
  deleting: boolean;
  deleteProgress: DeleteProgress | null;
};

export function useDeviceSync(device: BleDevice | null): DeviceSyncState {
  const [status, setStatus] = useState<DeviceSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(null);

  useEffect(() => {
    setStatus(null);
    setError(null);
    if (device == null) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        await writeTimeSync(device);
      } catch (err) {
        console.warn('Time sync write failed (old firmware?)', err);
      }
      try {
        const service = await device.getService(ENVSENSE_SERVICE_UUID);
        const char = await service.getCharacteristic(SYNC_STATUS_UUID);
        const apply = (data: Uint8Array) => {
          const parsed = parseSyncStatus(data);
          if (parsed != null && !cancelled) setStatus(parsed);
        };
        apply(await char.read());
        unsubscribe = await char.subscribe((data) => {
          if (!cancelled) apply(data);
        });
      } catch (err) {
        console.warn('Sync status unavailable (old firmware?)', err);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [device]);

  const startSync = useCallback(async () => {
    if (device == null || syncing) return;
    setSyncing(true);
    setError(null);
    setProgress(null);
    // 同期中（転送 + 文字起こし flush）は keepAlive のフォアグラウンドサービスを維持する。
    const endWork = beginBackgroundWork();
    try {
      const result = await runDeviceSync(device, setProgress);
      console.log(`Sync complete: ${result.files} files (${result.skipped} skipped)`);
    } catch (err) {
      console.warn('Sync failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      endWork();
      setSyncing(false);
      setProgress(null);
    }
    // 完了直後の残量を反映する（デバイス側の定期 notify を待たない）。これは UI 上の
    // 進捗とは独立したベストエフォートの後処理にする。転送直後は BLE が混みやすく、
    // タイムアウトの無い read（ble.native.ts）がここで詰まると同期 UI が
    // 「文字起こしを仕上げています…」のまま固まるため（issue #74）、syncing/progress を
    // 先に解除してから読む。読めなくても定期 notify がいずれ status を更新する。
    try {
      const service = await device.getService(ENVSENSE_SERVICE_UUID);
      const char = await service.getCharacteristic(SYNC_STATUS_UUID);
      const parsed = parseSyncStatus(await char.read());
      if (parsed != null) setStatus(parsed);
    } catch (err) {
      console.warn('Post-sync status refresh failed (will rely on periodic notify)', err);
    }
  }, [device, syncing]);

  const deleteAll = useCallback(async () => {
    if (device == null || syncing || deleting) return;
    setDeleting(true);
    setError(null);
    setDeleteProgress(null);
    try {
      await deleteAllDeviceFiles(device, setDeleteProgress);
      const service = await device.getService(ENVSENSE_SERVICE_UUID);
      const char = await service.getCharacteristic(SYNC_STATUS_UUID);
      const parsed = parseSyncStatus(await char.read());
      if (parsed != null) setStatus(parsed);
    } catch (err) {
      console.warn('Delete-all failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
      setDeleteProgress(null);
    }
  }, [device, syncing, deleting]);

  return useMemo(
    () => ({ status, syncing, progress, error, startSync, deleteAll, deleting, deleteProgress }),
    [status, syncing, progress, error, startSync, deleteAll, deleting, deleteProgress],
  );
}
