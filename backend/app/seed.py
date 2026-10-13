"""Database seeding utilities."""

import base64
import hashlib
import uuid
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Dict, List
from uuid import uuid4
import wave
import zipfile

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import selectinload

from . import models
from .auth import hash_password
from .config import get_settings
from .database import SessionLocal
from .storage.local import LocalAdapter
from .utils.image import probe_image_dimensions

settings = get_settings()

DEFAULT_TENANT_ID = uuid.uuid5(uuid.NAMESPACE_URL, "zea-play-tenant:seed")

DEPARTMENTS = [
    ("dept-1", "Data Team"),
    ("dept-2", "Lead Generation"),
    ("dept-3", "Marketing Team"),
    ("dept-4", "IT Support"),
    ("dept-5", "Sales Team"),
    ("dept-6", "Management"),
    ("dept-7", "Finance Team"),
    ("dept-8", "Hyper Automation"),
    ("dept-9", "ZeaCRM"),
    ("dept-10", "URL Factory"),
    ("dept-11", "Target Access Hub"),
    ("dept-12", "Client"),
    ("dept-13", "Other"),
]

KANBAN_COLUMNS = [
    ("WAITING_FOR_REQUIREMENT", "Battle Plan", 0),
    ("TODO", "Case Filed", 1),
    ("IN_PROGRESS", "In Progress", 2),
    ("BLOCKED", "Boss Encounter", 3),
    ("IN_REVIEW", "Tactical Shift", 4),
    ("ON_HOLD", "On Hold", 5),
    ("DONE", "Conquered", 6),
    ("FAILED", "Fallen", 7),
    ("GRAVEYARD", "Graveyard", 8),
]

ACHIEVEMENTS = [
    ("ach-1", "First Task Completed", "Complete your first task.", 25, "RocketLaunch"),
    ("ach-2", "Task Master", "Complete 5 tasks.", 50, "AcademicCap"),
    ("ach-3", "High Flyer", "Complete 3 High or Urgent priority tasks.", 75, "Bolt"),
    ("ach-4", "Urgent Responder", "Complete an Urgent priority task.", 100, "Fire"),
    ("ach-5", "Architect", "Create 5 tasks for your team.", 50, "Clipboard"),
    ("ach-6", "Clear Communicator", "Receive an average task clarity score of 4+.", 100, "Sparkles"),
]

BADGE_MIGRATIONS = {
    "ach-1": {
        "tier": "Bronze",
        "tier_group": "task-completion",
        "tier_order": 1,
        "rules": {
            "operator": "AND",
            "rules": [
                {
                    "entity": "task",
                    "event": "completed",
                    "conditions": {"assigned_to": "self"},
                    "count": {"type": ">=", "value": 1},
                    "time_window": None,
                    "negative": False,
                }
            ],
        },
    },
    "ach-2": {
        "tier": "Silver",
        "tier_group": "task-completion",
        "tier_order": 2,
        "rules": {
            "operator": "AND",
            "rules": [
                {
                    "entity": "task",
                    "event": "completed",
                    "conditions": {"assigned_to": "self"},
                    "count": {"type": ">=", "value": 5},
                    "time_window": None,
                    "negative": False,
                }
            ],
        },
    },
    "ach-3": {
        "tier": "Silver",
        "tier_group": "priority-response",
        "tier_order": 1,
        "rules": {
            "operator": "AND",
            "rules": [
                {
                    "entity": "task",
                    "event": "completed",
                    "conditions": {"assigned_to": "self", "priority": ["HIGH", "URGENT"]},
                    "count": {"type": ">=", "value": 3},
                    "time_window": None,
                    "negative": False,
                }
            ],
        },
    },
    "ach-4": {
        "tier": "Gold",
        "tier_group": "priority-response",
        "tier_order": 2,
        "rules": {
            "operator": "AND",
            "rules": [
                {
                    "entity": "task",
                    "event": "completed",
                    "conditions": {"assigned_to": "self", "priority": ["URGENT"]},
                    "count": {"type": ">=", "value": 1},
                    "time_window": None,
                    "negative": False,
                }
            ],
        },
    },
    "ach-5": {
        "tier": "Bronze",
        "tier_group": "builder",
        "tier_order": 1,
        "rules": {
            "operator": "AND",
            "rules": [
                {
                    "entity": "task",
                    "event": "created",
                    "conditions": {"created_by": "self"},
                    "count": {"type": ">=", "value": 5},
                    "time_window": None,
                    "negative": False,
                }
            ],
        },
    },
    "ach-6": {
        "tier": "Gold",
        "tier_group": "clarity",
        "tier_order": 1,
        "rules": {
            "operator": "AND",
            "rules": [
                {
                    "entity": "manual",
                    "event": "updated",
                    "conditions": {"created_by": "self"},
                    "count": {"type": ">=", "value": 3},
                    "time_window": None,
                    "negative": False,
                }
            ],
        },
    },
}

