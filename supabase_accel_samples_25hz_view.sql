-- Expand compact batch rows into per-sample rows with smoothed 25 Hz timestamps.
--
-- Firmware stores one row per 100-sample batch with compact int2 arrays:
-- x[], y[], z[]. This view provides one row per accelerometer sample for
-- display/analysis, stepped at 40 ms. Gaps over 15 seconds start a new segment
-- so outages remain visible instead of being smoothed away.

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
