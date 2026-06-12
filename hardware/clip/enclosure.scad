// envsense クリップ筐体 — 筐体シェル (Phase 1 / #2)
//
// 構成: 角丸の外箱から、内部キャビティと各開口を difference() で引く。
// 印刷・組立のため本体(bottom)と蓋(top)に z=0 面で分割し、合わせ目に印籠リップを付ける。
//
// 開口（dimensions.md #30 防水セクションの浸水経路と対応）:
//   - USB-C 開口 : -X 端面。受け口(8.3×2.5)より広く ~12–13mm（プラグ樹脂が挿せる幅）
//   - レンズ穴   : 下面（カメラ側）。lens_d 基準
//   - マイク穴   : 下面。防水メッシュ前提の小穴
// タッチ面（カメラ側 = 下面）の壁は wall_touch に薄くする。

include <params.scad>
use <parts.scad>  // rrect() を借りる

// ----- 2D ヘルパ -----

// 角丸長方形の 2D 輪郭（基板・キャビティのフットプリント）
module rrect2d(l, w, r) {
    hull() for (x = [r, l - r], y = [r, w - r])
        translate([x, y]) circle(r = r);
}

// 対角 2 点 + z レンジで軸平行ボックス（符号に依らず描ける）
module box2(p0, p1, z0, z1) {
    translate([min(p0[0], p1[0]), min(p0[1], p1[1]), z0])
        cube([abs(p1[0] - p0[0]), abs(p1[1] - p0[1]), z1 - z0]);
}

// キャビティ（内部空間）— 角丸ボックス。中心は基板フットプリント中心。
module cavity() {
    translate([cav_cx - cav_l / 2, cav_cy - cav_w / 2, z_bat_bot - clr])
        rrect(cav_l, cav_w, cav_h, corner_r);
}

// 外形ソリッド（中身が詰まった状態）。キャビティ + 壁厚。
module outer_solid() {
    ol = cav_l + 2 * wall;
    ow = cav_w + 2 * wall;
    oh = cav_h + 2 * wall;
    translate([cav_cx - ol / 2, cav_cy - ow / 2, (z_bat_bot - clr) - wall])
        rrect(ol, ow, oh, corner_r + wall);
}

// ----- 開口（difference 用の工具体） -----

// USB-C 開口: 頭(-X)端面を貫く。受け口より広い幅、壁は薄く（面取り相当に開口拡大）。
// 頭壁は cav_x0 に追従（頭合わせレイアウトで端壁位置が動くため）。
module cut_usb() {
    open_w = 12.5;                 // プラグが挿せる幅（dimensions.md #30 の方針）
    open_h = usb_open_h + 1.0;     // 余裕
    z_top = z_board_top + usb_z + open_h;   // 開口上端（受け口基準は据え置き）
    z0 = -0.1;                     // 下開放: 合わせ面(z=0)の下から開ける。
                                   //   旧: z_board_top + usb_z(=0.2) 始まりだと、top では合わせ面との
                                   //   間に高さ 0.2mm の糸状壁、bottom ではリップに 0.2mm の切れ端が
                                   //   残りどちらも印刷不能。受け口下端は usb_z にあるので縁は不要。
    x_out = cav_x0 - wall - 1;     // 端壁の外側
    x_in  = cav_x0 + 4;            // 端壁を貫いてキャビティ内へ（プラグ進入路）
    translate([x_out, board_w / 2 - open_w / 2, z0])
        cube([x_in - x_out, open_w, z_top - z0]);
}