def _circle_icon(hex_color: str) -> str:
    color = hex_color.lstrip("#")
    return (
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E"
        f"%3Ccircle cx='32' cy='32' r='28' fill='%23{color}'/%3E%3C/svg%3E"
    )


REWARD_ICONS = [
    ("spark-gold", "Solar Spark", _circle_icon("F59E0B")),
    ("emerald-pulse", "Emerald Pulse", _circle_icon("10B981")),
    ("ocean-wave", "Ocean Wave", _circle_icon("0EA5E9")),
    ("violet-blaze", "Violet Blaze", _circle_icon("8B5CF6")),
    ("slate-focus", "Slate Focus", _circle_icon("64748B")),
]


REWARD_BLUEPRINTS = [
    {
        "id": "rew-1",
        "title": "Coffee Voucher",
        "description": "Get a free coffee on us!",
        "image_ref": "spark-gold",
        "xp_required": 400,
        "dept_whitelist": None,
        "auto_redeem": True,
        "expires_in_days": 45,
    },
    {
        "id": "rew-2",
        "title": "E-Commerce Gift Card",
        "description": "A gift card for your favorite online store.",
        "image_ref": "emerald-pulse",
        "xp_required": 900,
        "dept_whitelist": ["Sales Team", "Marketing Team"],
        "auto_redeem": False,
        "expires_in_days": 14,
    },
    {
        "id": "rew-3",
        "title": "Team Lunch",
        "description": "Enjoy a team lunch, sponsored by the company.",
        "image_ref": "ocean-wave",
        "xp_required": 1400,
        "dept_whitelist": ["Hyper Automation"],
        "auto_redeem": True,
        "expires_in_days": None,
    },
    {
        "id": "rew-4",
        "title": "One Day Off",
        "description": "Redeem your points for a paid day off.",
        "image_ref": "violet-blaze",
        "xp_required": 2200,
        "dept_whitelist": None,
        "auto_redeem": False,
        "expires_in_days": -5,
    },
    {
        "id": "rew-test",
        "title": "Testing Reward",
        "description": "This is a test reward for notifications.",
        "image_ref": "slate-focus",
        "xp_required": 50,
        "dept_whitelist": None,
        "auto_redeem": True,
        "expires_in_days": 7,
    },
]

DEFAULT_AVATARS = [
    ("avatar-default-01", "Sapphire Orbit", "avatars/library/default-avatar-01.svg"),
    ("avatar-default-02", "Aqua Horizon", "avatars/library/default-avatar-02.svg"),
    ("avatar-default-03", "Rose Echo", "avatars/library/default-avatar-03.svg"),
    ("avatar-default-04", "Verdant Pulse", "avatars/library/default-avatar-04.svg"),
    ("avatar-default-05", "Amber Dawn", "avatars/library/default-avatar-05.svg"),
    ("avatar-default-06", "Violet Comet", "avatars/library/default-avatar-06.svg"),
    ("avatar-default-07", "Crimson Nova", "avatars/library/default-avatar-07.svg"),
    ("avatar-default-08", "Azure Flare", "avatars/library/default-avatar-08.svg"),
    ("avatar-default-09", "Solar Ember", "avatars/library/default-avatar-09.svg"),
    ("avatar-default-10", "Nebula Bloom", "avatars/library/default-avatar-10.svg"),
]

SAMPLE_IMAGE_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=="
)


def _wav_placeholder() -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(8000)
        wav_file.writeframes(b"\x00\x00" * 800)
    return buffer.getvalue()


def _zip_placeholder() -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("README.txt", "Sample archive for Zea Play media library.")
    return buffer.getvalue()


