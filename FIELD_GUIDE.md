# FIELD_GUIDE — PR-SHM Sensor Node

> Installation, provisioning, maintenance, and troubleshooting.
> Parent: TEST_PLAN.md · Author: G. Kafka-Gibbons · DRAFT v0.2 · 2026-02-22

---

## Kit Checklist (Per Node)

```
□ Thingy:91 X with firmware flashed (ADXL367 onboard — no wiring needed)
□ Solar panel (2W) with lead wire
□ Mounting hardware (Phase 1: hose clamps / Phase 2: L-bracket + bolts)
□ Cable ties (UV-rated)
□ SIM card installed and activated (if not using iBasis eSIM)
□ Multimeter
□ Phone with nRF Connect app (BLE debug, optional)
□ Laptop + USB cable (emergency reflash)
□ Hex key set (M6 for Phase 2 brackets)
□ Marker / label tape for node ID
```

---

## 1. Pre-Deployment Setup (Desk)

### 1.1 Provision SIM

```
1. Insert SIM into Thingy:91 SIM slot (bottom of board, push-push)
2. Power on via USB
3. Check RTT log for: "LTE attached, RSSI: -XX dBm"
4. If no attach after 60 sec → verify SIM activation with carrier
```

### 1.2 Flash Firmware

```
1. Connect Thingy:91 X via USB
2. Set the slide switch to nRF91 position (away from nRF53 label).
   - nRF91 position: USB serial → nRF9151 (LTE chip) — you see firmware logs
   - nRF53 position: USB serial → nRF5340 (BLE bridge) — logs go nowhere
   - Flashing via nrfutil works in EITHER position (routes through nRF5340 bridge).
     The switch only affects which chip the serial terminal talks to.
3. Flash:
   nrfutil device program --firmware ~/ncs/build/dfu_application.zip
4. Monitor serial:
   screen /dev/tty.usbmodem102 115200
5. Verify output:
   - "ADXL367 accelerometer ready."
   - "Battery: X.XXX V (XX %)"
   - "Node ID (IMEI): XXXXXXXXXXXXXXX"
   - "Connected to LTE!"
   - "HTTP 201" (data reaching Supabase)
6. Check Supabase dashboard for new rows in accel_readings
```

### 1.3 Set Node ID

Node ID auto-derives from IMEI (SRS-903). Label the physical unit with the last 6 digits of IMEI for field identification. Write on label tape, stick to enclosure.

### 1.4 Verify Solar Charging

```
1. Connect solar panel to charge input
2. Place panel under desk lamp or sunlight
3. Check battery voltage trending up in RTT log
4. Confirm no thermal issues (PMIC should stay < 40°C)
```

---

## 2. Installation — Phase 1 (CityLab)

### 2.1 Site Selection

Pick a structural member where you expect measurable ambient vibration. Prefer mid-span of a beam or mid-height of a column over a rigid joint.

### 2.2 Mount

```
1. Clean mounting surface (wire brush loose paint/rust)
2. Apply thin layer of epoxy to enclosure base for rigid coupling
3. Secure with 2× hose clamps, tight — no rattle
4. Verify Thingy:91 orientation (ADXL367 axes printed on PCB)
   Record orientation in field notes:
     X = along member axis
     Y = transverse
     Z = vertical (gravity)
5. Route solar panel cable, zip-tie for strain relief
6. Position solar panel: south-facing, ~30° tilt, clear of shadows
7. Secure panel with zip ties or VHB tape
```

### 2.3 Verify

```
1. Tap structure near mount point with knuckle or bolt
2. Check RTT log (or wait for next hourly packet) for impulse response
3. Confirm RSSI > -110 dBm (LTE-M minimum usable)
4. Walk away — node should enter PSM within 60 sec
```

---

## 3. Installation — Phase 2 (PR Towers)

### 3.1 Safety

```
⚠  Tower climbing requires fall protection and PREPA site authorization.
⚠  De-energize or maintain safe clearance per OSHA 1926.1408.
⚠  Never mount sensors on energized conductors or within minimum approach distance.
⚠  Coordinate with PREPA ops for outage window if needed.
```

### 3.2 Mount

