-- Push subscriptions and notification preferences

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT NULL,
    device_label TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user_id ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module TEXT NOT NULL,
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, module)
);

CREATE INDEX IF NOT EXISTS ix_notification_preferences_user_id ON notification_preferences(user_id);

DO $$
BEGIN
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'TASK_CREATED';
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'TASK_UPDATED';
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'TASK_DELETED';
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'TICKET_UPDATED';
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'TICKET_DELETED';
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'USER_CREATED';
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'USER_UPDATED';
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'USER_DELETED';
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'DEPARTMENT_CREATED';
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'DEPARTMENT_UPDATED';
    ALTER TYPE notificationtypeenum ADD VALUE IF NOT EXISTS 'DEPARTMENT_DELETED';
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE notification_entity_type_enum ADD VALUE IF NOT EXISTS 'user';
    ALTER TYPE notification_entity_type_enum ADD VALUE IF NOT EXISTS 'department';
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;
