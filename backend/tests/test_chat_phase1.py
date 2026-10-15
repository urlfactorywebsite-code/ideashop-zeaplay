import uuid
import sys
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.database import Base, get_db
from backend.app.dependencies import get_current_active_user
from backend.app.config import get_settings
from backend.app.main import app
from backend.app.ws import chat as chat_ws
from backend.app.models import (
    AvatarAsset,
    ChatConversation,
    ChatConversationTypeEnum,
    ChatMessage,
    ChatMemberRoleEnum,
    ChatParticipant,
    Department,
    Notification,
    NotificationTypeEnum,
    MessageAttachment,
    MessageMention,
    MessageReaction,
    PinnedMessage,
    NotificationPreference,
    RoleEnum,
    User,
    UserStatusEnum,
)
from backend.app.routers import comments as comments_router
from backend.app.routers.comments import _bridge_comment_mentions_to_chat


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_chat.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
CHAT_TEST_TABLES = [
    Department.__table__,
    AvatarAsset.__table__,
    User.__table__,
    ChatConversation.__table__,
    ChatParticipant.__table__,
    ChatMessage.__table__,
    MessageReaction.__table__,
    MessageAttachment.__table__,
    PinnedMessage.__table__,
    MessageMention.__table__,
    Notification.__table__,
    NotificationPreference.__table__,
]

Base.metadata.create_all(bind=engine, tables=CHAT_TEST_TABLES)

TENANT_ID = uuid.uuid4()
OTHER_TENANT_ID = uuid.uuid4()


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def make_user(id_: str, email: str, tenant_id=TENANT_ID, role=RoleEnum.USER) -> User:
    return User(
        id=id_,
        tenant_id=tenant_id,
        name=email.split("@")[0].title(),
        email=email,
        hashed_password="hashed",
        role=role,
        status=UserStatusEnum.ACTIVE,
        points=0,
        tasks_created=0,
        tasks_completed=0,
        clarity_scores=[],
        claimed_reward_ids=[],
        unlocked_achievement_ids=[],
    )


