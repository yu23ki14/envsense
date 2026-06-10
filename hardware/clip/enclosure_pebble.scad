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

// X 方向に伸びる角丸バー（断面 = YZ 平面の角丸矩形。USB 開口用）。
//   wy=幅(Y) / hz=高さ(Z) / r=コーナー半径（min(wy,hz)/2 で full radius=スタジアム形）。
//   原点から +X へ len 伸び、断面は (peb_cy, zc) 等の translate 側で位置決め。
module rbar_x(len, wy, hz, r) {
    rr = min(r, wy / 2, hz / 2);
    rotate([0, 90, 0])
        linear_extrude(height = len)
            hull() for (a = [-1, 1], b = [-1, 1])
                translate([a * (hz / 2 - rr), b * (wy / 2 - rr)])
                    circle(r = rr, $fn = 48);
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
    // 金属スロット（全長・断面 full radius）。zc が断面中心。
    translate([x_out, peb_cy, zc])
        rbar_x(x_slot - x_out, usb_plug_w, usb_plug_h, min(usb_plug_w, usb_plug_h) / 2);
    // オーバーモールド・ザグリ（外側・断面 full radius）。スロットを内包する大きさ。
    translate([x_out, peb_cy, zc])
        rbar_x(well_d, usb_well_w, usb_well_h, min(usb_well_w, usb_well_h) / 2);
    // 下開放ポータル: スロットの下半分を角形にし、合わせ面(z=0)の下まで開ける。
    //   旧形状はスロット下端(z=usb_z=0.2)と合わせ面の間に高さ 0.2mm の糸状壁が残り
    //   印刷不能だった。受け口下端は usb_z にあるのでシェル側の下縁は不要。
    translate([x_out, peb_cy - usb_plug_w / 2, -0.1])
        cube([x_slot - x_out, usb_plug_w, zc + 0.1]);
    // 舌の薄片除去: ザグリ(井戸 x ≤ -3.1)が舌の帯(x = -3.9..-2.9)を貫通して厚さ 0.2mm
    //   の薄板を残し印刷不能だったため、開口幅では舌の帯を合わせ面の下まで全て払う
    //   （舌のリングはこの幅だけ途切れる。box の「開口はリップにも適用」と同じ扱い）。
    //   x はボトムの溝の外/内の壁面に揃えて止め、薄片もリム残し欠けも出さない。
    translate([cav_x0 - (lip_off + lip_t + lip_clr) - 0.1, peb_cy - usb_plug_w / 2, -(lip_h + 0.3)])
        cube([lip_t + 2 * lip_clr + 0.1, usb_plug_w, (lip_h + 0.3) + 0.1]);
}

// microSD 逃し（pebble）: 外面に開口は開けない（#30: SD は露出しない）。トップの頭壁
// 内面に「合わせ面(z=0)まで下開放の縦チャネル」を掘る。
//   - 下開放が組立の要: 蓋の垂直降下でカード先端が下からチャネルへ入る
//     （チャネル＝カード先端の降下コラムそのもの）。X 盲の単純ポケットだと、ポケット
//     下の壁がカードの降下コラムに衝突して蓋が閉じられない。
//   - X には盲: 前面 = USB ザグリ底(-3.1)と同一面。カード先端(-2.5)に 0.6mm の余裕。
//     ザグリ底と面を揃えるのは、井戸との間に 0.1mm の薄肉が残るのを防ぐため
//     （チャネル上部は井戸と連結し、井戸を覗くとカード先端が見えるが外面開口は増えない。
//     プラグ樹脂はザグリ底 x=-3.1 で止まりカード先端 -2.5 には届かない）。
//   - カード交換は開蓋で行う（電池直結・開けて組む設計と同じ思想）。
//   - 舌(z<0)へは -0.1 だけ届くが、この y 帯はほぼ cut_usb_peb が舌を払う帯
//     （peb_cy±usb_plug_w/2）に含まれ、はみ出す両端 ~0.75mm に深さ 0.1mm の
//     ノッチが付くだけ（印刷・嵌合に影響なし）。
//   - z/y は ASSUMED（params.scad の sd_z0/sd_y0）。実機で要確認。
//   - トップ半身専用: pebble_shell_solid には入れない（ボトムが共有するとリム一層目を
//     0.1mm 削るため）。pebble_enclosure_top の difference でのみ適用。
module cut_sd_peb() {
    open_w  = sd_card_w + 2 * sd_clr_y;
    x_front = -usb_overhang - usb_well_clr;   // = USB ザグリ底と同一面（-3.1）
    x_in    = cav_x0 + 1;                     // 頭壁内面を貫いてキャビティへ
    z1      = sd_z0 + sd_card_t + sd_clr_z;
    translate([x_front, board_w / 2 - open_w / 2, -0.1])
        cube([x_in - x_front, open_w, z1 + 0.1]);
}

