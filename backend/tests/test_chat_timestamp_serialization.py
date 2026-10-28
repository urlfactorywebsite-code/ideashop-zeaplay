"""Chat read timestamps are unambiguous UTC without changing stored values.

These tests import schemas only. Run with VEE_BOOTSTRAP_SCHEMA=false to avoid
the database module's optional import-time schema bootstrap.
"""

from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace

from fastapi.encoders import jsonable_encoder
import pytest

from backend.app import schemas


UTC_TIME = datetime(2026, 10, 28, 4, 55, tzinfo=timezone.utc)
INDIA = timezone(timedelta(hours=5, minutes=30))
JSON_TIME = "2026-10-28T04:55:00Z"


def message_data(timestamp):
    return {
        "id": "message-1",
        "conversation_id": "conversation-1",
        "sender_id": "user-1",
        "sender_name": "Alice",
        "sender_role": "user",
        "message_type": "TEXT",
        "content": "Hello",
        "created_at": timestamp,
        "updated_at": timestamp,
        "edited_at": timestamp,
        "deleted_at": timestamp,
    }


def member_data(timestamp):
    return {
        "id": "member-1",
        "conversation_id": "conversation-1",
        "user_id": "user-1",
        "name": "Alice",
        "email": "alice@example.com",
        "app_role": "user",
        "role": "MEMBER",
        "joined_at": timestamp,
        "last_read_at": timestamp,
    }


def reaction_data(timestamp):
    return {
        "id": "reaction-1", "message_id": "message-1", "user_id": "user-1",
        "emoji": "ok", "created_at": timestamp,
    }


def attachment_data(timestamp):
    return {
        "id": "attachment-1", "message_id": "message-1",
        "file_name": "image.png", "original_file_name": "image.png",
        "mime_type": "image/png", "file_size": 1, "storage_key": "image.png",
        "created_at": timestamp,
    }


def conversation_data(timestamp):
    return {
        "id": "conversation-1", "tenant_id": "tenant-1", "type": "DIRECT",
        "created_by_id": "user-1", "created_at": timestamp,
        "updated_at": timestamp, "last_message_at": timestamp,
    }


READ_CASES = [
    (schemas.ChatMemberRead, member_data, ("joined_at", "last_read_at")),
    (schemas.ChatDirectoryUserRead,
     lambda timestamp: {"id": "user-1", "name": "Alice", "email": "alice@example.com",
                        "last_seen_at": timestamp, "last_message_at": timestamp},
     ("last_seen_at", "last_message_at")),
    (schemas.ChatReactionRead, reaction_data, ("created_at",)),
    (schemas.ChatAttachmentRead, attachment_data, ("created_at",)),
    (schemas.ChatMessageRead, message_data, ("created_at", "updated_at", "edited_at", "deleted_at")),
    (schemas.ChatPinnedMessageRead,
     lambda timestamp: {"id": "pin-1", "conversation_id": "conversation-1",
                        "message_id": "message-1", "pinned_by": "user-1",
                        "created_at": timestamp, "message": message_data(timestamp)},
     ("created_at",)),
    (schemas.ChatConversationRead, conversation_data, ("created_at", "updated_at", "last_message_at")),
]


@pytest.mark.parametrize("schema,make_data,fields", READ_CASES, ids=lambda value: getattr(value, "__name__", None))
@pytest.mark.parametrize("timestamp", [
    UTC_TIME.replace(tzinfo=None),
    "2026-10-28T04:55:00",
    UTC_TIME,
    UTC_TIME.astimezone(INDIA),
    "2026-10-28T10:25:00+05:30",
], ids=["naive-datetime", "naive-iso", "utc", "offset-datetime", "offset-iso"])
def test_chat_read_timestamps_preserve_instant_and_emit_utc(schema, make_data, fields, timestamp):
    output = schema.model_validate(make_data(timestamp))
    encoded = output.model_dump(mode="json")

    for field in fields:
        assert getattr(output, field) == UTC_TIME
        assert getattr(output, field).tzinfo == timezone.utc
        assert encoded[field] == JSON_TIME


@pytest.mark.parametrize("schema,make_data,fields", [
    (schemas.ChatMemberRead, member_data, ("last_read_at",)),
    (schemas.ChatDirectoryUserRead, READ_CASES[1][1], ("last_seen_at", "last_message_at")),
    (schemas.ChatMessageRead, message_data, ("edited_at", "deleted_at")),
    (schemas.ChatConversationRead, conversation_data, ("last_message_at",)),
])
def test_optional_chat_timestamps_remain_null(schema, make_data, fields):
    data = make_data(UTC_TIME.replace(tzinfo=None))
    data.update({field: None for field in fields})
    encoded = schema.model_validate(data).model_dump(mode="json")
    assert all(encoded[field] is None for field in fields)


def test_nested_rest_and_websocket_message_payloads_use_the_same_utc_timestamps():
    naive = UTC_TIME.replace(tzinfo=None)
    source_data = message_data(naive)
    source_data["reactions"] = [reaction_data(naive)]
    source_data["attachments"] = [attachment_data(naive)]
    stored_message = SimpleNamespace(**source_data)
    message = schemas.ChatMessageRead.model_validate(stored_message)

    # REST encoding and the chat WebSocket's model_dump(mode="json") agree.
    rest_payload = jsonable_encoder(message)
    websocket_payload = message.model_dump(mode="json")
    assert rest_payload == websocket_payload == json.loads(message.model_dump_json())
    assert rest_payload["created_at"] == JSON_TIME
    assert rest_payload["reactions"][0]["created_at"] == JSON_TIME
    assert rest_payload["attachments"][0]["created_at"] == JSON_TIME
    assert datetime.fromisoformat(rest_payload["created_at"]).astimezone(INDIA).strftime("%H:%M") == "10:25"
    assert stored_message.created_at == naive
    assert stored_message.created_at.tzinfo is None

    conversation = schemas.ChatConversationSummary.model_validate({
        **conversation_data(naive), "members": [member_data(naive)], "last_message": message,
    }).model_dump(mode="json")
    assert conversation["last_message_at"] == JSON_TIME
    assert conversation["members"][0]["joined_at"] == JSON_TIME
    assert conversation["last_message"]["created_at"] == JSON_TIME
