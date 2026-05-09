# BOM — PR-SHM Sensor Node

> Every component, part number, supplier, unit cost, and selection rationale.
> Parent: ARCHITECTURE.md + POWER_BUDGET.md · Author: G. Kafka-Gibbons · DRAFT v0.2 · 2026-02-22

---

## Per-Node BOM

### Core Electronics

| # | Component | Part Number | Supplier | Qty | Unit | Ext | Why this part |
|---|-----------|-------------|----------|-----|------|-----|---------------|
| 1 | Platform / MCU | Nordic Thingy:91 X | DigiKey | 1 | $126.25 | $126.25 | Integrated nRF9151 + LTE-M + battery + PMIC + enclosure. Fastest path to field. |
| 2 | Accelerometer | ADXL367 (onboard Thingy:91 X) | — | 1 | $0.00 | $0.00 | 200 µg/√Hz noise, 14-bit, I2C. Built into Thingy:91 X — no external board needed. |
| 3 | SIM card | iBasis eSIM (included) | — | 1 | $0.00 | $0.00 | Pre-loaded on Thingy:91, 10 MB free. Evaluate before buying external SIM. |

### Power

| # | Component | Part Number | Supplier | Qty | Unit | Ext | Why this part |
|---|-----------|-------------|----------|-----|------|-----|---------------|
| 4 | Solar panel (2W, 6-7V open circuit) | TBD — 100×80 mm mono | Amazon / AliExpress | 1 | ~$12.00 | $12.00 | Primary energy source for outdoor deployment. Feeds the BQ24074 solar charger input. |
| 5 | Solar lead wire | 22 AWG silicone, red/black | — | 0.5 m | ~$1.00 | $1.00 | UV-resistant silicone insulation. Soldered to panel, gland entry to enclosure. |
| 6 | Solar LiPo charger / load-share | BQ24074 breakout | Adafruit / equivalent | 1 | ~$12.50 | $12.50 | Charges external LiPo buffer from solar and provides seamless solar-to-battery load sharing. LOAD/OUT is roughly 3.0-4.4V, not USB 5V. |
| 7 | Buck-boost regulator | Pololu S7V8F5 | Pololu | 1 | ~$8.00 | $8.00 | Regulates the BQ24074 LOAD/OUT rail to safe 5.0V for Thingy USB-C. Mostly boosts the 3.0-4.4V load rail, with buck capability retained for margin/future wiring changes. |
| 8 | External buffer battery | 3.7V LiPo, 10Ah | TBD | 1 | ~$20.00 | $20.00 | Primary overnight/storm energy reservoir. Connects to BQ24074 LIPO through fuse. |
| 9 | Resettable fuse | 2A polyfuse | DigiKey / Amazon | 1 | ~$0.50 | $0.50 | Inline protection between external LiPo positive lead and BQ24074 LIPO. |
| 10 | USB-C power lead | Cut USB-A to USB-C cable | — | 1 | ~$3.00 | $3.00 | Carries regulated 5V/GND from S7V8F5 to Thingy USB-C. Data wires insulated. |
| 11 | Heat shrink / insulation | Assorted | — | — | ~$1.00 | $1.00 | Insulates unused USB D+/D- wires and solder joints. |

### Interconnect

| # | Component | Part Number | Supplier | Qty | Unit | Ext | Why this part |
|---|-----------|-------------|----------|-----|------|-----|---------------|
| 12 | Pin headers (spare) | 2.54mm male breakaway | — | 1 strip | ~$0.50 | $0.50 | For bench prototyping / debug access. |

### Mounting & Enclosure (Phase 1 — CityLab)

