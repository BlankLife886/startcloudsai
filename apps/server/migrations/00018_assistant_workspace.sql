-- +goose Up
CREATE TABLE assistant_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title varchar(160) NOT NULL DEFAULT '新对话',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_conversations_user_updated_idx
    ON assistant_conversations (user_id, updated_at DESC, id DESC);

CREATE TABLE assistant_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    role varchar(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content text NOT NULL DEFAULT '',
    kind varchar(24) NOT NULL DEFAULT 'chat',
    status varchar(24) NOT NULL DEFAULT 'complete'
        CHECK (status IN ('queued', 'running', 'complete', 'failed', 'stopped')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_messages_conversation_created_idx
    ON assistant_messages (conversation_id, created_at ASC, id ASC);

CREATE TABLE assistant_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    user_message_id uuid NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
    assistant_message_id uuid NOT NULL UNIQUE REFERENCES assistant_messages(id) ON DELETE CASCADE,
    mode varchar(16) NOT NULL CHECK (mode IN ('agent', 'chat', 'image')),
    resolved_mode varchar(16) NOT NULL DEFAULT '',
    status varchar(24) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
    stage varchar(32) NOT NULL DEFAULT 'queued',
    prompt text NOT NULL,
    params jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text,
    error_message text,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_runs_user_created_idx
    ON assistant_runs (user_id, created_at DESC, id DESC);
CREATE INDEX assistant_runs_active_idx
    ON assistant_runs (status, created_at ASC)
    WHERE status IN ('queued', 'running');

-- +goose Down
DROP TABLE IF EXISTS assistant_runs;
DROP TABLE IF EXISTS assistant_messages;
DROP TABLE IF EXISTS assistant_conversations;