// 静電タッチ電極（銅箔）座: 天面内側(キャビティ天井 z=cav_top_z)に浅い角丸ポケット。
// 箔を貼り付けて位置決め＆壁へ密着。彫り込みは壁内に留め外面は貫かない（1.3mm 残す）。
// リード線は空きの RTC タッチ GPIO へ（キャビティ内を引き回し。専用溝は設けない）。
module cut_touch_pad() {
    if (touch_pad)
        translate([touch_pad_pos[0], touch_pad_pos[1], cav_top_z])
            linear_extrude(height = touch_pad_depth + 0.01)
                offset(r = touch_pad_r)
                    square(touch_pad_size - 2 * touch_pad_r, center = true);
}

// シェル本体（分割前）: 外形 − キャビティ − 各開口、リテンションを union。
//   配線通しは tail_backstop（天井吊りリブ ×2）の中央開放部を使う（専用ノッチは廃止）。
module pebble_shell_solid() {
    difference() {
        pebble_outer_solid();
        cavity();
        cut_usb_peb();
        cut_lens();
        cut_mic();
        cut_touch_pad();   // 天面内側のタッチ電極座
    }
    corner_grips();        // キャビティ減算後に union（隅クランプは意図的にキャビティ内へ張り出す）
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
    rb       = clip_boss_r;                           // 意匠の丸め（外形 bbox は従来と同一）
    difference() {
        // 全エッジ丸めの角丸柱（minkowski 球）。根元(z_top)側だけは角を残さず
        //   そのまま裏面壁へ食い込ませたいので、内核を z_top - rb まで伸ばす…と
        //   キャビティ(電池室)を突くため z_top 止まり: 根元の丸みは小フィレット状に見える。
        for (s = [-1, 1]) {
            yb = clip_pin_y + s * (clip_boss_gap / 2 + clip_boss_w / 2);
            minkowski() {
                translate([clip_pin_x - clip_boss_l / 2 + rb, yb - clip_boss_w / 2 + rb, z_bot + rb])
                    cube([clip_boss_l - 2 * rb, clip_boss_w - 2 * rb, (z_top - rb) - (z_bot + rb)]);
                sphere(r = rb);
            }
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
    boss_clr = 0.5;                                           // ボス内面との片側クリアランス
    neck_w  = clip_boss_gap - 2 * boss_clr;                  // ネック幅 = ボス内法 - 両側クリア
    // ボス掃引半径: ピン軸からボス外縁角までの距離 + 余裕。腕の回転中もボスに当てない刳りの半径
    swing_r = sqrt(pow(clip_boss_l / 2, 2) + pow(clip_boss_over + clip_pin_drop, 2)) + 0.4;
    difference() {
        union() {
            // 有機パッド（裏面を覆う envsense ロゴ面）
            translate([pad_cx, peb_cy, az_bot])
                linear_extrude(height = clip_arm_t)
                    superellipse2d(clip_arm_l / 2, clip_arm_w / 2, clip_arm_n, peb_seg);
            // ナックル barrel（ピンを抱く。裏面直下まで届く）
            translate([clip_pin_x, knu_y0, clip_pin_z])
                rotate([-90, 0, 0]) cylinder(d = knu_od, h = knu_w);
            // ナックル→パッドのネック。★幅はボス内法 - クリアランス（neck_w）に絞る:
            //   ボス間を通る部分を旧 hull のように 2/3 パッド幅へ広げると内法 12 を超えて
            //   組めない（蓋が閉まらない以前にナックルがボス間に入らない）
            hull() {
                translate([clip_pin_x, knu_y0, clip_pin_z])
                    rotate([-90, 0, 0]) cylinder(d = knu_od, h = knu_w);
                translate([xh, clip_pin_y - neck_w / 2, az_bot])
                    cube([0.1, neck_w, clip_arm_t]);
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
        // ボス回転クリアランス: ピン軸まわり半径 swing_r の円筒を、ボス y 帯
        //   （内面 - boss_clr から外側）で刳る。パッドの肩がどの開き角でも
        //   ボスに当たらない掃引体クリアランス（回転は Y 軸なので y 幅は不変）。
        for (s = [-1, 1])
            translate([clip_pin_x, clip_pin_y + s * (clip_boss_gap / 2 - boss_clr), clip_pin_z])
                rotate([-s * 90, 0, 0]) cylinder(r = swing_r, h = 30);
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
// 合わせ目の印籠 + スナップ嵌合（pebble 専用: 舌=トップ / 溝=ボトム）
// =====================================================================
// box の mating_lip/mating_groove（舌=ボトム・輪郭基準）は使わない。理由と配置の
// 設計値（lip_off）は params_pebble.scad の「合わせ目」コメント参照。
//   - peb_mating_lip   : トップから z=0 を下へ -lip_h 降りる舌。先端リードは下端。
//   - peb_mating_groove: ボトムのリム面（z=0、印刷時はベッド一層目）に掘る受け溝。
//   - peb_snap_beads   : 舌（トップ）の外面の半円ビード。
//   - peb_snap_pockets : ボトムの溝外壁のキャッチポケット。リム面直下 0.6 が係止リッジ。
// 被せると舌が内へ撓み、ビードがリッジを越えてポケットへ落ちて係止（再開可能）。

// キャビティ輪郭から外側 [o0, o1] の帯（印籠リングの 2D 断面）
module peb_lip_ring2d(o0, o1) {
    translate([cav_x0, cav_y0])
        difference() {
            offset(r = o1) rrect2d(cav_l, cav_w, corner_r);
            offset(r = o0) rrect2d(cav_l, cav_w, corner_r);
        }
}

module peb_mating_lip() {
    lead = 0.8;   // 先端リードの高さ（細い首で溝へ誘い込む）
    led  = 0.4;   // 先端を各面で絞る量
    translate([0, 0, -(lip_h - lead)])
        linear_extrude(height = lip_h - lead)
            peb_lip_ring2d(lip_off, lip_off + lip_t);
    translate([0, 0, -lip_h])
        linear_extrude(height = lead)
            peb_lip_ring2d(lip_off + led, lip_off + lip_t - led);
}

module peb_mating_groove() {
    translate([0, 0, -(lip_h + 0.19)])
        linear_extrude(height = lip_h + 0.2)
            peb_lip_ring2d(lip_off - lip_clr, lip_off + lip_t + lip_clr);
}

module peb_snap_beads() {
    for (px = snap_xs)
        for (face = [cav_y0 - (lip_off + lip_t), cav_y1 + (lip_off + lip_t)])
            translate([px - snap_len / 2, face, -snap_z])
                rotate([0, 90, 0])
                    cylinder(r = snap_proj, h = snap_len, $fn = 24);
}

module peb_snap_pockets() {
    depth = snap_proj + 0.6;                    // ビードが収まる外向き深さ
    z0    = -(lip_h + 3);                       // 下は壁内へ逃がす
    z1    = -(snap_z - 0.2);                    // ポケット上端（リム面との間が係止リッジ）
    for (px = snap_xs)
        for (s = [[cav_y0 - (lip_off + lip_t), -1], [cav_y1 + (lip_off + lip_t), 1]]) {
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
            clip_bosses();     // 裏面のヒンジボス
        }
        peb_mating_groove();   // 舌を受ける溝（★pebble は溝がボトム = リム面がベッド一層目）
        peb_snap_pockets();    // ビードを受ける係止ポケット
        // 開口はボスにも適用（プラグ挿入路を塞がない）
        cut_usb_peb();
        cut_lens();
        cut_mic();
        clip_leg_anchor_body();   // バネ固定脚の差し込み穴
    }
}

module pebble_enclosure_top() {
    big = 300;
    difference() {
        union() {
            intersection() {
                pebble_shell_solid();
                translate([peb_cx - big / 2, peb_cy - big / 2, 0]) cube([big, big, big]);
            }
            tail_backstop();   // 板尾止めリブ ×2（z=0 をまたいで下へ突出。トップ所属）
            peb_mating_lip();  // 合わせ目の舌（z=0 → -lip_h。★pebble は舌がトップ所属）
            peb_snap_beads();  // 舌外面のスナップビード（係止突起）
        }
        cut_usb_peb();         // 舌は頭端の USB 開口を横切るので開口を再適用
        cut_sd_peb();          // microSD 縦チャネル（トップ半身専用 — module コメント参照）
    }
}

// このファイル単体で開いたときはシェル + クリップ腕を表示
pebble_shell_solid();
clip_arm();