def _image_placeholder() -> bytes:
    return SAMPLE_IMAGE_BYTES


def _video_placeholder() -> bytes:
    return b"Zea Play sample video placeholder"


def _document_placeholder() -> bytes:
    return b"Sample Zea Play documentation payload"


MEDIA_SAMPLE_BLUEPRINTS = [
    {
        "filename": "color-wave.png",
        "category": models.MediaCategoryEnum.IMAGE,
        "mime": "image/png",
        "owner_id": "user-1",
        "factory": _image_placeholder,
    },
    {
        "filename": "sprint-recap.mp4",
        "category": models.MediaCategoryEnum.VIDEO,
        "mime": "video/mp4",
        "owner_id": "user-2",
        "factory": _video_placeholder,
    },
    {
        "filename": "anthem-loop.wav",
        "category": models.MediaCategoryEnum.MUSIC,
        "mime": "audio/wav",
        "owner_id": "user-1",
        "factory": _wav_placeholder,
    },
    {
        "filename": "launch-brief.txt",
        "category": models.MediaCategoryEnum.DOCUMENT,
        "mime": "text/plain",
        "owner_id": "user-2",
        "factory": _document_placeholder,
    },
    {
        "filename": "creative-kit.zip",
        "category": models.MediaCategoryEnum.ZIP,
        "mime": "application/zip",
        "owner_id": "user-1",
        "factory": _zip_placeholder,
    },
]


def seed_media_items(session) -> None:
    inspector = inspect(session.bind)
    if "media_items" not in inspector.get_table_names():
        return
    if settings.storage_provider.lower() != "local":
        return

    media_root = Path(settings.media_root)
    adapter = LocalAdapter(str(media_root), settings.media_public_base)

    existing_pairs = {
        (owner_id, filename)
        for owner_id, filename in session.execute(
            select(models.MediaItem.owner_id, models.MediaItem.filename)
        ).all()
    }

    for blueprint in MEDIA_SAMPLE_BLUEPRINTS:
        key = (blueprint["owner_id"], blueprint["filename"])
        if key in existing_pairs:
            continue
        content = blueprint["factory"]()
        relative_path = Path("uploads") / "seed" / blueprint["category"].value / blueprint["filename"]
        stored = adapter.save(content, relative_path.as_posix(), content_type=blueprint["mime"])
        width = height = None
        if blueprint["category"] == models.MediaCategoryEnum.IMAGE:
            width, height = probe_image_dimensions(content)

        session.add(
            models.MediaItem(
                owner_id=blueprint["owner_id"],
                filename=blueprint["filename"],
                ext=Path(blueprint["filename"]).suffix.lstrip("."),
                mime_type=blueprint["mime"],
                size_bytes=len(content),
                category=blueprint["category"],
                storage_provider=models.StorageProviderEnum.LOCAL,
                storage_path=stored.path,
                public_url=stored.public_url,
                width=width,
                height=height,
                checksum_sha256=hashlib.sha256(content).hexdigest(),
            )
        )
    session.commit()

USERS = [
    {
        "id": "user-1",
        "name": "Alice Johnson",
        "email": "owner@example.com",
        "role": models.RoleEnum.OWNER,
        "department": "Management",
        "points": 185,
        "unlocked": ["ach-1"],
        "tasks_created": 3,
        "tasks_completed": 2,
        "clarity_scores": [5, 4],
        "claimed_rewards": [],
    },
    {
        "id": "user-2",
        "name": "Bob Williams",
        "email": "admin@example.com",
        "role": models.RoleEnum.ADMIN,
        "department": "Hyper Automation",
        "points": 75,
        "unlocked": ["ach-1"],
        "tasks_created": 4,
        "tasks_completed": 1,
        "clarity_scores": [3],
        "claimed_rewards": [],
    },
    {
        "id": "user-3",
        "name": "Charlie Brown",
        "email": "user@example.com",
        "role": models.RoleEnum.USER,
        "department": "Marketing Team",
        "points": 250,
        "unlocked": ["ach-1", "ach-2"],
        "tasks_created": 1,
        "tasks_completed": 5,
        "clarity_scores": [],
        "claimed_rewards": [],
    },
    {
        "id": "user-4",
        "name": "Diana Miller",
        "email": "diana@example.com",
        "role": models.RoleEnum.USER,
        "department": "Hyper Automation",
        "points": 50,
        "unlocked": [],
        "tasks_created": 0,
        "tasks_completed": 3,
        "clarity_scores": [],
        "claimed_rewards": [],
    },
    {
        "id": "user-5",
        "name": "Ethan Davis",
        "email": "ethan@example.com",
        "role": models.RoleEnum.USER,
        "department": "IT Support",
        "points": 120,
        "unlocked": ["ach-1"],
        "tasks_created": 1,
        "tasks_completed": 1,
        "clarity_scores": [],
        "claimed_rewards": [],
    },
    {
        "id": "user-temp-owner",
        "name": "Temp Owner",
        "email": "temp.owner@example.com",
        "role": models.RoleEnum.OWNER,
        "department": "Management",
        "points": 0,
        "unlocked": [],
        "tasks_created": 0,
        "tasks_completed": 0,
        "clarity_scores": [],
        "claimed_rewards": [],
        "password": "TempOwner!234",
    },
]