// microSD 逃し（box）: カード先端(x=-sd_protrude=-2.5)が頭壁内面(cav_x0=-1.9)を 0.6mm
// 貫くため、USB 開口の真上に貫通スロットを開ける（XIAO Sense コミュニティ製ケースの定石）。
//   - 組立は「空で閉じる → 外からカードを挿す」: 蓋の垂直降下時にカードが無いので
//     降下掃引の衝突が起きない。壁 1.6mm では盲ポケットにできない（残り 0.5mm）。
//   - カード先端は外面(-3.5)から 1.0mm 奥のほぼツライチ。抜くのはピンセット or 開蓋。
//   - USB 開口上端(z=3.7)とスロット下端(z=3.2)は重なる → 独立穴にせず USB 開口と連結した
//     一つの開口にする（間に橋を残すと 0.2mm の糸状壁になり印刷不能）。
//   - z/y は ASSUMED（params.scad の sd_z0/sd_y0）。実機で要確認。
module cut_sd() {
    open_w = sd_card_w + 2 * sd_clr_y;
    z0 = sd_z0 - sd_clr_z;
    z1 = sd_z0 + sd_card_t + sd_clr_z;
    x_out = cav_x0 - wall - 1;     // 端壁の外側
    x_in  = cav_x0 + 1;            // 端壁を貫いてキャビティ内へ
    translate([x_out, board_w / 2 - open_w / 2, z0])
        cube([x_in - x_out, open_w, z1 - z0]);
}

// レンズ穴: 上面（+Z）を貫く。開口貫通＝レンズ突出方式。
// レンズホルダ径 + クリアランスのストレート穴。lens_axis は §7 実測で確定。
// TODO[カメラ]: lens_front_d / cam_fov 確定後、内側にケラレ回避テーパ、
//   外側に保持ボス/ポケット（光軸固定）を追加する。
module cut_lens() {
    top_inner = (z_bat_bot - clr) + cav_h;  // キャビティ天面（内側）
    translate([lens_axis[0], lens_axis[1], top_inner - 1])
        cylinder(d = lens_d + 2 * clr, h = wall + 2);
}

// マイク穴: 上面の小穴。試作は素の開口（mic_port_d）。
// TODO[マイク]: mic_port_face 確定後に音道を通し、防水フェーズで音響メンブレン座 + 密閉ガスケットを追加。
module cut_mic() {
    top_inner = (z_bat_bot - clr) + cav_h;
    translate([mic_pos[0], mic_pos[1], top_inner - 1])
        cylinder(d = mic_port_d, h = wall + 2);
}

// ----- 基板リテンション（4隅クランプ） -----
// 各隅で L 字（2 辺）のグリップを立て、基板の z バンドだけを刳り貫く。
//   z < z_board_bot   : 棚（基板を下から受ける）
//   [z_board_bot,0]   : 位置決め壁（基板の角を clr 付きで抱く＝XY 拘束）
//   z > z_board_top   : 押さえ（基板を上から押さえる。前(USB側)隅のみ — 後隅は top_h=0 で廃止）
//   押さえ爪は board_top_gap ぶん上へ平行移動（下面=基板上面との隙間, 天も同量上げ爪厚 top_h を維持）。
// do_edgeB: 短辺(x)方向のアンカーを作るか。頭隅は近い端壁に取れるので true、
//   尾隅は端壁が遠い（バッテリーが基板より長い）ので false にして tail_backstop で受ける。
module corner_grip(bx, by, top_h, do_edgeB = true) {
    sx = (bx < cav_cx) ? 1 : -1;        // 内向き x
    sy = (by < cav_cy) ? 1 : -1;        // 内向き y
    xo = (sx == 1) ? cav_x0 : cav_x1;   // 壁側 x
    yo = (sy == 1) ? cav_y0 : cav_y1;   // 壁側 y
    z0 = z_board_bot - shelf_t;                       // 棚の底
    // 押さえの天（下面を board_top_gap 上げた分、天も上げて爪厚 top_h を維持）。
    // 爪なし(top_h=0)の後隅は z=0（分割面）で止める: board_top_gap を足すと 0.5mm だけ
    // top 側にはみ出し、印籠溝に溶着を切られた浮島が top の合わせ面に印刷されてしまう。
    z1 = (top_h > 0) ? z_board_top + board_top_gap + top_h : z_board_top;
    difference() {
        union() {
            // 辺 A: by 側の長辺に沿う（x 方向に clamp_run 走る / y は壁→基板内 clamp_reach）
            box2([bx + sx * corner_r,               yo - sy * weld],
                 [bx + sx * (corner_r + clamp_run), by + sy * clamp_reach], z0, z1);
            // 辺 B: bx 側の短辺に沿う（頭隅のみ。y 方向に clamp_run 走る / x は端壁→基板内）
            if (do_edgeB)
                box2([xo - sx * weld,                by + sy * corner_r],
                     [bx + sx * clamp_reach,         by + sy * (corner_r + clamp_run)], z0, z1);
        }
        // 基板挿入スロット（基板 + clr を z バンドだけ刳る）。
        // スロット上端を board_top_gap 持ち上げ＝押さえ爪の下面を上げて基板上面に隙間を作る。
        translate([0, 0, z_board_bot])
            linear_extrude(height = (z_board_top + board_top_gap) - z_board_bot)
                offset(r = clr) rrect2d(board_l, board_w, corner_r);
    }
}

