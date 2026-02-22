# TEST_PLAN — PR-SHM Sensor Node

> Verification of each SRS requirement. Bench → integration → field.
> Parent: SRS.md · Author: G. Kafka-Gibbons · DRAFT v0.2 · 2026-02-22

---

## Test Phases

| Phase | When | Where | Gate |
|-------|------|-------|------|
| T1 — Bench | Wk 1–6 | Desk / NYU lab | All [M] SRS-1xx, 2xx, 4xx pass |
| T2 — Integration | Wk 5–7 | Desk | End-to-end pipeline: sensor → cloud |
| T3 — Field (CityLab) | Wk 7–10 | CityLab structure | 72-hr soak, data quality check |
| T4 — Deploy (PR) | Wk 11+ | PREPA towers | Node survives, data flows |

---

## T1 — Bench Tests

### Sensing

| ID | SRS | Test | Pass criteria |
|----|-----|------|---------------|
| T1-01 | 101 | Init ADXL367 via Zephyr sensor API (I2C) | `device_is_ready()` returns true |
| T1-02 | 102 | Record noise floor on vibration-isolated surface, 60 sec | Spectral noise density ≤ 175 µg/√Hz |
| T1-03 | 103 | Read raw 14-bit values, verify bit depth | All 14 bits active (not truncated) |
| T1-04 | 104 | Verify sample timestamps at 100 Hz | Δt = 10.0 ± 0.1 ms between samples |
| T1-05 | 105 | Tilt 90° on each axis | Reads ±1g (±1000 mg ± 10 mg) |
| T1-06 | 106 | Static hold → check DC offset stability | DC drift < 2 mg over 10 min |

### Signal Processing

| ID | SRS | Test | Pass criteria |
|----|-----|------|---------------|
| T1-10 | 202 | Inject 10 Hz sine (shaker or tap), run FFT | Peak at 10.0 ± 0.1 Hz |
| T1-11 | 202 | Inject known multi-tone (5, 12, 25 Hz) | All 3 peaks detected, magnitudes within 10% |
| T1-12 | 203 | Run peak-picker on synthetic spectrum | Top 5 match expected, no spurious peaks |
| T1-13 | 204 | Compute RMS on known amplitude sine | RMS = A/√2 ± 5% |
| T1-14 | 206 | Verify bin spacing | Bin width = 0.0244 Hz (100/4096) |
| T1-15 | 207 | Confirm no raw data in TX payload | Packet contains only features, ≤ 2 kB |

### Power

| ID | SRS | Test | Tool | Pass criteria |
|----|-----|------|------|---------------|
| T1-20 | 406 | Measure sleep current | PPK2 | ≤ 50 µA |
| T1-21 | 403 | Measure full 1-hr duty cycle avg | PPK2 | ≤ 5 mA |
| T1-22 | 407 | Drain battery to 3.0V | Bench PSU | System shuts down cleanly |
| T1-23 | 401 | Charge from solar panel input | 2W panel | Battery charges, no thermal issues |

---

## T2 — Integration Tests

| ID | SRS | Test | Pass criteria |
|----|-----|------|---------------|
| T2-01 | 301–305 | HTTPS POST to Supabase REST API | HTTP 201, row appears in accel_readings table |
| T2-02 | 306 | Kill network mid-TX, restore | Queued packet delivered on reconnect |
| T2-03 | 307 | Wait 6 hr, check heartbeat | Heartbeat received with battery, RSSI, temp |
| T2-04 | 702 | Full state cycle: BOOT → SLEEP → SAMPLE → PROCESS → TX | All transitions logged, no hang |
| T2-05 | 703 | Force firmware hang (infinite loop) | Watchdog resets within 30 sec |
| T2-06 | 704 | Check timestamp on received packet | Within ±2 sec of NTP reference |
| T2-07 | 801–803 | POST → Supabase → Frontend dashboard | Data visible in dashboard within 60 sec |
| T2-08 | 901 | Validate packet against JSON schema | Schema check passes, size ≤ 2 kB |

---

## T3 — Field Validation (CityLab)

| ID | SRS | Test | Duration | Pass criteria |
|----|-----|------|----------|---------------|
| T3-01 | SC-1 | Continuous operation, no intervention | 72 hr min | No data gaps > 2 hr |
| T3-02 | SC-2 | Extract natural frequencies of test structure | — | Peaks stable across records, match hand calc ±10% |
| T3-03 | SC-3 | Pipeline end-to-end | 72 hr | All 72 hourly packets in DB |
| T3-04 | SC-4 | Survive rain event (natural or hose test) | 1 hr | No data corruption, no reset |
| T3-05 | 601–602 | Tap test at mount point | — | Mount resonance ≥ 200 Hz (verify with impact hammer or FFT of tap) |
| T3-06 | — | Battery trend over 72 hr | 72 hr | Voltage curve matches POWER_BUDGET.md prediction |
| T3-07 | — | RSSI stability | 72 hr | No sustained dropout > 30 min |

---

## T4 — Deployment Acceptance (PR)

| ID | Test | Pass criteria |
|----|------|---------------|
| T4-01 | Node powered on after shipping | Heartbeat received within 1 hr |
| T4-02 | Mount on tower, verify coupling | Tap test shows clean impulse response |
| T4-03 | 24-hr soak after install | 24 consecutive hourly packets, no anomalies |
| T4-04 | Solar charging under PR conditions | Battery trending up during daylight hours |

---

## Equipment Needed

| Item | For tests | Own / buy |
|------|-----------|-----------|
| Nordic PPK2 | T1-20, T1-21 | Buy ($99) or borrow from NYU lab |
| Bench shaker or tuning fork | T1-10, T1-11 | Borrow from lab |
| Multimeter | T1-05, T1-22 | Own |
| Garden hose + nozzle | T3-04 | Available |
| Impact hammer (or heavy bolt) | T3-05 | Improvise — bolt on string works |
| Laptop + J-Link | All T1/T2 | Own |

---

## Doc Chain

```
PRD → SRS → ARCHITECTURE → POWER_BUDGET → BOM → FIRMWARE → TEST_PLAN  ← you are here
                                                             └── FIELD_GUIDE.md
```
