-- Final compact production schema.
--
-- Firmware writes one row per 100-sample batch:
--   battery_pct integer
--   x/y/z smallint[] arrays
--
-- The accel_samples_25hz view expands batches into per-sample rows for charts.

BEGIN;

DROP VIEW IF EXISTS public.accel_samples_25hz;

-- The compact batch table replaces the old row-per-sample and status tables.
DROP TABLE IF EXISTS public.accel_readings;
DROP TABLE IF EXISTS public.node_status;

CREATE TABLE IF NOT EXISTS public.accel_batches (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  battery_pct INTEGER,
  x SMALLINT[],
  y SMALLINT[],
  z SMALLINT[]
);

ALTER TABLE public.accel_batches
  ADD COLUMN IF NOT EXISTS battery_pct INTEGER,
  ADD COLUMN IF NOT EXISTS x SMALLINT[],
  ADD COLUMN IF NOT EXISTS y SMALLINT[],
  ADD COLUMN IF NOT EXISTS z SMALLINT[],
  DROP COLUMN IF EXISTS sample_count,
  DROP COLUMN IF EXISTS start_uptime_ms,
  DROP COLUMN IF EXISTS end_uptime_ms;

-- One-time upgrade from the previous samples JSONB column, if present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accel_batches'
      AND column_name = 'samples'
  ) THEN
    EXECUTE $sql$
      UPDATE public.accel_batches b
      SET
        x = parsed.x,
        y = parsed.y,
        z = parsed.z
      FROM (
        SELECT
          id,
          array_agg((sample_value->>0)::smallint ORDER BY sample_ord) AS x,
          array_agg((sample_value->>1)::smallint ORDER BY sample_ord) AS y,
          array_agg((sample_value->>2)::smallint ORDER BY sample_ord) AS z
        FROM public.accel_batches
        CROSS JOIN LATERAL jsonb_array_elements(samples) WITH ORDINALITY
          AS sample(sample_value, sample_ord)
        WHERE samples IS NOT NULL
          AND x IS NULL
        GROUP BY id
      ) parsed
      WHERE b.id = parsed.id
    $sql$;

    ALTER TABLE public.accel_batches DROP COLUMN samples;
  END IF;
END $$;

ALTER TABLE public.accel_batches
  ALTER COLUMN x SET NOT NULL,
  ALTER COLUMN y SET NOT NULL,
  ALTER COLUMN z SET NOT NULL;

CREATE OR REPLACE VIEW public.accel_samples_25hz AS
WITH batches AS (
  SELECT
    id AS batch_id,
    ts AS batch_ts,
    battery_pct,
    cardinality(x) AS sample_count,
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
  FROM batches
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
  b.batch_id,
  b.segment_id,
  b.segment_sample_offset + p.sample_ord - 1 AS sample_index,
  p.sample_ord AS sample_in_batch,
  b.segment_anchor_ts
    + ((b.segment_sample_offset + p.sample_ord - 1) * interval '40 milliseconds')
    AS sample_ts,
  b.batch_ts,
  b.battery_pct,
  p.x,
  p.y,
  p.z
FROM indexed_batches b
JOIN public.accel_batches raw ON raw.id = b.batch_id
CROSS JOIN LATERAL unnest(raw.x, raw.y, raw.z) WITH ORDINALITY
  AS p(x, y, z, sample_ord);

COMMIT;
