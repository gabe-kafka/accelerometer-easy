# HARDWARE_SPEC - PR-SHM Sensor Node

> Research-grade hardware specification for the PR-SHM low-cost cellular
> accelerometer node.
> Author: Gabriel Kafka-Gibbons
> Status: Draft v0.1
> Last updated: 2026-05-08

---

## 1. Purpose and Scope

This document specifies the physical hardware for a low-cost wireless
accelerometer node intended for structural health monitoring (SHM) proof-of-
concept testing. It is written so that another engineer can reproduce the
prototype, understand the power architecture, verify the voltage path, and
separate measured facts from design assumptions.

This spec covers:

- Nordic Thingy:91 X sensing/comms platform.
- ADXL367 onboard accelerometer usage.
- External solar power front end.
- Voltage regulation path into Thingy USB-C.
- External and internal battery roles.
- Mechanical mounting and enclosure assumptions.
- Hardware telemetry boundaries.
- Verification tests required before field deployment.

This spec does not cover:

- Full PCB design.
- Production enclosure design.
- Certified environmental qualification.
- Long-term deployed fleet operation.
- Final firmware duty-cycle implementation.

---

## 2. Evidence Classification

Every hardware claim should be treated as one of these evidence classes:

| Class | Meaning |
|-------|---------|
| MEASURED | Verified directly on the prototype with instrumented bench or field data. |
| DATASHEET | Taken from manufacturer documentation or vendor specifications. |
| CALCULATED | Derived from explicit formulas using documented inputs. |
| DESIGN TARGET | Intended design value that must still be bench-verified. |
| ASSUMED | Working assumption used for planning; must not be presented as measured. |
| FUTURE WORK | Required for field-ready deployment but not yet completed. |

---

## 3. System Overview

The node uses a stock Nordic Thingy:91 X as the sensing, compute, cellular, and
local battery platform. The updated field power architecture does not feed the
solar panel directly into the Thingy. Instead, the solar/battery front end
produces a regulated 5.0V USB-C input.

```text
2W solar panel
  ~6.0-7.0V in sun
        |
        v
BQ24074 solar LiPo charger / load-share
  LOAD/OUT: ~3.0-4.4V load rail, not USB 5V
  LIPO: external 10Ah LiPo buffer
        |
        v
Pololu S7V8F5 buck-boost regulator
  VIN: 2.7-11.8V
  VOUT: regulated 5.0V
        |
        v
Cut USB-A to USB-C power lead
  red = +5V, black = GND
  green/white data wires insulated
        |
        v
Nordic Thingy:91 X
  USB-C VBUS = regulated 5.0V
  internal nPM1300 + stock 1350 mAh LiPo
  onboard ADXL367 accelerometer
  nRF9151 LTE-M modem
```

Final report figure:

- `public/diagrams/final-hardware-architecture.drawio`
- `public/diagrams/final-hardware-architecture.svg`

Use the `.drawio` file as the editable source and export the `.svg` for the
report body. The figure is simplified enough for the main paper while
preserving the required power path, telemetry boundary, and voltage summary.

Internal engineering diagram:

- `public/diagrams/thingy91x-voltage-trace.svg`

Use this SVG as a working voltage/wiring reference, not as the primary final
report figure. The final report should use the cleaner hardware specification
tables and a simplified architecture diagram unless the advisor requests
wiring-level detail.

Vendor source notes:

- Nordic Thingy:91 X product page:
  <https://www.nordicsemi.com/Products/Development-hardware/Nordic-Thingy-91-X>
  documents the nRF9151 platform, nPM6001/nPM1300 power management, and
  included 1350 mAh LiPo.
- Adafruit BQ24074 pinout/product pages:
  <https://learn.adafruit.com/adafruit-bq24074-universal-usb-dc-solar-charger-breakout/pinouts>
  and <https://www.adafruit.com/product/4755> document LOAD/OUT as regulated
  to no more than 4.4V and able to dip toward battery voltage; it is not a USB
  5V rail.
- Pololu S7V8F5 product page:
  <https://www.pololu.com/product/2123/specs> documents fixed 5V output from
  2.7V to 11.8V input.
