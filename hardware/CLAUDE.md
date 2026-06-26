# hardware

The clip-style enclosure for envsens. The physical design of the wearable device that houses the
XIAO ESP32S3 Sense + OV2640 camera + LiPo battery. It is developed as a parametric OpenSCAD design
(Phase 1 / GitHub #2).

## Current state

The Phase 1 OpenSCAD design skeleton exists in `clip/`:

| File | Role |
| --- | --- |
| `dimensions.md` | **Measured part dimensions** — the single source of truth for the reference values. |
| `params.scad` | All measured values (variable names mirror dimensions.md) + clearance/wall/process knobs + derived Z layers and cavity dims. |
| `parts.scad` | Mock of the internal parts (board / Sense board / camera / battery) used both for assembly fit-check and as the `difference()` negative. |
| `enclosure.scad` | The shell: rounded outer box minus cavity minus openings (USB-C / SD / lens / mic), split into `enclosure_bottom()` / `enclosure_top()` at z=0. Also holds the board retention (4-corner clamps) and the `lip`/`groove` mating joint. |
| `params_pebble.scad` | **pebble variant** params: river-stone outer form + a back clip. `include`s `params.scad` and reuses all electronics/cavity values; only adds outer-shape and clip design knobs. The single source of truth for the variant's design values (these are choices, not measured parts, so they are NOT in dimensions.md). |
| `enclosure_pebble.scad` | **pebble variant** shell + clip. Reuses `cavity()`/`cut_*()`/`corner_grips()` from `enclosure.scad` unchanged; replaces the outer form (superellipse plate → crown, hull-blended), swaps the mating joint to its own `peb_mating_lip/groove` (tongue on the TOP — see Closure below), and adds the one-piece flex clip (`clip_flex()`, unioned into the bottom — no separate parts). |
| `clip.scad` | Top-level. `variant` toggles `box` (default, Phase 1) / `pebble`; `mode` toggles assembly / shell / bottom / top / parts and drives CLI export. |

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
**head corners get both edges and a top retainer** (anchored to the near end wall); the **tail
corners get the long-edge grip only, below z=0** — tail-side top retainers are geometrically
impossible: the Sense board canopies the entire main-board tail (full width, overhanging it by
0.45 mm in +X), so anything on the lid that ends up under that canopy collides with the Sense top
face during the vertical close (a lid feature's descent sweep is the column above its final
position). The **Sense board has no margin and is never touched** in the assembled state; +X load
(USB-plug insertion) is taken by the Sense tail edge against the `tail_backstop` ribs at `clr`
(through the B2B connector), with the main-board edge as a 0.75 mm backup, and tail lift is
limited to 0.3 mm by the ribs' brow over the Sense tail (contact only on abnormal lift). The board↔battery gap `bat_gap` must clear both the
retention shelf **and** the battery-lead solder joints on the underside BAT pads (which face the
battery), so it is `max(shelf_t + 0.2, bat_lead_clr)` (= 1.6 mm). Pair with low-profile solder + a
Kapton film on the battery top when wiring.

**The `tail_backstop` belongs to the TOP half, not the bottom.** Because the battery is hard-wired
to the board (a soldered board+battery unit, both larger than nothing-but-the-board) and drops into
the bottom tub, a full-width tail wall in the bottom would block insertion. So `corner_grips()` does
**not** call `tail_backstop()`; instead `enclosure_top()` / `pebble_enclosure_top()` union it
**outside** the `z>0` intersection so its `z<0` portion survives and reaches down to the board tail
edge. Closing the lid lowers the backstop across `z=0` to lock the board in +X; a `-X` lead-in
chamfer (`ch`) nudges a +X-drifted board back. **Shape: a single cantilever rib hung from the cavity
ceiling** (`backstop_w` × `backstop_t`), pushed against the **+Y wall** (was two shoulder ribs; merged
2026-06 for wiring) — when the lid is printed face-down it grows straight up off the ceiling, so no
layer starts in mid-air (the earlier low cross-wall only existed near `z=0` and its first printed
layer was an unsupported bridge between the side walls). The rib front face sits at the **Sense tail
+ `clr` (x=22.0) for the full height** — anything further -X would scrape the Sense tail edge during
the vertical close, since the Sense overhangs the main-board tail. Near the ceiling the rib carries a
**brow** (`z_sense_top + 0.3`, reaching 1.2 mm over the Sense tail) that limits board-tail lift to
0.3 mm without touching the Sense in the normal state; its underside faces down in model space, i.e.
up in the face-down print, so it adds no overhang. The 7.3 mm width overlaps the Sense tail edge by
6.1 mm — more bearing than the old two ribs combined (2.3 + 2.3); the off-centre +X reaction yaws the
board slightly, which the tail corners' long-edge grips (below z=0) take. The **−Y side of the tail
ceiling is fully open** — it is the battery-lead / antenna pass-through (the former `cut_wire_notch`
is gone) and hosts the pebble touch-pad pocket, which moved −Y with it (`touch_pad_pos` y =
`cav_y0`+6.5; pocket top edge y=11.0 keeps 0.5 to the rib inner edge y=11.5). The rib stays `clr`
inside the cavity in Y so the `z<0` portion clears the bottom wall and tongue. Assembly order: drop
battery+board into the open bottom, route leads through the −Y opening, then close the top.

Open TODOs: the **camera pocket / lens-bore alignment** still needs `cam_rot` (unmeasured in
dimensions.md §7); and screw bosses are intentionally omitted. Wires/antenna route through the
**open −Y side of the tail ceiling, beside the single backstop rib** (the dedicated `cut_wire_notch`
was removed along with the `wire_notch_*` params). Validate any geometry edit with a headless render
(`Status: NoError` = watertight) — `openscad` is installed via the `openscad@snapshot` cask.

### microSD relief (the inserted card overhangs the head)

The Sense board's microSD slot (a cage on the Sense **component (+Z) face**, between the USB top
z=3.0 and the camera base z=7.75) lets the inserted card protrude to **x = -2.5** (`sd_protrude`,
measured) — 0.6 mm past the cavity head wall's inner face. The card's z/y envelope is **ASSUMED**
(`sd_z0`/`sd_y0` in params.scad, mocked by `sd_card()` in parts.scad) — verify on hardware.

