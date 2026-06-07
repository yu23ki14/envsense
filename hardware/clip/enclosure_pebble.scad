// envsense クリップ筐体 — pebble バリアントのシェル + 裏面クリップ (#2 / プロダクト外観)
//
// 構成:
//   - 外形      : 川石モチーフ（スーパー楕円プレート → クラウンへ hull で滑らかに丸める。裏面はフラット）
//   - 内部      : enclosure.scad のキャビティ/開口/基板リテンションをそのまま流用
//   - 合わせ目  : enclosure.scad の印籠リップ/溝を流用（キャビティ矩形基準なので石外形でも内側に収まる）
//   - クリップ  : ピボット＋トーションバネ式。本体側ヒンジボス + 可動クリップ腕（別パーツ書き出し）
//
// enclosure.scad から流用する module:
//   cavity() / cut_usb() / cut_lens() / cut_mic() / corner_grips() / mating_lip() / mating_groove()
// これらは params.scad のキャビティ寸法基準なので、石外形でも壁内に収まる（側壁が十分厚いため）。

include <params_pebble.scad>
use <parts.scad>
use <enclosure.scad>

// =====================================================================
// 2D ヘルパ: スーパー楕円
// =====================================================================
// |x/a|^n + |y/b|^n = 1 の輪郭。n=2 で楕円、n を上げると角丸長方形に近づく。
function se_pt(t, a, b, n) =
    let(c = cos(t), s = sin(t))
        [a * sign(c) * pow(abs(c), 2 / n), b * sign(s) * pow(abs(s), 2 / n)];

module superellipse2d(a, b, n, seg = 64) {
    polygon([for (i = [0:seg - 1]) se_pt(360 * i / seg, a, b, n)]);
}

// =====================================================================
// 外形ソリッド（石モチーフ）
// =====================================================================
// 3 段の輪郭を hull でつなぎ、膨らみのある石形状にする:
//   1) 裏面プレート: 少し内側に絞ったフラット面（クリップ座。底エッジを尖らせない）
//   2) ウエスト   : 最大幅(peb_l×peb_w)。側面を凸に膨らませる
//   3) クラウン   : キャビティ平面を内包し天面を球で丸める（天面/上側壁の壁厚を保証）
module pebble_outer_solid() {
    hull() {
        // 1) 裏面プレート（フラット・内側に bottom_inset 絞り）
        translate([peb_cx, peb_cy, peb_z_bot])
            linear_extrude(height = 0.1)
                superellipse2d(peb_l / 2 - bottom_inset, peb_w / 2 - bottom_inset, peb_n, peb_seg);
        // 2) ウエスト（最大幅）
        translate([peb_cx, peb_cy, peb_z_bot + waist_h])
            linear_extrude(height = 0.1)
                superellipse2d(peb_l / 2, peb_w / 2, peb_n, peb_seg);
        // 3) クラウン（キャビティ平面を内包。天面を球で丸める）
        translate([peb_cx, peb_cy, peb_z_top - crown_round])
            minkowski() {
                linear_extrude(height = 0.1)
                    superellipse2d(crown_a, crown_b, peb_n, peb_seg);
                sphere(r = crown_round);
            }
    }
}

// USB-C 開口（石 専用）: 厚い頭壁(7.5mm)を貫く「ザグリ＋スロット」。
//   - 金属スロット : 受け口より広く、奥(受け口貫通)まで掘る → プラグ金属部の進入路
//   - 外側ザグリ   : オーバーモールド(コネクタ樹脂)が沈む大きめの座 → 実効壁厚を詰める
// box の cut_usb は薄壁前提で外面まで届かないため、石ではこちらを使う。
module cut_usb_peb() {
    z0     = z_board_top + usb_z;          // 開口下端（受け口下端）
    zc     = z0 + usb_plug_h / 2;          // 開口の z 中心
    x_out  = (peb_cx - peb_l / 2) - 3;     // 石頭の外側（確実に外面より外）
    x_slot = usb_body_l + 1;               // 受け口を貫く奥
    well_d = (-usb_overhang) - usb_well_clr - x_out;   // ザグリ深さ（受け口前面の手前まで）
    // 金属スロット（全長）
    translate([x_out, peb_cy - usb_plug_w / 2, z0])
        cube([x_slot - x_out, usb_plug_w, usb_plug_h]);
    // オーバーモールド・ザグリ（外側・大きめ）
    translate([x_out, peb_cy - usb_well_w / 2, zc - usb_well_h / 2])
        cube([well_d, usb_well_w, usb_well_h]);
}

