from functools import lru_cache
from typing import List, Literal, Optional

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    app_name: str = "Vee Task Manager API"
    environment: str = "development"
    database_url: str = "sqlite:///./vee_task_manager.db"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_pool_recycle: int = 1800

    access_token_expire_minutes: int = 60 * 24  # 24 hours
    refresh_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    jwt_secret_key: str = "change_me"
    jwt_refresh_secret_key: str = "change_me_refresh"
    jwt_algorithm: str = "HS256"
    password_reset_url: Optional[str] = None
    password_reset_expire_minutes: int = Field(default=15, ge=5, le=60)
    password_reset_requests_per_email: int = Field(default=3, ge=1, le=20)
    password_reset_requests_per_ip: int = Field(default=100, ge=1, le=1000)
    smtp_secret_keys: List[str] = Field(default_factory=list, repr=False)
    smtp_private_host_allowlist: List[str] = Field(default_factory=list)
    smtp_plaintext_host_allowlist: List[str] = Field(default_factory=list)
    smtp_ca_file: Optional[str] = None
    smtp_delivery_enabled: bool = True
    bcrypt_rounds: int = 12
    default_tenant_id: str = "00000000-0000-0000-0000-000000000000"

    media_root: str = "./media"
    media_public_base: str = "/uploads"
    storage_provider: str = "local"
    media_max_file_size_mb: int = 200
    max_request_body_mb: int = 250
    media_presign_rate_limit: int = 30
    media_presign_rate_window_seconds: int = 60
    media_presign_rate_redis_url: Optional[str] = None
    redis_url: Optional[str] = None
    cache_redis_url: Optional[str] = None
    cache_default_ttl_seconds: int = 30
    cache_prefix: str = "zeaplay"
    task_list_cache_ttl_seconds: int = 5
    kanban_page_size_per_column: int = 20
    prefetch_pages: int = 3
    minio_endpoint: str = "https://zbucket.urlfactory.website"
    minio_access_key: Optional[str] = None
    minio_secret_key: Optional[str] = None
    minio_region: str = "us-east-1"
    minio_bucket_attachments: str = "zea-play-attachments"
    minio_bucket_ticket_attachments: str = "zeaplay-ticket-attachments"
    minio_public_base: str = "https://zbucket.urlfactory.website"

    supabase_url: Optional[str] = None
    supabase_anon_key: Optional[str] = None
    supabase_bucket: Optional[str] = None
    supabase_service_role_key: Optional[str] = None
    supabase_public_url: Optional[str] = None

    gdrive_service_account_json_path: Optional[str] = None
    gdrive_parent_folder_id: Optional[str] = None
    google_service_account_json_path: Optional[str] = None
    google_client_email: Optional[str] = None
    google_private_key: Optional[str] = None
    google_drive_folder_id: Optional[str] = None
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    google_redirect_uri: Optional[str] = None

    n8n_webhook_url: Optional[str] = None
    enable_n8n_forwarding: bool = False
    webex_bot_token: Optional[str] = None
    webex_room_id: Optional[str] = None
    webex_api_base: str = "https://webexapis.com/v1"

    vapid_public_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("VAPID_PUBLIC_KEY", "VEE_VAPID_PUBLIC_KEY"),
    )
    vapid_private_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("VAPID_PRIVATE_KEY", "VEE_VAPID_PRIVATE_KEY"),
    )
    vapid_subject: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("VAPID_SUBJECT", "VEE_VAPID_SUBJECT"),
    )

    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = "admin123"

    cors_allow_origins: List[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://localhost:3000",
            "http://localhost:3001",
            "http://localhost:3002",
            "http://frontend:80",
            "http://127.0.0.1:8000",
            "http://localhost:8000",
            "http://127.0.0.1:3000",
            "http://localhost:6300",
            "http://127.0.0.1:6300",
            "http://167.86.108.178:6300",
            "http://167.86.108.178",
            "https://playapi.zeacrm.com",
            "https://play.zeacrm.com",
            "http://167.86.108.178:6311",
        ]
    )
    cors_allow_credentials: bool = True
    cors_allow_methods: List[str] = Field(default_factory=lambda: ["*"])
    cors_allow_headers: List[str] = Field(default_factory=lambda: ["*"])
    websocket_trusted_origins: List[str] = Field(default_factory=list)
    websocket_require_origin: bool = False
    websocket_require_ticket: bool = False
    websocket_ticket_expire_minutes: int = 2
    websocket_max_message_bytes: int = 64 * 1024
    websocket_max_connections_per_user: int = 6
    realtime_outbox_enabled: bool = False
    realtime_outbox_categories: List[Literal["chat", "task", "ticket"]] = Field(default_factory=list)
    realtime_max_event_bytes: int = Field(default=262144, ge=1024, le=2097152)
    realtime_queue_size: int = Field(default=128, ge=1, le=4096)
    realtime_send_timeout: float = Field(default=2.0, gt=0, le=30)
    realtime_outbox_max_pending: int = Field(default=100000, ge=1)
    realtime_outbox_retention_days: int = Field(default=7, ge=1, le=3650)
    bootstrap_schema: bool = True
    active_timer_admin_limit: int = Field(default=5, ge=1, le=100)
    active_timer_owner_limit: int = Field(default=5, ge=1, le=100)

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_prefix="VEE_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
