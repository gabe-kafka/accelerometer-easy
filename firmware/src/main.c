#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/i2c.h>

#include <modem/nrf_modem_lib.h>
#include <modem/lte_lc.h>
#include <modem/modem_info.h>
#include <nrf_modem_at.h>

#include <zephyr/dfu/mcuboot.h>

#include "power.h"
#include "transport.h"

/* ADXL367 register addresses */
#define ADXL367_STATUS         0x0Bu
#define ADXL367_FIFO_ENTRIES_L 0x0Cu
#define ADXL367_FIFO_ENTRIES_H 0x0Du
#define ADXL367_X_DATA_H       0x0Eu
#define ADXL367_DATA_RDY       BIT(0)
#define ADXL367_FIFO_CONTROL   0x28u
#define ADXL367_FILTER_CTL     0x2Cu
#define ADXL367_POWER_CTL      0x2Du

/* FIFO + ODR config */
#define FIFO_MODE_STREAM       0x02u
#define FILTER_25HZ_2G         0x01u  /* ±2g, 25 Hz ODR */
#define POWER_MEAS             0x02u

/* Batch sizing */
#define BATCH_SAMPLES          100
#define FIFO_MAX_SETS          170   /* 512 FIFO entries / 3 axes */
#define FIFO_RAW_BUF_SIZE      (FIFO_MAX_SETS * 6)
#define FIFO_DRAIN_MS          2000

/* Default POST interval */
#define DEFAULT_SAMPLE_INTERVAL_MS 10000U

/* I2C bus + address from device tree (ADXL367 @ 0x1d on I2C2) */
static const struct i2c_dt_spec accel_i2c = I2C_DT_SPEC_GET(DT_NODELABEL(accel));

/*
 * Read raw 14-bit accelerometer counts directly via I2C.
 * Bypasses the Zephyr ADXL367 sensor driver (which has a 10x scale
 * error in NCS v2.9) to get the rawest possible data.
 *
 * Output: signed 14-bit values in [-8192, +8191].
 * At ±2g range, 1 LSB ≈ 250 µg (per ADXL367 datasheet).
 */
static int read_accel_raw(int16_t *x, int16_t *y, int16_t *z)
{
	uint8_t status;
	uint8_t buf[6];
	int ret;

	/* Poll STATUS register until DATA_RDY */
	do {
		ret = i2c_reg_read_byte_dt(&accel_i2c, ADXL367_STATUS, &status);
		if (ret) {
			return ret;
		}
	} while (!(status & ADXL367_DATA_RDY));

	/* Burst read 6 bytes: X_H, X_L, Y_H, Y_L, Z_H, Z_L */
	ret = i2c_burst_read_dt(&accel_i2c, ADXL367_X_DATA_H, buf, 6);
	if (ret) {
		return ret;
	}

	/* Parse 14-bit signed values (high byte << 6 | low byte >> 2) */
	*x = ((int16_t)buf[0] << 6) | (buf[1] >> 2);
	if (*x & BIT(13)) {
		*x |= 0xC000; /* sign-extend bits 14-15 */
	}

	*y = ((int16_t)buf[2] << 6) | (buf[3] >> 2);
	if (*y & BIT(13)) {
		*y |= 0xC000;
	}

	*z = ((int16_t)buf[4] << 6) | (buf[5] >> 2);
	if (*z & BIT(13)) {
		*z |= 0xC000;
	}

	return 0;
}

/* FIFO buffers */
static struct accel_sample batch[BATCH_SAMPLES];
static int batch_pos;
static uint8_t fifo_raw[FIFO_RAW_BUF_SIZE];

static int adxl367_fifo_init(void)
{
	int ret;

	ret = i2c_reg_write_byte_dt(&accel_i2c, ADXL367_POWER_CTL, 0x00);
	if (ret) { printk("ADXL367: standby failed: %d\n", ret); return ret; }
	k_msleep(10);

	ret = i2c_reg_write_byte_dt(&accel_i2c, ADXL367_FILTER_CTL, FILTER_25HZ_2G);
	if (ret) { printk("ADXL367: ODR failed: %d\n", ret); return ret; }

	ret = i2c_reg_write_byte_dt(&accel_i2c, ADXL367_FIFO_CONTROL, FIFO_MODE_STREAM);
	if (ret) { printk("ADXL367: FIFO failed: %d\n", ret); return ret; }

	ret = i2c_reg_write_byte_dt(&accel_i2c, ADXL367_POWER_CTL, POWER_MEAS);
	if (ret) { printk("ADXL367: meas failed: %d\n", ret); return ret; }

	printk("ADXL367: FIFO stream, 25 Hz, +/-2g\n");
	return 0;
}

