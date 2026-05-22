import { ClipScreen, ScreenPlaceholder } from '../../src/components';

export default function TodayRoute() {
  return (
    <ClipScreen>
      <ScreenPlaceholder
        title="今日"
        description="このタブには今日の記録フィードが表示されます。"
      />
    </ClipScreen>
  );
}
