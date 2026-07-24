-- +goose Up
ALTER TABLE prompt_library
    ADD COLUMN gallery_submission_id uuid REFERENCES gallery_submissions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX uq_prompt_library_gallery_submission
    ON prompt_library (gallery_submission_id)
    WHERE gallery_submission_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS uq_prompt_library_gallery_submission;
ALTER TABLE prompt_library DROP COLUMN IF EXISTS gallery_submission_id;