// 尾(+X)バックストップ: 基板尾の +X 移動止め（USB プラグ押し込み力の受け）。
//   ★所属は「トップ半身」: ボトム底タブの尾側を完全に空けて電池(直結・基板より大)の
//     傾け入れ路を確保し、蓋を閉じると z=0 をまたいで下へ降り基板尾を押さえる。
//     enclosure_top() / pebble_enclosure_top() で intersection の外に union する
//     （z<0 部を残すため）。corner_grips() からは呼ばない。
//   ★形状は「キャビティ天井から吊る片持ちリブ ×1」（+Y 壁寄せ・幅 backstop_w）:
//     蓋を伏せて印刷すると天井面（=ベッド直上）から素直に立ち上がり、宙に浮く層が
//     出ない（旧: 側壁間の低い横断壁は最下層が全幅ブリッジになり印刷不能だった）。
//     単リブ化（旧 ±Y 両肩の 2 リブ → 2026-06）: −Y 側を全開放して電池リード/
//     アンテナの通り道をまとめ（旧 cut_wire_notch は廃止）、タッチ電極ポケット
//     （pebble: −Y 寄せ y ≤ 11.0）の回避域とする。受け面は幅 7.3 で旧 2 リブ合計
//     （2.3+2.3）以上を単独で確保。+X 反力が +Y 寄りに偏るが、ヨーは尾隅の
//     長辺グリップ（z<0）が受ける。
//   ★前面は Sense 尾 + clr で全高フラット: Sense は主基板尾を 0.45mm オーバーハング
//     する（assy_offset.x + sense_l = 21.7 > board_l + clr = 21.55）ため、これより
//     -X の張り出しは蓋の垂直降下で Sense 尾縁を擦る（降下掃引 = 部材底面から上の柱）。
//     +X 止めは Sense 尾縁が clr=0.3 で先に当たり（B2B コネクタ経由で受ける）、
//     主基板縁は 0.75 のバックアップ。
//   ★上部の「ひさし」(brow): Sense 上面 + 0.3 から -X へ張り出し、基板尾の浮き上がり
//     を 0.3mm に制限する（尾側の上押さえは Sense の蓋で垂直降下が不能なため廃止 →
//     corner_grips 参照）。通常状態では Sense に触れない。ひさし底面はモデルで下向き
//     = 伏せ印刷で上向きなのでオーバーハングにならない。
//   - 先端(-X下)の面取り ch = 閉合時に基板が +X へずれていても -X へ誘い戻す。
//   - y はキャビティ内側 (cav_y0/cav_y1 ∓ clr) に収める: z<0 部がボトム側壁・舌と
//     干渉しないため。アンカーは天井への weld のみ（側壁には付けない）。
module tail_backstop() {
    x_front = assy_offset[0] + sense_l + clr;     // 前面 = Sense 尾 + clr（降下掃引を回避）
    x_back  = x_front + backstop_t;               // 背面
    x_brow  = assy_offset[0] + sense_l - 1.2;     // ひさし先端（Sense 尾に 1.2 かぶる）
    z0      = z_board_bot;                        // 下端 = 基板下面（尾エッジを受ける）
    z_brow  = z_sense_top + 0.3;                  // ひさし底 = Sense 上面 + 0.3（浮き許容量）
    z1      = ((z_bat_bot - clr) + cav_h) + weld; // キャビティ天井へ食い込み（溶着）
    ch      = 1.0;                                // 先端誘い込み面取り
    translate([0, cav_y1 - clr, 0])
        rotate([90, 0, 0])
            linear_extrude(height = backstop_w)
                polygon([[x_front + ch, z0], [x_back, z0], [x_back, z1], [x_brow, z1],
                         [x_brow, z_brow], [x_front, z_brow], [x_front, z0 + ch]]);
}

