from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
from typing import List

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_active_user, get_current_admin, get_current_owner
from ..integrations import trigger_n8n_event
from ..services import audit_logger

router = APIRouter(prefix="/config", tags=["config"])

DEFAULT_EMAIL_TEMPLATES: dict[str, dict[str, str]] = {
    "welcome_password": {
        "subject": "Welcome to Zea Play",
        "body": "Welcome aboard! Your account is ready. If you requested a password reset, follow the instructions in the app.",
    },
    "task_notifications": {
        "subject": "Task update",
        "body": "This is a test email for task and workflow alerts.",
    },
    "achievement_notifications": {
        "subject": "Achievement unlocked",
        "body": "This is a test email for achievements and badges.",
    },
    "reward_notifications": {
        "subject": "Rewards and product updates",
        "body": "This is a test email for new rewards and product updates.",
    },
    "system_alerts": {
        "subject": "System status update",
        "body": "This is a test email for system status and maintenance notices.",
    },
    "support_notifications": {
        "subject": "Support request received",
        "body": "This is a test email for support requests and helpdesk notifications.",
    },
}


def _get_or_create_api_config(db: Session) -> models.ApiConfig:
    api_config = db.get(models.ApiConfig, 1)
    if not api_config:
        api_config = models.ApiConfig(id=1, provider="Google Gemini", api_key=None)
        db.add(api_config)
        db.commit()
        db.refresh(api_config)
    return api_config


def _get_or_create_points_config(db: Session) -> tuple[models.PointsTableConfig, bool]:
    inspector = inspect(db.bind)
    if "points_table_config" not in inspector.get_table_names():
        models.PointsTableConfig.__table__.create(bind=db.bind, checkfirst=True)
    points_config = db.get(models.PointsTableConfig, 1)
    created = False
    if not points_config:
        points_config = models.PointsTableConfig(id=1)
        db.add(points_config)
        db.commit()
        db.refresh(points_config)
        created = True
    return points_config, created


def _ensure_email_templates(db: Session) -> None:
    inspector = inspect(db.bind)
    if "email_templates" not in inspector.get_table_names():
        models.EmailTemplate.__table__.create(bind=db.bind, checkfirst=True)
    existing = {
        template.notification_type: template
        for template in db.query(models.EmailTemplate).all()
    }
    created = False
    for notification_type, values in DEFAULT_EMAIL_TEMPLATES.items():
        if notification_type in existing:
            continue
        template = models.EmailTemplate(
            notification_type=notification_type,
            subject=values["subject"],
            body=values["body"],
        )
        db.add(template)
        created = True
    if created:
        db.commit()


@router.get("/api", response_model=schemas.ApiConfigRead)
def get_api_config(db: Session = Depends(get_db), _: models.User = Depends(get_current_active_user)):
    return _get_or_create_api_config(db)


@router.patch("/api", response_model=schemas.ApiConfigRead)
def update_api_config(
    payload: schemas.ApiConfigUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    api_config = _get_or_create_api_config(db)
    api_config.provider = payload.provider
    api_config.api_key = payload.api_key
    db.commit()
    db.refresh(api_config)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="API_CONFIG_UPDATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"provider": payload.provider},
        )
    )
    return api_config


@router.get("/points", response_model=schemas.PointsTableConfigRead)
def get_points_table_config(
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_owner),
):
    points_config, created = _get_or_create_points_config(db)
    if created:
        payload = schemas.PointsTableConfigRead.model_validate(points_config).model_dump()
        trigger_n8n_event("points_table.created", payload)
    return points_config


@router.patch("/points", response_model=schemas.PointsTableConfigRead)
def update_points_table_config(
    payload: schemas.PointsTableConfigUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_owner),
):
    points_config, created = _get_or_create_points_config(db)
    if created:
        payload_created = schemas.PointsTableConfigRead.model_validate(points_config).model_dump()
        trigger_n8n_event("points_table.created", payload_created)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(points_config, key, value)
    db.commit()
    db.refresh(points_config)
    payload_updated = schemas.PointsTableConfigRead.model_validate(points_config).model_dump()
    trigger_n8n_event("points_table.updated", payload_updated)
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action="POINTS_CONFIG_UPDATED",
            category=models.AuditLogCategoryEnum.SYSTEM,
            source=models.AuditLogSourceEnum.MANUAL,
            metadata={"fields": list(payload.model_dump(exclude_unset=True).keys())},
        )
    )
    return points_config


# ---------------------------------------------------------------------------#
# Multiple SMTP Configurations
# ---------------------------------------------------------------------------#


