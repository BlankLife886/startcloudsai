package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/google/uuid"
)

const DefaultUserConcurrency = 4
const DefaultUserChatConcurrency = 4
const DefaultGlobalImageConcurrency = 2000
const DefaultGlobalChatConcurrency = 32

// History projections are excluded by a server-owned lease marker, never client params.
const sharedExecutionTaskSQL = `COALESCE(lease_owner,'') <> '` + UIDesignAssetHistoryLeaseOwner + `'`

type UserConcurrency struct {
	Base         int   `json:"base"`
	Bonus        int   `json:"bonus"`
	Limit        int   `json:"limit"`
	Running      int64 `json:"running"`
	ImageRunning int64 `json:"imageRunning"`
	ImageLimit   int   `json:"imageLimit"`
	ChatRunning  int64 `json:"chatRunning"`
	ChatLimit    int   `json:"chatLimit"`
}

type ExecutionUsage struct {
	ImageRunning int64
	ChatRunning  int64
}

type ExecutionLimits struct {
	ImageLimit int64
	ChatLimit  int64
}

var ErrExecutionBatchTooLarge = errors.New("execution batch exceeds capacity")

type ExecutionBatchCapacityError struct {
	Pool      string
	Scope     string
	Requested int64
	Limit     int64
}

func (e *ExecutionBatchCapacityError) Error() string {
	return fmt.Sprintf("本次%s需要 %d 个名额，超过%s上限 %d，请减少本次数量", e.Pool, e.Requested, e.Scope, e.Limit)
}
func (e *ExecutionBatchCapacityError) Unwrap() error { return ErrExecutionBatchTooLarge }

func TaskWorkUnits(task *Task) int64 {
	if task == nil {
		return 1
	}
	return int64(max(task.WorkUnits, task.Count, 1))
}

func AssistantRunIsImage(run *AssistantRun) bool {
	return run != nil && (run.Mode == "image" || (run.Mode == "auto" && run.ResolvedMode == "image"))
}

func AssistantRunWorkUnits(run *AssistantRun) int64 {
	if !AssistantRunIsImage(run) {
		return 1
	}
	raw, exists := run.Params["count"]
	if !exists || raw == nil || raw == "" {
		return 2
	}
	n, err := strconv.ParseInt(fmt.Sprint(raw), 10, 64)
	if err != nil || n < 0 || n > 999999999 {
		return 1000000000
	}
	return max(n, 1)
}

func assistantImageSQL(table string) string {
	return "(" + table + ".mode = 'image' OR (" + table + ".mode = 'auto' AND COALESCE(" + table + ".resolved_mode,'') = 'image'))"
}

func assistantImageUnitsSQL(table string) string {
	return "CASE WHEN COALESCE(" + table + ".params->>'count','') = '' THEN 2 WHEN " + table + ".params->>'count' ~ '^[0-9]{1,9}$' THEN GREATEST((" + table + ".params->>'count')::bigint,1) ELSE 1000000000 END"
}

func executionSetting(ctx context.Context, q Q, key string, defaultValue, invalidFallback int64) (int64, error) {
	raw, err := GetAppSetting(ctx, q, key)
	if err != nil {
		return 0, err
	}
	if raw == nil {
		return defaultValue, nil
	}
	var n int64
	if json.Unmarshal(raw, &n) != nil || n < 1 || n > 1000000000 {
		return invalidFallback, nil
	}
	return n, nil
}

func GetGlobalExecutionLimits(ctx context.Context, q Q) (ExecutionLimits, error) {
	image, err := executionSetting(ctx, q, "global_max_concurrent_tasks", DefaultGlobalImageConcurrency, 64)
	if err != nil {
		return ExecutionLimits{}, err
	}
	chat, err := executionSetting(ctx, q, "global_max_concurrent_chats", DefaultGlobalChatConcurrency, DefaultGlobalChatConcurrency)
	return ExecutionLimits{ImageLimit: image, ChatLimit: chat}, err
}

func GetGlobalExecutionUsage(ctx context.Context, q Q) (ExecutionUsage, error) {
	var usage ExecutionUsage
	err := q.QueryRow(ctx, `SELECT
		(SELECT COALESCE(sum(GREATEST(work_units,count,1)),0) FROM tasks task WHERE `+taskExecutionActiveSQL("task")+`)
		+(SELECT COALESCE(sum(`+assistantImageUnitsSQL("run")+`),0) FROM assistant_runs run WHERE `+assistantExecutionActiveSQL("run")+` AND `+assistantImageSQL("run")+`),
		(SELECT count(*) FROM assistant_runs run WHERE status='running' AND NOT `+assistantImageSQL("run")+`)`).Scan(&usage.ImageRunning, &usage.ChatRunning)
	return usage, err
}