static int adxl367_drain_fifo(struct accel_sample *buf, int max_samples)
{
	uint8_t eh, el;
	int ret;

	ret = i2c_reg_read_byte_dt(&accel_i2c, ADXL367_FIFO_ENTRIES_H, &eh);
	if (ret) return ret;
	ret = i2c_reg_read_byte_dt(&accel_i2c, ADXL367_FIFO_ENTRIES_L, &el);
	if (ret) return ret;

	uint16_t entries = ((uint16_t)(eh & 0x03) << 8) | el;
	int complete = entries / 3;
	if (complete == 0) return 0;
	if (complete > max_samples) complete = max_samples;
	if (complete > FIFO_MAX_SETS) complete = FIFO_MAX_SETS;

	ret = i2c_burst_read_dt(&accel_i2c, ADXL367_X_DATA_H,
				fifo_raw, complete * 6);
	if (ret) return ret;

	for (int i = 0; i < complete; i++) {
		int b = i * 6;
		int16_t x = (int16_t)(((fifo_raw[b+0] & 0x3F) << 8) | fifo_raw[b+1]);
		if (x & 0x2000) x |= 0xC000;
		int16_t y = (int16_t)(((fifo_raw[b+2] & 0x3F) << 8) | fifo_raw[b+3]);
		if (y & 0x2000) y |= 0xC000;
		int16_t z = (int16_t)(((fifo_raw[b+4] & 0x3F) << 8) | fifo_raw[b+5]);
		if (z & 0x2000) z |= 0xC000;
		buf[i].x = x; buf[i].y = y; buf[i].z = z;
	}
	return complete;
}

/*
 * Read IMEI from modem via AT+CGSN and store as a NUL-terminated
 * string of up to 15 decimal digits.  Falls back to "unknown" on error.
 */
static void read_imei(char *buf, size_t buf_len)
{
	char at_buf[32] = {0};
	int j = 0;

	if (nrf_modem_at_cmd(at_buf, sizeof(at_buf), "AT+CGSN") == 0) {
		for (int i = 0; at_buf[i] && j < 15 && j < (int)buf_len - 1; i++) {
			if (at_buf[i] >= '0' && at_buf[i] <= '9') {
				buf[j++] = at_buf[i];
			}
		}
	}

	if (j == 0) {
		strncpy(buf, "unknown", buf_len - 1);
		buf[buf_len - 1] = '\0';
	} else {
		buf[j] = '\0';
	}
}

static int modem_connect(void)
{
	int err;
	char buf[128];

	printk("\n--- Modem bringup ---\n");

	printk("Initializing modem...\n");
	err = nrf_modem_lib_init();
	if (err) {
		printk("nrf_modem_lib_init failed: %d\n", err);
		return err;
	}
	printk("Modem initialized.\n");

	/* Provision TLS cert before LTE connect */
	err = transport_init();
	if (err) {
		printk("WARNING: transport_init failed: %d (POST will fail)\n", err);
	}

	/* Read SIM ICCID */
	err = nrf_modem_at_cmd(buf, sizeof(buf), "AT+CCID");
	if (err) {
		printk("AT+CCID failed: %d\n", err);
	} else {
		printk("SIM ICCID: %s", buf);
	}

	/* Read IMSI */
	err = nrf_modem_at_cmd(buf, sizeof(buf), "AT+CIMI");
	if (err) {
		printk("AT+CIMI failed: %d\n", err);
	} else {
		printk("IMSI: %s", buf);
	}

	printk("Connecting to LTE network (this may take 10-60 seconds)...\n");
	err = lte_lc_connect();
	if (err) {
		printk("lte_lc_connect failed: %d\n", err);
		return err;
	}
	printk("Connected to LTE!\n");

	/* Print signal strength */
	err = modem_info_init();
	if (err) {
		printk("modem_info_init failed: %d\n", err);
	} else {
		int rsrp_raw;

		err = modem_info_get_rsrp(&rsrp_raw);
		if (err) {
			printk("modem_info_get_rsrp failed: %d\n", err);
		} else {
			printk("RSRP: %d dBm\n", RSRP_IDX_TO_DBM(rsrp_raw));
		}
	}

	return 0;
}

/*
 * Force the modem offline then reconnect.  Called when a transport
 * operation fails, indicating the LTE link has dropped.
 *
 * lte_lc_offline() drives the modem to AT+CFUN=4, which tears down
 * any open sockets and deregisters from the network — ensuring
 * lte_lc_connect() performs a full re-registration rather than
 * returning immediately because the modem still thinks it's attached.
 *
 * Returns 0 on success, negative errno if reconnect fails.
 */
