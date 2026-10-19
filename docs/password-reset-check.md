# Password Reset Verification

**Follow-up:** fixes and new local validation are documented in [Password Recovery Fix and Activation](password-reset-implementation.md). The results below are the original, pre-fix audit and have not been rewritten as passing.

Checked 2026-10-19 in `F:\Projects\ideashop-zeaplay-v5`. **Overall: FAIL / not safe to rely on for account recovery.** This was a check, not an implementation/deployment. No existing user password, schema, SMTP configuration or application source was modified.

## Results

| Feature/check | Result | Evidence |
| --- | --- | --- |
| Login-page Forgot Password accepts email-only requests | FAIL | Both source and actual local backend return 422: `body.password` is required. Frontend sends only email. |
| Sends/queues a reset email | FAIL | Route explicitly contains a mock/TODO. An isolated request satisfying the incorrect schema returned 202 but invoked no email delivery. Configuring SMTP alone will not complete this route. |
| Reset-token validation/redemption | MISSING | No password-reset token issuance, redemption API or frontend token-based reset screen was found. Expiration/replay cannot be certified for a nonexistent flow. |
| Forgot Password error state | FAIL | Real Chrome interaction with an intercepted 422 response still displayed the success text claiming an email was sent. No real API calls/emails were made by the browser test. |
| Same-tenant admin password reset | FUNCTIONAL | Isolated synthetic target reset returned 204; old-password login returned 401 and new-password login returned 200. |
| Anonymous admin-reset request | PASS | 401, no reset. |
| Regular USER admin-reset request | PASS | 403, password unchanged. |
| Cross-tenant Owner reset | **CRITICAL FAIL** | Returned 204 and changed the other tenant's synthetic account password. |
| Cross-tenant Admin reset | **CRITICAL FAIL** | Returned 204 and changed the other tenant's synthetic account password. |
| Cross-tenant Manager reset | **CRITICAL FAIL** | Returned 204 and changed the other tenant's synthetic account password. |
| Signed-in Settings password change | FUNCTIONAL | Correct old password accepted; 204 and new hash verified in isolated storage. |
| Incorrect current password on Settings change | PASS | 400, password unchanged. |
| Admin dialog/backend minimum-length agreement | FAIL | Dialog requires 8 characters; backend accepts a 6-character password with 204. This records a contract mismatch, not approval of an 8-character production security policy. |
| XP balances | PASS | All six synthetic users retained their original points. |

Backend diagnostic assertions: **6 passed, 7 failed**. One additional browser assertion confirmed the false-success defect. These are deliberately reported failed acceptance checks, not an all-green pytest suite. The isolated backend harness completed all checks and printed each result; its process exit code is not a feature-readiness pass.

## Root Causes

1. `backend/app/routers/auth.py:223` uses `LoginRequest` instead of the already defined email-only `ForgotPasswordRequest` in `backend/app/schemas.py:202`. The handler at lines 227-232 is explicitly a mock and does not send mail or create reset credentials. Merely correcting that request model would not make account recovery work.
2. `frontend/components/ForgotPasswordModal.tsx:21` catches every error and displays the same successful-email claim. A generic response for account enumeration safety is appropriate for accepted requests, but must not pretend validation/network/delivery failures succeeded.
3. `backend/app/routers/users.py:565` accepts Owner/Admin/Manager through `get_current_admin`, then looks up the target by ID without a tenant condition or tenant check. Target credential changes must enforce tenant isolation; a role check alone does not authorize a foreign account.
4. `backend/app/schemas.py:363` permits six-character admin-reset passwords; `frontend/components/ResetPasswordModal.tsx:43` requires eight. The Settings password-change schema also permits six; its input has no matching client-side minimum.

The `owner_reset_tokens` table and `/api/admin/data/reset/*` handlers are **full-system data reset**, not password recovery. They were not invoked and must not be repurposed as a password-reset endpoint.

## Test Safety and Limits

- Backend scenarios used a newly generated temporary SQLite database, six synthetic accounts and a fresh FastAPI test application including the existing auth/users routers. Database dependency overrides isolated all reads/writes. Password hashes, tokens and email content were not printed or persisted as test artifacts. Audit logging and email transport were captured in-process to prevent external effects.
- The live local backend was checked only with an email-only request that fails validation before the handler. Its 422 response confirmed the production-shaped frontend/backend contract mismatch; no existing account password was changed.
- A fresh Chrome context tested the actual Forgot Password component on the existing loopback frontend server at port 6302. All API traffic was intercepted. Initial browser-selector ambiguity was corrected by targeting `#forgot-email`; the final interaction reproduced false success after 422.
- No real mailbox delivery, PostgreSQL password-mutation concurrency, session revocation, full frontend suite/build, or VPS deployment was validated in this check. No password-reset expiry/replay safety is claimed. Source inspection shows existing JWTs are not tied to password changes, so session invalidation needs an explicit review when implementing recovery.

## Required Before Use

Fix the tenant boundary on administrative reset first. Complete the email-only request contract, trustworthy UI failure handling and an actual secure reset-token issuance/delivery/redemption flow; add expiry, single-use, abuse-control, validation, authorization and session-policy tests. Use the existing email infrastructure, but do not assume the unrelated full-system-reset OTP provides password recovery. No application fixes were silently applied as part of this verification.
