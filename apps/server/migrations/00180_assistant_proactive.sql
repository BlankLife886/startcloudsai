-- +goose Up
-- AI 助手的主动能力：长任务完成通知、异常提醒、定时报告。
-- 没有记录表示默认：完成通知和异常提醒开启，定时报告关闭。
CREATE TABLE assistant_proactive_settings (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    task_notices boolean NOT NULL DEFAULT true,
    alerts boolean NOT NULL DEFAULT true,
    -- 定时报告：'' 关闭，daily 每天，weekly 每周一。
    report_schedule text NOT NULL DEFAULT '',
    report_last_sent_at timestamptz,
    -- 异常提醒和定时报告发到这个“助手提醒”对话；用户删掉后下次重建。
    inbox_conversation_id uuid REFERENCES assistant_conversations(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_assistant_proactive_report CHECK (report_schedule IN ('', 'daily', 'weekly'))
);

-- 套图每完成一批（首次生成或重做）只通知一次：记下通知时的累计生成次数。
ALTER TABLE assistant_commerce_sets ADD COLUMN announced_attempts integer NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE assistant_commerce_sets DROP COLUMN IF EXISTS announced_attempts;
DROP TABLE IF EXISTS assistant_proactive_settings;