static int modem_reconnect(void)
{
	int err;

	printk("LTE link lost — reconnecting...\n");

	err = lte_lc_offline();
	if (err) {
		printk("lte_lc_offline failed: %d (continuing)\n", err);
	}

	k_msleep(1000);

	err = lte_lc_connect();
	if (err) {
		printk("lte_lc_connect failed: %d\n", err);
		return err;
	}

	printk("LTE reconnected.\n");

	/* Allow date_time to re-sync from network time */
	k_msleep(3000);

	return 0;
}

int main(void)
{
	printk("\n=== Thingy:91 X — Raw Accel + LTE + Supabase ===\n\n");

	/* Confirm MCUboot image so bootloader doesn't revert */
	boot_write_img_confirmed();

	/* --- Step 1: Accelerometer I2C bus --- */
	if (!i2c_is_ready_dt(&accel_i2c)) {
		printk("ERROR: ADXL367 I2C bus not ready!\n");
		return 0;
	}
	printk("ADXL367 I2C bus ready (addr 0x%02x).\n", accel_i2c.addr);

	/* --- Step 1b: Battery --- */
	if (power_init() != 0) {
		printk("WARNING: nPM1300 charger not ready\n");
	} else {
		int32_t bat_mv;
		uint8_t bat_pct;

		if (power_read_battery(&bat_mv, &bat_pct) == 0) {
			printk("Battery: %d.%03d V  (%u %%)\n",
			       bat_mv / 1000, bat_mv % 1000, bat_pct);
		} else {
			printk("WARNING: battery read failed\n");
		}
	}

	/* Show a few raw readings at startup */
	for (int i = 0; i < 5; i++) {
		int16_t x, y, z;

		if (read_accel_raw(&x, &y, &z) == 0) {
			printk("Accel raw: x=%d  y=%d  z=%d  (counts)\n", x, y, z);
		} else {
			printk("Accel raw read failed\n");
		}
		k_msleep(100);
	}

	/* --- Step 2: LTE-M modem + TLS cert --- */
	modem_connect();

	/* Read IMEI now that modem is initialized */
	char node_id[20] = {0};

	read_imei(node_id, sizeof(node_id));
	printk("Node ID (IMEI): %s\n", node_id);

	/* Wait for date_time to sync from modem after LTE attach */
	printk("Waiting for time sync...\n");
	k_msleep(3000);

	/* Fetch initial remote config (sample interval) */
	uint32_t sample_interval_ms = DEFAULT_SAMPLE_INTERVAL_MS;

	transport_fetch_config(node_id, &sample_interval_ms);
	printk("Sample interval: %u ms\n", sample_interval_ms);

	/* --- Enable ADXL367 FIFO at 25 Hz --- */
	if (adxl367_fifo_init() != 0) {
		printk("ERROR: ADXL367 FIFO init failed!\n");
		return 0;
	}

	/* --- FIFO batch loop --- */
	printk("\n--- FIFO 25 Hz -> batch of %d -> Supabase ---\n",
	       BATCH_SAMPLES);
	batch_pos = 0;

	while (1) {
		int n = adxl367_drain_fifo(batch + batch_pos,
					   BATCH_SAMPLES - batch_pos);
		if (n > 0) {
			batch_pos += n;
			printk("FIFO: +%d (%d/%d)\n",
			       n, batch_pos, BATCH_SAMPLES);
		}

		if (batch_pos >= BATCH_SAMPLES) {
			int32_t bat_mv = 0;
			uint8_t bat_pct = 0;
			int ret;

			power_read_battery(&bat_mv, &bat_pct);
			printk("Posting %d samples (bat %d.%03dV)...\n",
			       batch_pos, bat_mv / 1000, bat_mv % 1000);

			ret = transport_send_batch(node_id, batch,
						   batch_pos, bat_mv);
			if (ret) {
				printk("POST failed (%d) — reconnecting\n",
				       ret);
				if (modem_reconnect() == 0) {
					transport_send_batch(node_id, batch,
							     batch_pos,
							     bat_mv);
				}
			}

			batch_pos = 0;

			/* Drain samples that arrived during POST */
			n = adxl367_drain_fifo(batch, BATCH_SAMPLES);
			if (n > 0) {
				batch_pos = n;
				printk("Post-TX drain: +%d\n", n);
			}

			transport_fetch_config(node_id, &sample_interval_ms);
		}

		k_msleep(FIFO_DRAIN_MS);
	}

	return 0;
}
