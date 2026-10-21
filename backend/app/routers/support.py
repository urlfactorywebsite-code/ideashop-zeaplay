# FastAPI Depends defaults declare dependencies.
# ruff: noqa: B008
"""Authenticated support forwarding; workspace policy is checked before delivery."""
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from ..dependencies import get_current_active_user
from ..models import User

router = APIRouter(prefix='/support', tags=['support'])
# Preserve the existing support destination. The browser no longer posts directly.
WEBHOOK_URL = 'https://n8n.urlfactory.website/webhook/task-support'


class SupportRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str | None = Field(default=None, max_length=200)
    email: EmailStr
    employerId: str | None = Field(default=None, max_length=200)
    subject: str = Field(min_length=1, max_length=500)
    category: Literal['Bug', 'Feature Request', 'Access Issue', 'Other']
    priority: Literal['Low', 'Medium', 'High', 'Critical']
    description: str = Field(min_length=1, max_length=50000)
    attachment: str | None = Field(default=None, max_length=8 * 1024 * 1024)
    fileType: Literal['image', 'pdf'] | None = None
    submittedAt: datetime | None = None
    user_id: str | None = None

    @model_validator(mode='after')
    def attachment_type(self):
        if self.attachment:
            valid = self.attachment.startswith('data:image/') if self.fileType == 'image' else self.fileType == 'pdf' and self.attachment.startswith('data:application/pdf;')
            if not valid:
                raise ValueError('Only image and PDF attachments are supported.')
        return self


@router.post('/requests')
async def submit_support(payload: SupportRequest, user: User = Depends(get_current_active_user)):
    body = payload.model_dump(mode='json')
    body.update(user_id=str(user.id), submittedAt=datetime.now(timezone.utc).isoformat())
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            response = await client.post(WEBHOOK_URL, json=body)
        if not 200 <= response.status_code < 300:
            raise HTTPException(502, 'Support delivery is temporarily unavailable.')
    except httpx.HTTPError as exc:
        raise HTTPException(502, 'Support delivery is temporarily unavailable.') from exc
    return {'accepted': True}
