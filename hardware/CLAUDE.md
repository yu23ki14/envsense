# hardware

The clip-style enclosure for envsense. The physical design of the wearable device that houses the
XIAO ESP32S3 Sense + OV2640 camera + LiPo battery. It is developed as a parametric OpenSCAD design
(Phase 1 / GitHub #2).

## Current state

Only `clip/dimensions.md` exists. It is a record of **measured part dimensions** and serves as the
reference values for the Phase 1 OpenSCAD design. There are no `.scad` files yet. When you create
OpenSCAD files, match the variable names exactly to the "OpenSCAD variable name" column in
dimensions.md.

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
