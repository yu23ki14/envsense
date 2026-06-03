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
| `enclosure.scad` | The shell: rounded outer box minus cavity minus openings (USB-C / lens / mic), split into `enclosure_bottom()` / `enclosure_top()` at z=0. |
| `clip.scad` | Top-level. `mode` toggles assembly / shell / bottom / top / parts and drives CLI export. |

When you edit OpenSCAD files, match the variable names exactly to the "OpenSCAD variable name"
column in dimensions.md — `params.scad` already does this; keep it in sync.

Open TODOs marked in the source: the lid/body mating lip & snap/screw bosses are not implemented
yet (`lip_*` params exist), and the battery is assumed **stacked behind the board stack** — a
side-by-side layout would change `cav_*` and the `battery()` placement.

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
