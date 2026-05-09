# POWER_BUDGET — PR-SHM Sensor Node

> Current draw by operating state, duty cycle analysis, and autonomy calculations.
> Parent: ARCHITECTURE.md · Author: G. Kafka-Gibbons · DRAFT v0.2 · 2026-02-22

---

## Energy Storage

The node now has two energy buffers:

1. The stock Thingy:91 X 1350 mAh LiPo, monitored by the onboard nPM1300 PMIC.
2. An external 10Ah LiPo buffer managed by a BQ24074 solar charger/load-share
   board and regulated to the Thingy USB-C input through an S7V8F5 buck-boost.

Firmware telemetry (`battery_v`, `battery_pct`, `ibat`, `vbus`, and charge
state) describes the **Thingy internal battery and USB input**, not the external
10Ah buffer directly.

| Parameter | Thingy internal battery | External buffer battery | Source / note |
|-----------|-------------------------|--------------------------|---------------|
| Chemistry | Li-ion polymer | Li-ion polymer | Thingy onboard / external pack |
| Capacity | 1350 mAh nominal | 10,000 mAh nominal | Nordic datasheet / selected field buffer |
| Usable capacity | 1080 mAh (80%) | 8000 mAh (80%) | Derate for aging + cutoff |
| Nominal voltage | 3.7V | 3.7V | — |
| Full charge | 4.2V | 4.2V | — |
| Cutoff | 3.0V | ~3.0V | nPM1300 / BQ24074 battery range |
| Energy usable | 4.0 Wh | 29.6 Wh | usable Ah × 3.7V |

## External Power Path

```
solar panel → BQ24074 charger/load-share → S7V8F5 buck-boost → USB-C → Thingy:91 X
             ↘ external 10Ah LiPo buffer                         stock 1350 mAh LiPo
```

The BQ24074 LOAD/OUT node is intentionally treated as a non-USB rail. Adafruit
documents it at roughly 3.0-4.4V, which is below USB 5V and may track the LiPo
battery when input power is absent. The S7V8F5 is therefore used to hold the
Thingy USB-C input at 5.0V in all operating conditions.

| Node | Expected voltage | Design implication |
|------|------------------|--------------------|
| Solar panel | ~6.0-7.0V in sun | Feeds BQ24074 VBUS input. |
| BQ24074 LOAD/OUT | ~3.0-4.4V | Load rail for a 3.3V regulator or 5V converter; do not feed Thingy USB-C directly. |
| S7V8F5 OUT | 5.0V regulated | Safe Thingy USB-C input. |
| Thingy internal battery | ~3.0-4.2V | Local ride-through and telemetry source. |

Voltage trace figure: `public/diagrams/thingy91x-voltage-trace.svg`

---

## Component Current Draw

### nRF9151 SiP

| State | Current | Duration | Source |
|-------|---------|----------|--------|
| PSM sleep (RTC running) | 2.6 µA | Baseline | nRF9151 PS v2.1 §5.1 |
| Active (CPU @ 64 MHz, no radio) | 5.2 mA | Processing | nRF9151 PS §5.2 |
| LTE-M TX (23 dBm) | 230 mA peak | Transmit burst | nRF9151 PS §5.3 |
| LTE-M TX (average, incl. protocol) | 50 mA avg | ~10 sec window | Measured typical |
| LTE-M RX | 6.5 mA | During TX handshake | nRF9151 PS §5.3 |
| GNSS (not used) | — | Disabled | — |

### ADXL367 (Onboard)

| State | Current | Duration | Source |
|-------|---------|----------|--------|
| Measurement mode (100 Hz ODR) | 3.0 µA | Sampling | ADXL367 DS Rev. F §1 |
| Standby | 0.01 µA | Between windows | ADXL367 DS §1 |

### nPM1300 PMIC

| State | Current | Source |
|-------|---------|--------|
| Quiescent (ship mode) | 0.75 µA | nPM1300 DS |
| Active (regulating, no load) | 8 µA | nPM1300 DS |
| Buck regulator overhead | ~15 µA | Estimated at light load |

### nRF52840 (BLE controller)

| State | Current | Notes |
|-------|---------|-------|
| System OFF | 0.4 µA | Default — BLE not used in field |
| Active (if BLE debug enabled) | 4.6 mA | Only during Phase 1 bench debug |

### Misc (LEDs, sensors)

