import './FleetDashboard.css';
import { useReadingSummary } from '../hooks/useAccelReadings';
import { useLiveStatus } from '../hooks/useLiveStatus';
import { StatusDot } from './StatusDot';
import { formatAge, formatET } from '../lib/time';

export function FleetDashboard() {
  const { total, latest, earliest_ts, latest_ts, status, loading } = useReadingSummary();
  const { latest: latestStatus, loading: statusLoading } = useLiveStatus();

  if (loading) {
    return (
      <div className="fleet-dashboard">
        <h2 className="fleet-dashboard__heading">Dashboard</h2>
        <p className="fleet-dashboard__loading">Loading...</p>
      </div>
    );
  }

  return (
    <div className="fleet-dashboard">
      <h2 className="fleet-dashboard__heading">Dashboard</h2>

      <div className="fleet-dashboard__grid">
        <div className="fleet-dashboard__card">
          <span className="fleet-dashboard__label">STATUS</span>
          <span className="fleet-dashboard__value">
            <StatusDot status={status} />
            {status.toUpperCase()}
          </span>
        </div>

        <div className="fleet-dashboard__card">
          <span className="fleet-dashboard__label">TOTAL READINGS</span>
          <span className="fleet-dashboard__value">{total.toLocaleString()}</span>
        </div>

        <div className="fleet-dashboard__card">
          <span className="fleet-dashboard__label">LAST READING</span>
          <span className="fleet-dashboard__value">
            {latest_ts ? formatAge(latest_ts) : '—'}
          </span>
        </div>

        <div className="fleet-dashboard__card">
          <span className="fleet-dashboard__label">TIME SPAN</span>
          <span className="fleet-dashboard__value fleet-dashboard__value--small">
            {earliest_ts ? formatET(earliest_ts) : '—'}
            <br />
            {latest_ts ? formatET(latest_ts) : '—'}
          </span>
        </div>

        {/* Node status cards (node_status table telemetry) */}
        <div className="fleet-dashboard__card">
          <span className="fleet-dashboard__label">CHARGER</span>
          <span className="fleet-dashboard__value">
            {statusLoading ? '...' : latestStatus?.chg_state_label ?? '—'}
          </span>
        </div>

        <div className="fleet-dashboard__card">
          <span className="fleet-dashboard__label">IBAT</span>
          <span className="fleet-dashboard__value">
            {latestStatus?.ibat_ma != null ? `${latestStatus.ibat_ma} mA` : '—'}
          </span>
        </div>

        <div className="fleet-dashboard__card">
          <span className="fleet-dashboard__label">VBUS</span>
          <span className="fleet-dashboard__value">
            {latestStatus?.vbus_present == null
              ? '—'
              : latestStatus.vbus_present
              ? 'PRESENT'
              : 'ABSENT'}
          </span>
        </div>

        <div className="fleet-dashboard__card">
          <span className="fleet-dashboard__label">LAST STATUS</span>
          <span className="fleet-dashboard__value">
            {latestStatus?.ts ? formatAge(latestStatus.ts) : '—'}
          </span>
        </div>
      </div>

      {latest && (
        <div className="fleet-dashboard__latest">
          <h3 className="fleet-dashboard__label">LATEST SAMPLE</h3>
          <table className="fleet-dashboard__table">
            <thead>
              <tr>
                <th>TIMESTAMP</th>
                <th>NODE</th>
                <th>X raw</th>
                <th>Y raw</th>
                <th>Z raw</th>
                <th>BAT V</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatET(latest.ts)}</td>
                <td>{latest.node_id}</td>
                <td>{latest.x_raw}</td>
                <td>{latest.y_raw}</td>
                <td>{latest.z_raw}</td>
                <td>{latest.battery_v != null ? latest.battery_v.toFixed(3) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