// シェル本体（分割前）: 外形 − キャビティ − 各開口、その後に基板リテンションを union。
module pebble_shell_solid() {
    difference() {
        pebble_outer_solid();
        cavity();
        cut_usb_peb();
        cut_lens();
        cut_mic();
    }
    corner_grips();   // キャビティ減算後に union（隅クランプは意図的にキャビティ内へ張り出す）
}

// =====================================================================
// クリップ: 本体側ヒンジボス
// =====================================================================
// 裏面(-Z)の頭寄りに 2 ボス。中央(clip_boss_gap)に腕のナックルとバネが入る。
// ★これがクリップを筐体へ固定する要：ピン座を「スナップ挿入」式にしてピンを捕捉する。
//   ピン座は Y 軸の円筒。-Z（裏面外側）から座へ伸びるスリットはピン径よりわずかに狭く、
//   ピンを押し込むと脚がしなって座に嵌り、軸方向にも径方向にも保持される（=本体に固定）。
//   腕のナックルにピンを通してから、ピンごと両ボス座へスナップして組む。
//   バネの固定脚を受ける座は、バネ選定後に追加（dimensions.md / 別途）。
module clip_bosses() {
    z_top    = peb_z_bot + clip_boss_over;            // 裏面壁へ少し食い込む
    z_bot    = clip_pin_z - clip_pin_d / 2 - 1.4;    // ピン下に保持肉を残す
    slit_w   = clip_pin_d * 0.85;                     // スナップ保持スリット幅（ピンより狭い）
    difference() {
        for (s = [-1, 1]) {
            yb = clip_pin_y + s * (clip_boss_gap / 2 + clip_boss_w / 2);
            translate([clip_pin_x - clip_boss_l / 2, yb - clip_boss_w / 2, z_bot])
                cube([clip_boss_l, clip_boss_w, z_top - z_bot]);
        }
        // ピン座（Y 軸円筒シート）
        translate([clip_pin_x, clip_pin_y - peb_w, clip_pin_z])
            rotate([-90, 0, 0])
                cylinder(d = clip_pin_d + 2 * clr, h = 2 * peb_w);
        // スナップ挿入スリット（-Z 外側 → 座。ピンより狭くして抜け止め）
        translate([clip_pin_x - slit_w / 2, clip_pin_y - peb_w, z_bot - 1])
            cube([slit_w, 2 * peb_w, clip_pin_z - (z_bot - 1)]);
    }
}

