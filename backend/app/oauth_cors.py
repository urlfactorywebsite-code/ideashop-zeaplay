"""Public protocol endpoints use explicit credentials and never ambient cookies."""
import re

from fastapi.middleware.cors import CORSMiddleware
from starlette.datastructures import Headers


def build_cors_stack(inner, settings):
    application = CORSMiddleware(inner, allow_origins=settings.cors_allow_origins,
        allow_credentials=settings.cors_allow_credentials, allow_methods=settings.cors_allow_methods,
        allow_headers=settings.cors_allow_headers)
    public_tokens = CORSMiddleware(inner, allow_origins=['*'], allow_credentials=False,
        allow_methods=['POST'], allow_headers=['Authorization', 'Content-Type'], max_age=600)
    public_reads = CORSMiddleware(inner, allow_origins=['*'], allow_credentials=False,
        allow_methods=['GET'], allow_headers=['Authorization', 'Content-Type'], max_age=600)

    async def dispatch(scope, receive, send):
        path = scope.get('path', '')
        handler = public_tokens if path in {'/oauth2/token', '/api/oauth2/token', '/oauth2/revoke', '/api/oauth2/revoke'} else application
        resource = path.removeprefix('/api')
        if scope.get('method') in {'GET', 'OPTIONS'} and (resource in {'/oauth2/profile', '/oauth2/service'} or
                re.fullmatch(r'/(?:tasks|projects)(?:/[0-9a-fA-F-]{36})?', resource)):
            # App requests include browser-session credentials, including on
            # bearer-authenticated reads. Preflights do not carry those cookies,
            # so select the credentialed policy by the trusted origin instead.
            if Headers(scope=scope).get('origin') not in settings.cors_allow_origins:
                handler = public_reads  # External OAuth reads still require bearer auth and scopes/RBAC.
        await handler(scope, receive, send)

    return dispatch