@router.get("/email-templates", response_model=List[schemas.EmailTemplateRead])
def list_email_templates(
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    _ensure_email_templates(db)
    return db.query(models.EmailTemplate).all()


@router.put("/email-templates/{notification_type}", response_model=schemas.EmailTemplateRead)
def update_email_template(
    notification_type: str,
    payload: schemas.EmailTemplateUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    _ensure_email_templates(db)
    template = (
        db.query(models.EmailTemplate)
        .filter(models.EmailTemplate.notification_type == notification_type)
        .first()
    )
    defaults = DEFAULT_EMAIL_TEMPLATES.get(notification_type)

    if not template:
        if not defaults and (payload.subject is None or payload.body is None):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Subject and body are required for new templates.",
            )
        template = models.EmailTemplate(
            notification_type=notification_type,
            subject=defaults["subject"] if defaults else payload.subject or "",
            body=defaults["body"] if defaults else payload.body or "",
        )
        db.add(template)

    if payload.subject is not None:
        template.subject = payload.subject
    if payload.body is not None:
        template.body = payload.body

    db.commit()
    db.refresh(template)
    return template


# ---------------------------------------------------------------------------#
# OAuth Configurations
# ---------------------------------------------------------------------------#


def _rotate_if_requested(oauth_config: models.OAuthConfig, rotate: schemas.OAuthCredentialsRotate) -> None:
    if rotate.rotate_client_id:
        oauth_config.client_id = token_urlsafe(18)
    if rotate.rotate_client_secret:
        oauth_config.client_secret = token_urlsafe(36)
    if rotate.rotate_api_key:
        oauth_config.api_key = token_urlsafe(24)


def _ensure_oauth_schema(db: Session) -> None:
    """Ensure legacy databases are upgraded with the multi-client OAuth columns."""
    inspector = inspect(db.bind)
    table_names = inspector.get_table_names()
    dialect = db.bind.dialect.name

    if "oauth_config" not in table_names:
        models.OAuthConfig.__table__.create(bind=db.bind, checkfirst=True)
        return

    existing_columns = {column["name"] for column in inspector.get_columns("oauth_config")}
    with db.begin_nested():
        if "name" not in existing_columns:
            db.execute(text("ALTER TABLE oauth_config ADD COLUMN name VARCHAR(255) DEFAULT ''"))
        if "redirect_url" not in existing_columns:
            db.execute(text("ALTER TABLE oauth_config ADD COLUMN redirect_url VARCHAR(500) DEFAULT ''"))
        if "client_id" not in existing_columns:
            db.execute(text("ALTER TABLE oauth_config ADD COLUMN client_id VARCHAR(255) DEFAULT ''"))
        if "client_secret" not in existing_columns:
            db.execute(text("ALTER TABLE oauth_config ADD COLUMN client_secret VARCHAR(255) DEFAULT ''"))
        if "api_key" not in existing_columns:
            db.execute(text("ALTER TABLE oauth_config ADD COLUMN api_key VARCHAR(255)"))
        if "scopes" not in existing_columns:
            db.execute(text("ALTER TABLE oauth_config ADD COLUMN scopes JSON DEFAULT '[]'"))
        if "n8n_integration" not in existing_columns:
            default_value = "FALSE" if dialect == "postgresql" else "0"
            db.execute(text(f"ALTER TABLE oauth_config ADD COLUMN n8n_integration BOOLEAN DEFAULT {default_value}"))
        if "created_at" not in existing_columns:
            timestamp_type = "TIMESTAMPTZ" if dialect == "postgresql" else "DATETIME"
            db.execute(text(f"ALTER TABLE oauth_config ADD COLUMN created_at {timestamp_type} DEFAULT CURRENT_TIMESTAMP"))
        if "updated_at" not in existing_columns:
            timestamp_type = "TIMESTAMPTZ" if dialect == "postgresql" else "DATETIME"
            db.execute(text(f"ALTER TABLE oauth_config ADD COLUMN updated_at {timestamp_type} DEFAULT CURRENT_TIMESTAMP"))


@router.get("/oauth", response_model=List[schemas.OAuthConfigRead])
def list_oauth_configs(
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    _ensure_oauth_schema(db)
    return db.query(models.OAuthConfig).order_by(models.OAuthConfig.created_at.desc()).all()


@router.post("/oauth", response_model=schemas.OAuthConfigRead, status_code=status.HTTP_201_CREATED)
def create_oauth_config(
    payload: schemas.OAuthConfigCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    _ensure_oauth_schema(db)
    oauth_config = models.OAuthConfig(
        name=payload.name,
        redirect_url=payload.redirect_url,
        scopes=payload.scopes,
        n8n_integration=payload.n8n_integration,
        client_id=payload.client_id or token_urlsafe(18),
        client_secret=payload.client_secret or token_urlsafe(36),
        api_key=payload.api_key or token_urlsafe(24),
    )
    db.add(oauth_config)
    db.commit()
    db.refresh(oauth_config)
    return oauth_config


@router.patch("/oauth/{config_id}", response_model=schemas.OAuthConfigRead)
def update_oauth_config(
    config_id: int,
    payload: schemas.OAuthConfigUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    _ensure_oauth_schema(db)
    oauth_config = db.get(models.OAuthConfig, config_id)
    if not oauth_config:
        raise HTTPException(status_code=404, detail="OAuth configuration not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(oauth_config, key, value)

    db.commit()
    db.refresh(oauth_config)
    return oauth_config


@router.post("/oauth/{config_id}/rotate", response_model=schemas.OAuthConfigRead)
def rotate_oauth_credentials(
    config_id: int,
    payload: schemas.OAuthCredentialsRotate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
):
    _ensure_oauth_schema(db)
    oauth_config = db.get(models.OAuthConfig, config_id)
    if not oauth_config:
        raise HTTPException(status_code=404, detail="OAuth configuration not found")

    _rotate_if_requested(oauth_config, payload)
    db.commit()
    db.refresh(oauth_config)
    return oauth_config


@router.delete("/oauth/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_oauth_config(
    config_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_admin),
) -> None:
    _ensure_oauth_schema(db)
    oauth_config = db.get(models.OAuthConfig, config_id)
    if not oauth_config:
        raise HTTPException(status_code=404, detail="OAuth configuration not found")

    db.delete(oauth_config)
    db.commit()


# Retain the existing public SMTP namespace with its own secret-safe validation.
from .smtp import router as smtp_router
router.include_router(smtp_router)
