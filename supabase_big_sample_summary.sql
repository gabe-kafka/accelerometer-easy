-- Server-side full-history downsampling for the Big Sample Data Viewer.
--
-- Apply in Supabase SQL Editor:
--   1. Open SQL Editor
--   2. Paste this file
--   3. Run
--
-- Frontend endpoint:
--   POST /rest/v1/rpc/big_sample_summary
--   {"target_points":10000}

CREATE OR REPLACE FUNCTION public.big_sample_summary(target_points integer DEFAULT 10000)
RETURNS TABLE (
  bucket_index integer,
  ts timestamptz,
  start_ts timestamptz,
  end_ts timestamptz,
  batch_count bigint,
  sample_count bigint,
  x_mean double precision,
  y_mean double precision,
  z_mean double precision,
  x_min smallint,
  x_max smallint,
  y_min smallint,
  y_max smallint,
  z_min smallint,
  z_max smallint,
  battery_pct double precision,
  total_batches bigint
)
LANGUAGE sql
STABLE
AS $$
WITH params AS (
  SELECT greatest(1, least(coalesce(target_points, 10000), 50000)) AS target_points
),
bounds AS (
  SELECT
    min(id) AS min_id,
    max(id) AS max_id,
    greatest(max(id) - min(id) + 1, 1) AS id_span
  FROM public.accel_batches
),
stride AS (
  SELECT
    min_id,
    max_id,
    id_span,
    greatest(1, ceil(id_span::double precision / (SELECT target_points FROM params))::bigint) AS stride
  FROM bounds
),
selected AS (
  SELECT
    floor((b.id - s.min_id)::double precision / s.stride)::integer AS bucket_index,
    b.ts,
    b.battery_pct,
    b.x,
    b.y,
    b.z,
    s.id_span AS total_batches
  FROM public.accel_batches b
  CROSS JOIN stride s
  WHERE ((b.id - s.min_id) % s.stride = 0)
    OR b.id = s.max_id
),
batch_stats AS (
  SELECT
    bucket_index,
    ts,
    battery_pct,
    cardinality(x) AS sample_count,
    (
      coalesce(x[1], 0)::double precision
      + coalesce(x[greatest(1, cardinality(x) / 2)], x[1], 0)::double precision
      + coalesce(x[cardinality(x)], x[1], 0)::double precision
    ) / 3.0 AS x_mean,
    (
      coalesce(y[1], 0)::double precision
      + coalesce(y[greatest(1, cardinality(y) / 2)], y[1], 0)::double precision
      + coalesce(y[cardinality(y)], y[1], 0)::double precision
    ) / 3.0 AS y_mean,
    (
      coalesce(z[1], 0)::double precision
      + coalesce(z[greatest(1, cardinality(z) / 2)], z[1], 0)::double precision
      + coalesce(z[cardinality(z)], z[1], 0)::double precision
    ) / 3.0 AS z_mean,
    least(
      coalesce(x[1], 0),
      coalesce(x[greatest(1, cardinality(x) / 2)], x[1], 0),
      coalesce(x[cardinality(x)], x[1], 0)
    )::smallint AS x_min,
    greatest(
      coalesce(x[1], 0),
      coalesce(x[greatest(1, cardinality(x) / 2)], x[1], 0),
      coalesce(x[cardinality(x)], x[1], 0)
    )::smallint AS x_max,
    least(
      coalesce(y[1], 0),
      coalesce(y[greatest(1, cardinality(y) / 2)], y[1], 0),
      coalesce(y[cardinality(y)], y[1], 0)
    )::smallint AS y_min,
    greatest(
      coalesce(y[1], 0),
      coalesce(y[greatest(1, cardinality(y) / 2)], y[1], 0),
      coalesce(y[cardinality(y)], y[1], 0)
    )::smallint AS y_max,
    least(
      coalesce(z[1], 0),
      coalesce(z[greatest(1, cardinality(z) / 2)], z[1], 0),
      coalesce(z[cardinality(z)], z[1], 0)
    )::smallint AS z_min,
    greatest(
      coalesce(z[1], 0),
      coalesce(z[greatest(1, cardinality(z) / 2)], z[1], 0),
      coalesce(z[cardinality(z)], z[1], 0)
    )::smallint AS z_max,
    total_batches
  FROM selected
)
SELECT
  bucket_index,
  min(ts) + ((max(ts) - min(ts)) / 2.0) AS ts,
  min(ts) AS start_ts,
  max(ts) AS end_ts,
  count(*) AS batch_count,
  sum(sample_count)::bigint AS sample_count,
  avg(x_mean)::double precision AS x_mean,
  avg(y_mean)::double precision AS y_mean,
  avg(z_mean)::double precision AS z_mean,
  min(x_min)::smallint AS x_min,
  max(x_max)::smallint AS x_max,
  min(y_min)::smallint AS y_min,
  max(y_max)::smallint AS y_max,
  min(z_min)::smallint AS z_min,
  max(z_max)::smallint AS z_max,
  avg(battery_pct)::double precision AS battery_pct,
  max(total_batches)::bigint AS total_batches
FROM batch_stats
GROUP BY bucket_index
ORDER BY bucket_index;
$$;

GRANT EXECUTE ON FUNCTION public.big_sample_summary(integer) TO anon;
