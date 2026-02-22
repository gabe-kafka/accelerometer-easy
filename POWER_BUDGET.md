# POWER_BUDGET — PR-SHM Sensor Node

> Current draw by operating state, duty cycle analysis, and autonomy calculations.
> Parent: ARCHITECTURE.md · Author: G. Kafka-Gibbons · DRAFT v0.2 · 2026-02-22

---

## Battery

| Parameter | Value | Source |
|-----------|-------|--------|
| Chemistry | Li-ion polymer | Thingy:91 onboard |
| Capacity | 1350 mAh (nominal) | Nordic datasheet |
| Usable capacity | 1080 mAh (80%) | Derate for aging + cutoff |
| Nominal voltage | 3.7V | — |
| Full charge | 4.2V | — |
| Cutoff | 3.0V (SRS-407) | nPM1300 PMIC threshold |
| Energy (usable) | 4.0 Wh | 1080 mAh × 3.7V |

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

---

## Autonomy — Battery + Solar

### Solar Input

| Parameter | Value | Source |
|-----------|-------|--------|
| Panel rating | 2W (peak) | Spec |
| Panel voltage | 5.5V open, ~5V operating | Typical |
| PR solar irradiance | 5.5 kWh/m²/day (annual avg) | NREL |
| Panel area | ~80 cm² (100 × 80 mm) | Typical 2W panel |
| Panel efficiency | ~18% | Monocrystalline |
| Daily harvest (ideal) | 2W × 5.5 hr = 11 Wh | Peak sun hours |
| Charge efficiency | ~70% (panel → battery via PMIC) | nPM1300 losses |
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
Battery available:   4.0 Wh
Margin:              8× — node survives easily
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
                                     ├── BOM.md
                                     ├── FIRMWARE.md
                                     ├── TEST_PLAN.md
                                     └── FIELD_GUIDE.md
```