TASKS = [
    {
        "id": "task-1",
        "title": "Design new dashboard layout",
        "description": "Create mockups and wireframes for the new V2 dashboard. Focus on user experience and data visualization.",
        "status": models.TaskStatusEnum.IN_PROGRESS,
        "priority": models.TaskPriorityEnum.HIGH,
        "team": "Hyper Automation",
        "assigned_to": "user-4",
        "created_by": "user-2",
        "created_offset": -10,
        "updated_offset": -2,
        "due_offset": 5,
        "subtasks": [
            {"id": "sub-1-1", "title": "User research", "completed": True},
            {"id": "sub-1-2", "title": "Low-fidelity wireframes", "completed": True},
            {"id": "sub-1-3", "title": "High-fidelity mockups", "completed": False},
        ],
        "dependencies": [],
        "recurrence_rule": models.RecurrenceRuleEnum.NONE,
        "recurring_task_id": None,
        "clarity_rating": None,
        "attachments": [],
        "estimated_hours": 24,
        "tags": ["#ux", "#design", "#dashboard"],
    },
    {
        "id": "task-2",
        "title": "Implement user authentication",
        "description": "Develop backend authentication flow with JWT-based sessions and integrate with frontend.",
        "status": models.TaskStatusEnum.IN_PROGRESS,
        "priority": models.TaskPriorityEnum.URGENT,
        "team": "Hyper Automation",
        "assigned_to": "user-1",
        "created_by": "user-2",
        "created_offset": -14,
        "updated_offset": -4,
        "due_offset": 1,
        "subtasks": [
            {"id": "sub-2-1", "title": "Design DB schema", "completed": True},
            {"id": "sub-2-2", "title": "Implement login flow", "completed": False},
        ],
        "dependencies": [],
        "recurrence_rule": models.RecurrenceRuleEnum.NONE,
        "recurring_task_id": None,
        "clarity_rating": None,
        "attachments": [],
        "estimated_hours": 30,
        "tags": ["#backend", "#security"],
    },
    {
        "id": "task-3",
        "title": "Create Q3 marketing campaign materials",
        "description": "Prepare creative assets and copy for the Q3 AI launch.",
        "status": models.TaskStatusEnum.DONE,
        "priority": models.TaskPriorityEnum.MEDIUM,
        "team": "Marketing Team",
        "assigned_to": "user-3",
        "created_by": "user-1",
        "created_offset": -20,
        "updated_offset": -8,
        "due_offset": -5,
        "completed_offset": -6,
        "subtasks": [
            {"id": "sub-3-1", "title": "Campaign concept", "completed": True},
            {"id": "sub-3-2", "title": "Asset design", "completed": True},
        ],
        "dependencies": [],
        "recurrence_rule": models.RecurrenceRuleEnum.NONE,
        "recurring_task_id": None,
        "clarity_rating": 4,
        "attachments": [],
        "estimated_hours": 18,
        "tags": ["#marketing", "#campaign"],
    },
    {
        "id": "task-4",
        "title": "Run regression tests for payment module",
        "description": "Execute the regression suite on staging and report issues.",
        "status": models.TaskStatusEnum.IN_REVIEW,
        "priority": models.TaskPriorityEnum.HIGH,
        "team": "IT Support",
        "assigned_to": "user-5",
        "created_by": "user-2",
        "created_offset": -7,
        "updated_offset": -1,
        "due_offset": 2,
        "subtasks": [],
        "dependencies": [],
        "recurrence_rule": models.RecurrenceRuleEnum.NONE,
        "recurring_task_id": None,
        "clarity_rating": None,
        "attachments": [],
        "estimated_hours": 8,
        "tags": ["#qa", "#testing", "#payments"],
    },
    {
        "id": "task-5",
        "title": "Update user documentation for v2.5",
        "description": "Write and publish documentation for all new features released in v2.5.",
        "status": models.TaskStatusEnum.ON_HOLD,
        "priority": models.TaskPriorityEnum.LOW,
        "team": "Client",
        "assigned_to": "user-4",
        "created_by": "user-2",
        "created_offset": -3,
        "updated_offset": -3,
        "due_offset": 15,
        "subtasks": [],
        "dependencies": ["task-2"],
        "recurrence_rule": models.RecurrenceRuleEnum.NONE,
        "recurring_task_id": None,
        "clarity_rating": None,
        "attachments": [],
        "estimated_hours": 12,
        "tags": ["#docs"],
    },
]