```
1. Bolt L-bracket to tower angle member using 2× M6 316 SS bolts
   - Drill not required if angle has existing holes
   - If drilling: 6.5mm bit, deburr, apply cold-galv touch-up paint
2. Bolt IP67 enclosure to L-bracket with included hardware
3. Route solar panel cable through IP67 cable gland, tighten
4. Mount solar panel above node: south-facing, zip-tied to tower member
5. Verify cable gland is fully sealed — pull-test the cable
6. Record GPS coordinates, tower ID, member ID, axis orientation
```

### 3.3 Verify

Same as Phase 1 §2.3. Additionally:

```
1. Confirm cellular signal from tower elevation (may differ from ground)
2. Wait for first heartbeat packet before descending
3. Photograph installation for thesis documentation
```

---

## 4. Monitoring (Ongoing)

### 4.1 Daily Check (< 2 min)

```
1. Open Supabase dashboard or frontend
2. Verify node has reported within last 30 seconds
3. Check battery_v column — all nodes > 3.3V
4. Glance at accel trends — any sudden shifts warrant investigation
```

### 4.2 Weekly Check

```
1. Export last 7 days of data (SQL → CSV)
2. Spot-check one node's spectra in MATLAB/Python
3. Compare peak frequencies to baseline — drift > 2% = flag
4. Check RSSI trend — degradation may indicate antenna issue
```

### 4.3 Pre-Hurricane

```
1. Verify all nodes reporting and batteries > 3.5V
2. Note last known natural frequencies as pre-storm baseline
3. No action needed — nodes are designed to operate through storm
4. Expect data gaps if tower/cell infrastructure damaged
```

### 4.4 Post-Hurricane

```
1. Check dashboard as soon as cellular service restores
2. Compare post-storm frequencies to pre-storm baseline
3. Flag nodes that went offline — may indicate structural failure
4. Coordinate site visit for visual inspection of flagged towers
5. Download any flash-queued packets (may take several TX cycles to drain)
```

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Firmware flashes OK but zero serial output | Slide switch in nRF53 position — USB serial routed to BLE chip, not LTE chip | Move slide switch to nRF91 position, press reset. Flashing still works in either position. |
| No packets for > 2 hr | PSM timer stuck / modem crash | Wait for watchdog reset (30 sec). If persists > 6 hr, power cycle. |
| Packet received but peaks all < 0.1 mg | ADXL367 in standby / SPI fault | Reflash firmware. Check onboard SPI bus via RTT debug. |
| Battery dropping despite solar | Panel disconnected or shaded | Check cable gland, verify panel orientation. |
| RSSI degrading over time | Antenna corrosion / enclosure moisture | Inspect antenna area, check for condensation inside enclosure. |
| Frequency shift > 5% sudden | Structural event OR mount loosened | Check mount first (re-torque clamp/bolts). If mount solid → real structural change. |
| HTTPS POST fails repeatedly | Certificate expired, SIM data exhausted, or Supabase down | Check cert expiry (GlobalSign Root CA exp 2028). Check SIM data balance. Check Supabase status. |
| All peaks at exactly 50 Hz | Electrical noise coupling | Check for ground loop. Verify anti-alias filter. Ensure solar panel cable is routed away from Thingy:91. |
| Watchdog keeps resetting | FFT exceeding timeout | Increase WDT timeout or reduce FFT segment count. |

---

## 6. Battery Swap

```
1. Open Thingy:91 enclosure (4× Phillips screws on stock shell)
2. Disconnect LiPo JST connector
3. Connect fresh 1350 mAh LiPo (same JST-PH 2-pin, check polarity)
4. Reassemble, verify boot via RTT or wait for heartbeat
5. Expected frequency: once per ~3 months if solar panel functional,
   never if solar panel and weather are cooperative
```

---

## 7. Decommission

```
1. Retrieve node from structure
2. Remove mounting hardware (leave no bolts in tower)
3. Power off (hold button 5 sec or disconnect battery)
4. Download any remaining flash-queued data via USB + RTT
5. Export full dataset from Supabase: SQL editor → CSV export
6. Archive raw data, firmware binary, and config for thesis reproducibility
```

---

## Doc Chain (Complete)

```
PRD.md
├── SRS.md
├── ARCHITECTURE.md
├── POWER_BUDGET.md
├── BOM.md
├── FIRMWARE.md
├── TEST_PLAN.md
└── FIELD_GUIDE.md  ← you are here (final document)
```