def make_token(user_id: str, tenant_id=TENANT_ID) -> str:
    settings = get_settings()
    return jwt.encode(
        {
            "sub": user_id,
            "user_id": user_id,
            "tenant_id": str(tenant_id),
            "token_type": "access",
            "roles": ["user"],
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def make_websocket_ticket(user_id: str, tenant_id=TENANT_ID, scope: str = "chat", expired: bool = False) -> str:
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + (-timedelta(minutes=1) if expired else timedelta(minutes=2))
    return jwt.encode(
        {
            "sub": user_id,
            "user_id": user_id,
            "tenant_id": str(tenant_id),
            "token_type": "access",
            "purpose": "websocket",
            "scopes": ["websocket", f"websocket:{scope}"],
            "roles": ["user"],
            "exp": expires_at,
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def receive_until(ws, event_type: str, attempts: int = 8):
    for _ in range(attempts):
        payload = ws.receive_json()
        if payload.get("type") == event_type:
            return payload
    raise AssertionError(f"Did not receive {event_type}")


@pytest.fixture()
def db():
    Base.metadata.drop_all(bind=engine, tables=list(reversed(CHAT_TEST_TABLES)))
    Base.metadata.create_all(bind=engine, tables=CHAT_TEST_TABLES)
    session = TestingSessionLocal()
    session.add(Department(id="dept-1", name="Engineering"))
    session.add_all(
        [
            make_user("user-a", "alpha@example.com", role=RoleEnum.ADMIN),
            make_user("user-b", "bravo@example.com"),
            make_user("user-c", "charlie@example.com"),
            make_user("user-x", "external@example.com", tenant_id=OTHER_TENANT_ID),
        ]
    )
    session.commit()
    yield session
    session.close()


@pytest.fixture()
def client(db, monkeypatch):
    def current_user():
        return db.get(User, "user-a")

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_active_user] = current_user
    monkeypatch.setattr(chat_ws, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(chat_ws, "manager", chat_ws.ChatConnectionManager())
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_create_direct_message_and_prevent_duplicate(client):
    first = client.post("/api/chat/direct", json={"user_id": "user-b"})
    assert first.status_code == 201
    second = client.post("/api/chat/direct", json={"user_id": "user-b"})
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["type"] == "DIRECT"
    assert len(first.json()["members"]) == 2


def test_direct_lookup_ignores_invalid_multi_member_direct_rows(db, client):
    contaminated = ChatConversation(
        tenant_id=TENANT_ID,
        type=ChatConversationTypeEnum.DIRECT,
        is_private=True,
        created_by_id="user-a",
    )
    db.add(contaminated)
    db.flush()
    db.add_all(
        [
            ChatParticipant(conversation_id=contaminated.id, user_id="user-a", role=ChatMemberRoleEnum.OWNER),
            ChatParticipant(conversation_id=contaminated.id, user_id="user-b", role=ChatMemberRoleEnum.MEMBER),
            ChatParticipant(conversation_id=contaminated.id, user_id="user-c", role=ChatMemberRoleEnum.MEMBER),
        ]
    )
    db.commit()

    response = client.post("/api/chat/direct", json={"user_id": "user-b"})
    assert response.status_code == 201
    assert response.json()["id"] != contaminated.id
    assert len(response.json()["members"]) == 2


def test_create_group_and_space(client):
    group = client.post("/api/chat/conversations", json={"type": "GROUP", "name": "Release Crew", "member_ids": ["user-b"], "is_private": True})
    assert group.status_code == 201
    assert group.json()["type"] == "GROUP"
    assert group.json()["is_private"] is True

    space = client.post("/api/chat/conversations", json={"type": "SPACE", "name": "Engineering", "team_id": "Engineering", "member_ids": ["user-c"]})
    assert space.status_code == 201
    assert space.json()["type"] == "SPACE"


def test_space_requires_non_blank_name(client):
    response = client.post("/api/chat/conversations", json={"type": "SPACE", "name": "   "})
    assert response.status_code == 422


def test_privileged_user_can_start_cross_tenant_chat(client):
    direct = client.post("/api/chat/direct", json={"user_id": "user-x"})
    assert direct.status_code == 201
    assert direct.json()["type"] == "DIRECT"
    assert {member["user_id"] for member in direct.json()["members"]} == {"user-a", "user-x"}

    group = client.post("/api/chat/conversations", json={"type": "GROUP", "name": "Cross Tenant Group", "member_ids": ["user-x"]})
    assert group.status_code == 201
    assert {member["user_id"] for member in group.json()["members"]} == {"user-a", "user-x"}


def test_regular_user_cross_tenant_member_rejected(db, client):
    db.get(User, "user-a").role = RoleEnum.USER
    db.commit()

    direct = client.post("/api/chat/direct", json={"user_id": "user-x"})
    assert direct.status_code == 404

    response = client.post("/api/chat/conversations", json={"type": "GROUP", "name": "Bad Group", "member_ids": ["user-x"]})
    assert response.status_code == 422


def test_chat_directory_lists_active_visible_users_and_excludes_current_and_deactivated(db, client):
    db.get(User, "user-c").status = UserStatusEnum.DEACTIVATED
    db.commit()

    response = client.get("/api/chat/users")

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["id"] for item in items] == ["user-b", "user-x"]
    assert items[0]["presence"] == "OFFLINE"
    assert items[0]["existing_conversation_id"] is None


def test_regular_user_chat_directory_stays_tenant_scoped(db, client):
    db.get(User, "user-a").role = RoleEnum.USER
    db.commit()

    response = client.get("/api/chat/users")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == ["user-b", "user-c"]


def test_chat_directory_search_does_not_return_deactivated_accounts(db, client):
    db.get(User, "user-c").status = UserStatusEnum.DEACTIVATED
    db.commit()

    response = client.get("/api/chat/users", params={"search": "charlie"})

    assert response.status_code == 200
    assert response.json()["items"] == []


def test_chat_directory_reports_existing_direct_conversation_and_unread_count(db, client):
    conversation = client.post("/api/chat/direct", json={"user_id": "user-b"}).json()
    db.add(ChatMessage(conversation_id=conversation["id"], sender_id="user-b", content="Can you check this API?"))
    db.commit()

    response = client.get("/api/chat/users", params={"search": "bravo"})

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["id"] == "user-b"
    assert item["existing_conversation_id"] == conversation["id"]
    assert item["unread_count"] == 1
    assert item["latest_message_preview"] == "Can you check this API?"


def test_rest_message_send_broadcasts_to_joined_websocket(client):
    conversation = client.post("/api/chat/direct", json={"user_id": "user-b"}).json()
    token = make_token("user-b")

    with client.websocket_connect(f"/api/ws/chat?token={token}") as ws:
        ws.send_json({"type": "chat:join", "payload": {"conversation_id": conversation["id"]}})
        receive_until(ws, "chat:joined")

        response = client.post(
            f"/api/chat/conversations/{conversation['id']}/messages",
            json={"content": "Live without refresh", "client_id": "client-rest-1"},
        )

        assert response.status_code == 201
        event = receive_until(ws, "message:new")
        assert event["payload"]["conversation_id"] == conversation["id"]
        assert event["payload"]["client_id"] == "client-rest-1"
        assert event["payload"]["message"]["content"] == "Live without refresh"


def test_deactivated_user_cannot_be_new_direct_group_or_space_member(db, client):
    db.get(User, "user-c").status = UserStatusEnum.DEACTIVATED
    db.commit()

    direct = client.post("/api/chat/direct", json={"user_id": "user-c"})
    assert direct.status_code == 404

    group = client.post("/api/chat/conversations", json={"type": "GROUP", "name": "Bad Group", "member_ids": ["user-c"]})
    assert group.status_code == 422

    space = client.post("/api/chat/conversations", json={"type": "SPACE", "name": "Bad Space", "member_ids": ["user-c"]})
    assert space.status_code == 422


def test_existing_direct_history_with_deactivated_user_is_preserved_but_sending_is_rejected(db, client):
    conversation = client.post("/api/chat/direct", json={"user_id": "user-b"}).json()
    sent = client.post(f"/api/chat/conversations/{conversation['id']}/messages", json={"content": "Before deactivation"})
    assert sent.status_code == 201

    db.get(User, "user-b").status = UserStatusEnum.DEACTIVATED
    db.commit()

    history = client.get(f"/api/chat/conversations/{conversation['id']}/messages")
    assert history.status_code == 200
    assert history.json()["items"][0]["content"] == "Before deactivation"

    blocked = client.post(f"/api/chat/conversations/{conversation['id']}/messages", json={"content": "After deactivation"})
    assert blocked.status_code == 409


def test_mentions_skip_deactivated_conversation_members(db, client):
    conversation = client.post(
        "/api/chat/conversations",
        json={"type": "GROUP", "name": "Mentions", "member_ids": ["user-b"], "is_private": True},
    ).json()
    db.get(User, "user-b").status = UserStatusEnum.DEACTIVATED
    db.commit()

    response = client.post(
        f"/api/chat/conversations/{conversation['id']}/messages",
        json={"content": "@bravo please check"},
    )

    assert response.status_code == 201
    assert response.json()["mentions"] == []
    assert db.query(MessageMention).count() == 0


def test_task_comment_mentions_create_direct_chat_inbox_message(db, monkeypatch):
    def fake_create_notification(db, **kwargs):
        notification = Notification(
            user_id=kwargs["user_id"],
            type=kwargs["notification_type"],
            title=kwargs.get("title"),
            body=kwargs.get("body"),
            message=kwargs["message"],
            entity_type=kwargs.get("entity_type"),
            entity_id=kwargs.get("entity_id"),
            deep_link=kwargs.get("deep_link"),
            related_task_id=kwargs.get("related_task_id"),
            related_chat_id=kwargs.get("related_chat_id"),
        )
        db.add(notification)
        return notification

    monkeypatch.setattr(comments_router.notification_service, "create_notification", fake_create_notification)

    task = SimpleNamespace(id="task-mention-1", title="Mention Bridge")
    comment = SimpleNamespace(content="@bravo can you check this task comment?")
    actor = db.get(User, "user-a")

    _bridge_comment_mentions_to_chat(db, task=task, comment=comment, actor=actor)
    db.commit()

    conversation = db.query(ChatConversation).filter(ChatConversation.type == ChatConversationTypeEnum.DIRECT).one()
    assert {member.user_id for member in conversation.participants} == {"user-a", "user-b"}

    message = db.query(ChatMessage).filter(ChatMessage.conversation_id == conversation.id).one()
    assert message.sender_id == "user-a"
    assert "mentioned you in a task comment" in message.content
    assert "Open task: /tasks/task-mention-1" in message.content

    mention = db.query(MessageMention).one()
    assert mention.message_id == message.id
    assert mention.mentioned_user_id == "user-b"

    notification = db.query(Notification).one()
    assert notification.type == NotificationTypeEnum.CHAT_MESSAGE
    assert notification.related_chat_id == conversation.id
    assert notification.related_task_id == task.id


def test_message_persistence_edit_delete_and_pagination(client):
    conversation = client.post("/api/chat/direct", json={"user_id": "user-b"}).json()
    conversation_id = conversation["id"]

    for index in range(3):
        response = client.post(f"/api/chat/conversations/{conversation_id}/messages", json={"content": f"Message {index}"})
        assert response.status_code == 201

    page = client.get(f"/api/chat/conversations/{conversation_id}/messages", params={"limit": 2})
    assert page.status_code == 200
    payload = page.json()
    assert len(payload["items"]) == 2
    assert payload["has_more"] is True

    older = client.get(f"/api/chat/conversations/{conversation_id}/messages", params={"limit": 2, "cursor": payload["next_cursor"]})
    assert older.status_code == 200
    assert len(older.json()["items"]) == 1

    message_id = payload["items"][-1]["id"]
    edited = client.patch(f"/api/chat/messages/{message_id}", json={"content": "Edited"})
    assert edited.status_code == 200
    assert edited.json()["content"] == "Edited"
    assert edited.json()["edited_at"] is not None

    deleted = client.delete(f"/api/chat/messages/{message_id}")
    assert deleted.status_code == 204

    edit_deleted = client.patch(f"/api/chat/messages/{message_id}", json={"content": "Too late"})
    assert edit_deleted.status_code == 409

    after_delete = client.get(f"/api/chat/conversations/{conversation_id}/messages")
    assert after_delete.status_code == 200
    deleted_item = next(item for item in after_delete.json()["items"] if item["id"] == message_id)
    assert deleted_item["content"] == ""
    assert deleted_item["deleted_at"] is not None


def test_member_management(client):
    conversation = client.post(
        "/api/chat/conversations",
        json={"type": "GROUP", "name": "Operations", "member_ids": ["user-b"], "is_private": True},
    ).json()

    added = client.post(
        f"/api/chat/conversations/{conversation['id']}/members",
        json={"user_ids": ["user-c"], "role": "MEMBER"},
    )
    assert added.status_code == 201
    assert added.json()[0]["user_id"] == "user-c"

    members = client.get(f"/api/chat/conversations/{conversation['id']}/members")
    assert members.status_code == 200
    assert {member["user_id"] for member in members.json()} == {"user-a", "user-b", "user-c"}

    removed = client.delete(f"/api/chat/conversations/{conversation['id']}/members/user-c")
    assert removed.status_code == 204


def test_read_markers_reactions_and_attachment_metadata(client):
    conversation = client.post("/api/chat/direct", json={"user_id": "user-b"}).json()
    message = client.post(
        f"/api/chat/conversations/{conversation['id']}/messages",
        json={"content": "Launch packet"},
    ).json()

    read = client.post(
        f"/api/chat/conversations/{conversation['id']}/read",
        json={"last_read_message_id": message["id"]},
    )
    assert read.status_code == 200
    assert read.json()["last_read_message_id"] == message["id"]

    reacted = client.post(f"/api/chat/messages/{message['id']}/reactions", json={"emoji": "ship"})
    assert reacted.status_code == 200
    assert reacted.json()["reactions"][0]["emoji"] == "ship"
    assert reacted.json()["reactions"][0]["user_id"] == "user-a"

    duplicate_reaction = client.post(f"/api/chat/messages/{message['id']}/reactions", json={"emoji": "ship"})
    assert duplicate_reaction.status_code == 200
    assert len(duplicate_reaction.json()["reactions"]) == 1

    attachment = client.post(
        f"/api/chat/messages/{message['id']}/attachments",
        json={
            "file_name": "launch.pdf",
            "original_file_name": "Launch Plan.pdf",
            "mime_type": "application/pdf",
            "file_size": 128,
            "storage_key": "chat/user-a/launch.pdf",
            "url": "https://example.test/launch.pdf",
        },
    )
    assert attachment.status_code == 201
    assert attachment.json()["message_id"] == message["id"]
    assert attachment.json()["storage_key"] == "chat/user-a/launch.pdf"

    removed = client.delete(f"/api/chat/messages/{message['id']}/reactions/ship")
    assert removed.status_code == 200
    assert removed.json()["reactions"] == []


def test_search_pin_member_update_and_upload(client):
    conversation = client.post(
        "/api/chat/conversations",
        json={"type": "GROUP", "name": "Searchable", "member_ids": ["user-b"], "is_private": True},
    ).json()
    message = client.post(
        f"/api/chat/conversations/{conversation['id']}/messages",
        json={"content": "Quarterly rollout plan"},
    ).json()

    search = client.get("/api/chat/messages/search", params={"q": "rollout", "conversation_id": conversation["id"]})
    assert search.status_code == 200
    assert search.json()["items"][0]["message"]["id"] == message["id"]

    pin = client.post(f"/api/chat/conversations/{conversation['id']}/messages/{message['id']}/pin")
    assert pin.status_code == 200
    assert pin.json()["message_id"] == message["id"]

    pins = client.get(f"/api/chat/conversations/{conversation['id']}/pins")
    assert pins.status_code == 200
    assert len(pins.json()) == 1

    updated_member = client.patch(
        f"/api/chat/conversations/{conversation['id']}/members/user-b",
        json={"role": "ADMIN"},
    )
    assert updated_member.status_code == 200
    assert updated_member.json()["role"] == "ADMIN"

    upload = client.post(
        f"/api/chat/conversations/{conversation['id']}/attachments",
        files={"file": ("notes.txt", BytesIO(b"hello"), "text/plain")},
    )
    assert upload.status_code == 200
    assert upload.json()["original_file_name"] == "notes.txt"


def test_websocket_auth_join_send_typing_read_and_reaction(client):
    conversation = client.post("/api/chat/direct", json={"user_id": "user-b"}).json()
    token = make_token("user-a")

    with client.websocket_connect(f"/api/ws/chat?token={token}") as ws:
        receive_until(ws, "presence:changed")
        ws.send_json({"type": "chat:join", "payload": {"conversation_id": conversation["id"]}})
        receive_until(ws, "chat:joined")

        ws.send_json({"type": "typing:start", "payload": {"conversation_id": conversation["id"]}})
        typing = receive_until(ws, "typing:started")
        assert typing["payload"]["user_id"] == "user-a"

        ws.send_json(
            {
                "type": "message:send",
                "payload": {"conversation_id": conversation["id"], "content": "Realtime hello", "client_id": "client-1"},
            }
        )
        created = receive_until(ws, "message:new")
        assert created["payload"]["client_id"] == "client-1"
        message_id = created["payload"]["message"]["id"]

        ws.send_json({"type": "reaction:add", "payload": {"message_id": message_id, "emoji": "ok"}})
        reacted = receive_until(ws, "reaction:added")
        assert reacted["payload"]["message"]["reactions"][0]["emoji"] == "ok"

        ws.send_json({"type": "message:read", "payload": {"conversation_id": conversation["id"], "last_read_message_id": message_id}})
        read = receive_until(ws, "message:read")
        assert read["payload"]["member"]["last_read_message_id"] == message_id


def test_websocket_two_sessions_receive_once_and_client_id_is_idempotent(client, db):
    conversation = client.post("/api/chat/direct", json={"user_id": "user-b"}).json()
    token_a = make_token("user-a")
    token_b = make_token("user-b")

    with client.websocket_connect(f"/api/ws/chat?token={token_a}") as ws_a:
        receive_until(ws_a, "presence:changed")
        ws_a.send_json({"type": "chat:join", "payload": {"conversation_id": conversation["id"]}})
        receive_until(ws_a, "chat:joined")

        with client.websocket_connect(f"/api/ws/chat?token={token_b}") as ws_b:
            receive_until(ws_b, "presence:changed")
            ws_b.send_json({"type": "chat:join", "payload": {"conversation_id": conversation["id"]}})
            receive_until(ws_b, "chat:joined")

            ws_a.send_json(
                {
                    "type": "message:send",
                    "payload": {"conversation_id": conversation["id"], "content": "Exactly once", "client_id": "client-once"},
                }
            )
            first_a = receive_until(ws_a, "message:new")
            first_b = receive_until(ws_b, "message:new")
            assert first_a["payload"]["message"]["id"] == first_b["payload"]["message"]["id"]

            ws_a.send_json(
                {
                    "type": "message:send",
                    "payload": {"conversation_id": conversation["id"], "content": "Exactly once", "client_id": "client-once"},
                }
            )
            duplicate_ack = receive_until(ws_a, "message:new")
            assert duplicate_ack["payload"]["message"]["id"] == first_a["payload"]["message"]["id"]

    persisted = db.query(ChatMessage).filter(ChatMessage.client_id == "client-once").all()
    assert len(persisted) == 1


def test_stale_room_membership_is_pruned_after_member_removal(client):
    conversation = client.post(
        "/api/chat/conversations",
        json={"type": "GROUP", "name": "Removal", "member_ids": ["user-b"], "is_private": True},
    ).json()
    token_b = make_token("user-b")

    with client.websocket_connect(f"/api/ws/chat?token={token_b}") as ws_b:
        receive_until(ws_b, "presence:changed")
        ws_b.send_json({"type": "chat:join", "payload": {"conversation_id": conversation["id"]}})
        receive_until(ws_b, "chat:joined")
        assert chat_ws.manager._conversations[conversation["id"]]

        removed = client.delete(f"/api/chat/conversations/{conversation['id']}/members/user-b")
        assert removed.status_code == 204

        sent = client.post(
            f"/api/chat/conversations/{conversation['id']}/messages",
            json={"content": "After removal"},
        )
        assert sent.status_code == 201

        import asyncio

        asyncio.run(
            chat_ws.manager.broadcast_conversation(
                conversation["id"],
                "message:new",
                {"conversation_id": conversation["id"], "message": sent.json()},
            )
        )
        assert ws_b not in chat_ws.manager._conversations.get(conversation["id"], set())


def test_upload_rejects_extension_mime_content_mismatch(client):
    conversation = client.post("/api/chat/direct", json={"user_id": "user-b"}).json()
    upload = client.post(
        f"/api/chat/conversations/{conversation['id']}/attachments",
        files={"file": ("fake.png", BytesIO(b"not really a png"), "image/png")},
    )
    assert upload.status_code == 400


def test_websocket_rejects_unauthorized_join(client):
    conversation = client.post(
        "/api/chat/conversations",
        json={"type": "GROUP", "name": "Private", "member_ids": ["user-b"], "is_private": True},
    ).json()
    token = make_token("user-c")

    with client.websocket_connect(f"/api/ws/chat?token={token}") as ws:
        receive_until(ws, "presence:changed")
        ws.send_json({"type": "chat:join", "payload": {"conversation_id": conversation["id"]}})
        error = receive_until(ws, "error")
        assert error["payload"]["code"] == "event_failed"


def test_unauthorized_non_member_cannot_read(db, client):
    conversation = client.post("/api/chat/conversations", json={"type": "GROUP", "name": "Private", "member_ids": ["user-b"], "is_private": True}).json()

    def current_user():
        return db.get(User, "user-c")

    app.dependency_overrides[get_current_active_user] = current_user
    response = client.get(f"/api/chat/conversations/{conversation['id']}/messages")
    assert response.status_code == 403


def test_models_exist_for_phase1_schema():
    assert ChatConversation.__tablename__ == "chat_conversations"
    assert ChatParticipant.__tablename__ == "chat_participants"
    assert ChatMessage.__tablename__ == "chat_messages"


def test_websocket_origin_allowlist_allows_trusted_origin(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "websocket_require_origin", True)
    monkeypatch.setattr(settings, "websocket_trusted_origins", ["https://trusted.example"])
    token = make_websocket_ticket("user-b")

    with client.websocket_connect(
        f"/api/ws/chat?token={token}",
        headers={"origin": "https://trusted.example"},
    ) as ws:
        event = receive_until(ws, "presence:changed")
        assert event["type"] == "presence:changed"


def test_websocket_origin_allowlist_rejects_untrusted_origin(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "websocket_require_origin", True)
    monkeypatch.setattr(settings, "websocket_trusted_origins", ["https://trusted.example"])
    token = make_websocket_ticket("user-b")

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            f"/api/ws/chat?token={token}",
            headers={"origin": "https://evil.example"},
        ) as ws:
            ws.receive_json()


def test_websocket_origin_allowlist_rejects_missing_origin_when_required(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "websocket_require_origin", True)
    monkeypatch.setattr(settings, "websocket_trusted_origins", ["https://trusted.example"])
    token = make_websocket_ticket("user-b")

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/ws/chat?token={token}") as ws:
            ws.receive_json()


def test_websocket_requires_short_lived_ticket_when_enabled(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "websocket_require_ticket", True)
    access_token = make_token("user-b")

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/ws/chat?token={access_token}") as ws:
            ws.receive_json()

    ticket = make_websocket_ticket("user-b")
    with client.websocket_connect(f"/api/ws/chat?token={ticket}") as ws:
        event = receive_until(ws, "presence:changed")
        assert event["type"] == "presence:changed"


def test_websocket_rejects_ticket_for_wrong_scope_when_enabled(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "websocket_require_ticket", True)
    ticket = make_websocket_ticket("user-b", scope="tasks")

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/ws/chat?token={ticket}") as ws:
            ws.receive_json()


def test_websocket_rejects_expired_ticket(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "websocket_require_ticket", True)
    ticket = make_websocket_ticket("user-b", expired=True)

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/ws/chat?token={ticket}") as ws:
            ws.receive_json()


def test_websocket_connection_cleanup_after_disconnect(client):
    token = make_websocket_ticket("user-b")
    with client.websocket_connect(f"/api/ws/chat?token={token}") as ws:
        receive_until(ws, "presence:changed")
    assert chat_ws.manager.snapshot()["sockets"] == 0
