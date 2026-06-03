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

// USB-C 開口: -X 端面を貫く。受け口より広い幅、壁は薄く（面取り相当に開口拡大）。
module cut_usb() {
    open_w = 12.5;                 // プラグが挿せる幅（dimensions.md #30 の方針）
    open_h = usb_open_h + 1.0;     // 余裕
    z0 = z_board_top + usb_z;      // 開口下端
    translate([-(wall + 2), board_w / 2 - open_w / 2, z0])
        cube([wall + 4, open_w, open_h]);
}

// レンズ穴: 下面（-Z）を貫く。カメラのレンズ光軸に合わせる。
module cut_lens() {
    cx = assy_offset[0] + cam_fpc_xy[0] + lens_xy[0];
    cy = assy_offset[1] + cam_fpc_xy[1] - cam_w / 2 + lens_xy[1];
    bottom_z = (z_bat_bot - clr) - wall_touch - 1;
    translate([cx, cy, bottom_z])
        cylinder(d = lens_d + 2 * clr, h = wall_touch + 2);
}

// マイク穴: 下面の小穴（防水メッシュ前提なので最小径）。
module cut_mic() {
    cx = assy_offset[0] + mic_xy[0];
    cy = assy_offset[1] + mic_xy[1];
    bottom_z = (z_bat_bot - clr) - wall_touch - 1;
    translate([cx, cy, bottom_z])
        cylinder(d = 1.2, h = wall_touch + 2);
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
}

// 合わせ面 z=0 で上下に切る半空間
module half_above() {
    big = max(cav_l, cav_w, cav_h) * 3;
    translate([cav_cx, cav_cy, 0]) cube(big, center = true)
        children();
}

// bottom = z<=0（Sense / カメラ / バッテリー側）, top = z>=0（USB-C 側）
module enclosure_bottom() {
    big = 200;
    intersection() {
        shell_solid();
        translate([cav_cx - big/2, cav_cy - big/2, -big]) cube([big, big, big]);
    }
    // TODO[勘合]: 合わせ目リップ／スナップ or ネジボスは未実装。
    //   lip_h / lip_t / lip_clr のパラメータは用意済み。
}

module enclosure_top() {
    big = 200;
    intersection() {
        shell_solid();
        translate([cav_cx - big/2, cav_cy - big/2, 0]) cube([big, big, big]);
    }
}
