# Vee Task Manager Backend

This directory contains the FastAPI + SQLAlchemy backend for the Vee Task Manager project. It provides production-ready endpoints for authentication, task management, gamification, notifications, configuration, and n8n workflow automation.

## Prerequisites
- Python 3.10+
- (Optional) virtual environment

## Installation
```bash
cd backend
python -m venv .venv
. .venv/Scripts/activate  # Windows
source .venv/bin/activate # macOS/Linux
pip install -r requirements.txt
```

## Environment configuration
Create a `.env` file in `backend/` when you need to override defaults. Available settings (all prefixed with `VEE_`):

| Variable | Default | Description |
| --- | --- | --- |
| `VEE_DATABASE_URL` | `sqlite:///./vee_task_manager.db` | SQL database connection string. |
| `VEE_JWT_SECRET_KEY` | `change_me` | Secret for access tokens. Change in production. |
| `VEE_JWT_REFRESH_SECRET_KEY` | `change_me_refresh` | Secret for refresh tokens. |
| `VEE_ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | Access token lifetime. |
| `VEE_REFRESH_TOKEN_EXPIRE_MINUTES` | `10080` | Refresh token lifetime. |
| `VEE_ENABLE_N8N_FORWARDING` | `False` | When `True`, outbound events are sent to n8n. |
| `VEE_N8N_WEBHOOK_URL` | _unset_ | n8n webhook endpoint to receive events. |
| `VEE_CORS_ALLOW_ORIGINS` | `["http://localhost:5173"]` | Comma-separated list of allowed origins. |
| `VEE_MAX_REQUEST_BODY_MB` | `250` | Global request body limit applied before route processing. |
| `VEE_MINIO_ENDPOINT` | `https://zbucket.urlfactory.website` | Object-storage endpoint for private/public media when MinIO storage is enabled. |
| `VEE_MINIO_ACCESS_KEY` | _unset_ | Object-storage access key. Required for MinIO-backed storage. |
| `VEE_MINIO_SECRET_KEY` | _unset_ | Object-storage secret key. Required for MinIO-backed storage. |
| `VEE_MEDIA_PRESIGN_RATE_REDIS_URL` | _unset_ | Optional Redis URL for shared media presign rate limiting. |
| `VEE_VAPID_PUBLIC_KEY` / `VEE_VAPID_PRIVATE_KEY` / `VEE_VAPID_SUBJECT` | _unset_ | Web Push credentials when push delivery is enabled. |

## Running the API
```bash
uvicorn app.main:app --reload
```
The API will be available at `http://127.0.0.1:8000`. Automatic docs are served at `http://127.0.0.1:8000/docs`.

A quick health check is available at `GET /health`.

## Seed data
On first launch the database is pre-populated with:
- Departments, kanban columns, achievements, rewards, SMTP/API config defaults.
- Five sample users:
  - Owner: `owner@example.com`
  - Admin: `admin@example.com`
  - Users: `user@example.com`, `diana@example.com`, `ethan@example.com`
- Sample tasks, comments, and notifications mirroring the original mock API.

_All seed accounts share the temporary password `password123`. Update their passwords immediately in any persistent environment._

## n8n integration
- Outgoing events (`task.created`, `task.updated`, `comment.created`, `reward.claimed`, etc.) trigger background POSTs to the configured n8n webhook when `VEE_ENABLE_N8N_FORWARDING=true` and `VEE_N8N_WEBHOOK_URL` is set.
- Administrative endpoints under `/integrations/n8n` allow you to inspect the current configuration and fire ad-hoc events to n8n.

Example request to send a custom event:
```bash
curl -X POST http://127.0.0.1:8000/integrations/n8n/trigger \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"event":"custom.sync","payload":{"foo":"bar"}}'
```

## Key endpoints snapshot
- `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/me`
- `/users`, `/users/me`, `/users/{id}` with password management helpers
- `/tasks` CRUD with subtasks, dependencies, gamification hooks, and n8n events
- `/comments` for task discussions
- `/rewards` CRUD + claiming, `/achievements`
- `/notifications` (list, mark as read)
- `/config/smtp`, `/config/api`

Refer to the interactive Swagger UI for the full contract.