// This only rejects a batch that can never fit. Current occupancy is checked by
// the worker under the shared execution locks, allowing accepted work to queue.
func ValidateExecutionBatchCapacity(ctx context.Context, q Q, userID uuid.UUID, image bool, units, maxRouteUnits int64) error {
	account, err := GetUserConcurrency(ctx, q, userID)
	if err != nil {
		return err
	}
	global, err := GetGlobalExecutionLimits(ctx, q)
	if err != nil {
		return err
	}
	pool, userLimit, globalLimit := "生图", int64(account.ImageLimit), global.ImageLimit
	if !image {
		pool, userLimit, globalLimit = "对话", int64(account.ChatLimit), global.ChatLimit
	}
	return checkExecutionBatchLimits(pool, units, userLimit, globalLimit, maxRouteUnits)
}

func CheckExecutionBatchLimits(image bool, units, userLimit, globalLimit, maxRouteUnits int64) error {
	pool := "生图"
	if !image {
		pool = "对话"
	}
	return checkExecutionBatchLimits(pool, units, userLimit, globalLimit, maxRouteUnits)
}

func checkExecutionBatchLimits(pool string, units, userLimit, globalLimit, maxRouteUnits int64) error {
	for _, limit := range []struct {
		scope string
		units int64
	}{{"账户", userLimit}, {"全局", globalLimit}, {"单条模型线路", maxRouteUnits}} {
		if limit.units > 0 && units > limit.units {
			return &ExecutionBatchCapacityError{Pool: pool, Scope: limit.scope, Requested: units, Limit: limit.units}
		}
	}
	return nil
}

// Both task entry points call this same route projection before claiming work.
func RunningExecutionUnitsByProvider(ctx context.Context, q Q, keys []string) (map[string]int64, error) {
	result, err := RunningTasksByProvider(ctx, q, keys)
	if err != nil {
		return nil, err
	}
	assistant, err := RunningAssistantRunsByProvider(ctx, q, keys)
	if err != nil {
		return nil, err
	}
	for key, units := range assistant {
		result[key] += units
	}
	return result, nil
}

func BaseUserConcurrency(ctx context.Context, q Q) (int, error) {
	raw, err := GetAppSetting(ctx, q, "user_max_concurrent_tasks")
	if err != nil {
		return 0, err
	}
	if raw == nil {
		return DefaultUserConcurrency, nil
	}
	var n int
	if err := json.Unmarshal(raw, &n); err != nil || n < 1 || n > 10000 {
		return 0, fmt.Errorf("invalid base user concurrency")
	}
	return n, nil
}

// Workers hold LockUserTaskExecution through the capacity check and claim commit.
func GetUserConcurrency(ctx context.Context, q Q, userID uuid.UUID) (UserConcurrency, error) {
	base, err := BaseUserConcurrency(ctx, q)
	if err != nil {
		return UserConcurrency{}, err
	}
	chatLimit, err := executionSetting(ctx, q, "user_max_concurrent_chats", DefaultUserChatConcurrency, DefaultUserChatConcurrency)
	if err != nil {
		return UserConcurrency{}, err
	}
	result := UserConcurrency{Base: base, Limit: base, ChatLimit: int(chatLimit)}
	sub, err := ActiveBillingSubscription(ctx, q, userID, false)
	if err != nil {
		return result, err
	}
	if sub != nil && sub.Contract != nil {
		result.Bonus = sub.Contract.ExtraConcurrency()
		result.Limit += result.Bonus
	}
	result.ImageLimit = result.Limit
	err = q.QueryRow(ctx, `SELECT
 (SELECT COALESCE(sum(GREATEST(work_units,count,1)),0) FROM tasks task WHERE user_id=$1 AND `+taskExecutionActiveSQL("task")+`)
 +(SELECT COALESCE(sum(`+assistantImageUnitsSQL("run")+`),0) FROM assistant_runs run WHERE user_id=$1 AND `+assistantExecutionActiveSQL("run")+` AND `+assistantImageSQL("run")+`),
 (SELECT count(*) FROM assistant_runs run WHERE user_id=$1 AND status='running' AND NOT `+assistantImageSQL("run")+`)`, userID).Scan(&result.ImageRunning, &result.ChatRunning)
	result.Running = result.ImageRunning
	return result, err
}
