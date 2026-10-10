-- +goose Up
ALTER TABLE trial_access_applications
    DROP CONSTRAINT ck_trial_access_occupation_length,
    ADD CONSTRAINT ck_trial_access_occupation_length
        CHECK (char_length(occupation) BETWEEN 2 AND 240);

-- +goose Down
ALTER TABLE trial_access_applications
    DROP CONSTRAINT ck_trial_access_occupation_length,
    ADD CONSTRAINT ck_trial_access_occupation_length
        CHECK (char_length(occupation) BETWEEN 2 AND 80);