- Analog Devices ADXL367 product page/data sheet:
  <https://www.analog.com/en/products/adxl367.html> documents the 3-axis,
  14-bit, +/-2g/+/-4g/+/-8g digital MEMS accelerometer.

---

## 4. Hardware Requirements

| ID | Requirement | Value / rule | Evidence class | Verification |
|----|-------------|--------------|----------------|--------------|
| HW-PWR-001 | Thingy USB-C input shall be regulated | 5.0V +/- 5% | DESIGN TARGET | Bench PSU sweep into S7V8F5; DMM on USB-C/TP12 |
| HW-PWR-002 | BQ24074 LOAD/OUT shall not connect directly to Thingy USB-C | Mandatory | DESIGN TARGET | Wiring inspection |
| HW-PWR-003 | Regulator substitution shall be controlled | S7V8F5 baseline; boost-only substitute only if its input is verified as BQ24074 LOAD/OUT and never solar/VBUS | DESIGN TARGET | BOM + wiring inspection |
| HW-PWR-004 | Solar panel shall feed charger input | Panel to BQ24074 VBUS | DESIGN TARGET | Wiring inspection + DMM |
| HW-PWR-005 | External field buffer shall be a single-cell LiPo pack | 3.7V nominal, 10Ah nominal | ASSUMED | BOM + measured charge/discharge test |
| HW-PWR-006 | External LiPo positive lead shall include current protection | 2A polyfuse inline | DESIGN TARGET | Wiring inspection |
| HW-PWR-007 | Thingy stock battery shall remain installed | 1350 mAh nominal | DATASHEET | Physical inspection |
| HW-SNS-001 | Accelerometer shall be onboard Thingy ADXL367 | 3-axis, 14-bit, +/-2g default | DATASHEET | Firmware init + static gravity test |
| HW-SNS-002 | Sensor shall be rigidly coupled to structure | No rattling mount; first mount resonance target >= 200 Hz | DESIGN TARGET | Tap/impact test |
| HW-COM-001 | Cellular backhaul shall use nRF9151 LTE-M | HTTPS POST to Supabase | MEASURED | HTTP 201 and database row |
| HW-MECH-001 | Phase 1 enclosure shall support short outdoor/bench deployment | Stock Thingy shell, IP54-class use | DATASHEET / ASSUMED | Inspection and soak test |
| HW-MECH-002 | Phase 2 enclosure shall be weather-resistant | IP67 target | FUTURE WORK | Enclosure selection + hose/rain test |

---

## 5. Electrical Specification

### 5.1 Voltage Nodes

| Node | Nominal / expected value | Minimum | Maximum | Evidence class | Notes |
|------|--------------------------|---------|---------|----------------|-------|
| Solar panel open/full-sun voltage | ~6.0-7.0V | 0V | ~7.0V | DESIGN TARGET | Depends on sun/load; feeds BQ24074 VBUS/DC input. |
| BQ24074 VBUS/DC input | Solar/input rail | 5V recommended minimum for useful charging | 10V normal input limit | DATASHEET | Input to charger; do not treat as Thingy power. |
| BQ24074 LOAD/OUT | Variable load rail | ~3.0V | ~4.4V | DATASHEET / DESIGN TARGET | Safe for 3.3V regulators or 5V boost converters, but not USB 5V. |
| S7V8F5 VIN | BQ24074 LOAD/OUT | 2.7V regulator lower bound | 11.8V regulator upper bound | DATASHEET / DESIGN TARGET | Covers full BQ24074 LOAD/OUT range with margin. |
| S7V8F5 VOUT | 5.0V | 4.75V | 5.25V | DESIGN TARGET | Safe USB-C input for Thingy. |
| Thingy USB-C VBUS / TP12 | 5.0V | 4.75V | 5.25V | DESIGN TARGET | Confirms regulated external power reaches Thingy. |
| Thingy internal LiPo / TP4 | 3.7V nominal | ~3.0V | 4.2V | DATASHEET / MEASURED | Firmware telemetry source. |
| Thingy 3V3 / TP19 | 3.3V | TBD | TBD | MEASURED | Bench observed 3.30V during debug. |

### 5.2 Prohibited Connections

Do not make these connections:

