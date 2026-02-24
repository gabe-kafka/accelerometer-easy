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
 * @param node_id    NUL-terminated node identifier (IMEI or "unknown")
 * @param x_raw      Raw 14-bit X acceleration count [-8192, +8191]
 * @param y_raw      Raw 14-bit Y acceleration count [-8192, +8191]
 * @param z_raw      Raw 14-bit Z acceleration count [-8192, +8191]
 * @param battery_mv Battery voltage in millivolts (0 if unavailable)
 * Returns 0 on success, negative errno on failure.
 */
int transport_send_reading(const char *node_id,
			   int16_t x_raw, int16_t y_raw, int16_t z_raw,
			   int battery_mv);

/**
 * Fetch remote configuration for this node from Supabase node_config table.
 * If a row exists for node_id, updates *sample_interval_ms with the cloud value.
 * If no row is found, *sample_interval_ms is left unchanged (caller's default).
 *
 * @param node_id             NUL-terminated node identifier (IMEI)
 * @param sample_interval_ms  In/out: updated from cloud if a config row is found
 * Returns 0 on success (including "no row found"), negative errno on network error.
 */
int transport_fetch_config(const char *node_id, uint32_t *sample_interval_ms);

#endif /* TRANSPORT_H */
