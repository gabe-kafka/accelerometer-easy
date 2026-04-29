#ifndef TRANSPORT_H
#define TRANSPORT_H

#include <stdint.h>

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
 * @param x_raw      Raw 14-bit X acceleration count [-8192, +8191]
 * @param y_raw      Raw 14-bit Y acceleration count [-8192, +8191]
 * @param z_raw      Raw 14-bit Z acceleration count [-8192, +8191]
 * Returns 0 on success, negative errno on failure.
 */
int transport_send_reading(int16_t x_raw, int16_t y_raw, int16_t z_raw);

/**
 * Fetch global remote configuration from Supabase node_config table.
 * If a row exists, updates *sample_interval_ms with the cloud value.
 * If no row is found, *sample_interval_ms is left unchanged (caller's default).
 *
 * @param sample_interval_ms  In/out: updated from cloud if a config row is found
 * Returns 0 on success (including "no row found"), negative errno on network error.
 */
int transport_fetch_config(uint32_t *sample_interval_ms);

struct accel_sample {
	int16_t x, y, z;
};

int transport_send_batch(const struct accel_sample *samples, int count,
			 uint8_t battery_pct);

#endif /* TRANSPORT_H */