- Do not connect BQ24074 LOAD/OUT directly to Thingy USB-C.
- Do not connect BQ24074 VBUS/DC input, solar panel positive, or any other
  6-10V upstream charger rail to Thingy USB-C.
- Do not substitute a boost-only regulator unless the wiring is also proven to
  keep its input on the BQ24074 LOAD/OUT rail only.
- Do not feed Thingy USB-C from any rail that can exceed 5.25V.
- Do not leave unused USB data wires exposed.
- Do not bypass the external battery polyfuse.

Reason: BQ24074 LOAD/OUT is not a USB 5V rail. The Adafruit board documents
LOAD/OUT as approximately 3.0-4.4V, which is suitable as the input to a 5V
boost or buck-boost converter but not as a direct Thingy USB-C supply. The
S7V8F5 is retained as the baseline regulator because it presents a verified
5.0V output to the Thingy and has enough input-voltage range to tolerate bench
variation or future front-end changes. If a boost-only part is substituted, the
report must prove that the regulator input cannot ever be connected to the
solar/VBUS rail.

### 5.3 Wire Map

| Source | Destination | Wire / connection | Verification |
|--------|-------------|-------------------|--------------|
| Solar positive | BQ24074 VBUS | Red solar lead | Continuity + DMM panel voltage |
| Solar negative | BQ24074 GND | Black solar lead | Shared ground continuity |
| External LiPo positive | 2A polyfuse -> BQ24074 LIPO | Red battery lead | Fuse continuity + polarity check |
| External LiPo negative | BQ24074 GND | Black battery lead | Shared ground continuity |
| BQ24074 LOAD/OUT | S7V8F5 VIN | Red jumper | DMM: variable input rail |
| BQ24074 GND | S7V8F5 GND | Black jumper | Shared ground continuity |
| S7V8F5 VOUT | USB-C cable red | +5V | DMM: 5.0V before plugging into Thingy |
| S7V8F5 GND | USB-C cable black | Ground | Shared ground continuity |
| USB-C green/white | No connection | Insulate with heat shrink | Visual inspection |

### 5.4 Protection and Grounding

- All power-stage grounds share one common return.
- External LiPo positive lead uses a 2A inline polyfuse before the BQ24074 LIPO
  input.
- USB-C power lead carries only 5V and GND; data wires are insulated.
- Charger/regulator wiring must be strain-relieved inside the enclosure.
- Solar and USB-C leads must pass through sealed glands for Phase 2 deployment.

---

## 6. Energy Storage and Power Budget

| Storage element | Role | Capacity | Evidence class |
|-----------------|------|----------|----------------|
| Thingy stock LiPo | Local ride-through and firmware telemetry source | 1350 mAh nominal; 1080 mAh usable assumed | DATASHEET / CALCULATED |
| External LiPo buffer | Primary overnight/storm energy reservoir | 10Ah nominal; 8Ah usable assumed | ASSUMED / CALCULATED |

Duty-cycled target:

```text
Average system current: 1.07 mA
Daily energy: ~95 mWh/day
Thingy internal-only autonomy: ~42 days calculated
External 10Ah buffer autonomy: ~249 days with conversion margin
```

Current continuous-post firmware:

```text
Approx USB-side load: ~20 mA at 5V ~= 100 mW
Daily energy: ~2.4 Wh/day
External 10Ah buffer autonomy: ~10 days with conversion margin
Internal-only autonomy: ~2.3 days
```

Report implication: the final report must distinguish the feasible duty-cycled
power architecture from the current continuous-post firmware limitation.

---

## 7. Sensing Hardware

| Item | Specification | Evidence class | Notes |
|------|---------------|----------------|-------|
| Accelerometer | ADXL367 onboard Thingy:91 X | DATASHEET | No external accelerometer wiring required. |
| Axes | 3-axis | DATASHEET | Axis orientation must be recorded during mounting. |
| Resolution | 14-bit raw counts | DATASHEET / MEASURED | Firmware reads raw I2C registers. |
| Default range | +/-2g | DATASHEET / CONFIGURED | +/-4g and +/-8g available if configured. |
| Raw scale | ~250 micro-g/LSB at +/-2g | DATASHEET | Used for post-processing normalization. |
| Known firmware issue | Zephyr ADXL367 scale bug in NCS v2.9 | MEASURED | Bypassed with direct raw I2C reads. |

