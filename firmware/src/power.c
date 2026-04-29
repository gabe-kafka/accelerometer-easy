#include "power.h"

#include <stdbool.h>
#include <zephyr/device.h>
#include <zephyr/drivers/i2c.h>
#include <zephyr/drivers/sensor.h>
#include <zephyr/drivers/sensor/npm1300_charger.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/printk.h>

/* Charge policy: keep cell in a longevity-friendly 3.9–4.0 V band.
 * Trigger charging when VBAT falls below START, commit to DURATION, stop.
 * Safety-override continuous-charge when cell is dangerously low. */
#define CHARGE_START_MV    3900
#define CHARGE_FORCE_MV    4000
#define CHARGE_SAFETY_MV   3500
#define CHARGE_RESUME_MV   3800
#define CHARGE_DURATION_MS (20 * 60 * 1000)
#define LOW_VBAT_CONFIRM   3

static bool policy_active;
static bool safety_override;
static int64_t policy_start_ts;
static int low_vbat_streak;

/* nPM1300 charger node on the Thingy:91 X */
static const struct device *charger = DEVICE_DT_GET(DT_NODELABEL(npm1300_charger));

/* nPM1300 MFD parent at I²C addr 0x6b — for direct register reads not
 * exposed by the charger sensor driver (VBUS status, etc.). */
static const struct i2c_dt_spec pmic_i2c =
	I2C_DT_SPEC_GET(DT_NODELABEL(pmic_main));

struct soc_point {
	int32_t mv;
	uint8_t pct;
};

/* Field-facing usable battery estimate. The modem becomes unreliable around
 * 3.7 V on this hardware, so treat that as 0% usable capacity. */
static const struct soc_point soc_curve[] = {
	{4200, 100},
	{4100, 90},
	{4000, 80},
	{3920, 70},
	{3850, 60},
	{3790, 50},
	{3750, 40},
	{3710, 30},
	{3700, 0},
};

static uint8_t battery_pct_from_mv(int32_t mv)
{
	for (size_t i = 0; i < ARRAY_SIZE(soc_curve) - 1; i++) {
		const struct soc_point *hi = &soc_curve[i];
		const struct soc_point *lo = &soc_curve[i + 1];

		if (mv >= hi->mv) {
			return hi->pct;
		}

		if (mv >= lo->mv) {
			return lo->pct +
			       (uint8_t)(((mv - lo->mv) * (hi->pct - lo->pct)) /
					 (hi->mv - lo->mv));
		}
	}

	return 0;
}

int power_init(void)
{
	if (!device_is_ready(charger)) {
		return -ENODEV;
	}
	return 0;
}

int power_read_battery(int32_t *voltage_mv, uint8_t *pct)
{
	struct sensor_value val;
	int ret;

	ret = sensor_sample_fetch(charger);
	if (ret < 0) {
		return ret;
	}

	ret = sensor_channel_get(charger, SENSOR_CHAN_GAUGE_VOLTAGE, &val);
	if (ret < 0) {
		return ret;
	}

	/* Convert sensor_value (volts) to millivolts */
	int32_t mv = val.val1 * 1000 + val.val2 / 1000;
	*voltage_mv = mv;

	*pct = battery_pct_from_mv(mv);

	return 0;
}

int power_read_vbus(bool *present)
{
	/* nPM1300 VBUS_STATUS register: block 0x02, offset 0x07.
	 * Bit 0 = VBUSINPRESENT (valid VBUS supply detected). */
	uint8_t reg_addr[2] = { 0x02, 0x07 };
	uint8_t stat;
	int ret;

	if (!device_is_ready(pmic_i2c.bus)) {
		return -ENODEV;
	}

	ret = i2c_write_read_dt(&pmic_i2c, reg_addr, sizeof(reg_addr), &stat, 1);
	if (ret < 0) {
		return ret;
	}

	*present = (stat & 0x01) != 0;
	return 0;
}

int power_set_charging(bool enable)
{
	uint8_t buf[3] = {
		0x03,                              /* CHGR_BASE block */
		(uint8_t)(enable ? 0x04 : 0x05),  /* BCHGENABLESET / BCHGENABLECLR */
		0x01,
	};
	int ret;

	if (!device_is_ready(pmic_i2c.bus)) {
		return -ENODEV;
	}

	if (enable) {
		uint8_t err_clr[3] = {
			0x03,  /* CHGR_BASE block */
			0x00,  /* BCHGERRREASONCLR */
			0x01,
		};

		ret = i2c_write_dt(&pmic_i2c, err_clr, sizeof(err_clr));
		if (ret < 0) {
			return ret;
		}
	}

	return i2c_write_dt(&pmic_i2c, buf, sizeof(buf));
}

