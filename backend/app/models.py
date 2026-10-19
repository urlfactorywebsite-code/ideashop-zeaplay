"""SQLAlchemy models for the Vee Task Manager backend."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Computed,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKeyConstraint,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Table,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class RealtimeAggregate(Base):
    __tablename__ = "realtime_aggregates"
    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    aggregate_type: Mapped[str] = mapped_column(String(16), primary_key=True)
    aggregate_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False)


class RealtimeOutbox(Base):
    __tablename__ = "realtime_outbox"
    __table_args__ = (
        UniqueConstraint("tenant_id", "aggregate_type", "aggregate_id", "aggregate_version", name="uq_realtime_outbox_version"),
        Index("ix_realtime_outbox_due", "status", "next_attempt_at", "created_at"),
        CheckConstraint("status IN ('PENDING', 'PUBLISHED', 'DEAD')", name="ck_realtime_outbox_status"),
        CheckConstraint("aggregate_version > 0 AND attempt_count >= 0", name="ck_realtime_outbox_counters"),
    )
    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), nullable=False)
    aggregate_type: Mapped[str] = mapped_column(String(16), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(64), nullable=False)
    aggregate_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[str] = mapped_column(String(96), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class RoleEnum(str, enum.Enum):
    USER = "user"
    ADMIN = "admin"
    MANAGER = "manager"
    OWNER = "owner"


class UserStatusEnum(str, enum.Enum):
    ACTIVE = "ACTIVE"
    DEACTIVATED = "DEACTIVATED"


class ClientStatusEnum(str, enum.Enum):
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class ContactStatusEnum(str, enum.Enum):
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class ProjectStatusEnum(str, enum.Enum):
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class ProjectMemberRoleEnum(str, enum.Enum):
    MANAGER = "MANAGER"
    MEMBER = "MEMBER"


class TimeEntryStatusEnum(str, enum.Enum):
    ACTIVE = "ACTIVE"
    STOPPED = "STOPPED"
    CORRECTED = "CORRECTED"


class CompletionSubmissionStatusEnum(str, enum.Enum):
    PENDING_REVIEW = "PENDING_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    COMPLETED = "COMPLETED"


class TaskPriorityEnum(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    URGENT = "URGENT"


class TaskStatusEnum(str, enum.Enum):
    WAITING_FOR_REQUIREMENT = "WAITING_FOR_REQUIREMENT"
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    BUG_FIXING = "BUG_FIXING"
    IN_REVIEW = "IN_REVIEW"
    BLOCKED = "BLOCKED"
    ON_HOLD = "ON_HOLD"
    DONE = "DONE"
    DEPLOYED = "DEPLOYED"
    FAILED = "FAILED"
    GRAVEYARD = "GRAVEYARD"


class SubtaskStatusEnum(str, enum.Enum):
    WAITING = "WAITING"
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    IN_REVIEW = "IN_REVIEW"
    DONE = "DONE"


class TaskApprovalStatusEnum(str, enum.Enum):
    NONE = "none"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class RecurrenceRuleEnum(str, enum.Enum):
    NONE = "NONE"
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"
    AFTER_COMPLETION = "AFTER_COMPLETION"


class NotificationTypeEnum(str, enum.Enum):
    TASK_CREATED = "TASK_CREATED"
    TASK_UPDATED = "TASK_UPDATED"
    TASK_DELETED = "TASK_DELETED"
    TASK_COMPLETED = "TASK_COMPLETED"
    TASK_ASSIGNED = "TASK_ASSIGNED"
    TASK_OVERDUE = "TASK_OVERDUE"
    COMMENT_ADDED = "COMMENT_ADDED"
    ACHIEVEMENT_UNLOCKED = "ACHIEVEMENT_UNLOCKED"
    REWARD_CLAIMED = "REWARD_CLAIMED"
    CHAT_MESSAGE = "CHAT_MESSAGE"
    TICKET_CREATED = "TICKET_CREATED"
    TICKET_UPDATED = "TICKET_UPDATED"
    TICKET_DELETED = "TICKET_DELETED"
    TICKET_ASSIGNED = "TICKET_ASSIGNED"
    TICKET_CLOSED = "TICKET_CLOSED"
    USER_CREATED = "USER_CREATED"
    USER_UPDATED = "USER_UPDATED"
    USER_DELETED = "USER_DELETED"
    DEPARTMENT_CREATED = "DEPARTMENT_CREATED"
    DEPARTMENT_UPDATED = "DEPARTMENT_UPDATED"
    DEPARTMENT_DELETED = "DEPARTMENT_DELETED"
    APPROVAL_REQUESTED = "APPROVAL_REQUESTED"
    APPROVAL_ACTED = "APPROVAL_ACTED"
    SLA_BREACH = "SLA_BREACH"
    SUBTASK_ACTIVATED = "SUBTASK_ACTIVATED"
    SUBTASK_REASSIGNED = "SUBTASK_REASSIGNED"
    SUBTASK_APPROVED = "SUBTASK_APPROVED"
    SUBTASK_REJECTED = "SUBTASK_REJECTED"
    SUBTASK_FORCE_STARTED = "SUBTASK_FORCE_STARTED"
    SUBTASK_REVIEW_REQUIRED = "SUBTASK_REVIEW_REQUIRED"
    MENTION = "MENTION"


class NotificationEntityTypeEnum(str, enum.Enum):
    TICKET = "ticket"
    TASK = "task"
    SUBTASK = "subtask"
    APPROVAL = "approval"
    USER = "user"
    DEPARTMENT = "department"


class NotificationOutboxStatusEnum(str, enum.Enum):
    PENDING = "PENDING"
    SENDING = "SENDING"
    SENT = "SENT"
    FAILED = "FAILED"


class NotificationOutboxChannelEnum(str, enum.Enum):
    EMAIL = "EMAIL"


class ApprovalScopeTypeEnum(str, enum.Enum):
    TICKET = "ticket"
    TASK = "task"
    OVERRIDE_CLOSE = "override_close"


class ApprovalStatusEnum(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class TaskTransferStatusEnum(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ToolCategoryStatusEnum(str, enum.Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class ToolPricingTypeEnum(str, enum.Enum):
    FREE = "free"
    PAID = "paid"
    TRIAL = "trial"


class ToolStatusEnum(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class AuditLogSourceEnum(str, enum.Enum):
    MANUAL = "manual"
    AUTOMATION = "automation"
    API = "api"
    SYSTEM = "system"


class AuditLogSeverityEnum(str, enum.Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AuditLogStatusEnum(str, enum.Enum):
    SUCCESS = "success"
    FAILED = "failed"


class AuditLogCategoryEnum(str, enum.Enum):
    USER = "user"
    TASK = "task"
    TICKET = "ticket"
    APPROVAL = "approval"
    AUTOMATION = "automation"
    NOTIFICATION = "notification"
    SECURITY = "security"
    SYSTEM = "system"


class ChatConversationTypeEnum(str, enum.Enum):
    SPACE = "SPACE"
    DIRECT = "DIRECT"
    GROUP = "GROUP"


class ChatMemberRoleEnum(str, enum.Enum):
    OWNER = "OWNER"
    ADMIN = "ADMIN"
    MEMBER = "MEMBER"


class ChatMessageTypeEnum(str, enum.Enum):
    TEXT = "TEXT"
    IMAGE = "IMAGE"
    FILE = "FILE"
    SYSTEM = "SYSTEM"


class AvatarStorageTypeEnum(str, enum.Enum):
    FILE = "file"
    DATA_URL = "data_url"
    EXTERNAL_URL = "external_url"


class MediaCategoryEnum(str, enum.Enum):
    IMAGE = "image"
    VIDEO = "video"
    MUSIC = "music"
    DOCUMENT = "doc"
    ZIP = "zip"


class MediaFileTypeEnum(str, enum.Enum):
    IMAGE = "image"
    VIDEO = "video"
    DOCUMENT = "document"
    ZIP = "zip"
    AVATAR = "avatar"


class MediaFileStatusEnum(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    FAILED = "failed"


class StorageProviderEnum(str, enum.Enum):
    LOCAL = "local"
    SUPABASE = "supabase"
    GDRIVE = "gdrive"


class RewardImageSourceEnum(str, enum.Enum):
    LIBRARY = "LIBRARY"
    UPLOAD = "UPLOAD"


class RewardStatusEnum(str, enum.Enum):
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    DELETED = "DELETED"


class RewardClaimStatusEnum(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REDEEMED = "REDEEMED"


class RewardLogActionEnum(str, enum.Enum):
    CREATED = "CREATED"
    EDITED = "EDITED"
    DELETED = "DELETED"
    CLAIMED = "CLAIMED"
    EXPIRED = "EXPIRED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    AUTO_ASSIGNED = "AUTO_ASSIGNED"
    IMAGE_DELETED = "IMAGE_DELETED"
    AUTO_REDEEMED = "AUTO_REDEEMED"


class BadgeStateEnum(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class BadgeProgressStatusEnum(str, enum.Enum):
    LOCKED = "locked"
    IN_PROGRESS = "in_progress"
    EARNED = "earned"


class NodeTypeEnum(str, enum.Enum):
    CHECKPOINT = "CHECKPOINT"
    TOWER = "TOWER"
    DECOR = "DECOR"
    GIFT = "GIFT"


class EventTypeEnum(str, enum.Enum):
    REACHED = "REACHED"
    CLAIMED = "CLAIMED"
    ANIM_SHOWN = "ANIM_SHOWN"



# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def generate_uuid() -> str:
    return str(uuid.uuid4())


def utc_now() -> datetime:
    """Use aware UTC timestamps for timezone-aware database columns."""
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Association tables
# ---------------------------------------------------------------------------


task_dependencies = Table(
    'task_dependencies',
    Base.metadata,
    Column('task_id', String(36), ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True),
    Column('depends_on_task_id', String(36), ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True),
)


task_followers = Table(
    'task_followers',
    Base.metadata,
    Column('task_id', String(36), ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True),
    Column('user_id', String(36), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    Column('created_at', DateTime(timezone=True), default=utc_now, nullable=False),
)



# ---------------------------------------------------------------------------
# Core models


# ---------------------------------------------------------------------------
# Core models
# ---------------------------------------------------------------------------


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)

    users: Mapped[List["User"]] = relationship("User", back_populates="department")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("id", "tenant_id", name="uq_users_id_tenant"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    employer_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    credentials_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    role: Mapped[RoleEnum] = mapped_column(SAEnum(RoleEnum), default=RoleEnum.USER, nullable=False)
    department_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    manager_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    manager_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    webex_person_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    shift_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    shift_start: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    shift_end: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    morning_break_start: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    morning_break_end: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    lunch_break_start: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    lunch_break_end: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    evening_break_start: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    evening_break_end: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    timezone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    skills: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    projects: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[UserStatusEnum] = mapped_column(
        SAEnum(UserStatusEnum), default=UserStatusEnum.ACTIVE, nullable=False
    )
    points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tasks_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tasks_completed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    clarity_scores: Mapped[List[int]] = mapped_column(JSON, default=list, nullable=False)
    claimed_reward_ids: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    unlocked_achievement_ids: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    avatar_asset_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("avatar_assets.id", ondelete="SET NULL"), nullable=True
    )
    avatar_frame: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    profile_image_key: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    profile_image_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    department: Mapped[Optional[Department]] = relationship("Department", back_populates="users")
    comments: Mapped[List["Comment"]] = relationship(
        "Comment", back_populates="author", cascade="all, delete-orphan"
    )
    tasks_assigned: Mapped[List["Task"]] = relationship(
        "Task", back_populates="assignee", foreign_keys="Task.assigned_to_id"
    )
    tasks_created_rel: Mapped[List["Task"]] = relationship(
        "Task", back_populates="creator", foreign_keys="Task.created_by_id"
    )
    followed_tasks: Mapped[List["Task"]] = relationship(
        "Task",
        secondary=task_followers,
        back_populates="followers",
    )
    avatar_asset: Mapped[Optional["AvatarAsset"]] = relationship(
        "AvatarAsset", back_populates="users", foreign_keys=[avatar_asset_id]
    )
    created_avatars: Mapped[List["AvatarAsset"]] = relationship(
        "AvatarAsset",
        back_populates="creator",
        foreign_keys="AvatarAsset.created_by_id",
    )
    notifications: Mapped[List["Notification"]] = relationship(
        "Notification", back_populates="user", cascade="all, delete-orphan"
    )
    push_subscriptions: Mapped[List["PushSubscription"]] = relationship(
        "PushSubscription", back_populates="user", cascade="all, delete-orphan"
    )
    notification_preferences: Mapped[List["NotificationPreference"]] = relationship(
        "NotificationPreference", back_populates="user", cascade="all, delete-orphan"
    )
    chat_participations: Mapped[List["ChatParticipant"]] = relationship(
        "ChatParticipant", back_populates="user", cascade="all, delete-orphan"
    )
    chat_messages: Mapped[List["ChatMessage"]] = relationship(
        "ChatMessage", back_populates="sender"
    )
    created_conversations: Mapped[List["ChatConversation"]] = relationship(
        "ChatConversation", back_populates="created_by"
    )
    media_files: Mapped[List["MediaFile"]] = relationship(
        "MediaFile",
        back_populates="owner",
        foreign_keys="MediaFile.user_id",
        cascade="all, delete-orphan",
    )
    media_items: Mapped[List["MediaItem"]] = relationship(
        "MediaItem",
        back_populates="owner",
        foreign_keys="MediaItem.owner_id",
        cascade="all, delete-orphan",
    )
    reward_claims: Mapped[List["RewardClaim"]] = relationship(
        "RewardClaim",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="RewardClaim.user_id",
    )
    approved_reward_claims: Mapped[List["RewardClaim"]] = relationship(
        "RewardClaim",
        back_populates="approver",
        foreign_keys="RewardClaim.approver_id",
    )
    project_memberships: Mapped[List["ProjectMember"]] = relationship(
        "ProjectMember",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="ProjectMember.user_id",
    )

    @property
    def claimed_xp_points(self) -> int:
        total = 0
        for claim in self.reward_claims or []:
            if claim.status == RewardClaimStatusEnum.REJECTED:
                continue
            total += claim.xp_spent if claim.xp_spent is not None else (claim.reward.xp_required if claim.reward else 0)
        return total

    @property
    def overall_xp_points(self) -> int:
        return (self.points or 0) + self.claimed_xp_points


class Client(Base):
    __tablename__ = "clients"
    __table_args__ = (
        UniqueConstraint("id", "tenant_id", name="uq_clients_id_tenant"),
        Index("ix_clients_tenant_status_updated", "tenant_id", "status", "updated_at"),
        Index("ix_clients_tenant_normalized_name", "tenant_id", "normalized_company_name"),
        Index("ix_clients_tenant_gst", "tenant_id", "gst_number"),
        Index("ix_clients_tenant_created", "tenant_id", "created_at"),
        Index(
            "uq_clients_active_tenant_normalized_name",
            "tenant_id",
            "normalized_company_name",
            unique=True,
            postgresql_where=text("status = 'ACTIVE'"),
            sqlite_where=text("status = 'ACTIVE'"),
        ),
        Index(
            "uq_clients_active_tenant_gst",
            "tenant_id",
            "gst_number",
            unique=True,
            postgresql_where=text("status = 'ACTIVE' AND gst_number IS NOT NULL"),
            sqlite_where=text("status = 'ACTIVE' AND gst_number IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    gst_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address_line1: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[ClientStatusEnum] = mapped_column(
        SAEnum(
            ClientStatusEnum,
            name="client_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=ClientStatusEnum.ACTIVE,
        nullable=False,
    )
    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    archived_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    created_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[created_by_id])
    updated_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[updated_by_id])
    archived_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[archived_by_id])
    contact_links: Mapped[List["ClientContact"]] = relationship(
        "ClientContact",
        back_populates="client",
        cascade="all, delete-orphan",
        overlaps="client_links,contact",
    )
    projects_rel: Mapped[List["Project"]] = relationship("Project", back_populates="client")


class Contact(Base):
    __tablename__ = "contacts"
    __table_args__ = (
        UniqueConstraint("id", "tenant_id", name="uq_contacts_id_tenant"),
        Index("ix_contacts_tenant_status_updated", "tenant_id", "status", "updated_at"),
        Index("ix_contacts_tenant_display_name", "tenant_id", "display_name"),
        Index("ix_contacts_tenant_email", "tenant_id", "normalized_email"),
        Index("ix_contacts_tenant_phone", "tenant_id", "normalized_phone"),
        Index(
            "uq_contacts_active_tenant_email",
            "tenant_id",
            "normalized_email",
            unique=True,
            postgresql_where=text("status = 'ACTIVE' AND normalized_email IS NOT NULL"),
            sqlite_where=text("status = 'ACTIVE' AND normalized_email IS NOT NULL"),
        ),
        Index(
            "uq_contacts_active_tenant_name_phone",
            "tenant_id",
            "normalized_name",
            "normalized_phone",
            unique=True,
            postgresql_where=text("status = 'ACTIVE' AND normalized_phone IS NOT NULL"),
            sqlite_where=text("status = 'ACTIVE' AND normalized_phone IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    first_name: Mapped[str] = mapped_column(String(120), nullable=False)
    last_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    normalized_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    normalized_phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[ContactStatusEnum] = mapped_column(
        SAEnum(
            ContactStatusEnum,
            name="contact_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=ContactStatusEnum.ACTIVE,
        nullable=False,
    )
    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    archived_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    created_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[created_by_id])
    updated_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[updated_by_id])
    archived_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[archived_by_id])
    client_links: Mapped[List["ClientContact"]] = relationship(
        "ClientContact",
        back_populates="contact",
        cascade="all, delete-orphan",
        overlaps="client,contact_links",
    )


class ClientContact(Base):
    __tablename__ = "client_contacts"
    __table_args__ = (
        ForeignKeyConstraint(["client_id", "tenant_id"], ["clients.id", "clients.tenant_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["contact_id", "tenant_id"], ["contacts.id", "contacts.tenant_id"], ondelete="CASCADE"),
        UniqueConstraint("tenant_id", "client_id", "contact_id", name="uq_client_contacts_tenant_client_contact"),
        Index("ix_client_contacts_tenant_client", "tenant_id", "client_id"),
        Index("ix_client_contacts_tenant_contact", "tenant_id", "contact_id"),
        Index(
            "uq_client_contacts_primary_per_client",
            "tenant_id",
            "client_id",
            unique=True,
            postgresql_where=text("is_primary = true"),
            sqlite_where=text("is_primary = 1"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    client_id: Mapped[str] = mapped_column(String(36), nullable=False)
    contact_id: Mapped[str] = mapped_column(String(36), nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    client: Mapped[Client] = relationship("Client", back_populates="contact_links", overlaps="client_links,contact")
    contact: Mapped[Contact] = relationship("Contact", back_populates="client_links", overlaps="client,contact_links")
    created_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[created_by_id])
    updated_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[updated_by_id])


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("id", "tenant_id", name="uq_projects_id_tenant"),
        ForeignKeyConstraint(["client_id", "tenant_id"], ["clients.id", "clients.tenant_id"], ondelete="RESTRICT"),
        Index("ix_projects_tenant_status_updated", "tenant_id", "status", "updated_at"),
        Index("ix_projects_tenant_client", "tenant_id", "client_id"),
        Index("ix_projects_tenant_name", "tenant_id", "normalized_name"),
        Index("ix_projects_tenant_created", "tenant_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    client_id: Mapped[str] = mapped_column(String(36), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[ProjectStatusEnum] = mapped_column(
        SAEnum(
            ProjectStatusEnum,
            name="project_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=ProjectStatusEnum.ACTIVE,
        nullable=False,
    )
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    archived_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    subtask_approval_required_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    client: Mapped[Client] = relationship("Client", back_populates="projects_rel")
    members: Mapped[List["ProjectMember"]] = relationship(
        "ProjectMember",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    tasks: Mapped[List["Task"]] = relationship(
        "Task",
        back_populates="project",
        passive_deletes=True,
    )
    created_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[created_by_id])
    updated_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[updated_by_id])
    archived_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[archived_by_id])


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (
        ForeignKeyConstraint(["project_id", "tenant_id"], ["projects.id", "projects.tenant_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["user_id", "tenant_id"], ["users.id", "users.tenant_id"], ondelete="CASCADE"),
        UniqueConstraint("tenant_id", "project_id", "user_id", name="uq_project_members_tenant_project_user"),
        Index("ix_project_members_tenant_project", "tenant_id", "project_id"),
        Index("ix_project_members_tenant_user", "tenant_id", "user_id"),
        Index("ix_project_members_tenant_role", "tenant_id", "role"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    role: Mapped[ProjectMemberRoleEnum] = mapped_column(
        SAEnum(
            ProjectMemberRoleEnum,
            name="project_member_role_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    project: Mapped[Project] = relationship("Project", back_populates="members")
    user: Mapped[User] = relationship("User", back_populates="project_memberships", foreign_keys=[user_id])
    created_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[created_by_id])
    updated_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[updated_by_id])


class AvatarAsset(Base):
    __tablename__ = "avatar_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_type: Mapped[AvatarStorageTypeEnum] = mapped_column(
        SAEnum(AvatarStorageTypeEnum), default=AvatarStorageTypeEnum.FILE, nullable=False
    )
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    data_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    external_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    creator: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="created_avatars",
        foreign_keys=[created_by_id],
    )
    users: Mapped[List["User"]] = relationship(
        "User",
        back_populates="avatar_asset",
        foreign_keys=[User.avatar_asset_id],
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[TaskStatusEnum] = mapped_column(
        SAEnum(TaskStatusEnum), default=TaskStatusEnum.TODO, nullable=False
    )
    priority: Mapped[TaskPriorityEnum] = mapped_column(
        SAEnum(TaskPriorityEnum), default=TaskPriorityEnum.MEDIUM, nullable=False
    )
    team: Mapped[str] = mapped_column(String(255), default="General", nullable=False)
    task_group_id: Mapped[str] = mapped_column(
        String(36), default=generate_uuid, nullable=False, index=True
    )
    ticket_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True
    )
    project_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assigned_to_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    approval_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    subtask_approval_required: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    approval_status: Mapped[TaskApprovalStatusEnum] = mapped_column(
        SAEnum(
            TaskApprovalStatusEnum,
            name="task_approval_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=TaskApprovalStatusEnum.NONE,
        nullable=False,
    )
    approver_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    assigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completion_xp_awarded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completion_xp_awarded_to_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    completion_xp_points_awarded: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    clarity_xp_awarded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    clarity_xp_awarded_to_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    clarity_xp_points_awarded: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    recurrence_rule: Mapped[RecurrenceRuleEnum] = mapped_column(
        SAEnum(RecurrenceRuleEnum), default=RecurrenceRuleEnum.NONE, nullable=False
    )
    recurring_task_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    clarity_rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    attachments: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    estimated_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tags: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    search_vector: Mapped[Optional[str]] = mapped_column(
        TSVECTOR().with_variant(Text, "sqlite"),
        Computed(
            "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))",
            persisted=True,
        ),
        nullable=True,
    )

    assignee: Mapped[Optional[User]] = relationship(
        "User", back_populates="tasks_assigned", foreign_keys=[assigned_to_id]
    )
    creator: Mapped[User] = relationship(
        "User", back_populates="tasks_created_rel", foreign_keys=[created_by_id]
    )
    approver: Mapped[Optional[User]] = relationship(
        "User", foreign_keys=[approver_id]
    )
    ticket: Mapped[Optional["Ticket"]] = relationship("Ticket")
    project: Mapped[Optional[Project]] = relationship("Project", back_populates="tasks")
    subtasks: Mapped[List["Subtask"]] = relationship(
        "Subtask", back_populates="task", cascade="all, delete-orphan"
    )
    comments: Mapped[List["Comment"]] = relationship(
        "Comment", back_populates="task", cascade="all, delete-orphan"
    )
    messages: Mapped[List["TaskMessage"]] = relationship(
        "TaskMessage", back_populates="task", cascade="all, delete-orphan"
    )
    dependencies: Mapped[List["Task"]] = relationship(
        "Task",
        secondary=task_dependencies,
        primaryjoin=lambda: Task.id == task_dependencies.c.task_id,
        secondaryjoin=lambda: Task.id == task_dependencies.c.depends_on_task_id,
        back_populates="dependents",
    )
    dependents: Mapped[List["Task"]] = relationship(
        "Task",
        secondary=task_dependencies,
        primaryjoin=lambda: Task.id == task_dependencies.c.depends_on_task_id,
        secondaryjoin=lambda: Task.id == task_dependencies.c.task_id,
        back_populates="dependencies",
    )
    followers: Mapped[List[User]] = relationship(
        "User",
        secondary=task_followers,
        back_populates="followed_tasks",
    )
    time_entries: Mapped[List["TimeEntry"]] = relationship(
        "TimeEntry",
        back_populates="task",
        cascade="all, delete-orphan",
        foreign_keys="TimeEntry.task_id",
    )
    completion_submissions: Mapped[List["CompletionSubmission"]] = relationship(
        "CompletionSubmission",
        back_populates="task",
        cascade="all, delete-orphan",
        overlaps="subtask,completion_submissions",
    )


class Subtask(Base):
    __tablename__ = "subtasks"
    __table_args__ = (
        UniqueConstraint("id", "task_id", name="uq_subtasks_id_task_id"),
        Index("ix_subtasks_task_status", "task_id", "status"),
        Index("ix_subtasks_assigned_to_id", "assigned_to_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    assigned_to_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[SubtaskStatusEnum] = mapped_column(
        SAEnum(SubtaskStatusEnum), default=SubtaskStatusEnum.TODO, nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    task: Mapped[Task] = relationship("Task", back_populates="subtasks")
    assigned_user: Mapped[Optional[User]] = relationship("User")
    dependency_edges: Mapped[List["SubtaskDependency"]] = relationship(
        "SubtaskDependency",
        foreign_keys="SubtaskDependency.subtask_id",
        back_populates="subtask",
        cascade="all, delete-orphan",
    )
    dependent_edges: Mapped[List["SubtaskDependency"]] = relationship(
        "SubtaskDependency",
        foreign_keys="SubtaskDependency.depends_on_subtask_id",
        back_populates="depends_on_subtask",
        cascade="all, delete-orphan",
    )
    time_entries: Mapped[List["TimeEntry"]] = relationship(
        "TimeEntry",
        back_populates="subtask",
        cascade="all, delete-orphan",
        foreign_keys="TimeEntry.subtask_id",
    )
    completion_submissions: Mapped[List["CompletionSubmission"]] = relationship(
        "CompletionSubmission",
        back_populates="subtask",
        cascade="all, delete-orphan",
        overlaps="task,completion_submissions",
    )


class SubtaskDependency(Base):
    __tablename__ = "subtask_dependencies"
    __table_args__ = (
        ForeignKeyConstraint(
            ["subtask_id", "task_id"],
            ["subtasks.id", "subtasks.task_id"],
            ondelete="CASCADE",
            name="fk_subtask_dependencies_child_same_task",
        ),
        ForeignKeyConstraint(
            ["depends_on_subtask_id", "task_id"],
            ["subtasks.id", "subtasks.task_id"],
            ondelete="CASCADE",
            name="fk_subtask_dependencies_parent_same_task",
        ),
        UniqueConstraint(
            "task_id",
            "subtask_id",
            "depends_on_subtask_id",
            name="uq_subtask_dependencies_edge",
        ),
        Index("ix_subtask_dependencies_task_child", "task_id", "subtask_id"),
        Index("ix_subtask_dependencies_task_parent", "task_id", "depends_on_subtask_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    subtask_id: Mapped[str] = mapped_column(String(36), nullable=False)
    depends_on_subtask_id: Mapped[str] = mapped_column(String(36), nullable=False)
    dependency_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    branch_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    task: Mapped[Task] = relationship("Task")
    subtask: Mapped[Subtask] = relationship(
        "Subtask",
        foreign_keys=[subtask_id],
        back_populates="dependency_edges",
    )
    depends_on_subtask: Mapped[Subtask] = relationship(
        "Subtask",
        foreign_keys=[depends_on_subtask_id],
        back_populates="dependent_edges",
    )


class SubtaskWorkflowEvent(Base):
    __tablename__ = "subtask_workflow_events"
    __table_args__ = (
        UniqueConstraint("event_key", name="uq_subtask_workflow_events_event_key"),
        Index("ix_subtask_workflow_events_task_created", "task_id", "created_at"),
        Index("ix_subtask_workflow_events_subtask_created", "subtask_id", "created_at"),
        Index("ix_subtask_workflow_events_type", "event_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    event_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    subtask_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("subtasks.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    from_status: Mapped[Optional[SubtaskStatusEnum]] = mapped_column(SAEnum(SubtaskStatusEnum), nullable=True)
    to_status: Mapped[SubtaskStatusEnum] = mapped_column(SAEnum(SubtaskStatusEnum), nullable=False)
    actor_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    blocked_predecessor_ids: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    payload: Mapped[Optional[dict]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    task: Mapped[Task] = relationship("Task")
    subtask: Mapped[Subtask] = relationship("Subtask")
    actor: Mapped[Optional[User]] = relationship("User", foreign_keys=[actor_id])


class CompletionSubmission(Base):
    __tablename__ = "completion_submissions"
    __table_args__ = (
        ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["subtask_id", "task_id"], ["subtasks.id", "subtasks.task_id"], ondelete="CASCADE"),
        Index("ix_completion_submissions_tenant_subtask_created", "tenant_id", "subtask_id", "created_at"),
        Index("ix_completion_submissions_tenant_task", "tenant_id", "task_id"),
        Index("ix_completion_submissions_tenant_status", "tenant_id", "status"),
        Index(
            "uq_completion_submissions_one_pending_review",
            "tenant_id",
            "task_id",
            "subtask_id",
            unique=True,
            postgresql_where=text("status = 'PENDING_REVIEW'"),
            sqlite_where=text("status = 'PENDING_REVIEW'"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    task_id: Mapped[str] = mapped_column(String(36), nullable=False)
    subtask_id: Mapped[str] = mapped_column(String(36), nullable=False)
    submitted_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    description_word_count: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[CompletionSubmissionStatusEnum] = mapped_column(
        SAEnum(
            CompletionSubmissionStatusEnum,
            name="completion_submission_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    approval_required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    reviewed_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    task: Mapped[Task] = relationship("Task", back_populates="completion_submissions", overlaps="subtask,completion_submissions")
    subtask: Mapped[Subtask] = relationship("Subtask", back_populates="completion_submissions", overlaps="task,completion_submissions")
    submitted_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[submitted_by_id])
    reviewed_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[reviewed_by_id])
    attachments: Mapped[List["CompletionAttachment"]] = relationship(
        "CompletionAttachment",
        back_populates="submission",
        cascade="all, delete-orphan",
    )


class CompletionAttachment(Base):
    __tablename__ = "completion_attachments"
    __table_args__ = (
        ForeignKeyConstraint(["submission_id"], ["completion_submissions.id"], ondelete="CASCADE"),
        Index("ix_completion_attachments_tenant_submission", "tenant_id", "submission_id"),
        Index("ix_completion_attachments_storage_key", "storage_key", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    submission_id: Mapped[str] = mapped_column(String(36), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    submission: Mapped[CompletionSubmission] = relationship("CompletionSubmission", back_populates="attachments")


class TimeEntry(Base):
    __tablename__ = "time_entries"
    __table_args__ = (
        CheckConstraint(
            "(task_id IS NOT NULL AND subtask_id IS NULL) OR (task_id IS NULL AND subtask_id IS NOT NULL)",
            name="ck_time_entries_exactly_one_target",
        ),
        CheckConstraint(
            "(stopped_at IS NULL AND duration_seconds IS NULL) OR "
            "(stopped_at IS NOT NULL AND duration_seconds IS NOT NULL AND duration_seconds >= 0)",
            name="ck_time_entries_duration_state",
        ),
        Index("ix_time_entries_tenant_user_started", "tenant_id", "user_id", "started_at"),
        Index("ix_time_entries_task_started", "task_id", "started_at"),
        Index("ix_time_entries_subtask_started", "subtask_id", "started_at"),
        Index("uq_time_entries_continued_from_id", "continued_from_id", unique=True,
              postgresql_where=text("continued_from_id IS NOT NULL"),
              sqlite_where=text("continued_from_id IS NOT NULL")),
        Index(
            "uq_time_entries_one_active_per_user",
            "tenant_id",
            "user_id",
            unique=True,
            postgresql_where=text("stopped_at IS NULL"),
            sqlite_where=text("stopped_at IS NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    continued_from_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    start_kind: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    stop_reason: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )
    subtask_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("subtasks.id", ondelete="CASCADE"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    stopped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[TimeEntryStatusEnum] = mapped_column(
        SAEnum(
            TimeEntryStatusEnum,
            name="time_entry_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=TimeEntryStatusEnum.ACTIVE,
        nullable=False,
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    original_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    original_stopped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    original_duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    correction_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    corrected_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    corrected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    user: Mapped[User] = relationship("User", foreign_keys=[user_id])
    task: Mapped[Optional[Task]] = relationship("Task", back_populates="time_entries", foreign_keys=[task_id])
    subtask: Mapped[Optional[Subtask]] = relationship("Subtask", back_populates="time_entries", foreign_keys=[subtask_id])
    corrected_by: Mapped[Optional[User]] = relationship("User", foreign_keys=[corrected_by_id])


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    task: Mapped[Task] = relationship("Task", back_populates="comments")
    author: Mapped[User] = relationship("User", back_populates="comments")


class TaskMessage(Base):
    __tablename__ = "task_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    mentions: Mapped[List[str]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), default=list, nullable=False
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    task: Mapped[Task] = relationship("Task", back_populates="messages")
    author: Mapped[User] = relationship("User")


class KanbanColumn(Base):
    __tablename__ = "kanban_columns"
    __table_args__ = (UniqueConstraint("order", name="uq_kanban_column_order"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    title: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    order: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)


class Achievement(Base):
    __tablename__ = "achievements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    icon: Mapped[str] = mapped_column(String(100), nullable=False)

    user_unlocks: Mapped[List["UserAchievement"]] = relationship(
        "UserAchievement", back_populates="achievement", cascade="all, delete-orphan"
    )


class UserAchievement(Base):
    __tablename__ = "user_achievements"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    achievement_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("achievements.id", ondelete="CASCADE"), primary_key=True
    )
    unlocked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship("User", backref="achievement_links")
    achievement: Mapped[Achievement] = relationship("Achievement", back_populates="user_unlocks")


class Badge(Base):
    __tablename__ = "badges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    tier: Mapped[str] = mapped_column(String(50), nullable=False)
    tier_group: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    tier_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    bonus_xp: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    image_asset_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    state: Mapped[BadgeStateEnum] = mapped_column(
        SAEnum(BadgeStateEnum), default=BadgeStateEnum.DRAFT, nullable=False
    )
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    ruleset: Mapped[Optional["BadgeRule"]] = relationship(
        "BadgeRule", back_populates="badge", cascade="all, delete-orphan", uselist=False
    )
    progress: Mapped[List["UserBadgeProgress"]] = relationship(
        "UserBadgeProgress", back_populates="badge", cascade="all, delete-orphan"
    )


class BadgeRule(Base):
    __tablename__ = "badge_rules"

    badge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("badges.id", ondelete="CASCADE"), primary_key=True
    )
    rules: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    badge: Mapped[Badge] = relationship("Badge", back_populates="ruleset")


class UserBadgeProgress(Base):
    __tablename__ = "user_badge_progress"
    __table_args__ = (UniqueConstraint("user_id", "badge_id", name="uq_user_badge_progress"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    badge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("badges.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[BadgeProgressStatusEnum] = mapped_column(
        SAEnum(BadgeProgressStatusEnum), default=BadgeProgressStatusEnum.LOCKED, nullable=False
    )
    progress_value: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    progress_state: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    earned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    user: Mapped[User] = relationship("User", backref="badge_progress")
    badge: Mapped[Badge] = relationship("Badge", back_populates="progress")


class RewardIcon(Base):
    __tablename__ = "reward_icons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)


class Reward(Base):
    __tablename__ = "rewards"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    image_source: Mapped[RewardImageSourceEnum] = mapped_column(
        SAEnum(RewardImageSourceEnum), default=RewardImageSourceEnum.LIBRARY, nullable=False
    )
    image_ref: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    xp_required: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    dept_whitelist: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    auto_redeem: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_multiple_claims: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[RewardStatusEnum] = mapped_column(
        SAEnum(RewardStatusEnum), default=RewardStatusEnum.ACTIVE, nullable=False
    )
    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    created_by: Mapped[Optional[User]] = relationship(
        "User", foreign_keys=[created_by_id], backref="rewards_created"
    )
    updated_by: Mapped[Optional[User]] = relationship(
        "User", foreign_keys=[updated_by_id], backref="rewards_updated"
    )
    claims: Mapped[List["RewardClaim"]] = relationship(
        "RewardClaim", back_populates="reward", cascade="all, delete-orphan"
    )


class RewardClaim(Base):
    __tablename__ = "reward_claims"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    reward_id: Mapped[str] = mapped_column(String(36), ForeignKey("rewards.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[RewardClaimStatusEnum] = mapped_column(
        SAEnum(RewardClaimStatusEnum), default=RewardClaimStatusEnum.PENDING, nullable=False
    )
    xp_spent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    approver_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    reward: Mapped[Reward] = relationship("Reward", back_populates="claims")
    user: Mapped[User] = relationship("User", foreign_keys=[user_id], back_populates="reward_claims")
    approver: Mapped[Optional[User]] = relationship(
        "User", foreign_keys=[approver_id], back_populates="approved_reward_claims"
    )


class RewardLog(Base):
    __tablename__ = "reward_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    actor_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    subject_type: Mapped[str] = mapped_column(String(100), nullable=False)
    subject_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    action: Mapped[RewardLogActionEnum] = mapped_column(SAEnum(RewardLogActionEnum), nullable=False)
    meta: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    actor: Mapped[Optional[User]] = relationship("User")


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    scope_type: Mapped[ApprovalScopeTypeEnum] = mapped_column(
        SAEnum(
            ApprovalScopeTypeEnum,
            name="approval_scope_type_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    scope_id: Mapped[str] = mapped_column(String(36), nullable=False)
    requested_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    approver_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    order_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[ApprovalStatusEnum] = mapped_column(
        SAEnum(
            ApprovalStatusEnum,
            name="approval_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=ApprovalStatusEnum.PENDING,
        nullable=False,
    )
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sla_hours: Mapped[int] = mapped_column(Integer, default=12, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    acted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    requester: Mapped[User] = relationship("User", foreign_keys=[requested_by])
    approver: Mapped[Optional[User]] = relationship("User", foreign_keys=[approver_id])


class TaskTransferRequest(Base):
    __tablename__ = "task_transfer_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    from_user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    to_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=False
    )
    requested_by_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=False
    )
    approved_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[TaskTransferStatusEnum] = mapped_column(
        SAEnum(
            TaskTransferStatusEnum,
            name="task_transfer_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=TaskTransferStatusEnum.PENDING,
        nullable=False,
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    acted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    task: Mapped["Task"] = relationship("Task")
    from_user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[from_user_id])
    to_user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[to_user_id])
    requested_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[requested_by_id])
    approved_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[approved_by_id])


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    actor_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    payload: Mapped[Optional[dict]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    actor: Mapped[Optional[User]] = relationship("User", foreign_keys=[actor_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_created_at", "created_at"),
        Index("ix_audit_logs_entity_type", "entity_type"),
        Index("ix_audit_logs_actor_id", "actor_id"),
        Index("ix_audit_logs_category", "category"),
        Index("ix_audit_logs_action", "action"),
        Index("ix_audit_logs_status", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    actor_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_role: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    action: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[AuditLogCategoryEnum] = mapped_column(
        SAEnum(
            AuditLogCategoryEnum,
            name="audit_log_category_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    entity_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    target_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    approval_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    old_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    new_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    before: Mapped[Optional[dict]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    after: Mapped[Optional[dict]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source: Mapped[AuditLogSourceEnum] = mapped_column(
        SAEnum(
            AuditLogSourceEnum,
            name="audit_log_source_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=AuditLogSourceEnum.MANUAL,
    )
    severity: Mapped[AuditLogSeverityEnum] = mapped_column(
        SAEnum(
            AuditLogSeverityEnum,
            name="audit_log_severity_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=AuditLogSeverityEnum.INFO,
    )
    status: Mapped[AuditLogStatusEnum] = mapped_column(
        SAEnum(
            AuditLogStatusEnum,
            name="audit_log_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=AuditLogStatusEnum.SUCCESS,
    )
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    trigger: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    route: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    method: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    metadata_payload: Mapped[Optional[dict]] = mapped_column(
        "metadata", JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    actor: Mapped[Optional[User]] = relationship("User", foreign_keys=[actor_id])


class AuditRetentionConfig(Base):
    __tablename__ = "audit_retention_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    retention_days: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
    last_applied_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class ToolCategory(Base):
    __tablename__ = "tool_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[ToolCategoryStatusEnum] = mapped_column(
        SAEnum(
            ToolCategoryStatusEnum,
            name="tool_category_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=ToolCategoryStatusEnum.ACTIVE,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    tools: Mapped[List["Tool"]] = relationship("Tool", back_populates="category")


class Tool(Base):
    __tablename__ = "tools"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    website_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    preview_image_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    category_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tool_categories.id"), nullable=True)
    tags: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    pricing_type: Mapped[ToolPricingTypeEnum] = mapped_column(
        SAEnum(
            ToolPricingTypeEnum,
            name="tool_pricing_type_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=ToolPricingTypeEnum.FREE,
        nullable=False,
    )
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[ToolStatusEnum] = mapped_column(
        SAEnum(
            ToolStatusEnum,
            name="tool_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        default=ToolStatusEnum.PENDING,
        nullable=False,
    )
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=False)
    approved_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    review_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    category: Mapped[Optional[ToolCategory]] = relationship("ToolCategory", back_populates="tools")
    creator: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])
    approver: Mapped[Optional["User"]] = relationship("User", foreign_keys=[approved_by])
    favorites: Mapped[List["UserFavoriteTool"]] = relationship(
        "UserFavoriteTool", back_populates="tool", cascade="all, delete-orphan"
    )


class UserFavoriteTool(Base):
    __tablename__ = "user_favorite_tools"
    __table_args__ = (
        UniqueConstraint("user_id", "tool_id", name="uq_user_favorite_tool"),
    )

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    tool_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    user: Mapped["User"] = relationship("User")
    tool: Mapped["Tool"] = relationship("Tool", back_populates="favorites")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_tenant_user_created", "tenant_id", "user_id", "created_at"),
        Index(
            "uq_notifications_user_dedupe_key",
            "user_id",
            "dedupe_key",
            unique=True,
            postgresql_where=text("dedupe_key IS NOT NULL"),
            sqlite_where=text("dedupe_key IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    type: Mapped[NotificationTypeEnum] = mapped_column(SAEnum(NotificationTypeEnum), nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[Optional[NotificationEntityTypeEnum]] = mapped_column(
        SAEnum(
            NotificationEntityTypeEnum,
            name="notification_entity_type_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=True,
    )
    entity_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    deep_link: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    related_task_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    related_reward_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    related_chat_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped[User] = relationship("User", back_populates="notifications")
    chat: Mapped[Optional["ChatConversation"]] = relationship("ChatConversation", back_populates="notifications")
    outbox_messages: Mapped[List["NotificationOutbox"]] = relationship(
        "NotificationOutbox", back_populates="notification", cascade="all, delete-orphan"
    )


class NotificationOutbox(Base):
    __tablename__ = "notification_outbox"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uq_notification_outbox_dedupe_key"),
        Index("ix_notification_outbox_status_next", "status", "next_attempt_at"),
        Index("ix_notification_outbox_tenant_recipient", "tenant_id", "recipient_user_id"),
        Index("ix_notification_outbox_event", "event_type", "event_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    notification_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("notifications.id", ondelete="CASCADE"), nullable=True
    )
    recipient_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    channel: Mapped[NotificationOutboxChannelEnum] = mapped_column(
        SAEnum(NotificationOutboxChannelEnum), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), default=dict, nullable=False)
    status: Mapped[NotificationOutboxStatusEnum] = mapped_column(
        SAEnum(NotificationOutboxStatusEnum), default=NotificationOutboxStatusEnum.PENDING, nullable=False
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    notification: Mapped[Optional[Notification]] = relationship("Notification", back_populates="outbox_messages")
    recipient: Mapped[User] = relationship("User", foreign_keys=[recipient_user_id])


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    endpoint: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    device_label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship("User", back_populates="push_subscriptions")


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("user_id", "module", name="uq_notification_preferences_user_module"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    module: Mapped[str] = mapped_column(String(50), nullable=False)
    push_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    user: Mapped[User] = relationship("User", back_populates="notification_preferences")

class ChatConversation(Base):
    __tablename__ = "chat_conversations"
    __table_args__ = (
        Index("ix_chat_conversations_tenant_updated", "tenant_id", "updated_at"),
        Index("ix_chat_conversations_tenant_last_message", "tenant_id", "last_message_at"),
        Index("ix_chat_conversations_type", "type"),
        Index("ix_chat_conversations_team_id", "team_id"),
        Index("ix_chat_conversations_project_id", "project_id"),
        Index("ix_chat_conversations_direct_key", "tenant_id", "direct_key"),
        UniqueConstraint("tenant_id", "direct_key", name="uq_chat_conversation_direct_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    type: Mapped[ChatConversationTypeEnum] = mapped_column(SAEnum(ChatConversationTypeEnum), nullable=False)
    project_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    team_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    direct_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_private: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    created_by: Mapped[Optional["User"]] = relationship("User", back_populates="created_conversations")
    participants: Mapped[List["ChatParticipant"]] = relationship(
        "ChatParticipant", back_populates="conversation", cascade="all, delete-orphan"
    )
    messages: Mapped[List["ChatMessage"]] = relationship(
        "ChatMessage", back_populates="conversation", cascade="all, delete-orphan", order_by="ChatMessage.created_at"
    )
    pinned_messages: Mapped[List["PinnedMessage"]] = relationship(
        "PinnedMessage", back_populates="conversation", cascade="all, delete-orphan"
    )
    notifications: Mapped[List["Notification"]] = relationship(
        "Notification", back_populates="chat"
    )


class ChatParticipant(Base):
    __tablename__ = "chat_participants"
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_chat_participant"),
        Index("ix_chat_participants_user_id", "user_id"),
        Index("ix_chat_participants_conversation_id", "conversation_id"),
        Index("ix_chat_participants_user_conversation", "user_id", "conversation_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[ChatMemberRoleEnum] = mapped_column(
        SAEnum(ChatMemberRoleEnum), default=ChatMemberRoleEnum.MEMBER, nullable=False
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_read_message_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    last_read_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    is_muted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    conversation: Mapped["ChatConversation"] = relationship("ChatConversation", back_populates="participants")
    user: Mapped["User"] = relationship("User", back_populates="chat_participations")


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_conversation_created", "conversation_id", "created_at"),
        Index("ix_chat_messages_conversation_created_id", "conversation_id", "created_at", "id"),
        Index("ix_chat_messages_client_id", "conversation_id", "sender_id", "client_id"),
        Index("ix_chat_messages_content", "content"),
        Index("ix_chat_messages_sender_id", "sender_id"),
        Index("ix_chat_messages_reply_to", "reply_to_message_id"),
        UniqueConstraint("conversation_id", "sender_id", "client_id", name="uq_chat_message_client_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False
    )
    sender_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    message_type: Mapped[ChatMessageTypeEnum] = mapped_column(
        SAEnum(ChatMessageTypeEnum), default=ChatMessageTypeEnum.TEXT, nullable=False
    )
    client_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    reply_to_message_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True
    )
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    conversation: Mapped["ChatConversation"] = relationship("ChatConversation", back_populates="messages")
    sender: Mapped["User"] = relationship("User", back_populates="chat_messages")
    reply_to: Mapped[Optional["ChatMessage"]] = relationship("ChatMessage", remote_side=[id])
    reactions: Mapped[List["MessageReaction"]] = relationship(
        "MessageReaction", back_populates="message", cascade="all, delete-orphan"
    )
    attachments: Mapped[List["MessageAttachment"]] = relationship(
        "MessageAttachment", back_populates="message", cascade="all, delete-orphan"
    )
    mentions: Mapped[List["MessageMention"]] = relationship(
        "MessageMention", back_populates="message", cascade="all, delete-orphan"
    )


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_reaction"),
        Index("ix_message_reactions_message_id", "message_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    emoji: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    message: Mapped["ChatMessage"] = relationship("ChatMessage", back_populates="reactions")
    user: Mapped["User"] = relationship("User")


class MessageAttachment(Base):
    __tablename__ = "message_attachments"
    __table_args__ = (Index("ix_message_attachments_message_id", "message_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    original_file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    message: Mapped["ChatMessage"] = relationship("ChatMessage", back_populates="attachments")


class PinnedMessage(Base):
    __tablename__ = "pinned_messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "message_id", name="uq_pinned_message"),
        Index("ix_pinned_messages_conversation_id", "conversation_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=False
    )
    pinned_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    conversation: Mapped["ChatConversation"] = relationship("ChatConversation", back_populates="pinned_messages")
    message: Mapped["ChatMessage"] = relationship("ChatMessage")
    pinned_by_user: Mapped["User"] = relationship("User")


class MessageMention(Base):
    __tablename__ = "message_mentions"
    __table_args__ = (
        UniqueConstraint("message_id", "mentioned_user_id", name="uq_message_mention"),
        Index("ix_message_mentions_mentioned_user_id", "mentioned_user_id"),
    )

    message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_messages.id", ondelete="CASCADE"), primary_key=True
    )
    mentioned_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )

    message: Mapped["ChatMessage"] = relationship("ChatMessage", back_populates="mentions")
    mentioned_user: Mapped["User"] = relationship("User")


class SmtpConfig(Base):
    __tablename__ = "smtp_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    password: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    encryption: Mapped[str] = mapped_column(String(50), default="tls", nullable=False)




class OwnerResetToken(Base):
    __tablename__ = "owner_reset_tokens"

    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    otp_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    owner: Mapped["User"] = relationship("User")

class ApiConfig(Base):
    __tablename__ = "api_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    api_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)


class PointsTableConfig(Base):
    __tablename__ = "points_table_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    points_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    task_creation_points: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    clarity_points_per_star: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    manager_overdue_penalty: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class ReleaseNotes(Base):
    __tablename__ = "release_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    version_label: Mapped[str] = mapped_column(String(255), nullable=False)
    content_mode: Mapped[str] = mapped_column(String(16), default="text", nullable=False)
    details_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    html: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    css: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    js: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    updated_by: Mapped[Optional["User"]] = relationship("User")


class MultipleApiConfig(Base):
    __tablename__ = "multiple_api_configs"
    __table_args__ = (UniqueConstraint("provider", name="uq_multiple_api_config_provider"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    provider: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    api_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class MultipleSmtpConfig(Base):
    __tablename__ = "multiple_smtp_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    password: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    encryption: Mapped[str] = mapped_column(String(50), default="tls", nullable=False)
    notification_types: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    notification_type: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class OAuthConfig(Base):
    __tablename__ = "oauth_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    client_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    client_secret: Mapped[str] = mapped_column(String(255), nullable=False)
    api_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True)
    redirect_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    scopes: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    n8n_integration: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class ExternalStorageOAuthCredential(Base):
    __tablename__ = "external_storage_oauth_credentials"
    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", name="uq_external_storage_oauth_tenant_provider"),
        Index("ix_external_storage_oauth_tenant_provider", "tenant_id", "provider"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    provider: Mapped[StorageProviderEnum] = mapped_column(SAEnum(StorageProviderEnum), nullable=False)
    connected_by_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    provider_account_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    token_uri: Mapped[str] = mapped_column(String(500), nullable=False, default="https://oauth2.googleapis.com/token")
    scopes: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class TaskTemplate(Base):
    __tablename__ = "task_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    priority: Mapped[TaskPriorityEnum] = mapped_column(
        SAEnum(TaskPriorityEnum), default=TaskPriorityEnum.MEDIUM, nullable=False
    )
    team: Mapped[str] = mapped_column(String(255), default="General", nullable=False)
    subtasks: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    attachments: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    estimated_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tags: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    featured_image: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    department_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    recurrence_rule: Mapped[RecurrenceRuleEnum] = mapped_column(
        SAEnum(RecurrenceRuleEnum), default=RecurrenceRuleEnum.NONE, nullable=False
    )
    created_by_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    department: Mapped[Optional[Department]] = relationship("Department", back_populates="task_templates")
    creator: Mapped[User] = relationship("User", back_populates="task_templates")


class TaskLifecycleEvent(Base):
    """Immutable database observations, deliberately independent of cascading business FKs."""

    __tablename__ = "task_lifecycle_events"
    __table_args__ = (
        Index("ix_task_lifecycle_tenant_task_id", "tenant_id", "task_id", "id"),
        Index("ix_task_lifecycle_entry_id", "time_entry_id", "id"),
        Index("ix_task_lifecycle_subtask_id", "subtask_id", "id"),
        Index("ix_task_lifecycle_task_id", "task_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    task_id: Mapped[str] = mapped_column(String(36), nullable=False)
    subtask_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    time_entry_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    previous_status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    new_status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    actor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, nullable=False)


class TaskLifecycleCoverage(Base):
    __tablename__ = "task_lifecycle_coverage"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# Add relationships to existing models
Department.task_templates: Mapped[List["TaskTemplate"]] = relationship("TaskTemplate", back_populates="department")
User.task_templates: Mapped[List["TaskTemplate"]] = relationship("TaskTemplate", back_populates="creator")


class MediaFile(Base):
    __tablename__ = "media_files"
    __table_args__ = (
        Index("ix_media_files_user_created", "user_id", "created_at"),
        Index("ix_media_files_department_created", "department_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    department_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    media_type: Mapped[MediaFileTypeEnum] = mapped_column(SAEnum(MediaFileTypeEnum), nullable=False)
    bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    checksum: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    crop_metadata: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    status: Mapped[MediaFileStatusEnum] = mapped_column(
        SAEnum(MediaFileStatusEnum), default=MediaFileStatusEnum.PENDING, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    owner: Mapped["User"] = relationship(
        "User", back_populates="media_files", foreign_keys=[user_id]
    )
    department: Mapped[Optional["Department"]] = relationship("Department")


class MediaItem(Base):
    __tablename__ = "media_items"
    __table_args__ = (
        Index("ix_media_items_owner_created", "owner_id", "created_at"),
        Index("ix_media_items_category", "category"),
        Index(
            "ix_media_items_filename_trgm",
            "filename",
            postgresql_using="gin",
            postgresql_ops={"filename": "gin_trgm_ops"},
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    ext: Mapped[str] = mapped_column(String(32), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    category: Mapped[MediaCategoryEnum] = mapped_column(SAEnum(MediaCategoryEnum), nullable=False)
    storage_provider: Mapped[StorageProviderEnum] = mapped_column(
        SAEnum(StorageProviderEnum), nullable=False
    )
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    public_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    checksum_sha256: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    original_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("media_items.id", ondelete="SET NULL"), nullable=True
    )

    owner: Mapped["User"] = relationship(
        "User", back_populates="media_items", foreign_keys=[owner_id]
    )
    original: Mapped[Optional["MediaItem"]] = relationship(
        "MediaItem",
        remote_side="MediaItem.id",
        back_populates="versions",
        foreign_keys=[original_id],
    )
    versions: Mapped[List["MediaItem"]] = relationship(
        "MediaItem", back_populates="original", cascade="all, delete-orphan"
    )


class Level(Base):
    __tablename__ = "levels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    bg_image: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    season_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("seasons.id", ondelete="CASCADE"), nullable=True
    )
    created_by_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    created_by: Mapped["User"] = relationship("User", back_populates="created_levels")
    season: Mapped[Optional["Season"]] = relationship("Season", back_populates="levels")
    nodes: Mapped[List["LevelNode"]] = relationship("LevelNode", back_populates="level", cascade="all, delete-orphan")
    edges: Mapped[List["LevelEdge"]] = relationship("LevelEdge", back_populates="level", cascade="all, delete-orphan")
    events: Mapped[List["LevelEvent"]] = relationship("LevelEvent", back_populates="level", cascade="all, delete-orphan")


class LevelNode(Base):
    __tablename__ = "level_nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    level_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("levels.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[NodeTypeEnum] = mapped_column(SAEnum(NodeTypeEnum), nullable=False)
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    xp_threshold: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reward_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("rewards.id", ondelete="SET NULL"), nullable=True
    )
    require_confirm: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    animation_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    level: Mapped["Level"] = relationship("Level", back_populates="nodes")
    reward: Mapped[Optional["Reward"]] = relationship("Reward", back_populates="level_nodes")
    events: Mapped[List["LevelEvent"]] = relationship("LevelEvent", back_populates="node", cascade="all, delete-orphan")
    outgoing_edges: Mapped[List["LevelEdge"]] = relationship(
        "LevelEdge",
        back_populates="source_node",
        foreign_keys="LevelEdge.from_node",
        cascade="all, delete-orphan"
    )
    incoming_edges: Mapped[List["LevelEdge"]] = relationship(
        "LevelEdge",
        back_populates="target_node",
        foreign_keys="LevelEdge.to_node",
        cascade="all, delete-orphan"
    )


class LevelEdge(Base):
    __tablename__ = "level_edges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    level_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("levels.id", ondelete="CASCADE"), nullable=False
    )
    from_node: Mapped[str] = mapped_column(
        String(36), ForeignKey("level_nodes.id", ondelete="CASCADE"), nullable=False
    )
    to_node: Mapped[str] = mapped_column(
        String(36), ForeignKey("level_nodes.id", ondelete="CASCADE"), nullable=False
    )
    path: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    level: Mapped["Level"] = relationship("Level", back_populates="edges")
    source_node: Mapped["LevelNode"] = relationship(
        "LevelNode",
        back_populates="outgoing_edges",
        foreign_keys=[from_node]
    )
    target_node: Mapped["LevelNode"] = relationship(
        "LevelNode",
        back_populates="incoming_edges",
        foreign_keys=[to_node]
    )



class LevelEvent(Base):
    __tablename__ = "level_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    level_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("levels.id", ondelete="CASCADE"), nullable=False
    )
    node_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("level_nodes.id", ondelete="CASCADE"), nullable=True
    )
    event_type: Mapped[EventTypeEnum] = mapped_column(SAEnum(EventTypeEnum), nullable=False)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    level: Mapped["Level"] = relationship("Level", back_populates="events")
    node: Mapped[Optional["LevelNode"]] = relationship("LevelNode", back_populates="events")
    user: Mapped["User"] = relationship("User", back_populates="level_events")


class Season(Base):
    __tablename__ = "seasons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    theme: Mapped[str] = mapped_column(String(255), nullable=False)
    bonus_multiplier: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    levels: Mapped[List["Level"]] = relationship("Level", back_populates="season", cascade="all, delete-orphan")
    user_progress: Mapped[List["UserProgress"]] = relationship("UserProgress", back_populates="season", cascade="all, delete-orphan")


class UserProgress(Base):
    __tablename__ = "user_progress"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    level_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("levels.id", ondelete="CASCADE"), nullable=False
    )
    season_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("seasons.id", ondelete="CASCADE"), nullable=True
    )
    current_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_points_earned: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    level_unlocked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="user_progress")
    level: Mapped["Level"] = relationship("Level", back_populates="user_progress")
    season: Mapped[Optional["Season"]] = relationship("Season", back_populates="user_progress")


class FeatureFlag(Base):
    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(String(150), primary_key=True)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    group: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(400), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


# Add relationships to existing models
User.level_events: Mapped[List["LevelEvent"]] = relationship("LevelEvent", back_populates="user", cascade="all, delete-orphan")
User.user_progress: Mapped[List["UserProgress"]] = relationship("UserProgress", back_populates="user", cascade="all, delete-orphan")
User.created_levels: Mapped[List["Level"]] = relationship("Level", back_populates="created_by", cascade="all, delete-orphan")
Level.created_by: Mapped["User"] = relationship("User", back_populates="created_levels")
Level.user_progress: Mapped[List["UserProgress"]] = relationship("UserProgress", back_populates="level", cascade="all, delete-orphan")
Reward.level_nodes: Mapped[List["LevelNode"]] = relationship("LevelNode", back_populates="reward")

# Register transactional actor context and bootstrap/test DDL only after models exist.
from .lifecycle import context as _lifecycle_context  # noqa: E402,F401
from .lifecycle.schema_v1 import register_metadata as _register_lifecycle_metadata  # noqa: E402

_register_lifecycle_metadata(Base.metadata)


