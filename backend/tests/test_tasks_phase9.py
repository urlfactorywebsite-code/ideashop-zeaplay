import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import BackgroundTasks, HTTPException

from backend.app import models
from backend.app.routers import tasks as tasks_module
from backend.app.services import subtask_completion
from backend.tests.test_tasks_phase5 import (
    TestingSessionLocal,
    _create_client_and_project,
    _create_user,
    _noop_notification,
    _task_payload,
    client,
)
from backend.tests.test_tasks_phase6 import _token_for_existing_user


def setup_function():
    db = TestingSessionLocal()
    try:
        db.query(models.TaskTransferRequest).delete()
        db.query(models.Notification).delete()
        db.query(models.AuditEvent).delete()
        db.query(models.TimeEntry).delete()
        db.query(models.CompletionAttachment).delete()
        db.query(models.CompletionSubmission).delete()
        db.query(models.SubtaskWorkflowEvent).delete()
        db.query(models.SubtaskDependency).delete()
        db.query(models.Subtask).delete()
        db.query(models.Task).delete()
        db.query(models.ProjectMember).delete()
        db.query(models.Project).delete()
        db.query(models.Client).delete()
        db.query(models.User).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def disable_external_task_side_effects(monkeypatch):
    monkeypatch.setattr(tasks_module.notification_service, "create_notification", _noop_notification)
    monkeypatch.setattr(tasks_module, "trigger_n8n_event", lambda *args, **kwargs: None)


