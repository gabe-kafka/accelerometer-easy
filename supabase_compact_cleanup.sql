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

COMMIT;

VACUUM (ANALYZE) public.accel_readings;
