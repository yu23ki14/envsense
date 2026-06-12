// envsense クリップ筐体 — pebble バリアントのシェル + 裏面クリップ (#2 / プロダクト外観)
//
// 構成:
//   - 外形      : 川石モチーフ（スーパー楕円プレート → クラウンへ hull で滑らかに丸める。裏面はフラット）
//   - 内部      : enclosure.scad のキャビティ/開口/基板リテンションをそのまま流用
//   - 合わせ目  : enclosure.scad の印籠リップ/溝を流用（キャビティ矩形基準なので石外形でも内側に収まる）
//   - クリップ  : 一体成形フレックス式（clip_flex を bottom へ union。可動部品・調達部品なし）
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
// クリップ: 一体成形フレックスクリップ（bottom へ union。可動部品なし）
// =====================================================================
// 形: 背面マウントの J 形。剛体の根本ブロックが背面の頭寄りから下り、テーパー腕が
// 尾(+X)へ伸びる。布は尾側の先端フレアからスライドインし、本体背面の半円ビード ×
// 腕の平面で clip_pinch=0.4 までつままれる。たわむのは腕だけ（応力設計と印刷方向の
// 根拠は params_pebble.scad §2 のコメント参照）。
// 印刷（リム面ベッド = 背面が上向き）: ビードと根本は背面から上へ育ちサポート不要。
// 腕の下（背面との clip_gap=2.0 の空間）はサポート必須 — 痕が出るのは腕に隠れる
// 背面領域と腕の内面（つまみ面）のみ。
module clip_flex() {
    z_back    = peb_z_bot;                    // 背面（外面）
    z_arm_top = z_back - clip_gap;            // 腕 上面（背面と対向するつまみ面）
    z_arm_bot = z_arm_top - clip_arm_t;       // 腕 下面（外側）
    x_flare   = clip_tip_x - clip_flare_l;    // フレア開始 x
    w_flare   = clip_arm_w1 + (clip_arm_w0 - clip_arm_w1) * clip_flare_l / clip_arm_l;
                                              // フレア開始位置でのテーパー幅
    // Y 軸の薄バー（hull の断面駒。x 中心 ±0.05）
    module ybar(x, w, z0, z1) {
        translate([x - 0.05, peb_cy - w / 2, z0]) cube([0.1, w, z1 - z0]);
    }
    // 1) 根本ブロック（剛体）: 背面へ clip_root_weld 食い込み、-X/-Z 外角は丸め。
    //    層をまたぐ向きだが断面 7×20 で層間応力は数 MPa（params §2）。
    hull() {
        ybar(clip_root_x + 0.05, clip_arm_w0, z_back - 0.01, z_back + clip_root_weld);
        ybar(clip_arm_x0, clip_arm_w0, z_arm_bot, z_back + clip_root_weld);
        translate([clip_root_x + clip_root_r, peb_cy - clip_arm_w0 / 2, z_arm_bot + clip_root_r])
            rotate([-90, 0, 0]) cylinder(r = clip_root_r, h = clip_arm_w0);
    }
    // 2) 内隅フィレット（腕付け根の応力集中の緩和。布の差し込みはここで止まる）
    hull() {
        ybar(clip_arm_x0, clip_arm_w0, z_arm_top - 0.01, z_arm_top + clip_fillet_z);
        ybar(clip_arm_x0 + clip_fillet_x, clip_arm_w0, z_arm_top - 0.01, z_arm_top);
    }
    // 3) 腕（テーパー平板 = たわみ部。印刷で水平スラブ → 曲げは層内方向）
    hull() {
        ybar(clip_arm_x0, clip_arm_w0, z_arm_bot, z_arm_top);
        ybar(x_flare, w_flare, z_arm_bot, z_arm_top);
    }
    // 4) フレア + 丸め先端（外側(-Z)へ clip_flare_drop 逃げて布の呼び込み口を開く）
    hull() {
        ybar(x_flare, w_flare, z_arm_bot, z_arm_top);
        translate([clip_tip_x - clip_arm_t / 2, peb_cy - clip_arm_w1 / 2,
                   z_arm_bot - clip_flare_drop + clip_arm_t / 2])
            rotate([-90, 0, 0]) cylinder(d = clip_arm_t, h = clip_arm_w1);
    }
    // 5) つまみビード（本体背面側の Y 半円柱。腕内面のリブだと印刷で下向き面になるため
    //    本体側 = 印刷で上向きに育つ面に置く。上半分は壁の食い込み深さでトリムして
    //    キャビティ（電池室）を突かない）
    intersection() {
        translate([clip_bead_x, peb_cy - clip_bead_w / 2, z_back])
            rotate([-90, 0, 0]) cylinder(r = clip_bead_r, h = clip_bead_w);
        translate([clip_bead_x - clip_bead_r - 1, peb_cy - clip_bead_w / 2 - 1,
                   z_back - clip_bead_r - 1])
            cube([2 * (clip_bead_r + 1), clip_bead_w + 2, (clip_bead_r + 1) + clip_root_weld]);
    }
}

