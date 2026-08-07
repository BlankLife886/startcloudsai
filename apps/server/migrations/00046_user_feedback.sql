-- +goose Up
CREATE TABLE user_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    page_url text,
    user_agent text,
    status text NOT NULL DEFAULT 'open',
    admin_reply text,
    handled_by uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
    handled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_feedback_category
        CHECK (category IN ('bug', 'generation', 'account', 'billing', 'suggestion', 'other')),
    CONSTRAINT ck_user_feedback_title_length
        CHECK (char_length(title) BETWEEN 5 AND 120),
    CONSTRAINT ck_user_feedback_content_length
        CHECK (char_length(content) BETWEEN 10 AND 3000),
    CONSTRAINT ck_user_feedback_page_url_length
        CHECK (page_url IS NULL OR char_length(page_url) <= 500),
    CONSTRAINT ck_user_feedback_user_agent_length
        CHECK (user_agent IS NULL OR char_length(user_agent) <= 512),
    CONSTRAINT ck_user_feedback_status
        CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    CONSTRAINT ck_user_feedback_admin_reply_length
        CHECK (admin_reply IS NULL OR char_length(admin_reply) <= 2000)
);

CREATE INDEX ix_user_feedback_user_created
    ON user_feedback (user_id, created_at DESC, id DESC);

CREATE INDEX ix_user_feedback_status_created
    ON user_feedback (status, created_at DESC, id DESC);

-- +goose Down
DROP TABLE IF EXISTS user_feedback;
