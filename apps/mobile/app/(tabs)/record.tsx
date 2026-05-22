import { router } from 'expo-router';
import { ClipScreen, ScreenPlaceholder } from '../../src/components';

export default function RecordRoute() {
  return (
    <ClipScreen>
      <ScreenPlaceholder
        title="記録"
        description="このタブにはこれまでの日々の一覧が表示されます。"
        actionLabel="日別ジャーナルを開く"
        onAction={() => router.push('/journal')}
      />
    </ClipScreen>
  );
}