def _completion_task(*, approval_required: bool):
    tenant = uuid.uuid4()
    _, owner_token = _create_user(models.RoleEnum.OWNER, tenant)
    manager, manager_token = _create_user(models.RoleEnum.MANAGER, tenant)
    member, member_token = _create_user(models.RoleEnum.USER, tenant)
    outsider, outsider_token = _create_user(models.RoleEnum.USER, tenant)
    project = _create_client_and_project(tenant_id=tenant, manager_ids=[manager.id], member_ids=[member.id])
    db = TestingSessionLocal()
    db_project = db.get(models.Project, project.id)
    db_project.subtask_approval_required_default = approval_required
    db.commit()
    db.close()

    payload = _task_payload(project.id, [member.id])
    payload["subtasks"] = [
        {
            "title": "Evidence subtask",
            "completed": False,
            "status": models.SubtaskStatusEnum.TODO.value,
            "assigned_to_id": member.id,
            "sort_order": 0,
        },
        {
            "title": "Dependent subtask",
            "completed": False,
            "status": models.SubtaskStatusEnum.WAITING.value,
            "assigned_to_id": member.id,
            "sort_order": 1,
        },
    ]
    created = client.post("/api/tasks", json=payload, headers={"Authorization": f"Bearer {owner_token}"})
    assert created.status_code == 201, created.text
    task = created.json()[0]
    first_id = task["subtasks"][0]["id"]
    second_id = task["subtasks"][1]["id"]
    dependency = client.post(
        f"/api/tasks/{task['id']}/subtasks/{second_id}/dependencies",
        json={"depends_on_subtask_id": first_id},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert dependency.status_code == 201, dependency.text
    return {
        "tenant": tenant,
        "owner_token": owner_token,
        "manager": manager,
        "manager_token": manager_token,
        "member": member,
        "member_token": member_token,
        "outsider": outsider,
        "outsider_token": outsider_token,
        "task_id": task["id"],
        "subtask_id": first_id,
        "dependent_id": second_id,
    }


def _submit(task_id: str, subtask_id: str, token: str, description: str = "Finished work with evidence attached"):
    return client.post(
        f"/api/tasks/{task_id}/subtasks/{subtask_id}/completion-submissions",
        data={"description": description},
        headers={"Authorization": f"Bearer {token}"},
    )


def _submit_file(
    task_id: str,
    subtask_id: str,
    token: str,
    *,
    filename: str,
    content: bytes,
    content_type: str,
    description: str = "Finished work with attached proof",
):
    return client.post(
        f"/api/tasks/{task_id}/subtasks/{subtask_id}/completion-submissions",
        data={"description": description},
        files={"files": (filename, content, content_type)},
        headers={"Authorization": f"Bearer {token}"},
    )


def test_completion_description_word_count_is_server_enforced():
    context = _completion_task(approval_required=False)
    empty = _submit(context["task_id"], context["subtask_id"], context["member_token"], "   ")
    assert empty.status_code == 422

    too_short = _submit(context["task_id"], context["subtask_id"], context["member_token"], "done now")
    assert too_short.status_code == 422

    too_long = _submit(
        context["task_id"],
        context["subtask_id"],
        context["member_token"],
        "one two three four five six seven eight nine ten eleven",
    )
    assert too_long.status_code == 422


def test_unicode_completion_description_word_count_is_supported():
    context = _completion_task(approval_required=False)
    accepted = _submit(
        context["task_id"],
        context["subtask_id"],
        context["member_token"],
        "செய்த வேலை முடிந்து ஆதாரம் இணைக்கப்பட்டது இன்று",
    )
    assert accepted.status_code == 200, accepted.text
    submission = accepted.json()["subtasks"][0]["latest_completion_submission"]
    assert submission["description_word_count"] == 6


def test_approval_required_submission_waits_for_review_and_approval_activates_dependents():
    context = _completion_task(approval_required=True)
    submitted = _submit(context["task_id"], context["subtask_id"], context["member_token"])
    assert submitted.status_code == 200, submitted.text
    subtasks = {item["id"]: item for item in submitted.json()["subtasks"]}
    assert subtasks[context["subtask_id"]]["status"] == models.SubtaskStatusEnum.IN_REVIEW.value
    assert subtasks[context["subtask_id"]]["completed"] is False
    assert subtasks[context["dependent_id"]]["status"] == models.SubtaskStatusEnum.WAITING.value
    submission = subtasks[context["subtask_id"]]["latest_completion_submission"]
    assert submission["status"] == models.CompletionSubmissionStatusEnum.PENDING_REVIEW.value

    approved = client.post(
        f"/api/tasks/{context['task_id']}/subtasks/{context['subtask_id']}/completion-submissions/{submission['id']}/approve",
        headers={"Authorization": f"Bearer {context['manager_token']}"},
    )
    assert approved.status_code == 200, approved.text
    approved_subtasks = {item["id"]: item for item in approved.json()["subtasks"]}
    assert approved_subtasks[context["subtask_id"]]["status"] == models.SubtaskStatusEnum.DONE.value
    assert approved_subtasks[context["dependent_id"]]["status"] == models.SubtaskStatusEnum.TODO.value
    assert approved_subtasks[context["subtask_id"]]["latest_completion_submission"]["status"] == models.CompletionSubmissionStatusEnum.APPROVED.value


def test_approval_disabled_completion_is_atomic_and_does_not_need_review():
    context = _completion_task(approval_required=False)
    submitted = _submit(context["task_id"], context["subtask_id"], context["member_token"])
    assert submitted.status_code == 200, submitted.text
    subtasks = {item["id"]: item for item in submitted.json()["subtasks"]}
    assert subtasks[context["subtask_id"]]["status"] == models.SubtaskStatusEnum.DONE.value
    assert subtasks[context["dependent_id"]]["status"] == models.SubtaskStatusEnum.TODO.value
    assert subtasks[context["subtask_id"]]["latest_completion_submission"]["status"] == models.CompletionSubmissionStatusEnum.COMPLETED.value


def test_rejection_requires_reason_and_preserves_submission_history():
    context = _completion_task(approval_required=True)
    submitted = _submit(context["task_id"], context["subtask_id"], context["member_token"])
    submission = submitted.json()["subtasks"][0]["latest_completion_submission"]
    rejected_without_reason = client.post(
        f"/api/tasks/{context['task_id']}/subtasks/{context['subtask_id']}/completion-submissions/{submission['id']}/reject",
        json={"review_reason": ""},
        headers={"Authorization": f"Bearer {context['manager_token']}"},
    )
    assert rejected_without_reason.status_code == 422

    rejected = client.post(
        f"/api/tasks/{context['task_id']}/subtasks/{context['subtask_id']}/completion-submissions/{submission['id']}/reject",
        json={"review_reason": "Missing final screenshots"},
        headers={"Authorization": f"Bearer {context['manager_token']}"},
    )
    assert rejected.status_code == 200, rejected.text
    subtask = rejected.json()["subtasks"][0]
    assert subtask["status"] == models.SubtaskStatusEnum.TODO.value
    assert subtask["completion_submissions"][0]["status"] == models.CompletionSubmissionStatusEnum.REJECTED.value
    assert subtask["completion_submissions"][0]["review_reason"] == "Missing final screenshots"


def test_upload_security_accepts_private_pdf_and_rejects_mismatched_content():
    context = _completion_task(approval_required=False)
    valid = _submit_file(
        context["task_id"],
        context["subtask_id"],
        context["member_token"],
        filename="proof.pdf",
        content=b"%PDF-1.4\n%proof\n",
        content_type="application/pdf",
    )
    assert valid.status_code == 200, valid.text
    attachment = valid.json()["subtasks"][0]["latest_completion_submission"]["attachments"][0]
    assert attachment["original_filename"] == "proof.pdf"

    context = _completion_task(approval_required=False)
    invalid = _submit_file(
        context["task_id"],
        context["subtask_id"],
        context["member_token"],
        filename="proof.pdf",
        content=b"not actually a pdf",
        content_type="application/pdf",
    )
    assert invalid.status_code == 422


def test_upload_security_rejects_oversize_forged_unsupported_and_sanitizes_filename():
    context = _completion_task(approval_required=False)
    oversize = _submit_file(
        context["task_id"],
        context["subtask_id"],
        context["member_token"],
        filename="large.pdf",
        content=b"%PDF-" + (b"x" * (subtask_completion.MAX_ATTACHMENT_FILE_BYTES + 1)),
        content_type="application/pdf",
    )
    assert oversize.status_code == 413

    context = _completion_task(approval_required=False)
    forged = _submit_file(
        context["task_id"],
        context["subtask_id"],
        context["member_token"],
        filename="image.png",
        content=b"%PDF-1.4\n",
        content_type="image/png",
    )
    assert forged.status_code == 422

    context = _completion_task(approval_required=False)
    unsupported = _submit_file(
        context["task_id"],
        context["subtask_id"],
        context["member_token"],
        filename="spreadsheet.xls",
        content=b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
        content_type="application/vnd.ms-excel",
    )
    assert unsupported.status_code == 422

    context = _completion_task(approval_required=False)
    malicious = _submit_file(
        context["task_id"],
        context["subtask_id"],
        context["member_token"],
        filename="../../evil.pdf",
        content=b"%PDF-1.4\n",
        content_type="application/pdf",
    )
    assert malicious.status_code == 200, malicious.text
    attachment = malicious.json()["subtasks"][0]["latest_completion_submission"]["attachments"][0]
    assert attachment["original_filename"] == "evil.pdf"
    db = TestingSessionLocal()
    try:
        db_attachment = db.get(models.CompletionAttachment, attachment["id"])
        assert db_attachment is not None
        assert "evil" not in db_attachment.storage_key
        assert ".." not in db_attachment.storage_key
        assert subtask_completion.resolve_storage_path(db_attachment.storage_key).exists()
    finally:
        db.close()


def test_completion_authorization_denies_unassigned_submitter_and_non_manager_review():
    context = _completion_task(approval_required=True)
    denied_submit = _submit(context["task_id"], context["subtask_id"], context["outsider_token"])
    assert denied_submit.status_code == 403

    submitted = _submit(context["task_id"], context["subtask_id"], context["member_token"])
    submission = submitted.json()["subtasks"][0]["latest_completion_submission"]
    denied_review = client.post(
        f"/api/tasks/{context['task_id']}/subtasks/{context['subtask_id']}/completion-submissions/{submission['id']}/approve",
        headers={"Authorization": f"Bearer {_token_for_existing_user(context['member'].id, context['tenant'])}"},
    )
    assert denied_review.status_code == 403


def test_cross_tenant_download_and_file_access_revocation_are_enforced():
    context = _completion_task(approval_required=False)
    submitted = _submit_file(
        context["task_id"],
        context["subtask_id"],
        context["member_token"],
        filename="proof.pdf",
        content=b"%PDF-1.4\n",
        content_type="application/pdf",
    )
    assert submitted.status_code == 200, submitted.text
    submission = submitted.json()["subtasks"][0]["latest_completion_submission"]
    attachment = submission["attachments"][0]
    download_url = (
        f"/api/tasks/{context['task_id']}/subtasks/{context['subtask_id']}"
        f"/completion-submissions/{submission['id']}/attachments/{attachment['id']}/download"
    )

    other_tenant_user, other_tenant_token = _create_user(models.RoleEnum.OWNER, uuid.uuid4())
    denied = client.get(download_url, headers={"Authorization": f"Bearer {other_tenant_token}"})
    assert denied.status_code in {403, 404}

    allowed = client.get(download_url, headers={"Authorization": f"Bearer {context['member_token']}"})
    assert allowed.status_code == 200
    assert allowed.content.startswith(b"%PDF-")

    db = TestingSessionLocal()
    try:
        db.query(models.ProjectMember).filter(
            models.ProjectMember.user_id == context["member"].id,
        ).delete()
        task = db.get(models.Task, context["task_id"])
        task.assigned_to_id = None
        subtask = db.get(models.Subtask, context["subtask_id"])
        subtask.assigned_to_id = None
        db.commit()
    finally:
        db.close()

    revoked = client.get(download_url, headers={"Authorization": f"Bearer {context['member_token']}"})
    assert revoked.status_code == 403
    assert other_tenant_user.tenant_id != context["tenant"]


def test_duplicate_submission_rejection_resubmission_and_history_preservation():
    context = _completion_task(approval_required=True)
    first = _submit(context["task_id"], context["subtask_id"], context["member_token"])
    assert first.status_code == 200, first.text
    first_submission = first.json()["subtasks"][0]["latest_completion_submission"]

    duplicate = _submit(context["task_id"], context["subtask_id"], context["member_token"])
    assert duplicate.status_code == 409

    rejected = client.post(
        f"/api/tasks/{context['task_id']}/subtasks/{context['subtask_id']}/completion-submissions/{first_submission['id']}/reject",
        json={"review_reason": "Needs one clearer proof"},
        headers={"Authorization": f"Bearer {context['manager_token']}"},
    )
    assert rejected.status_code == 200, rejected.text

    second = _submit(
        context["task_id"],
        context["subtask_id"],
        context["member_token"],
        "Updated proof attached for approval",
    )
    assert second.status_code == 200, second.text
    subtask = second.json()["subtasks"][0]
    assert subtask["latest_completion_submission"]["attempt_number"] == 2
    assert [item["status"] for item in subtask["completion_submissions"]] == [
        models.CompletionSubmissionStatusEnum.REJECTED.value,
        models.CompletionSubmissionStatusEnum.PENDING_REVIEW.value,
    ]


def test_approval_race_does_not_duplicate_completion_or_activation_history():
    context = _completion_task(approval_required=True)
    submitted = _submit(context["task_id"], context["subtask_id"], context["member_token"])
    submission = submitted.json()["subtasks"][0]["latest_completion_submission"]
    headers = {"Authorization": f"Bearer {context['manager_token']}"}

    def approve_once():
        db = TestingSessionLocal()
        try:
            manager = db.get(models.User, context["manager"].id)
            try:
                tasks_module.approve_subtask_completion(
                    task_id=context["task_id"],
                    subtask_id=context["subtask_id"],
                    submission_id=submission["id"],
                    background_tasks=BackgroundTasks(),
                    db=db,
                    current_user=manager,
                )
                return 200
            except HTTPException as exc:
                return exc.status_code
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(lambda _: approve_once(), range(2)))

    assert set(statuses).issubset({200, 409})
    assert 200 in statuses
    detail = client.get(f"/api/tasks/{context['task_id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    subtasks = {item["id"]: item for item in detail.json()["subtasks"]}
    assert subtasks[context["subtask_id"]]["status"] == models.SubtaskStatusEnum.DONE.value
    assert subtasks[context["dependent_id"]]["status"] == models.SubtaskStatusEnum.TODO.value

    db = TestingSessionLocal()
    try:
        completed_events = db.query(models.SubtaskWorkflowEvent).filter(
            models.SubtaskWorkflowEvent.subtask_id == context["subtask_id"],
            models.SubtaskWorkflowEvent.event_type == "SUBTASK_COMPLETED",
        ).count()
        activation_events = db.query(models.SubtaskWorkflowEvent).filter(
            models.SubtaskWorkflowEvent.subtask_id == context["dependent_id"],
            models.SubtaskWorkflowEvent.event_type == "SUBTASK_ACTIVATED",
        ).count()
        assert completed_events == 1
        assert activation_events == 1
    finally:
        db.close()
