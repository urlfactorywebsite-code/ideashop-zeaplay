from typing import Literal
from urllib.parse import parse_qs, urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCOPES = {
    'profile:read': 'Read your basic profile (name, ID and tenant).',
    'projects:read': 'Read projects you can access under your existing role and membership.',
    'tasks:read': 'Read tasks you can access under your existing role and assignments.',
    'offline_access': 'Maintain access without you present, using rotating refresh tokens.',
    'service:read': 'Read this machine client’s own service identity only.',
}


def valid_redirect(uri):
    p = urlsplit(uri)
    port = p.port  # Reject malformed ports rather than deferring failure to the browser.
    if (p.scheme not in {'http', 'https'} or not p.hostname or p.username or p.password
            or '#' in uri or '*' in uri or '\\' in uri or port == 0 or any(ord(c) <= 32 or ord(c) == 127 for c in uri)
            or (p.scheme == 'http' and p.hostname not in {'localhost', '127.0.0.1', '::1'})
            or set(parse_qs(p.query, keep_blank_values=True)) & {'code', 'state', 'error', 'error_description', 'error_uri', 'iss'}):
        raise ValueError('Use an exact HTTPS callback (HTTP is allowed only on loopback); no credentials, fragments or wildcards')
    return uri


class ClientInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(default='', max_length=2000)
    category: str = Field(default='integration', max_length=80)
    client_type: Literal['public', 'confidential'] = 'public'
    redirect_uris: list[str] = Field(default_factory=list, max_length=20)
    grant_types: list[Literal['authorization_code', 'refresh_token', 'client_credentials']] = Field(default_factory=lambda: ['authorization_code'])
    scopes: list[str] = Field(min_length=1, max_length=5)
    owner_id: str | None = None
    enabled: bool = True

    @model_validator(mode='after')
    def validate_configuration(self):
        self.name = self.name.strip()
        if not self.name or not self.grant_types or len(set(self.grant_types)) != len(self.grant_types):
            raise ValueError('Application name and distinct grant types are required')
        if not set(self.scopes) <= SCOPES.keys() or len(set(self.scopes)) != len(self.scopes):
            raise ValueError('Unknown or duplicate scope')
        if any(len(u) > 2000 for u in self.redirect_uris):
            raise ValueError('Callback is too long')
        self.redirect_uris = list(dict.fromkeys(valid_redirect(u) for u in self.redirect_uris))
        grants = set(self.grant_types)
        if 'authorization_code' in grants and not self.redirect_uris:
            raise ValueError('Authorization code clients require a registered callback')
        if 'client_credentials' in grants and self.client_type != 'confidential':
            raise ValueError('Machine clients must be confidential')
        if 'refresh_token' in grants and 'authorization_code' not in grants:
            raise ValueError('Refresh requires authorization code')
        if ('offline_access' in self.scopes) != ('refresh_token' in grants):
            raise ValueError('offline_access and refresh_token must be enabled together')
        if 'client_credentials' in grants and 'service:read' not in self.scopes:
            raise ValueError('Machine clients require service:read')
        return self


class ConsentInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ticket: str = Field(min_length=32, max_length=100)
    allow: bool


class AuthorizationInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    client_id: str = Field(max_length=64)
    redirect_uri: str = Field(max_length=2000)
    response_type: Literal['code']
    scope: str = Field(min_length=1, max_length=300)
    state: str = Field(min_length=16, max_length=500)
    code_challenge: str = Field(pattern=r'^[A-Za-z0-9_-]{43}$')
    code_challenge_method: Literal['S256']

    @field_validator('redirect_uri')
    @classmethod
    def callback_is_safe(cls, value):
        return valid_redirect(value)
