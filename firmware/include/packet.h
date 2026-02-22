#ifndef PACKET_H
#define PACKET_H

#include <stdint.h>

typedef struct {
	char     node_id[16];       /* IMEI or HW serial */
	int64_t  timestamp_ms;      /* Unix epoch ms (UTC) */
	float    accel_rms[3];      /* X, Y, Z in mg */
	struct {
		uint8_t axis;       /* 0=X, 1=Y, 2=Z */
		float   freq_hz;
		float   mag_mg;
	} peaks[15];                /* Top 5 per axis x 3 axes */
	float    battery_v;
	uint8_t  battery_pct;       /* 0-100%, linear map 3.0-4.2V */
	float    temp_c;            /* ADXL362 onboard temp sensor */
	int8_t   rssi_dbm;
} feature_packet_t;

#endif /* PACKET_H */
