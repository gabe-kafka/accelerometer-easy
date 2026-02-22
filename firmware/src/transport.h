#ifndef TRANSPORT_H
#define TRANSPORT_H

/**
 * Provision TLS CA certificate into the modem.
 * Must be called after modem init but before LTE connect.
 * Returns 0 on success, negative errno on failure.
 */
int transport_init(void);

/**
 * POST an accelerometer + battery reading to Supabase.
 * Call after LTE is connected.
 *
 * @param x_mg      X acceleration in milliG
 * @param y_mg      Y acceleration in milliG
 * @param z_mg      Z acceleration in milliG
 * @param battery_mv Battery voltage in millivolts (0 if unavailable)
 * Returns 0 on success, negative errno on failure.
 */
int transport_send_reading(int x_mg, int y_mg, int z_mg, int battery_mv);

#endif /* TRANSPORT_H */
