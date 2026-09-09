-- +goose Up
ALTER TABLE assistant_conversations
    ADD COLUMN workspace varchar(32) NOT NULL DEFAULT 'assistant'
    CHECK (workspace IN ('assistant', 'ui_design'));

UPDATE assistant_conversations conversation
SET workspace = 'ui_design'
WHERE EXISTS (
    SELECT 1
    FROM assistant_runs run
    WHERE run.conversation_id = conversation.id
      AND run.params->>'serviceKey' IN ('ui_design_analysis', 'ui_design_asset')
);

DROP INDEX assistant_conversations_user_updated_idx;
CREATE INDEX assistant_conversations_user_workspace_updated_idx
    ON assistant_conversations (user_id, workspace, updated_at DESC, id DESC);

-- +goose Down
DROP INDEX assistant_conversations_user_workspace_updated_idx;
CREATE INDEX assistant_conversations_user_updated_idx
    ON assistant_conversations (user_id, updated_at DESC, id DESC);
ALTER TABLE assistant_conversations DROP COLUMN workspace;
