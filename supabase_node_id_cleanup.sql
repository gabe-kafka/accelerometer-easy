-- Run in the Supabase SQL editor before deploying node-less firmware.
-- Removes device identity from ingest/status tables and makes config global.

ALTER TABLE public.accel_readings
  ALTER COLUMN node_id DROP NOT NULL;

ALTER TABLE public.accel_readings
  DROP COLUMN IF EXISTS node_id;

ALTER TABLE public.node_status
  ALTER COLUMN node_id DROP NOT NULL;

ALTER TABLE public.node_status
  DROP COLUMN IF EXISTS node_id;

ALTER TABLE public.node_config
  DROP CONSTRAINT IF EXISTS node_config_pkey;

ALTER TABLE public.node_config
  ADD COLUMN IF NOT EXISTS id BOOLEAN;

UPDATE public.node_config
SET id = TRUE
WHERE id IS NULL;

DELETE FROM public.node_config a
USING public.node_config b
WHERE a.ctid < b.ctid;

ALTER TABLE public.node_config
  ALTER COLUMN id SET DEFAULT TRUE,
  ALTER COLUMN id SET NOT NULL,
  DROP COLUMN IF EXISTS node_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'node_config_id_check'
      AND conrelid = 'public.node_config'::regclass
  ) THEN
    ALTER TABLE public.node_config
      ADD CONSTRAINT node_config_id_check CHECK (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'node_config_pkey'
      AND conrelid = 'public.node_config'::regclass
  ) THEN
    ALTER TABLE public.node_config
      ADD CONSTRAINT node_config_pkey PRIMARY KEY (id);
  END IF;
END $$;