| # | Component | Part Number | Supplier | Qty | Unit | Ext | Why this part |
|---|-----------|-------------|----------|-----|------|-----|---------------|
| 13 | Hose clamp (1–2") | Stainless worm-drive | Hardware store | 2 | ~$1.00 | $2.00 | Clamp to structural member. No drilling (SRS-604). |
| 14 | Conformal coat | MG Chemicals 422B (silicone) | Amazon | 1 can | ~$8.00 | $8.00 | Weatherproof solar panel solder joints and power-board wiring. Shared across all nodes. |
| 15 | Epoxy | J-B Weld ClearWeld | Hardware store | 1 tube | ~$5.00 | $5.00 | Bond enclosure to mount surface. Rigid coupling (SRS-601). |
| 16 | Cable ties | UV-rated nylon, 8" | — | 10 | ~$0.10 | $1.00 | Strain relief on solar and USB-C power leads. |

### Mounting & Enclosure (Phase 2 — PR Towers)

| # | Component | Part Number | Supplier | Qty | Unit | Ext | Why this part |
|---|-----------|-------------|----------|-----|------|-----|---------------|
| 17 | Enclosure (IP67) | Polycase WC-21 or Hammond 1554C | [Polycase](https://www.polycase.com) | 1 | ~$18.00 | $18.00 | UV-stabilized polycarbonate. RF-transparent for onboard antenna. Must fit Thingy plus charger/regulator/battery wiring. |
| 18 | Cable gland (IP67) | PG7, nylon | Amazon | 2 | ~$1.00 | $2.00 | Separate sealed entries for solar panel and regulated USB-C power lead. |
| 19 | L-bracket | 316 SS, 50×50mm | McMaster 1030A14 | 1 | ~$4.00 | $4.00 | Bolts to tower angle member. Marine-grade for salt environment. |
| 20 | M6 × 20mm bolt + nut | 316 SS hex head | McMaster | 2 | ~$0.75 | $1.50 | Bracket to structure. |
| 21 | Mounting standoff | M3 × 10mm nylon | — | 4 | ~$0.10 | $0.40 | Thingy:91 PCB to enclosure wall. Rigid coupling path. |
| 22 | Closed-cell foam gasket | 3mm neoprene, adhesive | Amazon | 1 sheet | ~$3.00 | $3.00 | Enclosure lid seal supplement. Shared across nodes. |

### Connectivity

| # | Component | Part Number | Supplier | Qty | Unit | Ext | Why this part |
|---|-----------|-------------|----------|-----|------|-----|---------------|
| 23 | SIM card (if iBasis insufficient) | Hologram Hyper SIM | [Hologram](https://hologram.io) | 1 | ~$5.00 | $5.00 | Pay-per-use IoT SIM. PR LTE-M coverage via T-Mobile / AT&T. |
| 24 | SIM data plan (6 months) | ~60 MB est. (1 kB/hr × 4,380 hr) | Hologram | 1 | ~$25.00 | $25.00 | $0.40/MB zone 1. Feature packets only, no raw data. |

---

## Per-Node Cost Summary

| Category | Phase 1 (CityLab) | Phase 2 (PR) |
|----------|-------------------|--------------|
| Core electronics (#1–3) | $126.25 | $126.25 |
| Power (#4–11) | ~$58.00 | ~$58.00 |
| Interconnect (#12) | $0.50 | $0.50 |
| Mounting + enclosure | $16.00 (#13–16) | ~$28.90 (#17–22) |
| Connectivity (#23–24) | $0 (iBasis trial) | $30.00 |
| **Node total** | **~$201** | **~$244** |

---

## 5-Node Fleet Cost

| Line | Qty | Cost |
|------|-----|------|
| Core electronics | 5 | $631 |
| Power | 5 | ~$290 |
| Interconnect | 5 | $3 |
| Mounting — Phase 1 | 5 | $16 (shared consumables) |
| Mounting — Phase 2 | 5 | ~$145 |
| Connectivity | 5 | $150 |
| Shipping (DigiKey + PR) | — | $50 |
| **Fleet total** | | **~$1,269** |

```
Budget constraint (C-1):  $2,000
Estimated spend:          $1,269
Margin:                   $731 (for spares, iteration, unforeseen)
```

---

## Shared Tools (Not Per-Node)

These are one-time purchases or already owned. Not included in per-node BOM.

| Tool | Est. Cost | Notes |
|------|-----------|-------|
| Soldering iron (Pinecil or equiv) | $25 | If not already owned |
| Nordic PPK2 (power profiler) | $99 | Validate POWER_BUDGET.md numbers |
| Multimeter | $0 | Already owned |
| J-Link debugger | $0 | Onboard Thingy:91 via nRF52840 |
| nRF Connect for Desktop | $0 | Free |
| Segger Embedded Studio / VS Code | $0 | Free |

---

## Procurement Notes

```
1. Order Thingy:91 first (DigiKey, 1–3 day ship).
   ADXL367 is onboard — no external sensor to source.
   Begin firmware dev while waiting for solar panels / mounting hardware.

2. iBasis eSIM (included) has 10 MB free — enough for ~2 weeks of
   hourly transmits. Evaluate coverage + data consumption before
   committing to Hologram or Soracom.

3. Order Pololu S7V8F5 buck-boost regulators for the solar front end.
   Do not substitute a boost-only regulator unless the wiring review proves
   its input is only the BQ24074 LOAD/OUT rail and never the solar/VBUS input
   rail.

4. Phase 2 enclosure/bracket not needed until Week 9+.
   Order after CityLab validation confirms the design works.

5. All mechanical hardware (clamps, brackets, bolts) available same-day
   from McMaster-Carr or local hardware store.
```

---

## Alternates Considered

| Component | Alternate | Why rejected |
|-----------|-----------|-------------|
| Platform | nRF9160 DK ($155) | No enclosure, battery, or antenna — adds weeks of integration |
| Platform | Particle Boron ($49) | No LTE-M in PR bands, weaker MCU, different SDK |
| Accelerometer | ADXL355 (EVAL-ADXL355-PMDZ, $16) | 7× lower noise but requires external SPI wiring and mechanical coupling |
| Accelerometer | LIS344ALH ($3) | 50,000 ng/√Hz — worse than ADXL367 |
| Accelerometer | PCB 393B31 ($$$) | Research-grade but no DC response, requires signal conditioner, 100× cost |
| Solar charger | Direct solar to Thingy USB-C | Unsafe without regulation; panel/charger rail can exceed 5V. |
| Solar charger | Direct solar to nPM1300/Thingy battery path | Requires invasive modification to the stock board and does not provide external 10Ah buffer management. |
| Regulator | Pololu U3V70F5 boost-only | Could work only if its input is guaranteed to be BQ24074 LOAD/OUT. Rejected for baseline because S7V8F5 gives a wider verified input envelope and reduces wiring-substitution risk. |
| Solar controller | BQ25570 ($8) | Better energy harvesting/MPPT, but slower integration than BQ24074 load-share plus S7V8F5 buck-boost for this prototype. |
| Enclosure | Pelican Micro ($30) | Overkill for Phase 1. Good option if aluminum needed for Phase 2. |

---

## Doc Chain

```
PRD.md → SRS.md → ARCHITECTURE.md → POWER_BUDGET.md → BOM.md  ← you are here
                                                       ├── HARDWARE_SPEC.md
                                                       ├── FIRMWARE.md
                                                       ├── TEST_PLAN.md
                                                       └── FIELD_GUIDE.md
```
