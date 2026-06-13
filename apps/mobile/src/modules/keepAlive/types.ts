/** 常駐通知に出す文言。状態（接続中 / 処理中）に応じて呼び出し側が切り替える。 */
export type KeepAliveNotification = {
  title: string;
  body: string;
};

/**
 * フォアグラウンドサービスの開始 / 停止。Android 以外（iOS / web）は no-op。
 * 起動中に start() を再度呼ぶと通知の文言だけ更新される。
 */
export type KeepAlive = {
  start(notification: KeepAliveNotification): Promise<void>;
  stop(): Promise<void>;
};
