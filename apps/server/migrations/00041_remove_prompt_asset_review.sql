-- +goose Up
UPDATE prompt_library
SET asset_verified = true,
    asset_verified_at = COALESCE(asset_verified_at, now()),
    asset_note = '';

UPDATE prompt_import_items
SET asset_status = 'not_required',
    asset_note = ''
WHERE asset_status <> 'not_required' OR asset_note <> '';

-- Compatibility columns are intentionally retained so existing databases and
-- older exports remain readable. Application behavior no longer uses them.

-- +goose Down
-- The previous review decisions cannot be reconstructed after normalization.
SELECT 1;
