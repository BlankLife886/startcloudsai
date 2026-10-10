-- +goose Up
ALTER TABLE wallets
    ADD COLUMN trial_balance_cents bigint NOT NULL DEFAULT 0,
    ADD COLUMN trial_frozen_cents bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_wallets_trial_balance_nonneg CHECK (trial_balance_cents >= 0),
    ADD CONSTRAINT ck_wallets_trial_frozen_nonneg CHECK (trial_frozen_cents >= 0);

ALTER TABLE wallet_ledger
    ADD COLUMN credit_bucket text NOT NULL DEFAULT 'normal',
    ADD CONSTRAINT ck_wallet_ledger_credit_bucket
        CHECK (credit_bucket IN ('normal', 'trial', 'mixed'));

CREATE TABLE task_credit_reservations (
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    generation integer NOT NULL,
    normal_cents bigint NOT NULL DEFAULT 0,
    trial_cents bigint NOT NULL DEFAULT 0,
    normal_remaining_cents bigint NOT NULL DEFAULT 0,
    trial_remaining_cents bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, generation),
    CONSTRAINT ck_task_credit_reservation_generation CHECK (generation >= 0),
    CONSTRAINT ck_task_credit_reservation_amounts CHECK (
        normal_cents >= 0 AND trial_cents >= 0
        AND normal_remaining_cents >= 0 AND trial_remaining_cents >= 0
        AND normal_remaining_cents <= normal_cents
        AND trial_remaining_cents <= trial_cents
        AND normal_cents + trial_cents > 0
    )
);

-- Existing active tasks were frozen before trial credits existed, so their
-- entire reservation belongs to the normal bucket.
WITH active_reservations AS (
    SELECT
        t.id AS task_id,
        GREATEST(
            COUNT(*) FILTER (WHERE l.kind = 'freeze')
              - 1,
            0
        )::integer AS generation,
        t.cost_cents
    FROM tasks t
    JOIN wallet_ledger l
      ON l.source_type = 'task'
     AND split_part(l.source_id, '/', 1) = t.id::text
    WHERE t.status IN ('queued', 'running') AND t.cost_cents > 0
    GROUP BY t.id, t.cost_cents
    HAVING COUNT(*) FILTER (WHERE l.kind = 'freeze')
         > COUNT(*) FILTER (WHERE l.kind = 'release')
)
INSERT INTO task_credit_reservations (
    task_id, generation, normal_cents, trial_cents,
    normal_remaining_cents, trial_remaining_cents
)
SELECT task_id, generation, cost_cents, 0, cost_cents, 0
FROM active_reservations
ON CONFLICT (task_id, generation) DO NOTHING;

ALTER TABLE trial_access_applications ADD COLUMN application_no bigint;

WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS application_no
    FROM trial_access_applications
)
UPDATE trial_access_applications a
SET application_no = ranked.application_no
FROM ranked
WHERE ranked.id = a.id;

ALTER TABLE trial_access_applications
    ALTER COLUMN application_no SET NOT NULL,
    ADD CONSTRAINT ck_trial_access_application_no CHECK (application_no > 0),
    ADD CONSTRAINT uq_trial_access_application_no UNIQUE (application_no);

-- +goose Down
ALTER TABLE trial_access_applications
    DROP CONSTRAINT IF EXISTS uq_trial_access_application_no,
    DROP CONSTRAINT IF EXISTS ck_trial_access_application_no,
    DROP COLUMN IF EXISTS application_no;

DROP TABLE IF EXISTS task_credit_reservations;

ALTER TABLE wallet_ledger
    DROP CONSTRAINT IF EXISTS ck_wallet_ledger_credit_bucket,
    DROP COLUMN IF EXISTS credit_bucket;

ALTER TABLE wallets
    DROP CONSTRAINT IF EXISTS ck_wallets_trial_frozen_nonneg,
    DROP CONSTRAINT IF EXISTS ck_wallets_trial_balance_nonneg,
    DROP COLUMN IF EXISTS trial_frozen_cents,
    DROP COLUMN IF EXISTS trial_balance_cents;