// =====================================================================
// 合わせ目の印籠 + スナップ嵌合（pebble 専用: 舌=トップ / 溝=ボトム / バネ=ボトム横梁）
// =====================================================================
// box の mating_lip/mating_groove（舌=ボトム・輪郭基準）は使わない。理由と配置の
// 設計値（lip_off）、および リング撓み式→マグネット→フィンガー式→横梁ラッチ の経緯と
// 設計値（catch_* / snap_* / latch_*）は params_pebble.scad の「合わせ目」コメント参照。
//   - peb_mating_lip    : トップから z=0 を下へ -lip_h 降りる舌。先端リードは下端。
//   - peb_mating_groove : ボトムのリム面（z=0、印刷時はベッド一層目）に掘る受け溝。
//   - peb_snap_catches  : 舌の 4 箇所を -catch_l へ延長した剛体キャッチ舌＋外面ビード（トップ）。
//   - peb_latch_pockets : ボトム側の深ポケット＋溝外壁を片持ち梁に切り出すスリット群（difference）。

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

// 剛体キャッチ舌（トップ所属）: snap_xs × 長辺±Y の 4 箇所で、舌と同じ帯
// （輪郭 + [lip_off, lip_off+lip_t]）を z=0 → -catch_l の角柱に延長し、先端リード
// （舌と同じ各面絞り）と外面の半円ビードを付ける。スリットは設けない＝リングと一体の剛体。
// 撓むのはボトムの横梁なので、トップ側は層間（伏せ印刷の水平層界面）に曲げ応力が乗らない。
// ビードは梁の自由端(+X)寄りにオフセット（根本から遠い＝低ひずみで押し退けられる位置）。
module peb_snap_catches() {
    lead = 0.8;   // 先端リードの高さ（peb_mating_lip と同値）
    led  = 0.4;   // 先端を各面で絞る量
    for (px = snap_xs, side = [-1, 1]) {
        y_in   = (side < 0) ? cav_y0 - (lip_off + lip_t) : cav_y1 + lip_off;            // 帯の y 下端
        y_face = (side < 0) ? cav_y0 - (lip_off + lip_t) : cav_y1 + (lip_off + lip_t);  // 外面
        // 本体（リードの上まで）
        translate([px - catch_w / 2, y_in, -(catch_l - lead)])
            cube([catch_w, lip_t, catch_l - lead]);
        // 先端リード（x/y 両絞り）
        hull() {
            translate([px - catch_w / 2, y_in, -(catch_l - lead)])
                cube([catch_w, lip_t, 0.01]);
            translate([px - catch_w / 2 + led, y_in + led, -catch_l])
                cube([catch_w - 2 * led, lip_t - 2 * led, 0.01]);
        }
        // 外面ビード（X 軸の半円柱。中心を外面に置き、半分が外へ出る。+X 寄せ）
        translate([px + snap_bead_off - snap_bead_l / 2, y_face, -snap_bead_z])
            rotate([0, 90, 0]) cylinder(r = snap_proj, h = snap_bead_l, $fn = 24);
    }
}

// 輪郭外側の帯直方体ヘルパ（ラッチ加工用）。side = -1/+1 で ±Y の長辺、
// [o0, o1] = 輪郭（cav_y0/cav_y1）からの外向きオフセット範囲、x/z はそのまま。
module latch_band(side, x0, x1, o0, o1, z0, z1) {
    translate([x0, (side < 0) ? cav_y0 - o1 : cav_y1 + o0, z0])
        cube([x1 - x0, o1 - o0, z1 - z0]);
}