// =====================================================================
// クリップ: 可動腕（別パーツとして書き出し）
// =====================================================================
// ナックル（barrel でピンを抱く。+Y 寄せ。-Y にコイルを置く）＋ 裏面を覆う有機パッド ＋
// 先端の掴み返し ＋ ランヤードタブ（溝付き）。腕側のバネ脚スロットも持つ。閉位置で表示。
module clip_arm() {
    xh      = clip_pin_x + clip_boss_l / 2 + 0.5;            // パッド頭縁（ボスより尾側）
    pad_cx  = xh + clip_arm_l / 2;                            // パッド中心 X
    az_top  = peb_z_bot - clip_gap;                           // 裏面側の面
    az_bot  = az_top - clip_arm_t;                            // 外側の面
    tip_x   = xh + clip_arm_l;                                // パッド尾縁
    knu_od  = clip_pin_d + 2 * 1.4;                          // ナックル外径 = 6.4
    knu_w   = 5;                                              // ナックル幅(Y)
    knu_y0  = peb_cy + 2.5 - knu_w / 2;                      // ナックルは +Y 寄せ（-Y にコイル）
    difference() {
        union() {
            // 有機パッド（裏面を覆う envsense ロゴ面）
            translate([pad_cx, peb_cy, az_bot])
                linear_extrude(height = clip_arm_t)
                    superellipse2d(clip_arm_l / 2, clip_arm_w / 2, clip_arm_n, peb_seg);
            // ナックル barrel（ピンを抱く。裏面直下まで届く）
            translate([clip_pin_x, knu_y0, clip_pin_z])
                rotate([-90, 0, 0]) cylinder(d = knu_od, h = knu_w);
            // ナックル→パッドのネック
            hull() {
                translate([clip_pin_x, knu_y0, clip_pin_z])
                    rotate([-90, 0, 0]) cylinder(d = knu_od, h = knu_w);
                translate([xh, peb_cy - clip_arm_w / 3, az_bot])
                    cube([0.1, clip_arm_w * 2 / 3, clip_arm_t]);
            }
            // 先端 掴み返し（パッド面から裏面へ斜めに立ち上がり、先端で裏面に接して掴む）
            hull() {
                translate([tip_x - clip_lip_l, peb_cy - clip_arm_w / 3, az_bot])
                    cube([0.1, clip_arm_w * 2 / 3, clip_arm_t]);
                translate([tip_x - 0.1, peb_cy - clip_arm_w / 3, az_bot])
                    cube([0.1, clip_arm_w * 2 / 3, (peb_z_bot - 0.1) - az_bot]);
            }
            // ランヤードタブ（尾へ張り出す）
            translate([tip_x, peb_cy - lanyard_w / 2 - 1.5, az_bot])
                cube([lanyard_tab_l, lanyard_w + 3, clip_arm_t]);
        }
        // ピン穴（Y 軸貫通）
        translate([clip_pin_x, peb_cy - peb_w, clip_pin_z])
            rotate([-90, 0, 0])
                cylinder(d = clip_pin_d + 2 * clr, h = 2 * peb_w);
        // 腕側 バネ脚スロット（コイル近傍 → +X。可動脚を受けて腕を駆動。実装で角度微調整）
        // TODO[バネ]: 実バネの脚長・曲げが出たら角度/深さを確定。
        translate([clip_pin_x, clip_spring_y - (clip_spring_wire + 2 * clr) / 2, az_top - 1.2])
            cube([clip_spring_leg * 0.6, clip_spring_wire + 2 * clr, 1.4]);
        // ランヤード溝
        translate([tip_x + (lanyard_tab_l - lanyard_l) / 2, peb_cy - lanyard_w / 2, az_bot - 1])
            cube([lanyard_l, lanyard_w, clip_arm_t + 2]);
    }
}

// 本体側 バネ固定脚のアンカー（差し込み穴）。固定脚は -Y 側ボス内へ逃がす。
//   ※ 裏壁は薄い(1.6mm)ので +Z に掘るとキャビティ(電池室)を貫く → ボス肉内(裏面より下)に留める。
// TODO[バネ]: 実バネ(脚16/巻右/使用角57°)合わせで位置・深さ・向きを最終化。脚は切詰め。
module clip_leg_anchor_body() {
    yb   = clip_pin_y - (clip_boss_gap / 2 + clip_boss_w / 2);   // -Y ボス中心
    zleg = clip_pin_z - clip_pin_d / 2 - clip_spring_wire;       // ピン直下（ボス肉内）
    translate([clip_pin_x - clip_boss_l / 2 - 1, yb, zleg])
        rotate([0, 90, 0]) cylinder(d = clip_spring_wire + 2 * clr, h = clip_boss_l + 2);
}

// クリップ: ピン・バネのモック（別調達品。アセンブリ確認用）
module clip_pin_mock() {
    color("Silver")
        translate([clip_pin_x, clip_pin_y - (clip_boss_gap / 2 + clip_boss_w), clip_pin_z])
            rotate([-90, 0, 0])
                cylinder(d = clip_pin_d, h = clip_boss_gap + 2 * clip_boss_w);
}

