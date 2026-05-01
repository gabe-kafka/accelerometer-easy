import { useState, useEffect, useRef, useCallback } from 'react';
import { NodeStatusRow } from '../types';
import { supabase } from '../lib/supabase';
import { COLLECTION_START_ISO } from '../lib/time';

const POLL_INTERVAL = 12_000;

export interface LiveStatusResult {
  rows: NodeStatusRow[];
  latest: NodeStatusRow | null;
  loading: boolean;
  lastUpdated: Date | null;
}

/**
 * Live view: all node_status rows since the test start.
 * One row per batch cycle (~12/hour at 5-min cadence) — tiny query.
 */
export function useLiveStatus(): LiveStatusResult {
  const [rows, setRows] = useState<NodeStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTsRef = useRef<string | null>(null);
  const lastCountRef = useRef<number>(0);

  const fetchStatus = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('node_status')
      .select('node_id,ts,ibat_ma,vbus_present,chg_state,chg_state_label')
      .gte('ts', COLLECTION_START_ISO)
      .order('ts', { ascending: true })
      .limit(2000);

    if (error) {
      console.error('Live status fetch error:', error);
      setLoading(false);
      return;
    }

    const fresh = (data as NodeStatusRow[]) ?? [];
    const tail = fresh[fresh.length - 1];
    const newLastTs = tail ? tail.ts : null;

    if (newLastTs !== lastTsRef.current || fresh.length !== lastCountRef.current) {
      lastTsRef.current = newLastTs;
      lastCountRef.current = fresh.length;
      setRows(fresh);
    }
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus]);

  const latest: NodeStatusRow | null = rows[rows.length - 1] ?? null;
  return { rows, latest, loading, lastUpdated };
}