// ボトム側のラッチ加工（difference）。各キャッチ位置で:
//   1) 深ポケット: 溝を -(catch_l + catch_tip_clr) まで局所延長（キャッチ舌の降下コラム）。
//      キャッチは剛体で撓まないため、③で要った内壁の撓み逃げ（0.5mm 薄壁）は廃止。
//   2) ビード逃げ: 梁の下（z < -(溝深さ+latch_slit)）でビードの出っ張りぶん外へ拡幅。
//   3) 梁の切り出し: 溝外壁の帯（厚さ latch_t）を「背後の逃げ溝＋下の水平スリット＋
//      自由端(+X)の縦スリット」で三方切り離し、根本(−X)端だけで持つ横向き片持ち梁にする。
//   4) 呼び込み面取り: 梁上端の内縁を 45° で落とす（進入するビードのカム面）。
// 印刷（リム面ベッド）: 梁はベッドから立つ壁の一部（根本側でリングと連続＝島にならない）、
// 逃げ溝/縦スリットはベッドから開く縦穴、水平スリットの上は 1.8mm の短ブリッジ。
module peb_latch_pockets() {
    in0 = lip_off - lip_clr;             // 深ポケット内面（= 通常溝と同じ。輪郭から 0.7）
    in1 = lip_off + lip_t + lip_clr;     // 深ポケット外面 = 梁の内面（輪郭から 2.3）
    pw  = catch_w + 2 * catch_xy_clr;    // 深ポケット X 幅
    pd  = snap_proj - lip_clr + 0.25;    // ビード逃げの外向き深さ（残り 0.3 + 余裕）
    gd  = lip_h + 0.2;                   // 溝深さ = 梁下端
    zb  = -(catch_l + catch_tip_clr);    // 深ポケット底
    for (px = snap_xs, side = [-1, 1]) {
        // 1) 深ポケット
        latch_band(side, px - pw / 2, px + pw / 2, in0, in1, zb, 0.02);
        // 2) ビード逃げ（梁の下のみ。ビード x 窓 + 0.4）
        latch_band(side, px + snap_bead_off - snap_bead_l / 2 - 0.4,
                         px + snap_bead_off + snap_bead_l / 2 + 0.4,
                         in1, in1 + pd, zb, -(gd + latch_slit));
        // 3) 梁の切り出し
        latch_band(side, px - latch_x0, px + latch_x1 + 1.0,                  // 背後の逃げ溝
                         in1 + latch_t, in1 + latch_t + latch_gap, -(gd + latch_slit), 0.02);
        latch_band(side, px - latch_x0, px + latch_x1 + 1.0,                  // 下の水平スリット
                         in1, in1 + latch_t + latch_gap, -(gd + latch_slit), -gd);
        latch_band(side, px + latch_x1, px + latch_x1 + 1.0,                  // 自由端の縦スリット
                         in1, in1 + latch_t + latch_gap, -(gd + latch_slit), 0.02);
        // 4) 呼び込み面取り（梁上端内縁の 45° ウェッジ = 2 帯の hull）
        hull() {
            latch_band(side, px - latch_x0, px + latch_x1, in1, in1 + latch_cham, -0.01, 0.02);
            latch_band(side, px - latch_x0, px + latch_x1, in1, in1 + 0.01, -latch_cham, 0.02);
        }
    }
}

// =====================================================================
// 分割（z=0 で本体/蓋）
// =====================================================================
// bottom = z<=0（バッテリー / メイン基板 / クリップ側）, top = z>=0（USB-C / Sense / カメラ側）
// 一体クリップは裏面側 → bottom に union（クリップは z < peb_z_bot+1 ≈ -12 に収まり、
// USB/レンズ/マイク開口とは z 帯が重ならないため開口の再適用は不要）。
module pebble_enclosure_bottom() {
    big = 300;
    difference() {
        union() {
            intersection() {
                pebble_shell_solid();
                translate([peb_cx - big / 2, peb_cy - big / 2, -big]) cube([big, big, big]);
            }
            clip_flex();       // 裏面の一体成形クリップ
        }
        peb_mating_groove();      // 舌を受ける溝（★pebble は溝がボトム = リム面がベッド一層目）
        peb_latch_pockets();      // キャッチ受け（深ポケット + 横梁ラッチの切り出し ×4）
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
            tail_backstop();    // 板尾止めリブ ×2（z=0 をまたいで下へ突出。トップ所属）
            peb_mating_lip();   // 合わせ目の舌（z=0 → -lip_h。★pebble は舌がトップ所属）
            peb_snap_catches(); // 剛体キャッチ舌 ×4（舌の局所延長 + ビード。トップ所属）
        }
        cut_usb_peb();         // 舌は頭端の USB 開口を横切るので開口を再適用
        cut_sd_peb();          // microSD 縦チャネル（トップ半身専用 — module コメント参照）
    }
}

// このファイル単体で開いたときはシェル + 一体クリップを表示
pebble_shell_solid();
clip_flex();