module clip_spring_mock() {
    // 選定トーションばね（33-0444 / 内4・線0.6・OD5.2）のコイル＋脚を簡易表現。
    color("DimGray") {
        // コイル部（軸方向 clip_spring_w、-Y 寄り）
        translate([clip_pin_x, clip_spring_y - clip_spring_w / 2, clip_pin_z])
            rotate([-90, 0, 0])
                difference() {
                    cylinder(d = clip_spring_od, h = clip_spring_w);
                    translate([0, 0, -1]) cylinder(d = clip_spring_id, h = clip_spring_w + 2);
                }
        // 固定脚（コイル → -Y 側ボスのアンカーへ。代表表示）
        translate([clip_pin_x - clip_spring_wire / 2,
                   clip_pin_y - (clip_boss_gap / 2 + clip_boss_w / 2),
                   clip_pin_z - clip_spring_wire / 2])
            cube([clip_spring_wire,
                  clip_spring_y - (clip_pin_y - (clip_boss_gap / 2 + clip_boss_w / 2)),
                  clip_spring_wire]);
        // 可動脚（+X 方向：腕スロットへ）
        translate([clip_pin_x, clip_spring_y - clip_spring_wire / 2, peb_z_bot - clip_gap - clip_spring_wire])
            cube([clip_spring_leg * 0.6, clip_spring_wire, clip_spring_wire]);
    }
}

// =====================================================================
// 合わせ目のスナップ嵌合（印籠リップに併設）
// =====================================================================
// snap_beads : 舌(mating_lip)の外面に付く半円ビード。bottom に union。
// snap_pockets: 蓋(top)の溝外壁に掘るキャッチポケット。top から difference。
// 長辺の両面・左右 2 箇所（計 4 個）。被せると舌が内へ撓み、ビードがポケットへ落ちて係止。
module snap_beads() {
    for (px = snap_xs)
        for (face = [cav_y0 - lip_t, cav_y1 + lip_t])
            translate([px - snap_len / 2, face, snap_z])
                rotate([0, 90, 0])
                    cylinder(r = snap_proj, h = snap_len, $fn = 24);
}

module snap_pockets() {
    depth = snap_proj + 0.6;                    // ビードが収まる外向き深さ
    z0    = snap_z - 0.2;                       // ポケット下端（直下が係止リッジ＝抜け止め）
    z1    = lip_h + 3;                          // 上は開放（挿入路）
    for (px = snap_xs)
        for (s = [[cav_y0 - lip_t, -1], [cav_y1 + lip_t, 1]]) {
            face = s[0]; dir = s[1];
            ya = face; yb = face + dir * depth;
            translate([px - (snap_len + 1) / 2, min(ya, yb), z0])
                cube([snap_len + 1, abs(yb - ya), z1 - z0]);
        }
}

// =====================================================================
// 分割（z=0 で本体/蓋）
// =====================================================================
// bottom = z<=0（バッテリー / メイン基板 / クリップ側）, top = z>=0（USB-C / Sense / カメラ側）
// クリップ機構(ボス)は裏面側 → bottom に union。
module pebble_enclosure_bottom() {
    big = 300;
    difference() {
        union() {
            intersection() {
                pebble_shell_solid();
                translate([peb_cx - big / 2, peb_cy - big / 2, -big]) cube([big, big, big]);
            }
            mating_lip();      // 合わせ目の舌（z=0 → +lip_h、キャビティ矩形基準）
            snap_beads();      // 舌外面のスナップビード（係止突起）
            clip_bosses();     // 裏面のヒンジボス
        }
        // 開口はリップ/ボスにも適用（プラグ挿入路を塞がない）
        cut_usb_peb();
        cut_lens();
        cut_mic();
        clip_leg_anchor_body();   // バネ固定脚の差し込み穴
    }
}

module pebble_enclosure_top() {
    big = 300;
    difference() {
        intersection() {
            pebble_shell_solid();
            translate([peb_cx - big / 2, peb_cy - big / 2, 0]) cube([big, big, big]);
        }
        mating_groove();       // 舌を受ける溝
        snap_pockets();        // ビードを受ける係止ポケット
    }
}

// このファイル単体で開いたときはシェル + クリップ腕を表示
pebble_shell_solid();
clip_arm();
