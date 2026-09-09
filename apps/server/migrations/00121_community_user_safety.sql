-- +goose Up
CREATE TABLE gallery_submission_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id uuid NOT NULL REFERENCES gallery_submissions(id) ON DELETE CASCADE,
    reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason text NOT NULL,
    detail text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    CONSTRAINT uq_gallery_submission_reports_user UNIQUE (submission_id, reporter_user_id),
    CONSTRAINT ck_gallery_submission_reports_reason CHECK (reason IN ('inappropriate','copyright','spam','harassment','other')),
    CONSTRAINT ck_gallery_submission_reports_status CHECK (status IN ('open','reviewed','dismissed')),
    CONSTRAINT ck_gallery_submission_reports_not_self CHECK (reporter_user_id <> author_user_id)
);
CREATE INDEX ix_gallery_submission_reports_status_created
    ON gallery_submission_reports (status, created_at DESC);
CREATE INDEX ix_gallery_submission_reports_author_created
    ON gallery_submission_reports (author_user_id, created_at DESC);

CREATE TABLE user_blocks (
    blocker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_user_id, blocked_user_id),
    CONSTRAINT ck_user_blocks_not_self CHECK (blocker_user_id <> blocked_user_id)
);
CREATE INDEX ix_user_blocks_blocked_user ON user_blocks (blocked_user_id);

-- +goose Down
DROP TABLE IF EXISTS user_blocks;
DROP TABLE IF EXISTS gallery_submission_reports;
