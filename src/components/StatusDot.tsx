import { NodeStatus } from '../types';

const STATUS_COLORS: Record<NodeStatus, string> = {
  online: 'var(--green)',
  stale: 'var(--amber)',
  offline: 'var(--red)',
};

interface StatusDotProps {
  status: NodeStatus;
}

export function StatusDot({ status }: StatusDotProps) {
  return (
    <span
      className="status-dot"
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: STATUS_COLORS[status],
        marginRight: 8,
      }}
      title={status.toUpperCase()}
    />
  );
}
