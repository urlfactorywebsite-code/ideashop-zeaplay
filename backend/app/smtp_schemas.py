from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator
from .services.smtp_categories import CATEGORIES, category_for
from .services.smtp_security import canonical_host


class ProfileFields(BaseModel):
    model_config = ConfigDict(extra='forbid')
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    username: str = Field(min_length=1, max_length=255)
    encryption: Literal['tls', 'ssl', 'none'] = 'tls'
    provider: Literal['custom', 'gmail', 'outlook_com', 'microsoft365', 'zoho', 'mailgun', 'sendgrid'] = 'custom'
    priority: int = Field(default=100, ge=0, le=100000)
    is_enabled: bool = True
    auth_method: Literal['password', 'oauth2', 'none'] = 'password'
    sender_name: str | None = Field(default=None, max_length=120)
    sender_email: EmailStr | None = None
    reply_to: EmailStr | None = None
    rate_limit_per_minute: int = Field(default=60, ge=1, le=10000)
    daily_limit: int = Field(default=1000, ge=1, le=10000000)
    notification_types: list[str] = Field(default_factory=lambda: ['notifications'], max_length=20)

    @field_validator('host')
    @classmethod
    def host_valid(cls, value):
        return canonical_host(value)

    @field_validator('username', 'sender_name')
    @classmethod
    def no_headers(cls, value):
        if value and (any(ord(char) < 32 or ord(char) == 127 for char in value) or not value.strip()):
            raise ValueError('Control characters and blank values are not allowed')
        return value

    @field_validator('notification_types')
    @classmethod
    def categories_valid(cls, values):
        aliases = {'welcome_password', 'task_notifications', 'project_updates'}
        if not values or any(value not in CATEGORIES and value not in aliases for value in values):
            raise ValueError('Choose one or more supported mail categories')
        return sorted(set(category_for(value) for value in values))


class ProfileCreate(ProfileFields):
    name: str = Field(min_length=1, max_length=120)
    password: SecretStr | None = Field(default=None, max_length=4096)
    @field_validator('name')
    @classmethod
    def name_valid(cls, value):
        value = value.strip()
        if not value or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError('Enter a valid profile name')
        return value


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str | None = Field(default=None, min_length=1, max_length=120)
    host: str | None = None
    port: int | None = None
    username: str | None = None
    password: SecretStr | None = Field(default=None, max_length=4096)
    encryption: str | None = None
    provider: str | None = None
    priority: int | None = None
    is_enabled: bool | None = None
    auth_method: str | None = None
    sender_name: str | None = None
    sender_email: str | None = None
    reply_to: str | None = None
    rate_limit_per_minute: int | None = None
    daily_limit: int | None = None
    notification_types: list[str] | None = None


class TestMail(BaseModel):
    model_config = ConfigDict(extra='forbid')
    to_address: EmailStr
    notification_type: str = 'general'
    subject: str = Field(default='Zea.Play SMTP test', min_length=1, max_length=200)
    body: str = Field(default='This is an explicitly requested SMTP test message.', max_length=10000)
    @field_validator('subject')
    @classmethod
    def no_headers(cls, value):
        if '\r' in value or '\n' in value:
            raise ValueError('Subject must be a single line')
        return value


class RetryJobs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ids: list[str] = Field(min_length=1, max_length=100)
