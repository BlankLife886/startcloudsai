-- +goose Up
-- 画布项目文档大小（字节），供项目列表、配额与后台展示；由数据库在每次写入 document 时
-- 自动计算，任何写入路径都不会漏更。添加生成列会重写 canvas_projects 并补算已有项目。
ALTER TABLE canvas_projects
    ADD COLUMN IF NOT EXISTS document_bytes bigint
    GENERATED ALWAYS AS (octet_length(document::text)) STORED;

-- +goose Down
ALTER TABLE canvas_projects DROP COLUMN IF EXISTS document_bytes;
