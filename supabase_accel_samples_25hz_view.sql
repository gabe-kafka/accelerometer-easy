-- Expand compact batch rows into per-sample rows with smoothed 25 Hz timestamps.
--
-- accel_batches.ts is the Supabase insert time for the whole batch, so every
-- sample in one batch otherwise appears at the same timestamp. This view keeps
-- accel_batches as the raw ingest table and provides a display/analysis layer:
-- one row per accelerometer sample, stepped at 40 ms. Gaps over 15 seconds
-- start a new segment so power/LTE outages are still visible.

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
