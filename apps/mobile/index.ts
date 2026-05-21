// Unistyles の設定を最優先で実行する（あらゆる StyleSheet.create より前）
import './src/ui/unistyles';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
