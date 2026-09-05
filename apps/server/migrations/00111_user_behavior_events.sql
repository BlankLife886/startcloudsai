-- +goose Up
CREATE TABLE user_behavior_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_event_id uuid NOT NULL,
    event_name text NOT NULL,
    feature text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_behavior_event_name CHECK (event_name IN (
        'feature_open',
        'reference_upload_started',
        'reference_upload_completed',
        'reference_upload_failed',
        'form_started',
        'form_abandoned',
        'template_open',
        'template_used'
    )),
    CONSTRAINT ck_user_behavior_feature CHECK (feature IN (
        'home',
        'text_to_image',
        'assistant',
        'canvas',
        'ecommerce',
        'coloring',
        'design_workshop',
        'model_sheet',
        'game_art',
        'background_remove',
        'media_tools',
        'assets',
        'history',
        'prompt_library',
        'other'
    )),
    CONSTRAINT ck_user_behavior_metadata CHECK (jsonb_typeof(metadata) = 'object'),
    CONSTRAINT uq_user_behavior_client_event UNIQUE (user_id, client_event_id)
);

CREATE INDEX user_behavior_events_user_created_idx
    ON user_behavior_events (user_id, created_at DESC);
CREATE INDEX user_behavior_events_name_created_idx
    ON user_behavior_events (event_name, created_at DESC);
CREATE INDEX user_behavior_events_feature_created_idx
    ON user_behavior_events (feature, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS user_behavior_events;
