#include "power.h"

#include <zephyr/device.h>
#include <zephyr/drivers/sensor.h>

/* nPM1300 charger node on the Thingy:91 X */
static const struct device *charger = DEVICE_DT_GET(DT_NODELABEL(npm1300_charger));

/* LiPo linear voltage-to-percentage mapping */
#define VBAT_FULL_MV  4200  /* 100% */
#define VBAT_EMPTY_MV 3000  /* 0%   */

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

	/* Linear map: 3000 mV = 0%, 4200 mV = 100% */
	if (mv <= VBAT_EMPTY_MV) {
		*pct = 0;
	} else if (mv >= VBAT_FULL_MV) {
		*pct = 100;
	} else {
		*pct = (uint8_t)(((mv - VBAT_EMPTY_MV) * 100) /
				 (VBAT_FULL_MV - VBAT_EMPTY_MV));
	}

	return 0;
}
