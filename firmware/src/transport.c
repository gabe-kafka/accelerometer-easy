#include <stdint.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <modem/modem_key_mgmt.h>
#include <net/rest_client.h>
#include <zephyr/net/http/client.h>
#include <date_time.h>

#include "transport.h"

#define TLS_SEC_TAG	42
#define SUPABASE_HOST	"rcaglkgoyemcjaszaahu.supabase.co"
#define SUPABASE_URL	"/rest/v1/accel_batches"
#define SUPABASE_CONFIG_URL "/rest/v1/node_config"
#define SUPABASE_PORT	443

#define SUPABASE_ANON_KEY \
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." \
	"eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjYWdsa2dveWVtY2phc3phYWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTcyNzcsImV4cCI6MjA4NzI5MzI3N30." \
	"m2lz6wQIlv9PfuT7_DU4HZoBcCnK_kzXtJOAI7b6UV4"

/* GlobalSign Root CA — trust anchor for Supabase (via Google Trust Services) */
static const char ca_cert[] = {
	#include "../certs/GlobalSignRootCA.pem"
};

/* Buffers */
static char body_buf[256];
static char batch_buf[16384];
static char resp_buf[2048];

int transport_init(void)
{
	int err;
	bool exists;

	printk("Provisioning TLS certificate (sec_tag %d)...\n", TLS_SEC_TAG);

	err = modem_key_mgmt_exists(TLS_SEC_TAG, MODEM_KEY_MGMT_CRED_TYPE_CA_CHAIN, &exists);
	if (err) {
		printk("modem_key_mgmt_exists failed: %d\n", err);
		return err;
	}

	if (exists) {
		int mismatch = modem_key_mgmt_cmp(TLS_SEC_TAG,
						  MODEM_KEY_MGMT_CRED_TYPE_CA_CHAIN,
						  ca_cert, sizeof(ca_cert));
		if (!mismatch) {
			printk("TLS certificate already provisioned.\n");
			return 0;
		}
		printk("TLS certificate mismatch, updating...\n");
		modem_key_mgmt_delete(TLS_SEC_TAG, MODEM_KEY_MGMT_CRED_TYPE_CA_CHAIN);
	}

	err = modem_key_mgmt_write(TLS_SEC_TAG, MODEM_KEY_MGMT_CRED_TYPE_CA_CHAIN,
				   ca_cert, sizeof(ca_cert));
	if (err) {
		printk("modem_key_mgmt_write failed: %d\n", err);
		return err;
	}

	printk("TLS certificate provisioned.\n");
	return 0;
}

int transport_send_reading(int16_t x_raw, int16_t y_raw, int16_t z_raw)
{
	int err;

	/* Build JSON body — raw 14-bit counts, no conversion */
	int len = snprintf(body_buf, sizeof(body_buf),
		"{\"x\":%d,\"y\":%d,\"z\":%d}",
		x_raw, y_raw, z_raw);

	if (len < 0 || len >= (int)sizeof(body_buf)) {
		printk("JSON body too large\n");
		return -ENOMEM;
	}

	/* REST client request */
	static const char *headers[] = {
		"apikey: " SUPABASE_ANON_KEY "\r\n",
		"Content-Type: application/json\r\n",
		"Prefer: return=minimal\r\n",
		NULL
	};

	struct rest_client_req_context req;
	struct rest_client_resp_context resp;

	rest_client_request_defaults_set(&req);
	req.host		= SUPABASE_HOST;
	req.port		= SUPABASE_PORT;
	req.url			= SUPABASE_URL;
	req.sec_tag		= TLS_SEC_TAG;
	req.tls_peer_verify	= REST_CLIENT_TLS_DEFAULT_PEER_VERIFY;
	req.http_method		= HTTP_POST;
	req.header_fields	= headers;
	req.body		= body_buf;
	req.body_len		= len;
	req.resp_buff		= resp_buf;
	req.resp_buff_len	= sizeof(resp_buf);
	req.timeout_ms		= 30000;

	printk("POST %s (%d bytes)...\n", SUPABASE_URL, len);

	err = rest_client_request(&req, &resp);
	if (err) {
		printk("rest_client_request failed: %d\n", err);
		return err;
	}

	printk("HTTP %d\n", resp.http_status_code);

	if (resp.http_status_code != 201 && resp.http_status_code != 200) {
		printk("Unexpected status. Body: %.*s\n",
		       (int)resp.response_len, resp.response ? resp.response : "");
		return -EIO;
	}

	return 0;
}

