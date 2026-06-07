# hardware

The clip-style enclosure for envsense. The physical design of the wearable device that houses the
XIAO ESP32S3 Sense + OV2640 camera + LiPo battery. It is developed as a parametric OpenSCAD design
(Phase 1 / GitHub #2).

## Current state

The Phase 1 OpenSCAD design skeleton exists in `clip/`:

| File | Role |
| --- | --- |
| `dimensions.md` | **Measured part dimensions** — the single source of truth for the reference values. |
| `params.scad` | All measured values (variable names mirror dimensions.md) + clearance/wall/process knobs + derived Z layers and cavity dims. |
| `parts.scad` | Mock of the internal parts (board / Sense board / camera / battery) used both for assembly fit-check and as the `difference()` negative. |
| `enclosure.scad` | The shell: rounded outer box minus cavity minus openings (USB-C / lens / mic), split into `enclosure_bottom()` / `enclosure_top()` at z=0. Also holds the board retention (4-corner clamps) and the `lip`/`groove` mating joint. |
| `params_pebble.scad` | **pebble variant** params: river-stone outer form + a back clip. `include`s `params.scad` and reuses all electronics/cavity values; only adds outer-shape and clip design knobs. The single source of truth for the variant's design values (these are choices, not measured parts, so they are NOT in dimensions.md). |
| `enclosure_pebble.scad` | **pebble variant** shell + clip. Reuses `cavity()`/`cut_*()`/`corner_grips()`/`mating_lip()`/`mating_groove()` from `enclosure.scad` unchanged; only replaces the outer form (superellipse plate → crown, hull-blended) and adds the pivot-spring clip (`clip_bosses()` on the body, `clip_arm()` as a separate printable part, plus pin/spring mocks). |
| `clip.scad` | Top-level. `variant` toggles `box` (default, Phase 1) / `pebble`; `mode` toggles assembly / shell / bottom / top / parts (+ `clip_arm` for pebble) and drives CLI export. |

When you edit OpenSCAD files, match the variable names exactly to the "OpenSCAD variable name"
column in dimensions.md — `params.scad` already does this; keep it in sync.

### Layout: head-aligned (battery is longer than the board)

The LiPo (`bat_l` 32.7) is **longer than the main board** (`board_l` 21.25), so the cavity is the
**bounding box of board ∪ battery**, not centered on the board (`cav_cx/cav_cy` derive from
`foot_x0..foot_y1`). The board's USB/camera **head is aligned to one short end** (`bat_x0 = 0`)
and the battery extends toward the tail (+X). This keeps the **USB-C port on the head end face** —
`cut_usb` follows `cav_x0` (don't hardcode the wall x). Changing `bat_x0`/centering the battery
will bury the USB port; re-check `cut_usb` if you touch the layout.

### Board retention (screwless)

The XIAO has no mounting holes and the board floats inside a battery-sized cavity, so it is held
by **corner clamps** (`corner_grip`/`corner_grips`) plus a **tail backstop** (`tail_backstop`),
matching common practice for this board (community cases are all screwless snap/sandwich designs).
Each clamp grips only the **main board** at its corners (measured 1.8 mm component-free margin at
all 4 corners; tune via `clamp_reach`/`clamp_run`). Because the board sits at the head, only the
**head corners get both edges** (anchored to the near end wall); the **tail corners get the long-
edge grip only**, and the `tail_backstop` wall takes the +X load (USB-plug insertion). The
**Sense board has no margin and is never touched** — tail-side top retainers and the backstop stay
inside the B2B gap (`top_h_rear < b2b_gap`). The shelf needs room under the board, so `bat_gap` is
derived as `max(0.6, shelf_t + 0.2)`.

Open TODOs: the **camera pocket / lens-bore alignment** still needs `cam_rot` (unmeasured in
dimensions.md §7); a **wire/antenna notch** in `tail_backstop` once routing is decided; and screw
bosses are intentionally omitted. Validate any geometry edit with a headless render
(`Status: NoError` = watertight) — `openscad` is installed via the `openscad@snapshot` cask.

### pebble variant (product-shaped outer + back clip)

A second outer form aimed at the product look (`hardware/clip/device_image_*` reference): a **river-stone
body** with a large **pivot + torsion-spring back clip** for stable wear. It is a *variant*, not a fork —
**the electronics layout, cavity, board retention and openings are identical** and come from `enclosure.scad`
via `use`. Only the outer shell is replaced and the clip is added.

- The internal layout already matches the product concept: lens + mic on the **+Z (camera) face**, USB-C on
  the **-X end face**, battery on **-Z**. So the clip mounts on the **-Z back** (flat seat) and the camera +Z
  face is the domed "front".
- **Outer form** (`pebble_outer_solid`): a flat back plate → widest "waist" → cavity-covering "crown"
  (sphere-rounded top), blended with one `hull()`. The crown must enclose the cavity footprint so the top /
  upper-side walls keep thickness — `crown_margin` is that wall budget. Height auto-fits the cavity
  (`peb_z_top`/`peb_z_bot` derive from it; ≈22.85 mm, within the 20–23 mm target). The cavity is tall (camera
  stack ~15 mm) so the achievable shape is a *flat* river stone, not a tall dome — that is geometric, not a
  tuning miss. `peb_l`/`peb_w` are the image targets (50×38); the generous XY margin is what leaves room to
  round the top edge without thinning the wall over the cavity.
- **Clip** (`clip_bosses` + `clip_arm`): hinge at the head (-X) end, pin axis along Y. Bosses are on the body
  (added to the **bottom** half); the arm is a **separate printable part** (`mode="clip_arm"`) with a central
  knuckle (a barrel, offset to +Y so the coil sits beside it on -Y) over the back, an organic pad, an angled
  grip tip that meets the back face, and a lanyard slot. The bosses use a **snap-in pin seat** (a Y-cylinder
  seat with a `-Z`-facing slit narrower than the pin) so the pin — and thus the clip — is captured into the
  body. The hinge sits well below the back (clip protrudes ~6.6 mm), clear of the USB-C opening (z ≈ 0–6).
  - **Spring (selected): MonotaRO 33-0444** (confirmed spec) — torsion, **SUS304-WPB**, wire 0.6 / ID 4 /
    **OD 5.2** / free angle 135° / 3.125 turns / **arm(leg) 16 mm** / **working angle 57°** / **RH wound** /
    RoHS / rate 0.457 N·mm/° → design torque ≈ 26 N·mm. Same-mount stiffer swap: 33-0441. The hinge is sized
    to it: **pin Ø3.0** (FDM proto: easy-to-source φ3 rod / M3 through the ID-4 coil, ~0.5 mm play — go Ø3.5
    for the final to tighten it), pin dropped `clip_pin_drop` so the OD-5.2 coil clears the
    back, plus a **body-side leg anchor** (`clip_leg_anchor_body`, routed into the **-Y boss** — NOT +Z, since
    the 1.6 mm back wall would otherwise be punched through into the battery cavity) and an **arm-side leg
    slot**. Spring values live in `params_pebble.scad` (`clip_spring_*`). Pin and spring are off-the-shelf
    (mocks only in CAD). TODO[spring]: finalize leg-anchor angle/depth (~78° installed = 135−57) and grip
    force by bench test; legs are trimmed to length.
- **USB-C opening** (`cut_usb_peb`, NOT the box `cut_usb`): the stone head wall is ~7.5 mm thick, far too deep
  for the box's thin-wall cut (which never reaches the outer surface). The pebble cut is a stepped **overmold
  counterbore + a slot tunneling to the receptacle**, so a real plug reaches the connector. If you move the
  layout or `peb_l`/`peb_cx`, re-check the well depth in render.
- **Closure**: the z=0 tongue/groove (`mating_lip`/`mating_groove`, reused) is the alignment + sandwich
  retention (board located in the bottom tub, top caps + retains via the corner-clamp pushers). On top of it,
  pebble adds **snap-fit** detents: `snap_beads()` (on the bottom tongue's outer face) drop into
  `snap_pockets()` (in the lid's groove wall), 4 total on the long sides. The **thin tongue (1 mm) flexes
  inward** during insertion since the stone outer wall is rigid — keep that in mind if you retune `snap_proj`.

## Build / export (OpenSCAD)

OpenSCAD must be on `PATH` as `openscad`. Use the apt package (`sudo apt install openscad`), or — if
apt/sudo is unavailable — the FUSE-free AppImage, extracted once and symlinked into `~/.local/bin`:

```bash
curl -fsSL -o /tmp/oscad.AppImage https://files.openscad.org/OpenSCAD-2021.01-x86_64.AppImage
chmod +x /tmp/oscad.AppImage && (cd /tmp && ./oscad.AppImage --appimage-extract)
mv /tmp/squashfs-root ~/.local/share/openscad-appimage
ln -sf ~/.local/share/openscad-appimage/usr/bin/openscad ~/.local/bin/openscad  # ~/.local/bin is on PATH
```

Export is headless (no display needed). Tune wall thickness / clearance for the target process in
`params.scad` first, then:

```bash
openscad -D 'mode="bottom"' -o clip/export/clip_bottom.stl clip/clip.scad
openscad -D 'mode="top"'    -o clip/export/clip_top.stl    clip/clip.scad
# 3MF carries mm units in metadata — preferred over STL for OEM handoff:
openscad -D 'mode="bottom"' -o clip/export/clip_bottom.3mf clip/clip.scad

# pebble variant (add -D 'variant="pebble"'; the clip arm is its own part):
openscad -D 'variant="pebble"' -D 'mode="bottom"'   -o clip/export/pebble_bottom.stl clip/clip.scad
openscad -D 'variant="pebble"' -D 'mode="top"'      -o clip/export/pebble_top.stl    clip/clip.scad
openscad -D 'variant="pebble"' -D 'mode="clip_arm"' -o clip/export/pebble_clip.stl   clip/clip.scad
```

The CGAL render log prints `Simple: yes` when the mesh is 2-manifold (watertight) — verify this
before any OEM handoff. `clip/export/` is gitignored (regenerate from source).

## Live preview while editing

Two hot-reload options:

- **GUI** — `openscad clip/clip.scad`, then enable *Design → Automatic Reload and Preview*; saving a
  `.scad` from any editor re-renders. Edit `variant=`/`mode=` to switch box/pebble and assembly / shell /
  bottom / top.
- **Browser** — `cd clip && node dev-preview.mjs` (Node built-ins only, no deps; honours the
  `OPENSCAD` / `PORT` / `VARIANT` env vars) serves `http://localhost:8787/`. It re-exports the shell + parts
  STL on every `.scad` save and `clip/preview.html` swaps the geometry in place, preserving the camera.
  Shell is shown translucent over the part mocks so interference is visible. Set `VARIANT=pebble node
  dev-preview.mjs` for the stone/clip variant.

## Conventions for working with dimensions (from dimensions.md)

- Units are **mm**.
- **Record raw measured sizes.** Fit clearances are added on the OpenSCAD side (e.g. battery
  thickness = measured value + 0.5–1 mm of slack).
- **Master origin = the corner of the XIAO main board's USB-C-side short edge.** Parts on the main
  board are referenced to this origin. The expansion board and camera X/Y are referenced to their
  own local origins and transformed into real space via `assy_offset`.
- Top face = USB-C side / bottom face = the side the Sense expansion board attaches to.

## Settled design decisions

These are already decided in dimensions.md. The enclosure design assumes them.

- **Power on/off is a capacitive-touch long press → deep sleep. There is no physical switch.**
  This removes the need for a power-switch opening in the enclosure, which helps waterproofing (#30).
- **The battery is hard-wired** (not meant to be replaced). It is always connected to the `BAT`
  pad, so charging works regardless of power state.
- The touch surface (the face whose wall is thinned to ~1.5–2 mm) is the **camera-side face**.
- The USB-C opening is designed wider than the receptacle (~12–13 mm) rather than measuring the
  plug's resin molding, since that varies per cable.

## Integration points

- The power-button long-press and touch-wake behavior must stay consistent with the firmware side
  (`POWER_BUTTON_PIN`, `POWER_OFF_PRESS_MS`, etc. in `firmware/src/config.h`).
- Openings that form water-ingress paths (USB-C / mic hole) are catalogued in the waterproofing
  (#30) section of dimensions.md.
