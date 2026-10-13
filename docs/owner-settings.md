# Owner Settings API

The owner settings surface now groups configuration into three feature areas: profile personalization, multi-mailbox SMTP routing, and OAuth automation clients. The tables below list the supported backend endpoints together with the payloads used by the refreshed frontend.

## Profile & Theme

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/users/me` | `PATCH` | Owner/Admin | Update display name, employer id, and department reference. |
| `/users/me/change-password` | `POST` | Owner/Admin | Change the current password by supplying the existing and new values. |

The theme, badge, picture, and frame selections are stored locally in the browser for instant preview. They do not call the backend yet and can be synced in a future release by extending the `/users/me` endpoint.

## Multi SMTP Profiles

| Endpoint | Method | Auth | Notes |
| --- | --- | --- | --- |
| `/config/smtp/multiple` | `GET` | Owner/Admin | List all configured SMTP profiles ordered by name. |
| `/config/smtp/multiple` | `POST` | Owner/Admin | Create a profile. Body fields: `name`, `host`, `port`, `username`, optional `password`, `encryption`, `notification_types[]`. |
| `/config/smtp/multiple/{id}` | `PATCH` | Owner/Admin | Update any field. Omitted fields stay unchanged. Provide `password` only when rotating the credential. |
| `/config/smtp/multiple/{id}` | `DELETE` | Owner/Admin | Remove a profile. |

`notification_types` currently supports:

- `welcome_password` – welcome messages and password resets
- `task_notifications` – task creation and workflow alerts
- `achievement_notifications` – badge and achievement emails
- `reward_notifications` – catalogue updates
- `system_alerts` – general system maintenance notices

## OAuth Clients & Keys

| Endpoint | Method | Auth | Notes |
| --- | --- | --- | --- |
| `/config/oauth` | `GET` | Owner/Admin | Return all registered OAuth clients with secrets and metadata. |
| `/config/oauth` | `POST` | Owner/Admin | Create a client. Body fields: `name`, `redirect_url`, `scopes[]`, `n8n_integration`, optional `client_id`, `client_secret`, `api_key`. Server generates missing secrets. |
| `/config/oauth/{id}` | `PATCH` | Owner/Admin | Update any subset of fields above. Useful for toggling `n8n_integration` or editing redirect URLs. |
| `/config/oauth/{id}/rotate` | `POST` | Owner/Admin | Rotate credentials. Body flags: `rotate_client_id`, `rotate_client_secret`, `rotate_api_key` (all boolean, default `false`). |
| `/config/oauth/{id}` | `DELETE` | Owner/Admin | Delete a client and revoke associated tokens. |

All secrets (`client_secret`, `api_key`) are delivered once in the response payloads above; rotate them when you need to reissue values for integrators such as n8n.

### OAuth Payload Example

```json
{
  "name": "n8n production",
  "redirect_url": "https://automation.example.com/oauth2/callback",
  "scopes": ["tasks.read", "notifications.send", "n8n.trigger"],
  "n8n_integration": true
}
```

Rotate only the API key:

```json
{
  "rotate_api_key": true
}
```

## Data Backup & Maintenance

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/admin/data/export` | `GET` | Owner/Admin | Download backup JSON (`scope` query supports `all`, `users`, `tasks`). |
| `/admin/data/import` | `POST` | Owner/Admin | Restore backup payloads produced by the export endpoint. |
| `/admin/data/reset/request` | `POST` | Owner | Send a one time passcode to the owner SMTP inbox. |
| `/admin/data/reset/confirm` | `POST` | Owner | Confirm full workspace reset by submitting the OTP. |

## Frontend Notes

- `frontend/pages/Settings.tsx` drives the three tab experience and stores badge, frame, and avatar selections locally.
- `frontend/services/mockApi.ts` exposes helpers for the new OAuth rotate endpoint and multi SMTP CRUD operations.
- Local storage keys created by the UI:
  - `owner-settings-badge`
  - `owner-settings-frame`
  - `owner-settings-picture`

These APIs and entry points are ready to plug into n8n by supplying the generated client credentials within an OAuth2 credential node, or by using the API key for simple token-based flows.