| Component | Current | Notes |
|-----------|---------|-------|
| LEDs | 0 µA | Disabled in field firmware |
| BME680 (onboard) | 0 µA | Not used |
| BME280 (if added, SRS-109) | 3.6 µA | Forced mode, 1 sample/hr |

---

## Operating States

### SLEEP (50 min / hr)

| Component | Current |
|-----------|---------|
| nRF9151 PSM | 2.6 µA |
| nPM1300 quiescent | 15 µA |
| ADXL367 standby | 0.01 µA |
| nRF52840 OFF | 0.4 µA |
| **Total** | **18 µA** |

### SAMPLE (10 min / hr)

| Component | Current |
|-----------|---------|
| nRF9151 active (SPI read loop) | 5.2 mA |
| ADXL367 measurement mode | 3.0 µA |
| nPM1300 active | 15 µA |
| nRF52840 OFF | 0.4 µA |
| **Total** | **5.2 mA** |

SPI reads 6 bytes (3 axes × 12-bit) at 100 Hz. CPU wakes briefly each sample, otherwise idle-waits on DRDY interrupt.

### PROCESS (15 sec / hr)

| Component | Current |
|-----------|---------|
| nRF9151 active (CPU @ 64 MHz, FPU) | 5.2 mA |
| CMSIS-DSP FFT computation | +7 mA (estimated) |
| ADXL367 standby | 0.01 µA |
| nPM1300 active | 15 µA |
| **Total** | **12.2 mA** |

4096-point FFT × 3 axes × ~14 overlapping segments (Welch). Cortex-M33 FPU handles float32 natively. Estimated 15 sec total processing time is conservative.

### TRANSMIT (10 sec / hr)

| Component | Current |
|-----------|---------|
| nRF9151 LTE-M TX (avg) | 50 mA |
| nPM1300 active | 15 µA |
| ADXL367 standby | 0.01 µA |
| **Total** | **50 mA** |

Includes modem wake, RRC connection setup, MQTT publish, ACK, and RRC release. Actual RF burst is ~230 mA peak but duty-cycled within the 10 sec window. 50 mA is the measured average for a typical LTE-M transaction.

---

## Duty Cycle Summary

| State | Duration | Current | Charge | Energy |
|-------|----------|---------|--------|--------|
| Sleep | 50 min | 18 µA | 15.0 µAh | 55.5 µWh |
| Sample | 10 min | 5.2 mA | 866.7 µAh | 3,206.7 µWh |
| Process | 15 sec | 12.2 mA | 50.8 µAh | 188.0 µWh |
| Transmit | 10 sec | 50 mA | 138.9 µAh | 513.9 µWh |
| **Total / hr** | **60 min** | **avg 1.07 mA** | **1,071.4 µAh** | **3,964.1 µWh** |

**Average system current: 1.07 mA**

> Note: Earlier ARCHITECTURE.md estimated 0.45 mA using simplified sleep current.
> This detailed budget is more conservative and accounts for nPM1300 quiescent
> and realistic sampling current.

---

## Autonomy — Battery Only

### Thingy Internal Battery Only

```
Usable capacity:     1,080 mAh
Average current:     1.07 mA
Autonomy:            1,080 / 1.07 = 1,009 hr ≈ 42 days

SRS-404 (≥ 7 days)   ✓  by 6.0×
SRS-405 (≥ 14 days)  ✓  by 3.0×
```

**Worst case** (poor cell signal, retries extend TX to 30 sec):

```
TX current:          50 mA × 30 sec = 416.7 µAh
Revised total/hr:    1,349 µAh → avg 1.35 mA
Worst autonomy:      1,080 / 1.35 = 800 hr ≈ 33 days

SRS-404  ✓  by 4.7×
SRS-405  ✓  by 2.4×
```

### External 10Ah Buffer, Duty-Cycled Firmware

Using the same duty-cycled load model and treating the 10Ah pack as the primary
field energy reservoir:

```
Usable external energy:    8.0 Ah × 3.7V = 29.6 Wh
Daily consumption:         95.0 mWh/day
Ideal autonomy:            29.6 / 0.095 = 311 days
With 80% conversion margin: ~249 days
```

### Current Continuous-Post Firmware

The current raw-stream firmware is not yet duty-cycled. With LTE activity every
10 seconds, the practical average draw is closer to the continuous model in
ARCHITECTURE.md.