---

## 8. Compute, Communications, and Cloud Interface

| Subsystem | Hardware / interface | Evidence class | Notes |
|-----------|----------------------|----------------|-------|
| MCU/modem | nRF9151 SiP on Thingy:91 X | DATASHEET | Cortex-M33, LTE-M/NB-IoT. |
| Firmware | Zephyr / nRF Connect SDK | MEASURED | Current firmware posts raw batches. |
| Network | LTE-M HTTPS POST | MEASURED | HTTP 201 responses observed. |
| Cloud | Supabase PostgREST + PostgreSQL | MEASURED | Rows visible in dashboard/database. |
| Power telemetry | nPM1300 internal battery domain | MEASURED | Does not measure external 10Ah buffer directly. |

---

## 9. Mechanical Specification

| Item | Phase 1 | Phase 2 target | Evidence class |
|------|---------|----------------|----------------|
| Enclosure | Stock Thingy shell | IP67 polycarbonate enclosure | ASSUMED / FUTURE WORK |
| Mount | Hose clamps / epoxy | 316 SS bracket + bolts | DESIGN TARGET |
| Cable entry | Bench/short-term strain relief | IP67 glands for solar and USB-C power leads | FUTURE WORK |
| Sensor coupling path | Structure -> enclosure -> PCB -> ADXL367 | Same, with rigid bracket | DESIGN TARGET |
| Orientation record | Required in field notes | Required in field notes | DESIGN TARGET |

Mechanical acceptance criteria:

- No visible movement or rattle after mounting.
- Cable strain relief prevents load transfer to solder joints.
- Tap/impact test shows clean impulse response.
- Mount first resonance target is >= 200 Hz.

---

## 10. Hardware Telemetry Boundary

Firmware telemetry fields must be interpreted carefully:

| Telemetry | Hardware domain | Meaning | Limitation |
|-----------|-----------------|---------|------------|
| `battery_v` | Thingy internal LiPo / nPM1300 | Internal battery voltage | Not external 10Ah buffer voltage. |
| `battery_pct` | Thingy internal LiPo / nPM1300 | Derived internal battery estimate | Not external buffer state of charge. |
| `ibat` | Thingy internal LiPo / nPM1300 | Internal charge/discharge current sign-normalized in firmware | Does not measure external battery current. |
| `vbus` | Thingy USB-C / nPM1300 status | Whether regulated 5V input reaches Thingy | Does not prove external battery is charging. |
| `chg_state` | Thingy nPM1300 charger | Internal charger state | Does not report BQ24074 state. |

Research-grade reporting rule:

> When discussing the external 10Ah buffer, use direct measurements of the
> external pack or BQ24074/S7V8F5 rails. Do not infer external buffer state of
> charge from Thingy `battery_v` alone.

---

## 11. Verification Matrix

| Test ID | Claim verified | Procedure | Pass criterion | Evidence artifact |
|---------|----------------|-----------|----------------|-------------------|
| HW-V-001 | S7V8F5 regulates across BQ24074 LOAD/OUT range | Sweep S7V8F5 VIN from 3.0V to 4.4V with bench PSU | VOUT remains 5.0V +/- 5% | DMM log / photo |
| HW-V-002 | Thingy never sees raw BQ24074 LOAD/OUT or solar/VBUS | Inspect wiring before power-up | BQ24074 LOAD/OUT only connects to S7V8F5 VIN; Thingy USB-C only sees S7V8F5 VOUT | Wiring photo |
| HW-V-003 | Solar panel produces usable input | Measure panel leads in sun | ~6.0-7.0V open/full sun | DMM reading |
| HW-V-004 | BQ24074 charges external buffer | Panel or bench input into BQ24074, measure external LiPo trend | External battery voltage rises without thermal issue | DMM log |
| HW-V-005 | Regulated power reaches Thingy | Measure Thingy TP12/VBUS after S7V8F5 output | 4.75-5.25V | DMM reading |
| HW-V-006 | Firmware sees VBUS present | Run firmware on regulated USB-C input | `VBUS: present` in RTT log | RTT capture |
| HW-V-007 | Internal battery telemetry is valid | Compare firmware `battery_v` to TP4 DMM reading | Difference within acceptable DMM/sensor tolerance | DMM + log |
| HW-V-008 | Sensor static response is sane | Orient Thingy on each axis | Gravity axis reads approximately +/-1g after conversion | CSV/log |
| HW-V-009 | Reference-sensor comparison supports feasibility | Align prototype and LORD S-200 data | Report magnitude/FFT correlation metrics | Analysis exports |
| HW-V-010 | Mount is rigid enough for measurement | Tap/impact test after mounting | Clean impulse response; no visible rattle | Plot/photo |