COMMENTS = [
    {
        "id": "comment-1",
        "task_id": "task-1",
        "user_id": "user-2",
        "content": "The low-fidelity wireframes look great, Diana! Let's proceed with the high-fidelity mockups.",
        "created_offset": -3,
    },
    {
        "id": "comment-2",
        "task_id": "task-1",
        "user_id": "user-4",
        "content": "Thanks, Bob! I've started on them and will share a draft by EOD tomorrow.",
        "created_offset": -2,
    },
    {
        "id": "comment-3",
        "task_id": "task-4",
        "user_id": "user-2",
        "content": "Ethan, please make sure to test the refund process thoroughly.",
        "created_offset": -1,
    },
]

NOTIFICATIONS = [
    {
        "id": "notif-test-reward",
        "user_id": "user-1",
        "type": models.NotificationTypeEnum.REWARD_CLAIMED,
        "message": "You have claimed the reward: 'Testing'.",
        "is_read": False,
        "related_task_id": None,
        "related_reward_id": "rew-test",
        "created_delta_seconds": -6,
    },
    {
        "id": "notif-1",
        "user_id": "user-1",
        "type": models.NotificationTypeEnum.TASK_COMPLETED,
        "message": "Charlie Brown completed the task 'Create Q3 marketing campaign materials'.",
        "is_read": False,
        "related_task_id": "task-3",
        "related_reward_id": None,
        "created_offset": -8,
    },
    {
        "id": "notif-2",
        "user_id": "user-4",
        "type": models.NotificationTypeEnum.TASK_ASSIGNED,
        "message": "You have been assigned a new task: 'Design new dashboard layout'.",
        "is_read": True,
        "related_task_id": "task-1",
        "related_reward_id": None,
        "created_offset": -10,
    },
]


