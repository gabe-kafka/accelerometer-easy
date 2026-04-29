#ifndef POWER_H
#define POWER_H

#include <stdbool.h>
#include <stdint.h>

/**
 * Initialize the power module (nPM1300 charger device).
 * Returns 0 on success, negative errno on failure.
 */
int power_init(void);

/**
 * Read battery voltage and compute percentage.
 * @param voltage_mv  Output: battery voltage in millivolts
 * @param pct         Output: battery percentage 0-100
 * Returns 0 on success, negative errno on failure.
 */
int power_read_battery(int32_t *voltage_mv, uint8_t *pct);

/**
 * Read instantaneous battery current.
 * Positive = charging (into battery), negative = discharging (out of battery).
 * @param ibat_ma  Output: battery current in mA
 * Returns 0 on success, negative errno on failure.
 */
int power_read_current(int32_t *ibat_ma);

/**
 * Read USB VBUS input status from the nPM1300.
 * @param present  Output: true if a valid VBUS supply is detected.
 * Returns 0 on success, negative errno on failure.
 */
int power_read_vbus(bool *present);

/**
 * Read nPM1300 charger status register (BCHGCHARGESTATUS) as a raw byte.
 * Bit layout: 0=BATTDETECTED 1=COMPLETED 2=TRICKLE 3=CC 4=CV 5=RECHARGE
 * 6=THERMAL_LIMIT 7=SUPPLEMENT. Decode intentionally lives off-device.
 * @param chg_state  Output: raw BCHGCHARGESTATUS byte
 * Returns 0 on success, negative errno on failure.
 */
int power_read_chg_state(uint8_t *chg_state);

/**
 * Enable or disable the nPM1300 charger at runtime via direct I2C write
 * to BCHGENABLESET (offset 0x04) or BCHGENABLECLR (offset 0x05).
 * Bypasses the NCS charger_charge_enable() API which secure-faults on 2.9.
 */
int power_set_charging(bool enable);

/**
 * Initialize the charge-policy state machine at boot based on current VBAT.
 * USB present and below 4.0 V: force charger on for recovery/debug.
 * Below 3.5 V: enter SAFETY (continuous charge until 3.8 V).
 * 3.5–3.9 V: enter CHARGING (20-min window).
 * ≥ 3.9 V: IDLE, charger disabled.
 */
int power_charge_policy_init(void);

/**
 * Evaluate the charge policy once.
 * Transitions: USB+VBAT<4.0V→FORCED ON, IDLE→CHARGING when VBAT<3.9V
 * confirmed on 3 consecutive ticks, CHARGING→IDLE when 20-min window expires,
 * SAFETY→CHARGING at 3.8 V, any→SAFETY when VBAT<3.5 V.
 */
void power_charge_policy_tick(void);

#endif /* POWER_H */
