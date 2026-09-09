-- +goose Up
CREATE TABLE credit_reservations (
    source_type text NOT NULL,
    source_id text NOT NULL,
    normal_cents bigint NOT NULL DEFAULT 0,
    trial_cents bigint NOT NULL DEFAULT 0,
    normal_remaining_cents bigint NOT NULL DEFAULT 0,
    trial_remaining_cents bigint NOT NULL DEFAULT 0,
    trial_feature_key text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_type, source_id),
    CONSTRAINT ck_credit_reservation_source_nonempty CHECK (
        char_length(source_type) BETWEEN 1 AND 80 AND char_length(source_id) BETWEEN 1 AND 240
    ),
    CONSTRAINT ck_credit_reservation_amounts CHECK (
        normal_cents >= 0 AND trial_cents >= 0
        AND normal_remaining_cents >= 0 AND trial_remaining_cents >= 0
        AND normal_remaining_cents <= normal_cents
        AND trial_remaining_cents <= trial_cents
        AND normal_cents + trial_cents > 0
    ),
    CONSTRAINT ck_credit_reservation_trial_feature CHECK (
        (trial_cents = 0 AND trial_remaining_cents = 0)
        OR trial_feature_key IS NOT NULL
    )
);

-- Preserve normal-credit reservations made by active assistant runs before
-- feature-scoped assistant trial credits were introduced.
INSERT INTO credit_reservations (
    source_type, source_id, normal_cents, trial_cents,
    normal_remaining_cents, trial_remaining_cents
)
SELECT ledger.source_type, ledger.source_id, -ledger.delta_cents, 0, -ledger.delta_cents, 0
FROM wallet_ledger ledger
WHERE ledger.kind = 'freeze'
  AND ledger.source_type = 'assistant_run'
  AND ledger.source_id IS NOT NULL
  AND ledger.delta_cents < 0
  AND NOT EXISTS (
      SELECT 1 FROM wallet_ledger terminal
      WHERE terminal.source_type = ledger.source_type
        AND terminal.source_id = ledger.source_id
        AND terminal.kind IN ('spend', 'release')
  )
ON CONFLICT (source_type, source_id) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS credit_reservations;
