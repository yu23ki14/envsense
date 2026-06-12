// envsense クリップ筐体 — トップレベル / 表示・書き出しの切替 (Phase 1 / #2)
//
// 使い方:
//   GUI      : mode を切り替えてプレビュー（F5）/ レンダー（F6）
//   CLI 書き出し（造形プロセスに合わせて壁厚等は params.scad で調整）:
//     openscad -D 'mode="bottom"' -o export/clip_bottom.stl clip.scad
//     openscad -D 'mode="top"'    -o export/clip_top.stl    clip.scad
//     openscad -D 'mode="bottom"' -o export/clip_bottom.3mf clip.scad
//
//   variant:
//     "box"    — Phase 1 の角丸ボックス筐体（既定。挙動は従来どおり）
//     "pebble" — 川石モチーフ外形 + 裏面の一体成形フレックスクリップ（プロダクト外観）
//   mode:
//     "assembly" — 筐体（半透明）+ 内蔵部品（pebble は一体クリップも表示）。干渉・配置の目視確認用
//     "shell"    — 分割前の一体筐体
//     "bottom"   — 本体（Sense/カメラ/バッテリー側, z<=0。pebble はクリップ込み）  ※入稿候補
//     "top"      — 蓋（USB-C 側, z>=0）                                            ※入稿候補
//     "parts"    — 内蔵部品のみ
//
//   CLI 書き出し例（pebble。クリップは bottom と一体なので専用パーツ書き出しは無い）:
//     openscad -D 'variant="pebble"' -D 'mode="bottom"' -o export/pebble_bottom.stl clip.scad
//     openscad -D 'variant="pebble"' -D 'mode="top"'    -o export/pebble_top.stl    clip.scad

variant = "box";
mode = "assembly";

include <params.scad>
use <parts.scad>
use <enclosure.scad>
use <enclosure_pebble.scad>

if (variant == "pebble") {
    if (mode == "assembly") {
        device_assembly();
        clip_flex();             // 一体クリップ（bottom 所属）も配置確認用に表示
        %pebble_shell_solid();   // % = 半透明。外形を透かして干渉確認
    } else if (mode == "shell") {
        pebble_shell_solid();
        clip_flex();
    } else if (mode == "bottom") {
        pebble_enclosure_bottom();
    } else if (mode == "top") {
        pebble_enclosure_top();
    } else if (mode == "parts") {
        device_assembly();
    }
} else {
    if (mode == "assembly") {
        device_assembly();
        %shell_solid();            // % = 半透明モディファイア。筐体を透かして干渉確認
    } else if (mode == "shell") {
        shell_solid();
    } else if (mode == "bottom") {
        enclosure_bottom();
    } else if (mode == "top") {
        enclosure_top();
    } else if (mode == "parts") {
        device_assembly();
    }
}