```
Approx USB-side load:      ~20 mA at 5V ≈ 100 mW
Daily consumption:         ~2.4 Wh/day
External 10Ah autonomy:    29.6 / 2.4 ≈ 12 days ideal
With 80% conversion margin: ~10 days
Internal-only autonomy:    ~2.3 days
```

This is why the report should separate **solar/battery feasibility of the final
duty-cycled architecture** from **the observed limitation of the current
continuous-post firmware**.

---

## Autonomy — Battery + Solar

### Solar Input

| Parameter | Value | Source |
|-----------|-------|--------|
| Panel rating | 2W (peak) | Spec |
| Panel voltage | ~6.0-7.0V open/full sun | Voltage trace |
| PR solar irradiance | 5.5 kWh/m²/day (annual avg) | NREL |
| Panel area | ~80 cm² (100 × 80 mm) | Typical 2W panel |
| Panel efficiency | ~18% | Monocrystalline |
| Daily harvest (ideal) | 2W × 5.5 hr = 11 Wh | Peak sun hours |
| Charge + regulation efficiency | ~70% | BQ24074 charge path + S7V8F5 conversion + wiring losses |
| **Net daily harvest** | **~7.7 Wh** | After losses |

### Daily Consumption

```
Average power:       1.07 mA × 3.7V = 3.96 mW
Daily consumption:   3.96 mW × 24 hr = 95.0 mWh ≈ 0.1 Wh
```

### Solar Balance

```
Daily harvest:       7,700 mWh
Daily consumption:      95 mWh
Surplus ratio:        81×
```

The system is overwhelmingly solar-positive. Even with 90% cloud cover reducing harvest to 770 mWh/day, the surplus is still 8.1×. The battery serves as a buffer for nighttime and multi-day heavy overcast (hurricane conditions), not as the primary energy source.

**Hurricane scenario** (5 days, zero solar):

```
Energy needed:       0.1 Wh/day × 5 days = 0.5 Wh
External buffer:     29.6 Wh usable
Margin:              59× — node survives easily under duty-cycled firmware
```

---

## Optimization Levers

If power budget is tighter than expected, these are available in order of impact:

| Lever | Savings | Trade-off |
|-------|---------|-----------|
| Reduce sample window from 10 min to 5 min | ~450 µAh/hr (−40%) | Lower frequency resolution, fewer averaged spectra |
| Reduce TX to every 2 hr | ~70 µAh/hr (−6%) | 2× latency on data visibility |
| Disable ADXL367 between windows (power-down) | negligible | Already near-zero standby (0.01 µA) |
| Use eDRX instead of PSM | Varies | Better downlink latency, slightly higher sleep |
| Reduce sample rate from 100 Hz to 50 Hz | ~225 µAh/hr (−20%) | Nyquist drops to 25 Hz, lose higher modes |

---

## Power State Diagram

```
                    ┌──────────────────────────────┐
                    │                              │
      18 µA         │         5.2 mA               │ 12.2 mA    50 mA
   ┌────────┐  RTC  │  ┌────────────────┐  done   │ ┌───────┐  ┌──────┐
   │ SLEEP  │──alarm─►  │    SAMPLE     │────────►  │PROCESS│─►│  TX  │
   │ 50 min │       │  │    10 min     │          │ 15 sec │  │10 sec│
   └────────┘       │  └────────────────┘          └───────┘  └──┬───┘
       ▲            │                                            │
       └────────────┴────────────────────────────────────────────┘
                                  success or queued
```

---

## Measurement Plan

Before field deployment, validate these numbers with a Nordic PPK2:

| Test | Expected | Acceptance |
|------|----------|------------|
| Sleep current (all peripherals off) | 18 µA | ≤ 50 µA (SRS-406) |
| Sample current (ADXL367 + SPI read) | 5.2 mA | ≤ 8 mA |
| FFT processing current | 12.2 mA | ≤ 15 mA |
| LTE-M TX average (single MQTT pub) | 50 mA | ≤ 80 mA |
| Full 1-hr cycle energy | 3.96 mWh | ≤ 6 mWh |

---

## Doc Chain

```
PRD.md → SRS.md → ARCHITECTURE.md → POWER_BUDGET.md  ← you are here
                                     ├── HARDWARE_SPEC.md
                                     ├── BOM.md
                                     ├── FIRMWARE.md
                                     ├── TEST_PLAN.md
                                     └── FIELD_GUIDE.md
```