def seed_database() -> None:
    """Populate the database with reference data if empty."""
    with SessionLocal() as session:
        connection = session.connection()
        inspector = inspect(connection)
        notification_columns = {col["name"] for col in inspector.get_columns("notifications")}
        if "related_chat_id" not in notification_columns:
            connection.execute(text("ALTER TABLE notifications ADD COLUMN related_chat_id VARCHAR(36)"))
            session.commit()

        existing_user = session.execute(select(models.User.id).limit(1)).first()
        if existing_user:
            return

        now = datetime.utcnow()
        default_password_hash = hash_password("password123")

        # Departments
        for dept_id, name in DEPARTMENTS:
            if not session.get(models.Department, dept_id):
                session.add(models.Department(id=dept_id, name=name))
        session.commit()

        departments = {
            dept.name: dept.id for dept in session.execute(select(models.Department)).scalars().all()
        }

        # Kanban Columns
        for col_id, title, order in KANBAN_COLUMNS:
            if not session.get(models.KanbanColumn, col_id):
                session.add(models.KanbanColumn(id=col_id, title=title, order=order))
        session.commit()

        # Achievements
        for ach_id, title, description, points, icon in ACHIEVEMENTS:
            if not session.get(models.Achievement, ach_id):
                session.add(
                    models.Achievement(
                        id=ach_id,
                        title=title,
                        description=description,
                        points=points,
                        icon=icon,
                    )
                )
        session.commit()

        # Reward Icons
        existing_icon_keys = {
            icon.key for icon in session.execute(select(models.RewardIcon)).scalars().all()
        }
        for key, label, url in REWARD_ICONS:
            if key not in existing_icon_keys:
                session.add(
                    models.RewardIcon(
                        id=f"icon-{key}",
                        key=key,
                        label=label,
                        url=url,
                    )
                )
        session.commit()

        # Rewards
        now = datetime.utcnow()
        for blueprint in REWARD_BLUEPRINTS:
            if session.get(models.Reward, blueprint["id"]):
                continue
            expires_at = None
            days = blueprint.get("expires_in_days")
            if days is not None:
                expires_at = now + timedelta(days=days)
            status = (
                models.RewardStatusEnum.EXPIRED
                if expires_at and expires_at <= now
                else models.RewardStatusEnum.ACTIVE
            )
            dept_names = blueprint.get("dept_whitelist") or []
            dept_ids = [departments[name] for name in dept_names if name in departments]
            session.add(
                models.Reward(
                    id=blueprint["id"],
                    title=blueprint["title"],
                    description=blueprint["description"],
                    image_source=models.RewardImageSourceEnum.LIBRARY,
                    image_ref=blueprint["image_ref"],
                    xp_required=blueprint["xp_required"],
                    dept_whitelist=dept_ids or None,
                    auto_redeem=blueprint["auto_redeem"],
                    expires_at=expires_at,
                    status=status,
                    created_at=now,
                    updated_at=now,
                )
            )
        session.commit()

        # Avatar assets
        existing_avatar_ids = {
            avatar_id for avatar_id in session.execute(select(models.AvatarAsset.id)).scalars().all()
        }
        for avatar_id, title, relative_path in DEFAULT_AVATARS:
            if avatar_id not in existing_avatar_ids:
                session.add(
                    models.AvatarAsset(
                        id=avatar_id,
                        name=title,
                        storage_type=models.AvatarStorageTypeEnum.FILE,
                        file_path=relative_path,
                        mime_type="image/svg+xml",
                        is_default=True,
                        created_by_id=None,
                    )
                )
        session.commit()

        # Users
        for user_data in USERS:
            dept_id = departments.get(user_data["department"])
            raw_password = user_data.get("password")
            hashed_password = hash_password(raw_password) if raw_password else default_password_hash
            session.add(
                models.User(
                    id=user_data["id"],
                    tenant_id=DEFAULT_TENANT_ID,
                    name=user_data["name"],
                    email=user_data["email"],
                    hashed_password=hashed_password,
                    role=user_data["role"],
                    department_id=dept_id,
                    status=models.UserStatusEnum.ACTIVE,
                    points=user_data["points"],
                    tasks_created=user_data["tasks_created"],
                    tasks_completed=user_data["tasks_completed"],
                    clarity_scores=user_data["clarity_scores"],
                    claimed_reward_ids=user_data["claimed_rewards"],
                    unlocked_achievement_ids=user_data["unlocked"],
                )
            )
        session.commit()

        # Tasks
        for task_data in TASKS:
            created_at = now + timedelta(days=task_data["created_offset"])
            updated_at = now + timedelta(days=task_data["updated_offset"])
            due_at = now + timedelta(days=task_data["due_offset"])
            completed_at = (
                now + timedelta(days=task_data["completed_offset"]) if "completed_offset" in task_data else None
            )

            task = models.Task(
                id=task_data["id"],
                title=task_data["title"],
                description=task_data["description"],
                status=task_data["status"],
                priority=task_data["priority"],
                team=task_data["team"],
                assigned_to_id=task_data["assigned_to"],
                task_group_id=task_data.get("task_group_id") or str(uuid4()),
                created_by_id=task_data["created_by"],
                created_at=created_at,
                updated_at=updated_at,
                due_at=due_at,
                completed_at=completed_at,
                recurrence_rule=task_data["recurrence_rule"],
                recurring_task_id=task_data["recurring_task_id"],
                clarity_rating=task_data["clarity_rating"],
                attachments=task_data["attachments"],
                estimated_hours=task_data["estimated_hours"],
                tags=task_data["tags"],
            )
            for subtask_data in task_data["subtasks"]:
                task.subtasks.append(
                    models.Subtask(
                        id=subtask_data.get("id"),
                        title=subtask_data["title"],
                        completed=subtask_data["completed"],
                    )
                )
            session.add(task)
        session.commit()

        # Task dependencies
        for task_data in TASKS:
            if task_data["dependencies"]:
                task = session.get(models.Task, task_data["id"])
                dependencies = [session.get(models.Task, dep_id) for dep_id in task_data["dependencies"]]
                task.dependencies = [dep for dep in dependencies if dep]
        session.commit()

        # Comments
        for comment_data in COMMENTS:
            created_at = now + timedelta(days=comment_data["created_offset"])
            session.add(
                models.Comment(
                    id=comment_data["id"],
                    task_id=comment_data["task_id"],
                    user_id=comment_data["user_id"],
                    content=comment_data["content"],
                    created_at=created_at,
                )
            )
        session.commit()

        # Notifications
        for notification_data in NOTIFICATIONS:
            created_at = now + timedelta(days=notification_data.get("created_offset", 0))
            if "created_delta_seconds" in notification_data:
                created_at = now + timedelta(seconds=notification_data["created_delta_seconds"])
            session.add(
                models.Notification(
                    id=notification_data["id"],
                    user_id=notification_data["user_id"],
                    type=notification_data["type"],
                    message=notification_data["message"],
                    is_read=notification_data["is_read"],
                    related_task_id=notification_data["related_task_id"],
                    related_reward_id=notification_data["related_reward_id"],
                    created_at=created_at,
                )
            )
        session.commit()

        # Chat defaults
        chat_exists = session.execute(select(models.ChatConversation.id).limit(1)).first()
        if not chat_exists:
            chat_now = datetime.utcnow()
            seeded_users = session.execute(select(models.User)).scalars().all()
            default_tenant_id = seeded_users[0].tenant_id if seeded_users else DEFAULT_TENANT_ID
            general_space = models.ChatConversation(
                tenant_id=default_tenant_id,
                name="General Space",
                description="Team-wide announcements and quick team updates.",
                type=models.ChatConversationTypeEnum.SPACE,
                is_private=False,
                created_by_id="user-1",
                created_at=chat_now,
                updated_at=chat_now,
                last_message_at=None,
            )
            session.add(general_space)
            session.flush()

            for user in seeded_users:
                session.add(
                    models.ChatParticipant(
                        conversation_id=general_space.id,
                        user_id=user.id,
                        role=models.ChatMemberRoleEnum.ADMIN if user.role in {models.RoleEnum.ADMIN, models.RoleEnum.MANAGER, models.RoleEnum.OWNER} else models.ChatMemberRoleEnum.MEMBER,
                        is_admin=user.role in {models.RoleEnum.ADMIN, models.RoleEnum.MANAGER, models.RoleEnum.OWNER},
                        joined_at=chat_now,
                        last_read_at=chat_now if user.id == "user-1" else chat_now - timedelta(hours=4),
                    )
                )

            welcome_at = chat_now + timedelta(minutes=5)
            session.add(
                models.ChatMessage(
                    conversation_id=general_space.id,
                    sender_id="user-1",
                    content="Welcome to the General space! Use this room for announcements and quick team updates.",
                    created_at=welcome_at,
                    updated_at=welcome_at,
                )
            )
            general_space.last_message_at = welcome_at
            general_space.updated_at = welcome_at

            for user in seeded_users:
                if user.id == "user-1":
                    continue
                session.add(
                    models.Notification(
                        user_id=user.id,
                        type=models.NotificationTypeEnum.CHAT_MESSAGE,
                        message="Alice Johnson: Welcome to the General space! Use this room for announcements and quick team updates.",
                        related_chat_id=general_space.id,
                        created_at=welcome_at,
                    )
                )

            dm_at = welcome_at + timedelta(minutes=10)
            direct_chat = models.ChatConversation(
                tenant_id=default_tenant_id,
                name=None,
                description=None,
                type=models.ChatConversationTypeEnum.DIRECT,
                is_private=True,
                created_by_id="user-2",
                created_at=dm_at,
                updated_at=dm_at,
                last_message_at=dm_at,
            )
            session.add(direct_chat)
            session.flush()

            session.add_all(
                [
                    models.ChatParticipant(
                        conversation_id=direct_chat.id,
                        user_id="user-2",
                        role=models.ChatMemberRoleEnum.OWNER,
                        is_admin=False,
                        joined_at=dm_at,
                        last_read_at=dm_at,
                    ),
                    models.ChatParticipant(
                        conversation_id=direct_chat.id,
                        user_id="user-3",
                        role=models.ChatMemberRoleEnum.MEMBER,
                        is_admin=False,
                        joined_at=dm_at,
                        last_read_at=dm_at - timedelta(minutes=1),
                    ),
                ]
            )

            session.add(
                models.ChatMessage(
                    conversation_id=direct_chat.id,
                    sender_id="user-2",
                    content="Hey Charlie, can you review the new onboarding flow today?",
                    created_at=dm_at,
                    updated_at=dm_at,
                )
            )
            session.add(
                models.Notification(
                    user_id="user-3",
                    type=models.NotificationTypeEnum.CHAT_MESSAGE,
                    message="Bob Williams: Hey Charlie, can you review the new onboarding flow today?",
                    related_chat_id=direct_chat.id,
                    created_at=dm_at,
                )
            )

            session.commit()

        seed_media_items(session)

        # Default config rows
        if not session.get(models.SmtpConfig, 1):
            session.add(
                models.SmtpConfig(
                    id=1,
                    host="smtp.example.com",
                    port=587,
                    username="noreply@example.com",
                    encryption="tls",
                )
            )
        if not session.get(models.ApiConfig, 1):
            session.add(models.ApiConfig(id=1, provider="Google Gemini", api_key=None))
        session.commit()


