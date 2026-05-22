// Unistyles の設定を最優先で実行する（あらゆる StyleSheet.create より前）。
import './src/ui/unistyles';

// expo-router のエントリ。app/ 配下のファイルベースルートをマウントし、
// ルートコンポーネントを登録する。
import 'expo-router/entry';