- **box** (`cut_sd`): a **through slot above the USB opening**, the standard solution in community
  XIAO Sense cases. Assembly is *close empty, then insert the card from outside* — so the lid's
  vertical descent never meets the card. The slot merges with the USB opening into one hole (a
  bridge between them would be a 0.2 mm unprintable wafer). The card nose ends ~1 mm inside the
  outer face; removal is tweezers or opening the case.
- **pebble** (`cut_sd_peb`): **no external opening** (#30 keeps SD unexposed). Instead a **vertical
  channel in the TOP's head wall, open down to the mating face (z=0)** and blind in X. The
  open-bottom is what makes closing possible: the channel *is* the card nose's descent column, so
  the lid drops around the inserted card (an X-blind pocket alone would collide during the close).
  Its front face sits `sd_clr_x` (1.0) past the USB counterbore floor (x=-4.1; was coplanar at
  -3.1 with only 0.6 mm to the card nose — the printed unit's card hit the wall, widened 2026-06).
  Deeper than the well floor leaves a 1 mm step, not the 0.1 mm wafer that a *shallower* face
  would — the channel joins the well's upper region (card nose visible down the well, but a
  plug's overmold stops at the well floor and never reaches it). Card swap = open the case.
  The cut is applied **only in `pebble_enclosure_top()`**, not in `pebble_shell_solid()` — the
  bottom shares the shell solid and would otherwise get a 0.1 mm bite out of its rim first layer.

### pebble variant (product-shaped outer + back clip)

A second outer form aimed at the product look (`hardware/clip/device_image_*` reference): a **river-stone
body** with a **one-piece flex back clip** (shirt-clip style) for stable wear. It is a *variant*, not a fork —
**the electronics layout, cavity, board retention and openings are identical** and come from `enclosure.scad`
via `use`. Only the outer shell is replaced and the clip is added.

- The internal layout already matches the product concept: lens + mic on the **+Z (camera) face**, USB-C on
  the **-X end face**, battery on **-Z**. So the clip mounts on the **-Z back** (flat seat) and the camera +Z
  face is the domed "front".
- **Outer form** (`pebble_outer_solid`): a flat back plate → widest "waist" → cavity-covering "crown"
  (sphere-rounded top), blended with one `hull()`. The crown must enclose the cavity footprint so the top /
  upper-side walls keep thickness — `crown_margin` is that wall budget. Height auto-fits the cavity
  (`peb_z_top`/`peb_z_bot` derive from it; ≈25.8 mm — the 20–23 mm image target is knowingly exceeded, a
  2026-06 decision: `top_headroom` plus the camera raise (`cam_tip_h`=13, clearing the SD card / FPC-fold
  interference) take priority). The cavity is tall (camera stack 13 mm) so the achievable shape is a *flat*
  river stone, not a tall dome — that is geometric, not a tuning miss. `peb_l`/`peb_w` are the image targets (50×38); the generous XY margin is what leaves room to
  round the top edge without thinning the wall over the cavity.
- **Clip** (`clip_flex`, replaced the pivot + torsion-spring design 2026-06 — pin/spring sourcing and the
  hinge history live in git): a **one-piece flex clip** (shirt-clip style) unioned into the **bottom** half —
  no sourced parts, no assembly step. Shape: a rigid root block drops from the back near the head (-X), a
  **tapered arm** (w 20→14, t 2.4) runs toward the tail; garment slides in from the tail past a flared tip and
  is pinched between a **half-round bead on the BODY back face** and the flat arm (`clip_pinch` 0.4 at the
  bead crest). The stress design follows the FDM strain limits that killed the snap fingers (~2–3% in-plane,
  half that across layers): the **only flexing member is the arm**, which prints as a horizontal slab
  (mating-face-down bottom) so bending stress is in-plane; the **root block crosses layers but is bulky**
  (7×20 footprint welded 1.0 into the back wall) so its interlayer stress stays at a few MPa. Design point
  (PETG, E≈2 GPa): k = E·w·t³/4L³ ≈ 5–6 N/mm → ~3.5 N pinch on 1 mm fabric; 3 mm opening ≈ 1.2% root strain
  (in-plane, elastic). **Print PETG, not PLA** (creep + brittleness). The bead lives on the body, not the arm,
  because the body back face prints facing up (clean), while the arm's gripping face prints facing down; the
  arm-to-back running gap is `clip_gap` 2.0 — deliberately support-sized, since a uniform 0.4 gap can't hold
  support and would print in mid-air. Supports stand on the back face under the arm; scars hide under the arm.
  Total protrusion below the back ≈ 5.9 mm (was ~7.4 with the hinge). All values are `clip_*` in
  `params_pebble.scad` §2. TODO[clip]: bench-check pinch force / fatigue on a printed unit.
- **USB-C opening** (`cut_usb_peb`, NOT the box `cut_usb`): the stone head wall is ~7.5 mm thick, far too deep
  for the box's thin-wall cut (which never reaches the outer surface). The pebble cut is a stepped **overmold
  counterbore + a slot tunneling to the receptacle**, so a real plug reaches the connector. If you move the
  layout or `peb_l`/`peb_cx`, re-check the well depth in render.
- **Closure**: the z=0 tongue/groove is the alignment + sandwich retention (board located in the bottom tub,
  top caps + retains via the head corner-clamp pushers). **pebble puts the tongue on the TOP and the groove in
  the bottom** (`peb_mating_lip`/`peb_mating_groove`, NOT the box `mating_lip`/`mating_groove`): the integrated
  clip forces the bottom to print mating-face-down, and a bottom-side tongue would leave the rim hanging 2 mm
  above the bed as a rough downward-facing ledge — with the groove in the bottom, the rim *is* the first layer.
  The ring is pushed `lip_off` (1.0) outside the cavity outline so the bottom groove does not sever the corner
  clamps' side-wall welds (`lip_off - lip_clr ≥ weld` is the invariant). Retention is **rigid catch tongues on
  the top × sideways latch beams in the bottom** (`peb_snap_catches` / `peb_latch_pockets`; design values
  `catch_*`/`snap_*`/`latch_*` in `params_pebble.scad`): at `snap_xs` × both long sides the tongue is locally
  extended into a rigid 4 mm catch (fused to the ring, no slits — it never flexes) carrying a half-round bead
  (`snap_proj` 0.6, offset toward +X); the bottom's groove outer wall is locally cut free into a horizontal
  cantilever beam (relief void behind, `latch_slit` 0.4 below, vertical end slit at +X, root at the −X end)
  with a 45° lead-in chamfer on its top inner edge. Closing cams the beam outward 0.3 and the bead clicks
  under the beam's bottom edge (0.05 preload bite); opening cams the beam back over the bead's round top —
  reopenable, non-destructive. **The flexing member lives in the bottom on purpose**: its mating-face-down
  print makes beam bending in-plane (along perimeters), ε ≈ 1.5×1.2×0.3/7² ≈ 1.3% in the strong direction,
  while nothing on the top flexes at all. History (all 2026-06): full-ring snap → ~11% strain, the 0.8 mm
  bottom ridge yielded; magnets (3 glued 2.3×1.7×1.5 pairs) → too weak; 6 mm top-side snap fingers → the
  face-down print makes them vertical cantilevers, bending tension landed on the root layer seam and they
  tore off. If you move `snap_*`/`latch_*`, re-render the closed-state intersection of both halves — the only
  intended overlap is the 4 bead-preload slivers.

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

# pebble variant (add -D 'variant="pebble"'; the flex clip is part of the bottom):
openscad -D 'variant="pebble"' -D 'mode="bottom"' -o clip/export/pebble_bottom.stl clip/clip.scad
openscad -D 'variant="pebble"' -D 'mode="top"'    -o clip/export/pebble_top.stl    clip/clip.scad
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
