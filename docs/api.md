# ZeaPlay API Quick Reference

## Auth

GET /auth/presence-token
Response:
{
  "access_token": "string",
  "token_type": "bearer",
  "expires_in": 3600
}

POST /auth/login
Response:
{
  "token": {
    "access_token": "string",
    "refresh_token": "string"
  },
  "user": {
    "id": "string",
    "email": "string",
    "role": "ADMIN"
  }
}

## Tasks

GET /tasks
Response:
[
  {
    "id": "string",
    "title": "string",
    "status": "TODO",
    "assigned_to_id": "string",
    "created_at": "2024-01-01T00:00:00Z"
  }
]

POST /tasks
Response:
[
  {
    "id": "string",
    "title": "string",
    "status": "TODO"
  }
]

PATCH /tasks/{task_id}
Response:
{
  "id": "string",
  "title": "string",
  "status": "IN_PROGRESS"
}

## Tickets

GET /tickets
Response:
{
  "data": [
    {
      "id": "string",
      "title": "string",
      "status": "OPEN",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}

POST /tickets
Response:
{
  "id": "string",
  "title": "string",
  "status": "OPEN"
}

PATCH /tickets/{ticket_id}
Response:
{
  "id": "string",
  "title": "string",
  "status": "RESOLVED"
}

## Presence (Socket.IO)

Events:
- user_online { "userId": "string" }
- user_offline { "userId": "string" }
- presence:online { "userId": "string" }
- presence:offline { "userId": "string" }

Client emits:
- presence:get (ack -> { ok: true, users: [] })
- presence:ping
