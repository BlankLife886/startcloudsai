-- +goose Up
-- 画布 HTML 节点的公开分享：用户把网页发布成只读链接。页面以
-- Content-Security-Policy: sandbox 返回（不含 allow-same-origin），在站点域名下也拿不到用户会话。
CREATE TABLE IF NOT EXISTS canvas_html_shares (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug        varchar(32) NOT NULL UNIQUE,
    title       text        NOT NULL DEFAULT '',
    html        text        NOT NULL,
    bytes       integer     NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz
);
CREATE INDEX IF NOT EXISTS canvas_html_shares_user_active_idx
    ON canvas_html_shares (user_id, created_at DESC) WHERE revoked_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS canvas_html_shares;