int power_charge_policy_init(void)
{
	int32_t mv;
	uint8_t pct;
	bool vbus_present = false;
	int ret;

	ret = power_read_battery(&mv, &pct);
	if (ret < 0) {
		return ret;
	}

	power_read_vbus(&vbus_present);

	if (vbus_present && mv < CHARGE_FORCE_MV) {
		policy_active = true;
		safety_override = false;
		policy_start_ts = k_uptime_get();
		power_set_charging(true);
		printk("Charge policy: USB present, bat=%dmV<4000, charger FORCED ON\n",
		       mv);
		return 0;
	}

	if (mv < CHARGE_SAFETY_MV) {
		safety_override = true;
		policy_active = true;
		policy_start_ts = k_uptime_get();
		power_set_charging(true);
		printk("Charge policy: SAFETY (bat=%dmV), charger ON\n", mv);
	} else if (mv < CHARGE_START_MV) {
		policy_active = true;
		policy_start_ts = k_uptime_get();
		power_set_charging(true);
		printk("Charge policy: bat=%dmV<3900, 20-min window\n", mv);
	} else {
		policy_active = false;
		power_set_charging(false);
		printk("Charge policy: bat=%dmV>=3900, charger OFF\n", mv);
	}
	return 0;
}

void power_charge_policy_tick(void)
{
	int32_t mv;
	uint8_t pct;
	bool vbus_present = false;

	if (power_read_battery(&mv, &pct) < 0) {
		return;
	}

	power_read_vbus(&vbus_present);

	if (vbus_present && mv < CHARGE_FORCE_MV) {
		policy_active = true;
		safety_override = false;
		policy_start_ts = k_uptime_get();
		power_set_charging(true);
		printk("Charge policy: USB present, bat=%dmV<4000, charger forced ON\n",
		       mv);
		return;
	}

	if (safety_override) {
		if (mv >= CHARGE_RESUME_MV) {
			safety_override = false;
			policy_active = true;
			policy_start_ts = k_uptime_get();
			printk("Charge policy: SAFETY cleared, 20-min window\n");
		}
		return;
	}

	if (policy_active) {
		if (k_uptime_get() - policy_start_ts >= CHARGE_DURATION_MS) {
			policy_active = false;
			power_set_charging(false);
			low_vbat_streak = 0;
			printk("Charge policy: 20-min window expired (bat=%dmV)\n", mv);
		}
		return;
	}

	if (mv < CHARGE_SAFETY_MV) {
		safety_override = true;
		policy_active = true;
		policy_start_ts = k_uptime_get();
		power_set_charging(true);
		printk("Charge policy: SAFETY triggered (bat=%dmV)\n", mv);
		return;
	}

	if (mv < CHARGE_START_MV) {
		if (++low_vbat_streak >= LOW_VBAT_CONFIRM) {
			policy_active = true;
			policy_start_ts = k_uptime_get();
			power_set_charging(true);
			low_vbat_streak = 0;
			printk("Charge policy: bat=%dmV<3900 (x%d), 20-min window\n",
			       mv, LOW_VBAT_CONFIRM);
		}
	} else {
		low_vbat_streak = 0;
	}
}

int power_read_chg_state(uint8_t *chg_state)
{
	struct sensor_value val;
	int ret;

	ret = sensor_sample_fetch(charger);
	if (ret < 0) {
		return ret;
	}

	ret = sensor_channel_get(charger, SENSOR_CHAN_NPM1300_CHARGER_STATUS, &val);
	if (ret < 0) {
		return ret;
	}

	*chg_state = (uint8_t)(val.val1 & 0xFF);
	return 0;
}

int power_read_current(int32_t *ibat_ma)
{
	struct sensor_value val;
	int ret;

	ret = sensor_sample_fetch(charger);
	if (ret < 0) {
		return ret;
	}

	ret = sensor_channel_get(charger, SENSOR_CHAN_GAUGE_AVG_CURRENT, &val);
	if (ret < 0) {
		return ret;
	}

	/*
	 * Handle both Zephyr sensor_value sign conventions for negatives,
	 * then negate: Nordic's nPM1300 driver returns + for discharging,
	 * - for charging. We expose the intuitive convention (+ = charging).
	 */
	int64_t ua = (int64_t)val.val1 * 1000000 + val.val2;
	*ibat_ma = -(int32_t)(ua / 1000);

	return 0;
}
