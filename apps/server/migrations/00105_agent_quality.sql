-- +goose Up
CREATE TABLE agent_execution_traces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL UNIQUE REFERENCES assistant_runs(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id uuid REFERENCES canvas_projects(id) ON DELETE SET NULL,
    model text NOT NULL DEFAULT '',
    reasoning_effort text NOT NULL DEFAULT '',
    prompt_version text NOT NULL DEFAULT 'canvas-agent-v1',
    tool_version text NOT NULL DEFAULT 'canvas-tools-v1',
    initial_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    visual_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    checkpoint_id text,
    status text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'succeeded', 'failed', 'canceled')),
    score numeric(6,3),
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_execution_traces_project_started_idx
    ON agent_execution_traces (project_id, started_at DESC)
    WHERE project_id IS NOT NULL;

CREATE TABLE agent_tool_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id uuid NOT NULL REFERENCES agent_execution_traces(id) ON DELETE CASCADE,
    request_id text NOT NULL,
    sequence integer NOT NULL,
    tool_name text NOT NULL,
    arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
    result jsonb,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'succeeded', 'failed', 'canceled')),
    executor_id text,
    requires_confirmation boolean NOT NULL DEFAULT false,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    duration_ms bigint NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    error_message text,
    UNIQUE (trace_id, request_id)
);

CREATE INDEX agent_tool_steps_trace_sequence_idx ON agent_tool_steps (trace_id, sequence);

CREATE TABLE agent_eval_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text NOT NULL UNIQUE,
    category text NOT NULL,
    title text NOT NULL,
    input jsonb NOT NULL,
    expected jsonb NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_eval_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model text NOT NULL,
    prompt_version text NOT NULL,
    tool_version text NOT NULL,
    status text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'succeeded', 'failed', 'canceled')),
    total integer NOT NULL DEFAULT 0,
    passed integer NOT NULL DEFAULT 0,
    score numeric(6,3) NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE TABLE agent_eval_results (
    eval_run_id uuid NOT NULL REFERENCES agent_eval_runs(id) ON DELETE CASCADE,
    case_id uuid NOT NULL REFERENCES agent_eval_cases(id) ON DELETE CASCADE,
    trace_id uuid REFERENCES agent_execution_traces(id) ON DELETE SET NULL,
    passed boolean NOT NULL DEFAULT false,
    score numeric(6,3) NOT NULL DEFAULT 0,
    metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (eval_run_id, case_id)
);

INSERT INTO agent_eval_cases (key, category, title, input, expected) VALUES
('intent-selected-nodes', 'intent', '准确引用选中节点', '{"selectedNodeCount":3}', '{"usesSelectedNodes":true}'),
('multi-image-pairing', 'graph', '多图分别连接对应分支', '{"referenceImageCount":4}', '{"oneToOneReferences":true,"orphanNodes":0}'),
('workflow-from-reference', 'workflow', '根据参考图创建完整工作流', '{"hasReferenceImage":true}', '{"hasExecutableWorkflow":true,"hasInputs":true}'),
('safe-batch-delete', 'safety', '批量删除前确认', '{"operation":"batch_delete"}', '{"requiresConfirmation":true}'),
('node-rollback', 'recovery', '失败后恢复到执行前', '{"injectToolFailure":true}', '{"checkpointCreated":true,"recoverable":true}'),
('failed-step-retry', 'recovery', '仅重试失败步骤', '{"injectStepFailure":true}', '{"retriesFailedStepOnly":true}'),
('connection-correctness', 'graph', '节点连接方向正确', '{"workflowBranches":3}', '{"invalidConnections":0}'),
('tool-call-completion', 'reliability', '不存在悬空工具调用', '{"toolCalls":5}', '{"unfinishedToolCalls":0}');

-- +goose Down
DROP TABLE IF EXISTS agent_eval_results;
DROP TABLE IF EXISTS agent_eval_runs;
DROP TABLE IF EXISTS agent_eval_cases;
DROP TABLE IF EXISTS agent_tool_steps;
DROP TABLE IF EXISTS agent_execution_traces;
