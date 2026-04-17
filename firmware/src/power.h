#ifndef POWER_H
#define POWER_H

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

#endif /* POWER_H */
