// envsense クリップ筐体 — パラメータ定義 (Phase 1 / #2)
//
// 値の単一ソースは dimensions.md。ここの「実測値」変数名は dimensions.md の
// 「OpenSCAD 変数名」列と完全一致させること（hardware/CLAUDE.md の規約）。
//
// 座標系（dimensions.md の規約に準拠）:
//   原点  = XIAO メイン基板の USB-C 側短辺の角
//   +X    = 基板長手方向（USB-C 端 → 反対端）, 0..board_l
//   +Y    = 基板幅方向, 0..board_w
//   +Z    = 厚み方向。z=0 はメイン基板の上面（USB-C 側）。
//           +Z = 上面（USB-C 側）/ -Z = 下面（Sense 拡張ボード・カメラ側）
//
// 「実測値」と「はめ合い後の値(_fit)」は分離する。実測は素のまま、
// クリアランスはここで足す（dimensions.md の測定ルール）。

// ===== 1. XIAO ESP32S3 メイン基板（実測値） =====
board_l      = 21.25;   // 基板 長さ
board_w      = 17.6;    // 基板 幅
pcb_t        = 1.15;    // PCB 厚み
corner_r     = 1.5;     // 角 R
usb_overhang = 0.85;    // USB-C 突き出し量
usb_w        = 8.9;     // USB-C コネクタ 幅
usb_h        = 3.0;     // USB-C コネクタ 高さ（筐体内 最高部品）
usb_open_w   = 8.3;     // USB-C 開口 幅（受け口 実測）
usb_open_h   = 2.5;     // USB-C 開口 高さ（受け口 実測）
usb_z        = 0.2;     // USB-C 開口 下端の基板上面からの高さ
top_clr      = 3.0;     // 上面 最大部品高さ（= usb_h）
pin_pitch    = 2.54;    // ピン ピッチ（規格）

// ===== 2. Sense 拡張ボード（実測値, ローカル原点） =====
sense_l     = 15.4;     // 外形 長さ
sense_w     = 17.6;     // 外形 幅
sense_t     = 1.1;      // PCB 厚み
b2b_gap     = 2.7;      // B2B コネクタ高さ（基板間の隙間）
mic_xy      = [6.6, 2]; // PDM マイク穴 位置（拡張ボード ローカル）
cam_fpc_xy  = [8.8, 9]; // カメラ FPC コネクタ 位置（拡張ボード ローカル）

// ===== 3. 合体状態（実測値） =====
assy_h      = 7.8;          // 合体時 総厚（カメラ除く）
assy_offset = [6.3, 0];     // 拡張ボードの主基板に対するズレ X/Y

// ===== 4. OV2640 カメラモジュール（実測値） =====
cam_l    = 7.8;             // カメラ基板 長さ
cam_w    = 7.8;             // カメラ基板 幅
cam_t    = 1.9;             // カメラ基板 厚み
lens_d   = 6;               // レンズホルダー外径（= 前面レンズ穴径の基準）
lens_h   = 3.35;            // レンズホルダー突き出し高さ
lens_xy  = [3.9, 3.9];      // レンズ光軸（カメラ基板中心からのオフセット）
fpc_w    = 6;               // FPC 幅
fpc_l    = 8.7;             // FPC 長さ

// ===== 5. バッテリー（実測値） =====
bat_l       = 25.5;         // セル本体 長さ
bat_w       = 19.5;         // セル本体 幅
bat_t       = 6.7;          // セル本体 厚み（最厚部）
bat_pcm_l   = 6.6;          // PCM 張り出し
bat_wire_d  = 0.7;          // リード線 線径

// =====================================================================
// 設計パラメータ（はめ合い・壁厚・造形）— ここを OEM のプロセスに合わせて調整
// =====================================================================

// 造形プロセス別の既定値の目安:
//   FDM      : wall 1.6 / clr 0.3
//   SLA/MJF  : wall 1.0 / clr 0.15
clr        = 0.3;   // 部品まわりの一般クリアランス（片側）
wall       = 1.6;   // 一般壁厚
wall_touch = 1.6;   // タッチ面（カメラ側 = 下面）の壁厚。静電容量が抜けるよう 1.5–2.0
lip_h      = 2.0;   // 本体/蓋の合わせ目リップ（印籠）の高さ
lip_t      = 1.0;   // リップの厚み
lip_clr    = 0.15;  // リップのはめ合いクリアランス

// はめ合い後の値（実測 + 余裕）
bat_t_fit  = bat_t + 1.0;   // バッテリー厚みは膨張ぶん +1mm（dimensions.md ルール）

// 部品配置の前提（要確認の設計判断 — 下記 TODO 参照）
bat_gap    = 0.5;           // カメラ面とバッテリー上面の仕切り
// TODO[設計判断]: バッテリーは「基板スタックの背面に積層」を仮定している。
//   横並びにする場合は cav_w/cav_h と battery 配置を切り替える。
bat_off    = [0, 0];        // バッテリーの XY 微調整（cavity 中心基準）

// ===== 派生：Z レイヤ（parts と enclosure で共有） =====
z_board_top = 0;
z_board_bot = z_board_top - pcb_t;
z_sense_top = z_board_bot - b2b_gap;
z_sense_bot = z_sense_top - sense_t;
z_cam_bot   = z_sense_bot - cam_t;
z_bat_top   = z_cam_bot - bat_gap;
z_bat_bot   = z_bat_top - bat_t_fit;
z_usb_top   = usb_h;

// ===== 派生：内部キャビティ寸法 =====
// 基板と（積層した）バッテリーの両フットプリントを内包し、clr を足したもの。
cav_l = max(board_l, bat_l) + 2 * clr;
cav_w = max(board_w, bat_w) + 2 * clr;
cav_h = (z_usb_top - z_bat_bot) + 2 * clr;

// キャビティ中心（基板フットプリント中心に揃える）
cav_cx = board_l / 2;
cav_cy = board_w / 2;

// 描画解像度。プレビューは粗く、書き出し(clip.scad の export)で上げる。
$fn = $preview ? 32 : 96;
