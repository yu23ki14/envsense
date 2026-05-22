import { router } from 'expo-router';
import { ClipScreen, ScreenPlaceholder } from '../../src/components';

export default function DeviceRoute() {
  return (
    <ClipScreen>
      <ScreenPlaceholder
        title="デバイス"
        description="このタブにはデバイス情報と設定が表示されます。"
        actionLabel="エクスポートを開く"
        onAction={() => router.push('/export')}
      />
    </ClipScreen>
  );
}
