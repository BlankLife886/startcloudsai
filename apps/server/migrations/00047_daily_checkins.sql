-- +goose Up
CREATE TABLE daily_checkins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    checkin_date date NOT NULL,
    streak integer NOT NULL,
    cycle_day integer NOT NULL,
    reward_cents bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_daily_checkins_user_date UNIQUE (user_id, checkin_date),
    CONSTRAINT ck_daily_checkins_streak CHECK (streak >= 1),
    CONSTRAINT ck_daily_checkins_cycle_day CHECK (cycle_day BETWEEN 1 AND 7),
    CONSTRAINT ck_daily_checkins_reward CHECK (reward_cents >= 0)
);

CREATE INDEX ix_daily_checkins_user_date
    ON daily_checkins (user_id, checkin_date DESC);

-- +goose Down
DROP TABLE IF EXISTS daily_checkins;
