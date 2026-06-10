import { secrets } from '../../data';
import { keys } from '../../keys';

/**
 * Groq API キーの解決。デバイス画面（SecureStore）で保存されたキーを最優先し、
 * 無ければビルド時の環境変数（EXPO_PUBLIC_GROQ_API_KEY）へフォールバックする。
 * SecureStore の読み出しは軽いので毎回読む（保存直後の反映にキャッシュ無効化が不要）。
 */
export async function getGroqApiKey(): Promise<string> {
  const stored = await secrets.getSecret('groqApiKey').catch(() => null);
  if (stored != null && stored.length > 0) return stored;
  return keys.groq;
}

export async function hasGroqApiKey(): Promise<boolean> {
  return (await getGroqApiKey()).length > 0;
}