---

## 12. Open Hardware Risks

| Risk | Impact | Mitigation / next action |
|------|--------|--------------------------|
| External 10Ah buffer not directly telemetered | Cannot remotely estimate true external reserve | Add external voltage divider/ADC or BQ24074 status telemetry in future revision. |
| BQ24074/S7V8F5 thermal behavior unverified outdoors | Power instability or enclosure heating | Bench thermal test under sun and max LTE duty cycle. |
| Existing voltage-trace diagram needs DMM confirmation | Diagram values can be mistaken for measured facts | Mark all diagram voltages as vendor/datasheet or measured before final report. |
| USB-C cable modification error | Wrong polarity or exposed data leads | Use continuity check, heat shrink, and pre-plug DMM verification. |
| Weather ingress around cable glands | Corrosion or shorts | IP67 glands, strain relief, conformal coat on solder joints. |
| Mechanical coupling through enclosure may attenuate vibration | Reduced acceleration fidelity | Tap/impact test and bracket redesign if needed. |
| Current firmware is not duty-cycled | Battery runtime much shorter than final power model | Implement PSM/duty-cycle firmware before long field deployment. |

---

## 13. Final Report Integration

Use this spec in the final report as follows:

1. Main report Section 3.1 Hardware:
   - Include one clean power architecture diagram, not the detailed voltage
     trace: `public/diagrams/final-hardware-architecture.svg` exported from
     `public/diagrams/final-hardware-architecture.drawio`.
   - Include the voltage node table from Section 5.1.
   - Include one sentence explaining the telemetry boundary.

2. Main report Section 4 Test Results and Success Criteria:
   - Cite HW-V-001 through HW-V-006 as required power-front-end verification.
   - Separate "final duty-cycled architecture feasibility" from "current
     continuous-post firmware behavior."

3. Appendix:
   - Include this full hardware spec or reference it as the reproducibility
     hardware appendix.
   - Include BOM, wire map, and verification matrix.

Recommended caption for the main hardware figure:

> Solar power architecture and voltage regulation path. The BQ24074 provides
> charging and load sharing for the external LiPo buffer; its LOAD/OUT rail is
> approximately 3.0-4.4V and is not a USB 5V supply. The S7V8F5 regulator is
> therefore used to present a verified 5.0V input to the Thingy:91 X USB-C port
> across sun, dusk, and battery-only conditions.

---

## 14. Revision History

| Revision | Date | Change |
|----------|------|--------|
| v0.1 | 2026-05-08 | Initial research-grade hardware spec. Added BQ24074 + S7V8F5 power architecture, external 10Ah buffer, telemetry boundary, and verification matrix. |

---

## 15. Related Repo Files

| File | Purpose |
|------|---------|
| `public/diagrams/final-hardware-architecture.drawio` | Editable source for the clean final-report hardware architecture figure. |
| `public/diagrams/final-hardware-architecture.svg` | Exported clean final-report hardware architecture figure. |
| `public/diagrams/thingy91x-voltage-trace.svg` | Detailed voltage trace and wire map source diagram. |
| `ARCHITECTURE.md` | System-level data, power, and cloud architecture. |
| `POWER_BUDGET.md` | Energy storage, autonomy, and solar balance calculations. |
| `BOM.md` | Parts, cost, and alternates. |
| `FIELD_GUIDE.md` | Assembly, test pads, deployment, and troubleshooting. |
| `TEST_PLAN.md` | Verification plan tied to requirements. |
| `FIRMWARE.md` | Firmware modules and telemetry interpretation. |
