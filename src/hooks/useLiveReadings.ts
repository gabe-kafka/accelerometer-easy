import { useState, useEffect, useRef, useCallback } from 'react';
import { AccelReading } from '../types';
import { supabase } from '../lib/supabase';
import { COLLECTION_START_ISO } from '../lib/time';

export interface LiveReadingsResult {
  readings: AccelReading[];
  loading: boolean;
  lastUpdated: Date | null;
}

/**
 * Live view: all accel_readings since the test start (hard-coded in time.ts).
 * At 5-min cadence × 100 samples/POST this is ~1200 rows/hour — single page.
 * Selects only the columns we render to keep payload small.
 */
export function useLiveReadings(): LiveReadingsResult {
  const [readings, setReadings] = useState<AccelReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const lastTsRef = useRef<string | null>(null);

  const lastCountRef = useRef<number>(0);

  const fetchReadings = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('accel_readings')
      .select('id,ts,x_raw,y_raw,z_raw,battery_v,node_id')
      .not('node_id', 'is', null)
      .gte('ts', COLLECTION_START_ISO)
      .order('ts', { ascending: true })
      .limit(20000);

    if (error) {
      console.error('Live readings fetch error:', error);
      setLoading(false);
      return;
    }

    const rows = (data as AccelReading[]) ?? [];
    const tail = rows[rows.length - 1];
    const newLastTs = tail ? tail.ts : null;

    // Re-render only if the tail changed or row count changed. Use refs so
    // the closure isn't stale when the interval fires.
    if (newLastTs !== lastTsRef.current || rows.length !== lastCountRef.current) {
      lastTsRef.current = newLastTs;
      lastCountRef.current = rows.length;
      setReadings(rows);
    }
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchReadings();
  }, [fetchReadings]);

  return { readings, loading, lastUpdated };
}
