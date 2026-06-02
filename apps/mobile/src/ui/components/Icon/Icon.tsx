/**
 * Icon — アイコンの公開コンポーネント。
 *
 * `name` でセマンティックなアイコンを、`color` でテーマのカラーロールを指定する。
 * アイコンライブラリ（lucide-react-native）への依存は registry とこのファイルに
 * 閉じ込め、画面側はライブラリを直接 import しない。
 */
import type { LucideIcon } from 'lucide-react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { ColorScheme } from '../../theme/semantic';
import { type IconName, iconRegistry } from './registry';

export type IconProps = {
  name: IconName;
  /** ピクセルサイズ。既定 20。 */
  size?: number;
  /** テーマのカラーロール。既定 'text'。 */
  color?: keyof ColorScheme;
  /** 線の太さ。未指定なら lucide の既定値。 */
  strokeWidth?: number;
};

export function Icon({ name, size = 20, color = 'text', strokeWidth }: IconProps) {
  const { theme } = useUnistyles();
  const Glyph: LucideIcon = iconRegistry[name];

  return <Glyph size={size} color={theme.colors[color]} strokeWidth={strokeWidth} />;
}
