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
//     "pebble" — 川石モチーフ外形 + 裏面クリップ（プロダクト外観）
//   mode:
//     "assembly" — 筐体（半透明）+ 内蔵部品（pebble はクリップ腕/ピン/バネも）。干渉・配置の目視確認用
//     "shell"    — 分割前の一体筐体
//     "bottom"   — 本体（Sense/カメラ/バッテリー側, z<=0）  ※入稿候補
//     "top"      — 蓋（USB-C 側, z>=0）                      ※入稿候補
//     "parts"    — 内蔵部品のみ
//     "clip_arm" — クリップ腕 単体（pebble 専用 / 別パーツ書き出し）
//
//   CLI 書き出し例（pebble）:
//     openscad -D 'variant="pebble"' -D 'mode="bottom"'   -o export/pebble_bottom.stl clip.scad
//     openscad -D 'variant="pebble"' -D 'mode="top"'      -o export/pebble_top.stl    clip.scad
//     openscad -D 'variant="pebble"' -D 'mode="clip_arm"' -o export/pebble_clip.stl   clip.scad

variant = "box";
mode = "assembly";

include <params.scad>
use <parts.scad>
use <enclosure.scad>
use <enclosure_pebble.scad>

if (variant == "pebble") {
    if (mode == "assembly") {
        device_assembly();
        clip_arm();
        clip_pin_mock();
        clip_spring_mock();
        %pebble_shell_solid();   // % = 半透明。外形を透かして干渉確認
    } else if (mode == "shell") {
        pebble_shell_solid();
        clip_arm();
    } else if (mode == "bottom") {
        pebble_enclosure_bottom();
    } else if (mode == "top") {
        pebble_enclosure_top();
    } else if (mode == "parts") {
        device_assembly();
    } else if (mode == "clip_arm") {
        clip_arm();
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