int transport_fetch_config(uint32_t *sample_interval_ms)
{
	int err;

	static const char *headers[] = {
		"apikey: " SUPABASE_ANON_KEY "\r\n",
		NULL
	};

	struct rest_client_req_context req;
	struct rest_client_resp_context resp;

	rest_client_request_defaults_set(&req);
	req.host		= SUPABASE_HOST;
	req.port		= SUPABASE_PORT;
	req.url			= SUPABASE_CONFIG_URL "?select=sample_interval_ms&limit=1";
	req.sec_tag		= TLS_SEC_TAG;
	req.tls_peer_verify	= REST_CLIENT_TLS_DEFAULT_PEER_VERIFY;
	req.http_method		= HTTP_GET;
	req.header_fields	= headers;
	req.body		= NULL;
	req.body_len		= 0;
	req.resp_buff		= resp_buf;
	req.resp_buff_len	= sizeof(resp_buf);
	req.timeout_ms		= 15000;

	printk("GET %s?select=sample_interval_ms&limit=1...\n",
	       SUPABASE_CONFIG_URL);

	err = rest_client_request(&req, &resp);
	if (err) {
		printk("fetch_config: request failed: %d\n", err);
		return err;
	}

	if (resp.http_status_code != 200) {
		printk("fetch_config: HTTP %d\n", resp.http_status_code);
		return -EIO;
	}

	/*
	 * Response is a JSON array, e.g.:
	 *   [{"sample_interval_ms":5000}]   — row found
	 *   []                               — no config row
	 *
	 * Parse by searching for the key and reading the following integer.
	 */
	if (resp.response && resp.response_len > 0) {
		const char *key = "\"sample_interval_ms\":";
		const char *p = strstr(resp.response, key);

		if (p) {
			p += strlen(key);

			/* Parse unsigned decimal integer */
			uint32_t val = 0;

			while (*p >= '0' && *p <= '9') {
				val = val * 10u + (uint32_t)(*p - '0');
				p++;
			}

			/* Sanity: 1 second – 1 hour */
			if (val >= 1000u && val <= 3600000u) {
				*sample_interval_ms = val;
				printk("fetch_config: sample_interval_ms = %u ms\n", val);
			} else {
				printk("fetch_config: value %u out of range, ignoring\n", val);
			}
		} else {
			printk("fetch_config: no config row\n");
		}
	}

	return 0;
}

int transport_send_batch(const struct accel_sample *samples, int count,
			 uint8_t battery_pct)
{
	int err;
	int pos = 0;

	pos += snprintf(batch_buf + pos, sizeof(batch_buf) - pos,
			"{\"battery_pct\":%u,\"x\":[",
			battery_pct);

	for (int i = 0; i < count; i++) {
		pos += snprintf(batch_buf + pos, sizeof(batch_buf) - pos,
			"%s%d", i > 0 ? "," : "", samples[i].x);

		if (pos >= (int)sizeof(batch_buf) - 2) {
			printk("batch_buf overflow at x sample %d\n", i);
			return -ENOMEM;
		}
	}

	pos += snprintf(batch_buf + pos, sizeof(batch_buf) - pos, "],\"y\":[");

	for (int i = 0; i < count; i++) {
		pos += snprintf(batch_buf + pos, sizeof(batch_buf) - pos,
			"%s%d", i > 0 ? "," : "", samples[i].y);

		if (pos >= (int)sizeof(batch_buf) - 2) {
			printk("batch_buf overflow at y sample %d\n", i);
			return -ENOMEM;
		}
	}

	pos += snprintf(batch_buf + pos, sizeof(batch_buf) - pos, "],\"z\":[");

	for (int i = 0; i < count; i++) {
		pos += snprintf(batch_buf + pos, sizeof(batch_buf) - pos,
			"%s%d", i > 0 ? "," : "", samples[i].z);

		if (pos >= (int)sizeof(batch_buf) - 2) {
			printk("batch_buf overflow at z sample %d\n", i);
			return -ENOMEM;
		}
	}

	pos += snprintf(batch_buf + pos, sizeof(batch_buf) - pos, "]}");

	static const char *headers[] = {
		"apikey: " SUPABASE_ANON_KEY "\r\n",
		"Content-Type: application/json\r\n",
		"Prefer: return=minimal\r\n",
		NULL
	};

	struct rest_client_req_context req;
	struct rest_client_resp_context resp;

	rest_client_request_defaults_set(&req);
	req.host		= SUPABASE_HOST;
	req.port		= SUPABASE_PORT;
	req.url			= SUPABASE_URL;
	req.sec_tag		= TLS_SEC_TAG;
	req.tls_peer_verify	= REST_CLIENT_TLS_DEFAULT_PEER_VERIFY;
	req.http_method		= HTTP_POST;
	req.header_fields	= headers;
	req.body		= batch_buf;
	req.body_len		= pos;
	req.resp_buff		= resp_buf;
	req.resp_buff_len	= sizeof(resp_buf);
	req.timeout_ms		= 30000;

	printk("POST %s (%d bytes, %d samples)...\n",
	       SUPABASE_URL, pos, count);

	err = rest_client_request(&req, &resp);
	if (err) {
		printk("batch POST failed: %d\n", err);
		return err;
	}

	printk("HTTP %d\n", resp.http_status_code);

	if (resp.http_status_code != 201 &&
	    resp.http_status_code != 200) {
		printk("Unexpected status. Body: %.*s\n",
		       (int)resp.response_len,
		       resp.response ? resp.response : "");
		return -EIO;
	}

	return 0;
}
