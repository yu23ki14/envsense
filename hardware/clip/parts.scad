// envsense クリップ筐体 — 部品モック (Phase 1 / #2)
//
// dimensions.md の実測値で内蔵部品を簡易再現する。目的は 2 つ:
//   1) アセンブリ表示で干渉・配置を目視確認する
//   2) （将来）筐体キャビティを difference() で引くための「ネガ」にする
//
// 厳密な造形を狙わず、フィットチェックに必要な外形だけを箱・円柱で表す。
// 実機合わせで調整が要る箇所には TODO[実機] を付けてある。

include <params.scad>

// 角を丸めた角柱（垂直エッジのみ R、上下面はフラット）。基板外形に使う。
module rrect(l, w, h, r) {
    hull() {
        for (x = [r, l - r], y = [r, w - r])
            translate([x, y, 0]) cylinder(r = r, h = h);
    }
}

// ----- メイン基板 -----
module main_board() {
    color("DarkGreen")
        translate([0, 0, z_board_bot])
            rrect(board_l, board_w, pcb_t, corner_r);
}

// ----- USB-C コネクタ（上面 最高部品） -----
module usb_connector() {
    color("Silver")
        translate([-usb_overhang, board_w / 2 - usb_w / 2, z_board_top])
            cube([usb_overhang + usb_body_l, usb_w, usb_h]);
}

// ----- Sense 拡張ボード（メイン基板の下面に B2B 接続） -----
module sense_board() {
    color("DarkOliveGreen")
        translate([assy_offset[0], assy_offset[1], z_sense_bot])
            rrect(sense_l, sense_w, sense_t, corner_r);
}

// ----- OV2640 カメラ（拡張ボード下面側、レンズは -Z へ突き出す） -----
// TODO[実機]: fpc_l=8.7 と短いため、カメラは拡張ボードのすぐ脇に固定される。
//   ここでは cam_fpc_xy 近傍に置いているが、実機の固定位置で要調整。
module camera() {
    // 折り返し FPC で上面(+Z)に立つ。レンズは +Z（真上）へ。位置は §7 実測で確定。
    translate([cam_org[0], cam_org[1], cam_base_z])
        color("DimGray") rrect(cam_l, cam_w, cam_t, 0.5);
    // レンズホルダー（カメラ基板上面から +Z へ突き出す）
    color("Black")
        translate([lens_axis[0], lens_axis[1], z_cam_top])
            cylinder(d = lens_d, h = lens_h);
}

// ----- バッテリー（基板スタックの背面に積層） -----
module battery() {
    bx = cav_cx - bat_l / 2 + bat_off[0];
    by = cav_cy - bat_w / 2 + bat_off[1];
    color("SlateGray")
        translate([bx, by, z_bat_bot])
            cube([bat_l, bat_w, bat_t_fit]);
}

// ----- 全部品 -----
module device_assembly() {
    main_board();
    usb_connector();
    sense_board();
    camera();
    battery();
}

// このファイルを単体で開いたときはアセンブリを表示
device_assembly();
