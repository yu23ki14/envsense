import { Tabs } from 'expo-router';
import { ClipTabBar } from '../../src/components';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <ClipTabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="record" />
      <Tabs.Screen name="device" />
    </Tabs>
  );
}
