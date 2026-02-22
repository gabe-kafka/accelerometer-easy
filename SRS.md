# SRS — PR-SHM Sensor Node

> System requirements. Every line testable. Traces to PRD.md.

```
Parent: PRD.md | Author: G. Kafka-Gibbons | Status: DRAFT v0.2 | 2026-02-22
Priority: [M] must | [S] should | [C] could
```

## Requirements

```
# ── SENSING ──
SRS-101 [M] Accelerometer: ADXL367 onboard Thingy:91 X           → SC-2
SRS-102 [M] Noise density ≤ 200 µg/√Hz                           → SC-2
SRS-103 [M] ADC ≥ 14-bit                                         → SC-2
SRS-104 [M] Sample rate 100 Hz/axis (configurable)                → SC-2
SRS-105 [M] Range ±2g default (±4g ±8g available)                 → SC-2
SRS-106 [M] DC response (no AC highpass)                          → SC-2
SRS-107 [S] Anti-alias filter at 50 Hz                            → SC-2
SRS-108 [C] BME280 env sensor (temp/humidity/pressure)            → SC-3

# ── SIGNAL PROCESSING ──
SRS-201 [M] Window: 10 min continuous per acquisition             → SC-2
SRS-202 [M] FFT: 4096-pt per axis, Hanning window                → SC-2
SRS-203 [M] Extract top 5 peak frequencies + magnitudes per axis  → SC-2
SRS-204 [M] Extract broadband RMS per axis                        → SC-3
SRS-205 [S] Extract spectral centroid + bandwidth                 → SC-5
SRS-206 [S] Freq resolution ≤ 0.025 Hz (100/4096)                → SC-2
SRS-207 [M] All processing on-node, no raw transmit               → C-6
SRS-208 [C] Optional raw dump to local SD                         → R-2

# ── COMMS ──
SRS-301 [M] LTE-M primary via nRF9160                            → C-6
SRS-302 [S] NB-IoT fallback                                      → R-2
SRS-303 [M] Feature packet ≤ 2 kB                                → C-6
SRS-304 [M] Transmit 1x/hr after each sample window              → SC-1
SRS-305 [M] HTTPS POST over TLS (Supabase REST API)              → SC-3
SRS-306 [M] Retry + local queue ≤ 24 hr on tx failure            → SC-1
SRS-307 [S] Heartbeat every 6 hr (battery, RSSI, temp)           → SC-1
SRS-308 [C] OTA firmware update                                   → SC-1

# ── POWER ──
SRS-401 [M] Battery: 1350 mAh LiPo (Thingy:91 onboard)          → C-1
SRS-402 [S] Solar: ≥ 2W external panel                           → SC-1
SRS-403 [M] Avg draw ≤ 5 mA @ 3.7V                              → SC-1
SRS-404 [M] Battery-only autonomy ≥ 7 days                       → SC-1
SRS-405 [S] Battery-only autonomy ≥ 14 days                      → SC-1
SRS-406 [M] Sleep current ≤ 50 µA                                → SC-1
SRS-407 [M] Low-battery cutoff at 3.0V                           → SC-4
SRS-408 [S] Battery V in every feature packet                    → SC-3
SRS-409 [C] MPPT charge controller (BQ25570)                     → SC-1

# ── ENVIRONMENTAL ──
SRS-501 [M] Temp range: -10°C to +60°C                           → SC-4
SRS-502 [M] Rain: IP54 minimum (Phase 1)                         → SC-4
SRS-503 [S] IP67 enclosure (Phase 2)                             → SC-6
SRS-504 [S] UV resistant: 6 mo tropical outdoor                  → SC-4
SRS-505 [C] Salt spray: ASTM B117, 48 hr                        → SC-6
SRS-506 [M] Wind load at mount: ≥ Cat 1 (74 mph)                → SC-4
SRS-507 [S] Survive 200+ mg vibration during hurricane           → SC-5

# ── MECHANICAL ──
SRS-601 [M] Thingy:91 rigidly coupled to structure               → SC-2
SRS-602 [M] Mount first resonance ≥ 200 Hz                       → SC-2
SRS-603 [M] Bolted or clamped to tower member                    → SC-4
SRS-604 [S] No drilling into structure required                   → SC-6
SRS-605 [M] Node weight ≤ 250g total                             → C-2
SRS-606 [S] Node dims ≤ 100×80×40 mm (excl. panel)              → C-2

# ── FIRMWARE ──
SRS-701 [M] Zephyr RTOS / nRF Connect SDK                       → C-5
SRS-702 [M] States: BOOT→CONFIGURE→SAMPLE→PROCESS→TX→SLEEP      → SC-3
SRS-703 [M] Watchdog: auto-reset on hang                         → SC-1
SRS-704 [M] RTC timestamps synced via LTE network time           → SC-2
SRS-705 [S] Downlink config: sample rate, window, tx interval    → SC-3
SRS-706 [S] Error log to flash (last 100 events)                 → SC-1
SRS-707 [C] BLE debug interface via nRF52840                     → C-2

# ── CLOUD ──
SRS-801 [M] Ingest: Supabase REST API (PostgREST)               → SC-3
SRS-802 [M] DB: Supabase PostgreSQL                              → SC-3
SRS-803 [M] Dashboard: Custom frontend (accel + battery viz)     → SC-3
SRS-804 [M] Data retention ≥ 6 months                            → SC-1
SRS-805 [S] Anomaly flag: freq shift > 2% from baseline          → SC-5
SRS-806 [S] Feature packet archive (JSON/CSV export)             → SC-3
SRS-807 [C] Multi-node comparison dashboard view                 → SC-3
```

## Packet Schema

```json
{
  "node_id":   "string",
  "ts":        "ISO-8601 UTC",
  "accel_rms": [x, y, z],
  "peaks":     [{"axis":"x","freq":0.0,"mag":0.0}, ...],
  "battery_v": 0.0,
  "temp_c":    0.0,
  "rssi":      0
}
```

```
SRS-901 [M] Schema as above, top 5 peaks per axis               → SC-3
SRS-902 [S] JSON encoding (human-readable, ~80 bytes)            → SRS-303
SRS-903 [M] Node ID from IMEI or HW serial                      → SC-3
```

## Traceability

```
SC-1  → 304 306 307 401-409 703 706 804
SC-2  → 101-107 201-206 601-602 704
SC-3  → 203-204 303-305 408 801-807 901-903
SC-4  → 501-507 603 605-606
SC-5  → 205 507 805
SC-6  → 503-505 604
C-1   → 401        C-2 → 605-606 707
C-4   → (no custom PCB — stock Thingy:91)  C-5 → 701  C-6 → 207 301 303
```

## Verification

```
SRS-1xx  Bench: known signal → validate output
SRS-2xx  Bench: synthetic waveform → FFT vs MATLAB
SRS-3xx  Integration: end-to-end tx to cloud
SRS-4xx  Nordic PPK2 power measurement
SRS-5xx  Outdoor soak test / env chamber
SRS-6xx  Impact hammer tap test (mount resonance)
SRS-7xx  Zephyr test framework unit + integration
SRS-8xx  Cloud: ingest → query → render
SRS-9xx  Schema validation + packet size check
```
