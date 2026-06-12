/** フォアグラウンドサービスの開始 / 停止。Android 以外（iOS / web）は no-op。 */
export type KeepAlive = {
  start(): Promise<void>;
  stop(): Promise<void>;
};
