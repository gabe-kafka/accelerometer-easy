export interface AccelReading {
  id: number;
  ts: string; // ISO-8601 UTC
  x_raw: number;
  y_raw: number;
  z_raw: number;
  battery_v: number | null;
  node_id: string;
}

/** One row in the node_status table (device/charger telemetry per batch cycle). */
export interface NodeStatusRow {
  node_id: string;
  ts: string; // ISO-8601 UTC
  ibat_ma: number | null;
  vbus_present: boolean | null;
  chg_state: number | null;
  chg_state_label: string | null;
}

export type NodeStatus = 'online' | 'stale' | 'offline';

export function deriveNodeStatus(lastTs: string): NodeStatus {
  const ageMs = Date.now() - new Date(lastTs).getTime();
  const ageMins = ageMs / (1000 * 60);
  if (ageMins < 10) return 'online';
  if (ageMins < 30) return 'stale';
  return 'offline';
}
