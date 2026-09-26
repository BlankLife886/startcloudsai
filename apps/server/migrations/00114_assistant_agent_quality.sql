-- +goose Up
ALTER TABLE agent_execution_traces
    ADD COLUMN workspace text NOT NULL DEFAULT 'canvas'
        CHECK (workspace IN ('assistant', 'canvas')),
    ADD COLUMN goal_contract jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE agent_eval_cases
    ADD COLUMN workspace text NOT NULL DEFAULT 'canvas'
        CHECK (workspace IN ('assistant', 'canvas'));

ALTER TABLE agent_eval_runs
    ADD COLUMN workspace text NOT NULL DEFAULT 'canvas'
        CHECK (workspace IN ('assistant', 'canvas'));

CREATE INDEX agent_execution_traces_workspace_started_idx
    ON agent_execution_traces (workspace, started_at DESC, status);
CREATE INDEX agent_eval_cases_workspace_active_idx
    ON agent_eval_cases (workspace, active, category, key);
CREATE INDEX agent_eval_runs_workspace_started_idx
    ON agent_eval_runs (workspace, started_at DESC);

INSERT INTO agent_eval_cases (key, workspace, category, title, input, expected) VALUES
('assistant-tool-call-completion', 'assistant', 'reliability', '助手工具调用完整结束', '{"workspace":"assistant"}', '{"unfinishedToolCalls":0}'),
('assistant-image-grounding', 'assistant', 'vision', '参考图进入图片方案', '{"referenceImageCount":1}', '{"proposalUsesReference":true}'),
('assistant-prompt-fidelity', 'assistant', 'prompt', '忠实模式保留用户约束', '{"promptMode":"faithful"}', '{"faithfulPreserved":true}'),
('assistant-multi-image-plan', 'assistant', 'planning', '独立多图方案完整', '{"deliverableCount":2}', '{"allDeliverablesComplete":true}'),
('assistant-web-search', 'assistant', 'grounding', '需要联网时使用真实搜索', '{"webSearchRequested":true}', '{"successfulWebSearch":true}')
ON CONFLICT (key) DO UPDATE SET
    workspace = EXCLUDED.workspace,
    category = EXCLUDED.category,
    title = EXCLUDED.title,
    input = EXCLUDED.input,
    expected = EXCLUDED.expected,
    updated_at = now();

-- +goose Down
DELETE FROM agent_eval_cases WHERE key IN (
    'assistant-tool-call-completion',
    'assistant-image-grounding',
    'assistant-prompt-fidelity',
    'assistant-multi-image-plan',
    'assistant-web-search'
);

DROP INDEX IF EXISTS agent_eval_runs_workspace_started_idx;
DROP INDEX IF EXISTS agent_eval_cases_workspace_active_idx;
DROP INDEX IF EXISTS agent_execution_traces_workspace_started_idx;

ALTER TABLE agent_eval_runs DROP COLUMN IF EXISTS workspace;
ALTER TABLE agent_eval_cases DROP COLUMN IF EXISTS workspace;
ALTER TABLE agent_execution_traces
    DROP COLUMN IF EXISTS goal_contract,
    DROP COLUMN IF EXISTS workspace;
