/**
 * Unistyles の初期化。
 *
 * このファイルはアプリのエントリ（index.ts）の先頭で import し、
 * いかなる `StyleSheet.create` よりも前に `StyleSheet.configure` を実行させる。
 */
import { StyleSheet } from 'react-native-unistyles';
import { breakpoints } from './theme/breakpoints';
import { themes } from './theme/themes';

type AppThemes = typeof themes;
type AppBreakpoints = typeof breakpoints;

declare module 'react-native-unistyles' {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

StyleSheet.configure({
  themes,
  breakpoints,
  settings: {
    initialTheme: 'light',
  },
});
