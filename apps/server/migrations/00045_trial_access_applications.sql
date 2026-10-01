-- +goose Up
CREATE TABLE trial_access_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    occupation text NOT NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    review_note text,
    reviewed_by uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    redemption_code_id uuid UNIQUE REFERENCES redemption_codes(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_trial_access_occupation_length
        CHECK (char_length(occupation) BETWEEN 2 AND 80),
    CONSTRAINT ck_trial_access_reason_length
        CHECK (char_length(reason) BETWEEN 10 AND 1000),
    CONSTRAINT ck_trial_access_review_note_length
        CHECK (review_note IS NULL OR char_length(review_note) <= 500),
    CONSTRAINT ck_trial_access_status
        CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX ix_trial_access_status_created
    ON trial_access_applications (status, created_at DESC, id DESC);

-- +goose Down
DROP TABLE IF EXISTS trial_access_applications;