def seed_badges_from_achievements() -> None:
    """Convert legacy achievements into badges and migrate earned progress."""
    with SessionLocal() as session:
        inspector = inspect(session.bind)
        table_names = set(inspector.get_table_names())
        if "badges" not in table_names or "badge_rules" not in table_names:
            return
        if "achievements" not in table_names or "users" not in table_names:
            return

        achievements = session.execute(select(models.Achievement)).scalars().all()
        if not achievements:
            return

        for achievement in achievements:
            migration = BADGE_MIGRATIONS.get(achievement.id)
            if not migration:
                continue
            if session.get(models.Badge, achievement.id):
                continue
            badge = models.Badge(
                id=achievement.id,
                name=achievement.title,
                description=achievement.description,
                tier=migration["tier"],
                tier_group=migration["tier_group"],
                tier_order=migration["tier_order"],
                bonus_xp=achievement.points,
                state=models.BadgeStateEnum.ACTIVE,
                is_system=True,
            )
            session.add(badge)
            session.add(
                models.BadgeRule(
                    badge_id=achievement.id,
                    rules=migration["rules"],
                )
            )

        session.commit()

        if "user_badge_progress" not in table_names:
            return

        badges = (
            session.execute(select(models.Badge).options(selectinload(models.Badge.ruleset)))
            .scalars()
            .all()
        )
        rules_by_badge = {
            badge.id: badge.ruleset.rules if badge.ruleset and isinstance(badge.ruleset.rules, dict) else {}
            for badge in badges
        }
        existing_pairs = {
            (row[0], row[1])
            for row in session.execute(
                select(models.UserBadgeProgress.user_id, models.UserBadgeProgress.badge_id)
            ).all()
        }
        users = session.execute(select(models.User)).scalars().all()
        now = datetime.utcnow()

        for user in users:
            for badge_id in user.unlocked_achievement_ids or []:
                if (user.id, badge_id) in existing_pairs:
                    continue
                rules = rules_by_badge.get(badge_id, {})
                rule_count = len(rules.get("rules") or [])
                progress_state = {
                    "rules": [
                        {"count": 0, "window_started_at": None, "last_event_at": None}
                        for _ in range(rule_count)
                    ]
                }
                session.add(
                    models.UserBadgeProgress(
                        user_id=user.id,
                        badge_id=badge_id,
                        status=models.BadgeProgressStatusEnum.EARNED,
                        progress_value=100,
                        progress_state=progress_state,
                        earned_at=now,
                    )
                )

        session.commit()
