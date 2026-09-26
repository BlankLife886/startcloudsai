package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const dailyCheckinCols = `id, user_id, checkin_date, streak, cycle_day, reward_cents, created_at`

func scanDailyCheckin(row pgx.Row) (*DailyCheckin, error) {
	var item DailyCheckin
	err := row.Scan(
		&item.ID, &item.UserID, &item.CheckinDate, &item.Streak,
		&item.CycleDay, &item.RewardCents, &item.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// LockDailyCheckinUser serializes one user's check-in operation inside the caller transaction.
func LockDailyCheckinUser(ctx context.Context, q Q, userID uuid.UUID) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, userID.String())
	return err
}

func GetDailyCheckin(ctx context.Context, q Q, userID uuid.UUID, date string) (*DailyCheckin, error) {
	item, err := scanDailyCheckin(q.QueryRow(ctx,
		`SELECT `+dailyCheckinCols+` FROM daily_checkins WHERE user_id = $1 AND checkin_date = $2::date`,
		userID, date))
	return nilOnNoRows(item, err)
}

func GetLatestDailyCheckin(ctx context.Context, q Q, userID uuid.UUID) (*DailyCheckin, error) {
	item, err := scanDailyCheckin(q.QueryRow(ctx,
		`SELECT `+dailyCheckinCols+` FROM daily_checkins WHERE user_id = $1 ORDER BY checkin_date DESC LIMIT 1`,
		userID))
	return nilOnNoRows(item, err)
}

func InsertDailyCheckin(ctx context.Context, q Q, userID uuid.UUID, date string, streak, cycleDay int, rewardCents int64) (*DailyCheckin, error) {
	return scanDailyCheckin(q.QueryRow(ctx,
		`INSERT INTO daily_checkins (user_id, checkin_date, streak, cycle_day, reward_cents)
		 VALUES ($1, $2::date, $3, $4, $5) RETURNING `+dailyCheckinCols,
		userID, date, streak, cycleDay, rewardCents))
}

func ListMonthlyDailyCheckins(ctx context.Context, q Q, userID uuid.UUID, monthStart, nextMonthStart string) ([]*DailyCheckin, error) {
	rows, err := q.Query(ctx,
		`SELECT `+dailyCheckinCols+` FROM daily_checkins
		 WHERE user_id = $1 AND checkin_date >= $2::date AND checkin_date < $3::date
		 ORDER BY checkin_date ASC`, userID, monthStart, nextMonthStart)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*DailyCheckin, 0)
	for rows.Next() {
		item, scanErr := scanDailyCheckin(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func CountDailyCheckins(ctx context.Context, q Q, userID uuid.UUID) (int64, error) {
	var count int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM daily_checkins WHERE user_id = $1`, userID).Scan(&count)
	return count, err
}

func SumMonthlyDailyCheckinRewards(ctx context.Context, q Q, userID uuid.UUID, monthStart, nextMonthStart string) (int64, error) {
	var total int64
	err := q.QueryRow(ctx,
		`SELECT COALESCE(sum(reward_cents), 0) FROM daily_checkins
		 WHERE user_id = $1 AND checkin_date >= $2::date AND checkin_date < $3::date`,
		userID, monthStart, nextMonthStart).Scan(&total)
	return total, err
}
