-- +goose Up
ALTER TABLE assistant_conversations
    ADD COLUMN project_id uuid;

CREATE INDEX assistant_conversations_user_workspace_project_updated_idx
    ON assistant_conversations (user_id, workspace, project_id, updated_at DESC, id DESC)
    WHERE project_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS assistant_conversations_user_workspace_project_updated_idx;
ALTER TABLE assistant_conversations DROP COLUMN IF EXISTS project_id;
