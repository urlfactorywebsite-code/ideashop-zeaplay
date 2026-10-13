# ZeaPlay Reporting - Webex Reply Webhook (n8n)

Endpoint:
`POST /api/reporting/webex/reply-webhook`

Purpose:
- Accept Webex replies to reporting check-ins.
- Create `WEBEX_REPLY` timeline events.
- Stop retries for the matching check-in.

Body (JSON):
```
{
  "correlation_id": "optional-correlation-id",
  "text": "reply message text",
  "person_id": "webex person id",
  "room_id": "webex room id",
  "reply_time": "2026-02-16T10:15:00Z",
  "message_id": "webex message id (optional)"
}
```

Resolution rules:
- If `correlation_id` is present, it is used to locate `report_checkins`.
- If missing, the latest pending check-in for the user+report_date is used.
- Tenant/user resolved from `users.webex_person_id`.

Idempotency:
- Webhook uses `message_id` if provided.
- If not, uses a hash of `correlation_id + person_id`.

Expected outcome:
- A `WEBEX_REPLY` row appears in `report_timeline_events`.
- Matching `report_checkins.reply_received = true` and `next_retry_at = null`.
