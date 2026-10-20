"""OAuth persistence. Only non-reversible credential verifiers are persisted."""
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from .database import Base


def identifier():
    return str(uuid4())


def epoch():
    return int(datetime.now(timezone.utc).timestamp())


class OAuthClient(Base):
    __tablename__ = 'oauth_clients'
    __table_args__ = (
        UniqueConstraint('id', 'tenant_id'),
        ForeignKeyConstraint(['owner_id', 'tenant_id'], ['users.id', 'users.tenant_id']),
        Index('ix_oauth_clients_tenant_status', 'tenant_id', 'enabled'),
    )
    id = Column(String(64), primary_key=True)
    client_id = Column(String(64), unique=True, nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    owner_id = Column(String(36), nullable=False)
    name = Column(String(150), nullable=False)
    description = Column(String(2000), nullable=False, default='')
    category = Column(String(80), nullable=False, default='integration')
    client_type = Column(String(16), nullable=False)
    secret_hash = Column(String(255))
    secret_expires_at = Column(Integer)
    redirect_uris = Column(JSON, nullable=False)
    grant_types = Column(JSON, nullable=False)
    scopes = Column(JSON, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(Integer, nullable=False, default=epoch)
    updated_at = Column(Integer, nullable=False, default=epoch)


class OAuthGrant(Base):
    __tablename__ = 'oauth_grants'
    __table_args__ = (
        UniqueConstraint('id', 'tenant_id'),
        ForeignKeyConstraint(['client_id', 'tenant_id'], ['oauth_clients.id', 'oauth_clients.tenant_id']),
        ForeignKeyConstraint(['user_id', 'tenant_id'], ['users.id', 'users.tenant_id']),
        Index('ix_oauth_grants_tenant_user', 'tenant_id', 'user_id', 'revoked_at'),
        Index('ix_oauth_grants_client', 'client_id'),
        Index('ix_oauth_grants_expiry', 'expires_at'),
        Index('ix_oauth_grants_revoked', 'revoked_at'),
    )
    id = Column(String(36), primary_key=True, default=identifier)
    client_id = Column(String(64), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(String(36))
    credentials_version = Column(Integer)
    scopes = Column(JSON, nullable=False)
    created_at = Column(Integer, nullable=False, default=epoch)
    expires_at = Column(Integer, nullable=False)
    revoked_at = Column(Integer)
    last_used_at = Column(Integer)


class OAuthCode(Base):
    __tablename__ = 'oauth_codes'
    __table_args__ = (ForeignKeyConstraint(['grant_id', 'tenant_id'], ['oauth_grants.id', 'oauth_grants.tenant_id']),
                      Index('ix_oauth_codes_grant', 'grant_id'))
    verifier = Column(String(64), primary_key=True)
    grant_id = Column(String(36), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    redirect_uri = Column(String(2000), nullable=False)
    challenge = Column(String(128), nullable=False)
    expires_at = Column(Integer, nullable=False, index=True)
    consumed_at = Column(Integer)


class OAuthConsent(Base):
    __tablename__ = 'oauth_consents'
    __table_args__ = (
        Index('ix_oauth_consents_client', 'client_id'),
        ForeignKeyConstraint(['user_id', 'tenant_id'], ['users.id', 'users.tenant_id']),
        ForeignKeyConstraint(['client_id', 'tenant_id'], ['oauth_clients.id', 'oauth_clients.tenant_id']),
    )
    verifier = Column(String(64), primary_key=True)
    client_id = Column(String(64), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(String(36), nullable=False)
    credentials_version = Column(Integer, nullable=False)
    parameters = Column(JSON, nullable=False)
    expires_at = Column(Integer, nullable=False, index=True)
    consumed_at = Column(Integer)


class OAuthToken(Base):
    __tablename__ = 'oauth_tokens'
    __table_args__ = (
        ForeignKeyConstraint(['grant_id', 'tenant_id'], ['oauth_grants.id', 'oauth_grants.tenant_id']),
        Index('ix_oauth_tokens_tenant_grant', 'tenant_id', 'grant_id'),
        Index('ix_oauth_tokens_grant', 'grant_id'),
    )
    id = Column(String(36), primary_key=True, default=identifier)
    verifier = Column(String(64), unique=True, nullable=False)
    kind = Column(String(16), nullable=False)
    grant_id = Column(String(36), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    issuer = Column(String(500), nullable=False)
    audience = Column(String(100), nullable=False)
    scopes = Column(JSON, nullable=False)
    created_at = Column(Integer, nullable=False, default=epoch)
    expires_at = Column(Integer, nullable=False, index=True)
    consumed_at = Column(Integer)
    revoked_at = Column(Integer)
    last_used_at = Column(Integer)


class OAuthEvent(Base):
    __tablename__ = 'oauth_events'
    __table_args__ = (Index('ix_oauth_events_tenant_time', 'tenant_id', 'created_at'),)
    id = Column(String(36), primary_key=True, default=identifier)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    client_id = Column(String(64))
    actor_id = Column(String(36))
    action = Column(String(80), nullable=False)
    created_at = Column(Integer, nullable=False, default=epoch)


class OAuthRateLimit(Base):
    __tablename__ = 'oauth_rate_limits'
    __table_args__ = (Index('ix_oauth_rate_window', 'window'),)
    key = Column(String(64), primary_key=True)
    window = Column(Integer, primary_key=True)
    count = Column(Integer, nullable=False)


class BrowserSession(Base):
    """Browser transport for existing first-party authentication, not an OAuth grant."""
    __tablename__ = 'browser_sessions'
    __table_args__ = (ForeignKeyConstraint(['user_id', 'tenant_id'], ['users.id', 'users.tenant_id']),)
    verifier = Column(String(64), primary_key=True)
    user_id = Column(String(36), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    credentials_version = Column(Integer, nullable=False)
    expires_at = Column(Integer, nullable=False, index=True)
    revoked_at = Column(Integer)
