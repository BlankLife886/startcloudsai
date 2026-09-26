-- +goose Up
CREATE TABLE user_upload_objects (
    object_key text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT ck_user_upload_objects_owner_prefix
        CHECK (object_key LIKE 'uploads/' || user_id::text || '/%')
);

CREATE INDEX ix_user_upload_objects_user_created
    ON user_upload_objects (user_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE user_upload_references (
    object_key text NOT NULL REFERENCES user_upload_objects(object_key) ON DELETE CASCADE,
    reference_type text NOT NULL CHECK (reference_type IN
        ('task_input', 'user_asset', 'user_avatar', 'assistant_message', 'assistant_run')),
    reference_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (object_key, reference_type, reference_id)
);

CREATE INDEX ix_user_upload_references_owner
    ON user_upload_references (reference_type, reference_id);

CREATE TABLE user_upload_cleanup_state (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    cursor text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO user_upload_cleanup_state (id) VALUES (true);

-- Backfill the durable references that already exist in relational and JSONB
-- records. Objects that were uploaded but never registered remain eligible for
-- the storage scan after the retention window.
INSERT INTO user_upload_objects (object_key, user_id, created_at)
SELECT object_key, user_id, min(created_at)
FROM (
    SELECT file_key AS object_key, user_id, created_at FROM user_assets
    WHERE file_key LIKE 'uploads/%'
    UNION ALL
    SELECT thumbnail_key AS object_key, user_id, created_at FROM user_assets
    WHERE thumbnail_key LIKE 'uploads/%'
    UNION ALL
    SELECT regexp_replace(avatar_url, '^/api/v1/files/', '') AS object_key, id AS user_id, created_at
    FROM users
    WHERE avatar_url LIKE '/api/v1/files/uploads/%'
    UNION ALL
    SELECT item.key AS object_key, t.user_id, t.created_at
    FROM tasks t
    CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(t.input_keys) = 'array' THEN t.input_keys ELSE '[]'::jsonb END
    ) AS item(key)
    WHERE item.key LIKE 'uploads/' || t.user_id::text || '/%'
    UNION ALL
    SELECT t.params ->> names.name AS object_key, t.user_id, t.created_at
    FROM tasks t
    CROSS JOIN LATERAL unnest(ARRAY['maskKey', 'maskBaseKey']) AS names(name)
    WHERE jsonb_typeof(t.params) = 'object'
      AND (t.params ->> names.name) LIKE 'uploads/' || t.user_id::text || '/%'
    UNION ALL
    SELECT item.value ->> 'fileKey' AS object_key, c.user_id, m.created_at
    FROM assistant_messages m
    JOIN assistant_conversations c ON c.id = m.conversation_id
    CROSS JOIN LATERAL (VALUES
        (m.metadata -> 'referenceImages'),
        (m.metadata -> 'images'),
        (m.metadata -> 'proposal' -> 'referenceImages'),
        (m.metadata -> 'proposal' -> 'images')
    ) AS collection(value)
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(collection.value) = 'array' THEN collection.value ELSE '[]'::jsonb END
    ) AS item(value)
    WHERE (item.value ->> 'fileKey') LIKE 'uploads/' || c.user_id::text || '/%'
    UNION ALL
    SELECT item.value ->> 'fileKey' AS object_key, r.user_id, r.created_at
    FROM assistant_runs r
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(r.params -> 'referenceImages') = 'array'
            THEN r.params -> 'referenceImages' ELSE '[]'::jsonb END
    ) AS item(value)
    WHERE (item.value ->> 'fileKey') LIKE 'uploads/' || r.user_id::text || '/%'
) existing
WHERE object_key <> ''
GROUP BY object_key, user_id
ON CONFLICT (object_key) DO NOTHING;

INSERT INTO user_upload_references (object_key, reference_type, reference_id)
SELECT file_key, 'user_asset', id FROM user_assets
WHERE file_key LIKE 'uploads/%'
ON CONFLICT DO NOTHING;

INSERT INTO user_upload_references (object_key, reference_type, reference_id)
SELECT thumbnail_key, 'user_asset', id FROM user_assets
WHERE thumbnail_key LIKE 'uploads/%'
ON CONFLICT DO NOTHING;

INSERT INTO user_upload_references (object_key, reference_type, reference_id)
SELECT regexp_replace(avatar_url, '^/api/v1/files/', ''), 'user_avatar', id
FROM users
WHERE avatar_url LIKE '/api/v1/files/uploads/%'
ON CONFLICT DO NOTHING;

INSERT INTO user_upload_references (object_key, reference_type, reference_id)
SELECT item.key, 'task_input', t.id
FROM tasks t
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(t.input_keys) = 'array' THEN t.input_keys ELSE '[]'::jsonb END
) AS item(key)
WHERE item.key LIKE 'uploads/' || t.user_id::text || '/%'
ON CONFLICT DO NOTHING;

INSERT INTO user_upload_references (object_key, reference_type, reference_id)
SELECT t.params ->> names.name, 'task_input', t.id
FROM tasks t
CROSS JOIN LATERAL unnest(ARRAY['maskKey', 'maskBaseKey']) AS names(name)
WHERE jsonb_typeof(t.params) = 'object'
  AND (t.params ->> names.name) LIKE 'uploads/' || t.user_id::text || '/%'
ON CONFLICT DO NOTHING;

INSERT INTO user_upload_references (object_key, reference_type, reference_id)
SELECT item.value ->> 'fileKey', 'assistant_message', m.id
FROM assistant_messages m
JOIN assistant_conversations c ON c.id = m.conversation_id
CROSS JOIN LATERAL (VALUES
    (m.metadata -> 'referenceImages'),
    (m.metadata -> 'images'),
    (m.metadata -> 'proposal' -> 'referenceImages'),
    (m.metadata -> 'proposal' -> 'images')
) AS collection(value)
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(collection.value) = 'array' THEN collection.value ELSE '[]'::jsonb END
) AS item(value)
WHERE (item.value ->> 'fileKey') LIKE 'uploads/' || c.user_id::text || '/%'
ON CONFLICT DO NOTHING;

INSERT INTO user_upload_references (object_key, reference_type, reference_id)
SELECT item.value ->> 'fileKey', 'assistant_run', r.id
FROM assistant_runs r
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.params -> 'referenceImages') = 'array'
        THEN r.params -> 'referenceImages' ELSE '[]'::jsonb END
) AS item(value)
WHERE (item.value ->> 'fileKey') LIKE 'uploads/' || r.user_id::text || '/%'
ON CONFLICT DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS user_upload_cleanup_state;
DROP TABLE IF EXISTS user_upload_references;
DROP TABLE IF EXISTS user_upload_objects;