module corner_grips() {
    for (c = [[0, 0], [0, board_w], [board_l, 0], [board_l, board_w]]) {
        is_head = c[0] < cav_cx;        // 頭(USB側)隅か
        // 尾隅の上押さえは廃止（top_h=0）: Sense が主基板尾を全幅で覆うため、蓋の
        //   垂直降下で押さえが必ず Sense 上面に衝突し閉じられない（さらに印籠溝が
        //   側壁アンカー(weld)を z<2.2 で切断するため、印刷でも浮島化していた）。
        //   尾の浮き上がりは tail_backstop のひさし（Sense 尾上 +0.3）で制限する。
        corner_grip(c[0], c[1], is_head ? top_h_front : 0, is_head);
    }
    // tail_backstop() はトップ半身に所属（enclosure_top で union）。ここでは呼ばない。
}

// ----- 合わせ目リップ（印籠） -----
// 本体(bottom)から z=0 で立ち上がる舌（tongue）。蓋(top)側は mating_groove で受ける。
module mating_lip() {
    lead = 0.8;   // 先端リードの高さ（細い首で溝へ誘い込む＝片側ずつ入れずに済む）
    led  = 0.4;   // 先端を各面で絞る量（先端だけ薄く）
    translate([cav_x0, cav_y0]) {
        // 本体（フル厚）
        linear_extrude(height = lip_h - lead)
            difference() {
                offset(r = lip_t) rrect2d(cav_l, cav_w, corner_r);
                rrect2d(cav_l, cav_w, corner_r);
            }
        // 先端リード（両面を led 絞って細く＝溝口への誘い込みノーズ）
        translate([0, 0, lip_h - lead])
            linear_extrude(height = lead)
                difference() {
                    offset(r = lip_t - led) rrect2d(cav_l, cav_w, corner_r);
                    offset(r = led) rrect2d(cav_l, cav_w, corner_r);
                }
    }
}

module mating_groove() {
    translate([0, 0, -0.01])
        linear_extrude(height = lip_h + 0.2)
            translate([cav_x0, cav_y0])
                difference() {
                    offset(r = lip_t + lip_clr) rrect2d(cav_l, cav_w, corner_r);
                    offset(r = -lip_clr) rrect2d(cav_l, cav_w, corner_r);
                }
}

// ----- シェル本体（分割前の一体筐体） -----
module shell_solid() {
    difference() {
        outer_solid();
        cavity();
        cut_usb();
        cut_sd();
        cut_lens();
        cut_mic();
    }
    // キャビティ減算の後に union（隅クランプはキャビティ内へ意図的に張り出す）
    corner_grips();
}

// 合わせ面 z=0 で上下に切る半空間
module half_above() {
    big = max(cav_l, cav_w, cav_h) * 3;
    translate([cav_cx, cav_cy, 0]) cube(big, center = true)
        children();
}

// bottom = z<=0（バッテリー / メイン基板側）, top = z>=0（USB-C / Sense / カメラ側）
module enclosure_bottom() {
    big = 200;
    difference() {
        union() {
            intersection() {
                shell_solid();
                translate([cav_cx - big/2, cav_cy - big/2, -big]) cube([big, big, big]);
            }
            mating_lip();   // 合わせ目の舌（z=0 から +lip_h）
        }
        // 開口はリップにも適用（USB プラグ挿入路を塞がない）
        cut_usb();
        cut_lens();
        cut_mic();
    }
}

module enclosure_top() {
    big = 200;
    difference() {
        union() {
            intersection() {
                shell_solid();
                translate([cav_cx - big/2, cav_cy - big/2, 0]) cube([big, big, big]);
            }
            tail_backstop();   // 板尾止めリブ ×2（z=0 をまたいで下へ突出。トップ所属）
        }
        mating_groove();       // 舌を受ける溝
    }
}
