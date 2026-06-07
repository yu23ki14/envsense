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
| `clip.scad` | Top-level. `mode` toggles assembly / shell / bottom / top / parts and drives CLI export. |

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
```

The CGAL render log prints `Simple: yes` when the mesh is 2-manifold (watertight) — verify this
before any OEM handoff. `clip/export/` is gitignored (regenerate from source).

## Live preview while editing

Two hot-reload options:

- **GUI** — `openscad clip/clip.scad`, then enable *Design → Automatic Reload and Preview*; saving a
  `.scad` from any editor re-renders. Edit `mode=` to switch assembly / shell / bottom / top.
- **Browser** — `cd clip && node dev-preview.mjs` (Node built-ins only, no deps; honours the
  `OPENSCAD` / `PORT` env vars) serves `http://localhost:8787/`. It re-exports the shell + parts STL
  on every `.scad` save and `clip/preview.html` swaps the geometry in place, preserving the camera.
  Shell is shown translucent over the part mocks so interference is visible.

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
