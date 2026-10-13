from fastapi import APIRouter, Depends, HTTPException, status

from .. import models, schemas
from ..config import get_settings
from ..dependencies import get_current_admin
from ..integrations import trigger_n8n_event

router = APIRouter(prefix="/integrations/n8n", tags=["integrations"])


@router.get("/config")
def get_n8n_config(_: models.User = Depends(get_current_admin)):
    settings = get_settings()
    return {
        "enabled": settings.enable_n8n_forwarding,
        "webhookUrl": settings.n8n_webhook_url,
    }


@router.post("/trigger", status_code=status.HTTP_202_ACCEPTED)
def trigger_custom_event(
    payload: schemas.N8NTriggerRequest,
    _: models.User = Depends(get_current_admin),
):
    trigger_n8n_event(payload.event, payload.payload)
    return {"status": "queued"}


@router.post("/test", status_code=status.HTTP_202_ACCEPTED)
def send_test_event(_: models.User = Depends(get_current_admin)):
    settings = get_settings()
    if not settings.enable_n8n_forwarding or not settings.n8n_webhook_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="n8n forwarding is disabled")
    trigger_n8n_event("test", {"message": "Test event from Vee Task Manager"})
    return {"status": "queued"}
