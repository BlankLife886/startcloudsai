-- +goose Up
ALTER TABLE assistant_conversations
    DROP CONSTRAINT assistant_conversations_workspace_check;
ALTER TABLE assistant_conversations
    ADD CONSTRAINT assistant_conversations_workspace_check
    CHECK (workspace IN ('assistant', 'ui_design', 'infinite_canvas'));

-- Older canvas text requests created one transient chat conversation per node.
-- Their flattened prompt always starts with the first message role.
UPDATE assistant_conversations conversation
SET workspace = 'infinite_canvas'
WHERE conversation.workspace = 'assistant'
  AND (lower(conversation.title) LIKE 'user:%' OR lower(conversation.title) LIKE 'system:%')
  AND (SELECT count(*) FROM assistant_runs run WHERE run.conversation_id = conversation.id) = 1
  AND EXISTS (
      SELECT 1 FROM assistant_runs run
      WHERE run.conversation_id = conversation.id
        AND run.mode = 'chat'
        AND (lower(ltrim(run.prompt)) LIKE 'user:%' OR lower(ltrim(run.prompt)) LIKE 'system:%')
  )
  AND (SELECT count(*) FROM assistant_messages message WHERE message.conversation_id = conversation.id) = 2;

UPDATE assistant_runs run
SET params = jsonb_set(
    jsonb_set(COALESCE(run.params, '{}'::jsonb), '{workspace}', '"infinite_canvas"'::jsonb, true),
    '{_source}', '"react_canvas"'::jsonb, true
)
FROM assistant_conversations conversation
WHERE conversation.id = run.conversation_id
  AND conversation.workspace = 'infinite_canvas';

-- +goose Down
UPDATE assistant_runs run
SET params = COALESCE(run.params, '{}'::jsonb) - 'workspace' - '_source' - '_kind'
FROM assistant_conversations conversation
WHERE conversation.id = run.conversation_id
  AND conversation.workspace = 'infinite_canvas';

UPDATE assistant_conversations SET workspace = 'assistant' WHERE workspace = 'infinite_canvas';

ALTER TABLE assistant_conversations
    DROP CONSTRAINT assistant_conversations_workspace_check;
ALTER TABLE assistant_conversations
    ADD CONSTRAINT assistant_conversations_workspace_check
    CHECK (workspace IN ('assistant', 'ui_design'));
