#include <Arduino.h>

#include "app.h"

// Opus エンコード (opus_encode) はライブラリ内部で十数 KB のスタックを使う。
// 既定 8KB の loopTask スタックから呼ぶと最初のフレームでオーバーフローして
// クラッシュループになるため、loopTask のスタックを 16KB に拡張する。
SET_LOOP_TASK_STACK_SIZE(16 * 1024);

void setup()
{
    setup_app();
}

void loop()
{
    loop_app();
}
