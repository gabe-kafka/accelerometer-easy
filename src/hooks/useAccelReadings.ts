import { useState, useEffect, useCallback } from 'react';
import { AccelReading, deriveNodeStatus, NodeStatus } from '../types';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 50;

export interface ExplorerFilters {
  from: string; // ISO date string
  to: string;   // ISO date string
  page: number;
  sortKey: 'ts' | 'x_raw' | 'y_raw' | 'z_raw' | 'battery_v' | 'node_id';
  sortDir: 'asc' | 'desc';
}

export interface ExplorerResult {
  readings: AccelReading[];
  total: number;
  totalPages: number;
  page: number;
  loading: boolean;
}

export function useAccelReadings(filters: ExplorerFilters): ExplorerResult {
  const [readings, setReadings] = useState<AccelReading[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchReadings = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const from = (filters.page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('accel_readings')
      .select('*', { count: 'exact' })
      .order(filters.sortKey, { ascending: filters.sortDir === 'asc' })
      .range(from, to);

    if (filters.from) {
      query = query.gte('ts', new Date(filters.from).toISOString());
    }
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setDate(endOfDay.getDate() + 1);
      query = query.lt('ts', endOfDay.toISOString());
    }

    const { data, count, error } = await query;

    if (error) {
      console.error('Supabase query error:', error);
      setLoading(false);
      return;
    }

    setReadings(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [filters.from, filters.to, filters.page, filters.sortKey, filters.sortDir]);

  useEffect(() => {
    fetchReadings();
  }, [fetchReadings]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return { readings, total, totalPages, page: filters.page, loading };
}

export interface ReadingSummary {
  total: number;
  latest: AccelReading | null;
  earliest_ts: string | null;
  latest_ts: string | null;
  status: NodeStatus;
  loading: boolean;
}

export function useReadingSummary(): ReadingSummary {
  const [summary, setSummary] = useState<ReadingSummary>({
    total: 0,
    latest: null,
    earliest_ts: null,
    latest_ts: null,
    status: 'offline',
    loading: true,
  });

  useEffect(() => {
    if (!supabase) {
      setSummary((s) => ({ ...s, loading: false }));
      return;
    }

    async function fetch() {
      const [countRes, latestRes, earliestRes] = await Promise.all([
        supabase!.from('accel_readings').select('*', { count: 'exact', head: true }),
        supabase!.from('accel_readings').select('*').order('ts', { ascending: false }).limit(1),
        supabase!.from('accel_readings').select('ts').order('ts', { ascending: true }).limit(1),
      ]);

      const latest = latestRes.data?.[0] as AccelReading | undefined;
      const earliest = earliestRes.data?.[0] as { ts: string } | undefined;

      setSummary({
        total: countRes.count ?? 0,
        latest: latest ?? null,
        earliest_ts: earliest?.ts ?? null,
        latest_ts: latest?.ts ?? null,
        status: latest ? deriveNodeStatus(latest.ts) : 'offline',
        loading: false,
      });
    }

    fetch();
  }, []);

  return summary;
}
