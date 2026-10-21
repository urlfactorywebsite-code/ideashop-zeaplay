# FastAPI Depends defaults declare dependencies.
# ruff: noqa: B008
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_active_user
from ..models import RoleEnum, User
from ..services import navigation

router = APIRouter(prefix='/navigation', tags=['navigation'])


class PageRule(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=80)
    enabled: bool = Field(strict=True)
    hidden: bool = Field(default=False, strict=True)
    allowedRoles: list[RoleEnum] = Field(max_length=len(RoleEnum))
    sortOrder: int = Field(ge=0, le=1000, strict=True)


class PolicyUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0, le=2147483646, strict=True)
    pages: list[PageRule] = Field(min_length=1, max_length=100)


@router.get('')
def read_policy(response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    response.headers['Cache-Control'] = 'no-store'
    return navigation.document(db, user)


@router.put('')
def update_policy(payload: PolicyUpdate, request: Request, response: Response,
                  db: Session = Depends(get_db), user: User = Depends(get_current_active_user)):
    response.headers['Cache-Control'] = 'no-store'
    return navigation.save(db, user, payload, request)
