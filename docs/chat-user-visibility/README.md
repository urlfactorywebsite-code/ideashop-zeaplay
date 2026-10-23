Deactivated-user visibility fix, 2026-10-23.

The requested behavior is to hide deactivated users from chat. The existing directory endpoint already returned only active users, but conversation loading brought inactive direct contacts back into the sidebar and synthesized contact list.

- The backend conversation list and message search exclude direct conversations whose other participant is inactive or missing. Existing membership and tenant predicates remain in place.
- The frontend defensively filters inactive direct conversations, removes inactive identities from synthesized contacts, and hides inactive group/space member rows and counts. This also handles an older server still returning inactive direct conversations.
- Direct links to hidden conversations cannot populate chat messages or join their realtime rooms through the UI; selection falls back to a visible conversation.
- Conversations, participants and messages are preserved. Historical group-message attribution is preserved. Existing authorized history APIs are retained; reactivating an account restores the same direct conversation. New-message restrictions for inactive accounts remain enforced by the backend.
- No schema changes or user/account mutations were made.

Validation:

- PASS: all 157 frontend tests, including three new visibility regressions.
- PASS: six targeted backend deactivation/directory/mention/history checks on an isolated temporary SQLite database.
- PASS: production browser checks at 1440px and 390px, including active-contact retention, hidden inactive direct contacts/member rows, new-message search and blocked inactive deep links. The fixture deliberately returns inactive conversations to exercise frontend protection. The mobile new-message control was activated by keyboard because of an existing header overlap. [Results](browser.json).
- PASS: production Vite build and scoped whitespace check.
- Broader chat validation is not green: the full suite stops on a WebSocket disconnect before `chat:joined`; the same failure reproduces with the new visibility predicate disabled. Running non-WebSocket cases stops after 14 passing tests on the existing task-comment fixture's `SimpleNamespace` missing `project`. These failures were not changed or suppressed in product code. Test startup requires `VEE_BOOTSTRAP_SCHEMA=false` and a local assets directory to avoid PostgreSQL-only schema bootstrap in SQLite.

No production deployment was performed. Both the frontend and backend changes need deployment to update the live service. Real multi-user messaging, PostgreSQL execution and immediate cross-session account-deactivation propagation were not verified.
