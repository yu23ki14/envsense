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
    z0 = z_board_top + usb_z;      // 開口下端
    x_out = cav_x0 - wall - 1;     // 端壁の外側
    x_in  = cav_x0 + 4;            // 端壁を貫いてキャビティ内へ（プラグ進入路）
    translate([x_out, board_w / 2 - open_w / 2, z0])
        cube([x_in - x_out, open_w, open_h]);
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
//   z > z_board_top   : 押さえ（基板を上から押さえる／後隅は B2B 隙間内に収める）
// do_edgeB: 短辺(x)方向のアンカーを作るか。頭隅は近い端壁に取れるので true、
//   尾隅は端壁が遠い（バッテリーが基板より長い）ので false にして tail_backstop で受ける。
module corner_grip(bx, by, top_h, do_edgeB = true) {
    sx = (bx < cav_cx) ? 1 : -1;        // 内向き x
    sy = (by < cav_cy) ? 1 : -1;        // 内向き y
    xo = (sx == 1) ? cav_x0 : cav_x1;   // 壁側 x
    yo = (sy == 1) ? cav_y0 : cav_y1;   // 壁側 y
    z0 = z_board_bot - shelf_t;          // 棚の底
    z1 = z_board_top + top_h;            // 押さえの天
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
        // 基板挿入スロット（基板 + clr を z バンドだけ刳る）
        translate([0, 0, z_board_bot])
            linear_extrude(height = z_board_top - z_board_bot)
                offset(r = clr) rrect2d(board_l, board_w, corner_r);
    }
}

// 尾(+X)バックストップ: 基板尾の直後に立てる横断壁。基板の +X 移動止め
//   （USB プラグ押し込み力の受け）を兼ねる。Sense に当てないよう B2B 隙間内の高さ。
module tail_backstop() {
    x0 = board_l + clr;                  // 基板尾の clr 後ろ
    z0 = z_board_bot - shelf_t;
    z1 = z_board_top + top_h_rear;       // < b2b_gap（Sense 下面に当てない）
    // TODO[配線]: バッテリーリード/アンテナの取り回しが決まったらノッチを開ける
    translate([x0, cav_y0 - weld, z0])
        cube([wall, cav_w + 2 * weld, z1 - z0]);
}

module corner_grips() {
    for (c = [[0, 0], [0, board_w], [board_l, 0], [board_l, board_w]]) {
        is_head = c[0] < cav_cx;        // 頭(USB側)隅か
        corner_grip(c[0], c[1], is_head ? top_h_front : top_h_rear, is_head);
    }
    tail_backstop();
}

// ----- 合わせ目リップ（印籠） -----
// 本体(bottom)から z=0 で立ち上がる舌（tongue）。蓋(top)側は mating_groove で受ける。
module mating_lip() {
    linear_extrude(height = lip_h)
        translate([cav_x0, cav_y0])
            difference() {
                offset(r = lip_t) rrect2d(cav_l, cav_w, corner_r);
                rrect2d(cav_l, cav_w, corner_r);
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
        intersection() {
            shell_solid();
            translate([cav_cx - big/2, cav_cy - big/2, 0]) cube([big, big, big]);
        }
        mating_groove();   // 舌を受ける溝
    }
}
