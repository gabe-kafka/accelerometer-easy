-- Compact production schema and prune retained data.
-- Run in the Supabase SQL editor. The anon REST key cannot delete these rows
-- because RLS blocks DELETE from the firmware/client role.

BEGIN;

-- Keep only the latest 100 accel samples by monotonically increasing id.
WITH keep AS (
  SELECT id
  FROM public.accel_readings
  ORDER BY id DESC
  LIMIT 100
)
DELETE FROM public.accel_readings
WHERE id NOT IN (SELECT id FROM keep);

-- Strip accel_readings to the columns the firmware now sends/stores:
-- id, ts, x, y, z.
ALTER TABLE public.accel_readings
  ALTER COLUMN ts SET DEFAULT now(),
  DROP COLUMN IF EXISTS battery_v,
  DROP COLUMN IF EXISTS node_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accel_readings'
      AND column_name = 'x_raw'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accel_readings'
      AND column_name = 'x'
  ) THEN
    ALTER TABLE public.accel_readings RENAME COLUMN x_raw TO x;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accel_readings'
      AND column_name = 'y_raw'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accel_readings'
      AND column_name = 'y'
  ) THEN
    ALTER TABLE public.accel_readings RENAME COLUMN y_raw TO y;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accel_readings'
      AND column_name = 'z_raw'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accel_readings'
      AND column_name = 'z'
  ) THEN
    ALTER TABLE public.accel_readings RENAME COLUMN z_raw TO z;
  END IF;
END $$;

-- Status telemetry was useful during charger debug, but it is extra storage
-- and an extra POST path. Keep charger state in RTT logs for now.
DROP TABLE IF EXISTS public.node_status;

-- One row per uploaded 100-sample batch. The firmware stores battery_pct once
-- per batch and keeps raw accel samples packed as compact JSON arrays.
CREATE TABLE IF NOT EXISTS public.accel_batches (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  samples JSONB NOT NULL,
  battery_pct INTEGER
);

ALTER TABLE public.accel_batches
  ADD COLUMN IF NOT EXISTS battery_pct INTEGER,
  DROP COLUMN IF EXISTS sample_count,
  DROP COLUMN IF EXISTS start_uptime_ms,
  DROP COLUMN IF EXISTS end_uptime_ms;

-- Display/analysis view: expand each compact JSON batch into one row per
-- sample with synthetic 25 Hz timestamps. Large gaps start new segments so
-- outages remain visible instead of being smoothed away.
CREATE OR REPLACE VIEW public.accel_samples_25hz AS
WITH ordered_batches AS (
  SELECT
    id AS batch_id,
    ts AS batch_ts,
    battery_pct,
    samples,
    jsonb_array_length(samples) AS sample_count,
    CASE
      WHEN lag(ts) OVER (ORDER BY id) IS NULL THEN 1
      WHEN ts - lag(ts) OVER (ORDER BY id) > interval '15 seconds' THEN 1
      ELSE 0
    END AS segment_start
  FROM public.accel_batches
),
segmented_batches AS (
  SELECT
    *,
    sum(segment_start) OVER (ORDER BY batch_id) AS segment_id
  FROM ordered_batches
),
indexed_batches AS (
  SELECT
    *,
    coalesce(
      sum(sample_count) OVER (
        PARTITION BY segment_id
        ORDER BY batch_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    ) AS segment_sample_offset,
    min(batch_ts) OVER (PARTITION BY segment_id) AS segment_anchor_ts
  FROM segmented_batches
)
SELECT
  batch_id,
  segment_id,
  segment_sample_offset + sample_ord - 1 AS sample_index,
  sample_ord AS sample_in_batch,
  segment_anchor_ts
    + ((segment_sample_offset + sample_ord - 1) * interval '40 milliseconds')
    AS sample_ts,
  batch_ts,
  battery_pct,
  (sample_value->>0)::integer AS x,
  (sample_value->>1)::integer AS y,
  (sample_value->>2)::integer AS z
FROM indexed_batches
CROSS JOIN LATERAL jsonb_array_elements(samples) WITH ORDINALITY
  AS sample(sample_value, sample_ord);

COMMIT;

VACUUM (ANALYZE) public.accel_readings;
