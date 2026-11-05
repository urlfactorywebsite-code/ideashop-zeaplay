import React, { useMemo, useState } from 'react';
import { useTicketLogs } from '../../hooks/useTicketLogs';

interface TicketLogsPanelProps {
  ticketId: string;
}

const TicketLogsPanel: React.FC<TicketLogsPanelProps> = ({ ticketId }) => {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { data, loading, error } = useTicketLogs(ticketId, page, 20);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <h3 className="text-lg font-semibold text-white">Logs</h3>
        {loading && <p className="mt-3 text-xs text-white/60">Loading logs...</p>}
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}

        {!loading && data && data.items.length === 0 && (
          <p className="mt-3 text-sm text-white/60">No logs yet.</p>
        )}

        <div className="mt-4 space-y-3">
          {data?.items.map((log) => (
            <div key={log.id} className="rounded-xl border border-white/10 bg-black/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{log.eventType}</p>
                  <p className="text-xs text-white/60">{log.summary}</p>
                </div>
                <span className="text-[11px] text-white/40">{new Date(log.createdAtUtc).toLocaleString()}</span>
              </div>
              {log.payloadJson && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [log.id]: !prev[log.id] }))}
                    className="text-xs font-semibold text-blue-300"
                  >
                    {expanded[log.id] ? 'Hide JSON' : 'View JSON'}
                  </button>
                  {expanded[log.id] && (
                    <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-black/70 p-3 text-[11px] text-white/70">
                      {JSON.stringify(log.payloadJson, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {data && totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
              className="rounded-full border border-white/10 bg-black/60 px-3 py-1 text-xs text-white/70 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-xs text-white/50">Page {page} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page === totalPages}
              className="rounded-full border border-white/10 bg-black/60 px-3 py-1 text-xs text-white/70 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TicketLogsPanel;
