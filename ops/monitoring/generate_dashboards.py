"""Deterministically generate provisioned Grafana JSON. No network access."""
import json
from pathlib import Path

BOARDS = {
    "infrastructure": [
        ("Host CPU fraction", '1-avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m]))'),
        ("Host available RAM", 'node_memory_MemAvailable_bytes'),
        ("Container CPU cores", 'sum by (instance,name) (rate(container_cpu_usage_seconds_total{image!=""}[5m]))'),
        ("Container memory", 'container_memory_working_set_bytes{image!=""}'),
        ("Filesystem free fraction", 'node_filesystem_avail_bytes / node_filesystem_size_bytes'),
        ("Network bytes per second", 'sum by (instance,device) (rate(node_network_receive_bytes_total[5m])+rate(node_network_transmit_bytes_total[5m]))'),
        ("Disk I/O seconds per second", 'rate(node_disk_io_time_seconds_total[5m])'),
        ("Open file descriptors", 'node_filefd_allocated'),
        ("Container start timestamps (not restart counts)", '1000 * container_start_time_seconds{image!=""}'),
        ("OOM events", 'increase(container_oom_events_total[15m])'),
    ],
    "fastapi-realtime": [
        ("Active accepted sockets", 'sum by (feature) (zea_ws_active)'),
        ("Messages per second", 'sum by (feature,direction) (rate(zea_ws_messages_total[5m]))'),
        ("Local fanout handler p95 seconds", 'histogram_quantile(0.95,sum by (le,category) (rate(zea_rt_handler_seconds_bucket[5m])))'),
        ("Explicit JWT failures", 'sum by (feature) (rate(zea_ws_rejections_total{reason="auth"}[5m]))'),
        ("Connection endings per second", 'sum by (feature,reason) (rate(zea_ws_disconnects_total[5m]))'),
        ("Queue depth", 'sum by (category) (zea_rt_queue)'),
        ("Slow-client send timeouts", 'sum by (feature) (rate(zea_ws_fanout_failures_total{reason="timeout"}[5m]))'),
        ("Send p95 seconds", 'histogram_quantile(0.95,sum by (le,feature) (rate(zea_ws_send_seconds_bucket[5m])))'),
    ],
    "socketio-calling": [
        ("Connected sockets", 'sum(zea_io_clients)'),
        ("Local presence sessions (not fleet-unique users)", 'zea_io_presence_sessions'),
        ("Call signaling attempts", 'sum(rate(zea_io_events_total{event="call:initiate",direction="in"}[5m]))'),
        ("Local signaling contexts (not media)", 'zea_io_signaling_contexts'),
        ("Signaling errors", 'rate(zea_io_errors_total{kind="signaling"}[5m])'),
        ("Event loop p99 seconds", 'zea_node_nodejs_eventloop_lag_p99_seconds'),
        ("Adapter readiness", 'zea_io_redis_up'),
        ("Process RSS", 'zea_node_process_resident_memory_bytes'),
        ("CPU cores", 'rate(zea_node_process_cpu_seconds_total[5m])'),
    ],
    "redis-postgres": [
        ("Redis used memory", 'redis_memory_used_bytes'),
        ("Redis clients", 'redis_connected_clients'),
        ("Redis fragmentation", 'redis_mem_fragmentation_ratio'),
        ("Redis evictions per second", 'rate(redis_evicted_keys_total[5m])'),
        ("Native subscriber health", 'zea_rt_subscriber_up'),
        ("Redis publishes per second", 'sum by (category) (rate(zea_rt_events_total{outcome="published"}[5m]))'),
        ("PostgreSQL active connections", 'zea_pg_activity_active'),
        ("Queries older than 30 seconds", 'zea_pg_activity_long_running'),
        ("Lock waiters", 'zea_pg_activity_lock_waiters'),
        ("Rollbacks per second", 'rate(zea_pg_transactions_xact_rollback[5m])'),
        ("Pool checked out", 'zea_db_pool_connections{state="checked_out"}'),
        ("Outbox records", 'max by(status)(zea_outbox_records)'),
        ("Retained outbox attempts (gauge)", 'max(zea_outbox_retained_attempts)'),
    ],
    "reliability": [
        ("Scrape health", 'up'),
        ("Dependency health", 'zea_dependency_up'),
        ("Delivery errors per second", 'sum by (category,outcome) (rate(zea_rt_events_total{outcome=~"publish_error|processing_error|reconciliation_error"}[5m]))'),
        ("Unresolved outbox age", 'zea_outbox_oldest_seconds'),
        ("Subscriber retries per second", 'sum by (category) (rate(zea_rt_events_total{outcome="subscriber_error"}[5m]))'),
        ("Probe age seconds", 'time()-zea_dependency_sample_timestamp_seconds'),
    ],
}


def unit_for(title):
    if title in {"Host CPU fraction", "Filesystem free fraction", "Disk I/O seconds per second"}:
        return "percentunit"
    if title in {"Host available RAM", "Container memory", "Process RSS", "Redis used memory"}:
        return "bytes"
    if title == "Network bytes per second":
        return "Bps"
    if "seconds" in title or title == "Unresolved outbox age":
        return "s"
    if title == "Container start timestamps (not restart counts)":
        return "dateTimeAsIso"
    if "per second" in title or title in {"Signaling errors", "Explicit JWT failures", "Slow-client send timeouts"}:
        return "ops"
    return "short"


def generate():
    directory = Path(__file__).parent / "grafana" / "dashboards"
    directory.mkdir(parents=True, exist_ok=True)
    for slug, queries in BOARDS.items():
        panels = [{"id": i+1, "type": "timeseries", "title": title,
                   "datasource": {"type": "prometheus", "uid": "zeaplay-prometheus"},
                   "gridPos": {"h": 8, "w": 12, "x": i % 2 * 12, "y": i // 2 * 8},
                   "targets": [{"refId": "A", "expr": query, "legendFormat": "{{instance}} {{feature}} {{category}} {{status}} {{client}} {{reason}} {{device}} {{name}}"}],
                   "fieldConfig": {"defaults": {"unit": unit_for(title), "noValue": "No data", "custom": {"spanNulls": False}}, "overrides": []},
                   "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}}
                  for i, (title, query) in enumerate(queries)]
        board = {"uid": "zea-"+slug, "title": "Zeaplay / "+slug.replace("-", " ").title(),
                 "schemaVersion": 39, "version": 1, "editable": False, "refresh": "30s",
                 "time": {"from": "now-1h", "to": "now"}, "tags": ["zeaplay", "realtime"], "panels": panels}
        (directory / (slug+".json")).write_text(json.dumps(board, indent=2)+"\n", encoding="utf-8")


if __name__ == "__main__":
    generate()
