/** keepAlive の web 実装。フォアグラウンドサービスの概念がないので no-op。 */
import type { KeepAlive } from './types';

export const keepAlive: KeepAlive = {
  async start() {},
  async stop() {},
};
