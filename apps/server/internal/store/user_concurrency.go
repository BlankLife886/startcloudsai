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

// 对话的全局闸门只当安全阀，要明显高于对话池（WORKER_CHAT_CONCURRENCY）。撞池子的任务留在
// Redis 队列里，有空位立刻被捡走；撞这道闸的任务则落进 outbox 靠退避轮询，醒得慢得多。
const DefaultGlobalChatConcurrency = 128

// History projections are excluded by a server-owned lease marker, never client params.
const sharedExecutionTaskSQL = `COALESCE(lease_owner,'') <> '` + UIDesignAssetHistoryLeaseOwner + `'`

type UserConcurrency struct {
	Base int `json:"base"`
	// Bonus is the total added to Base: PlanBonus + ManualBonus.
	Bonus        int   `json:"bonus"`
	PlanBonus    int   `json:"planBonus"`
	ManualBonus  int   `json:"manualBonus"`
	Limit        int   `json:"limit"`
	Running      int64 `json:"running"`
	ImageRunning int64 `json:"imageRunning"`
	ImageLimit   int   `json:"imageLimit"`
	ChatRunning  int64 `json:"chatRunning"`
	ChatLimit    int   `json:"chatLimit"`
}

// MaxUserConcurrencyBonus caps the manual grant, matching the subscription
// contract bonus ceiling and the users.concurrency_bonus CHECK constraint.
const MaxUserConcurrencyBonus = 1000

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

// AssistantRunIsAgent 与 assistantAgentSQL 必须保持一致：一个在 Go 里判定待准入的 run，
// 一个在 SQL 里统计已在跑的 run，两边口径不一样闸门就会漏。
//
// 只认 mode 是不够的：worker 会把带联网搜索、查任务这类请求的对话轮提升成 Agent 执行，
// 这些 run 库里存的仍然是 chat。漏掉它们，真实并发就会超过配置的上限。所以凡是
// resolved_mode 已经定为 agent 的，无论当初以什么模式提交，都算占用 Agent 名额。
func AssistantRunIsAgent(run *AssistantRun) bool {
	return run != nil && (run.Mode == "agent" || run.ResolvedMode == "agent")
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

// assistantAgentSQL 判定一条 run 是否为 Agent 执行。除了显式提交的 agent，还要认
// resolved_mode：auto 模式准入时还没判定，而 chat 模式可能被 worker 提升成 Agent 执行，
// 两种情况都只能从 worker 定下的 resolved_mode 看出来。
func assistantAgentSQL(table string) string {
	return "(" + table + ".mode = 'agent' OR COALESCE(" + table + ".resolved_mode,'') = 'agent')"
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

// Agent 一轮可以走几十步模型调用，占住一个 worker 好几分钟，而普通对话通常几秒就结束。
// 两者共用对话池时，少数 Agent 任务就能把池子占满，别人发一句话也得排队。所以 Agent 另设
// 上限，给普通对话留出永远拿不走的空位。
//
// 全局默认必须小于 WORKER_CHAT_CONCURRENCY（默认 32），否则留不出空位，这个设计就失效了。
// 取一半：Agent 最多吃掉池子的 50%，剩下的永远归普通对话。多开 worker 进程时对话池是按进程
// 叠加的，而这个上限是全平台一个，所以按单进程来定才安全——真要放开得连着后台配置一起调。
const (
	DefaultGlobalAgentConcurrency = 16
	DefaultUserAgentConcurrency   = 3
)

type AgentExecutionUsage struct {
	GlobalRunning int64
	UserRunning   int64
}

type AgentExecutionLimits struct {
	GlobalLimit int64
	UserLimit   int64
}

func GetAgentExecutionLimits(ctx context.Context, q Q) (AgentExecutionLimits, error) {
	global, err := executionSetting(ctx, q, "global_max_concurrent_agents", DefaultGlobalAgentConcurrency, DefaultGlobalAgentConcurrency)
	if err != nil {
		return AgentExecutionLimits{}, err
	}
	user, err := executionSetting(ctx, q, "user_max_concurrent_agents", DefaultUserAgentConcurrency, DefaultUserAgentConcurrency)
	return AgentExecutionLimits{GlobalLimit: global, UserLimit: user}, err
}

func GetAgentExecutionUsage(ctx context.Context, q Q, userID uuid.UUID) (AgentExecutionUsage, error) {
	var usage AgentExecutionUsage
	err := q.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM assistant_runs run WHERE `+assistantExecutionActiveSQL("run")+` AND `+assistantAgentSQL("run")+`),
		(SELECT count(*) FROM assistant_runs run WHERE run.user_id=$1 AND `+assistantExecutionActiveSQL("run")+` AND `+assistantAgentSQL("run")+`)`,
		userID).Scan(&usage.GlobalRunning, &usage.UserRunning)
	return usage, err
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

// ValidateDeveloperExecutionBatchCapacity applies platform and provider-route
// capacity checks without applying the interactive account concurrency quota.
// Developer API keys have their own request, spend, and daily byte limits;
// their work must still respect global and per-route execution capacity.
func ValidateDeveloperExecutionBatchCapacity(ctx context.Context, q Q, image bool, units, maxRouteUnits int64) error {
	global, err := GetGlobalExecutionLimits(ctx, q)
	if err != nil {
		return err
	}
	globalLimit := global.ChatLimit
	pool := "对话"
	if image {
		globalLimit = global.ImageLimit
		pool = "生图"
	}
	return checkExecutionBatchLimits(pool, units, 0, globalLimit, maxRouteUnits)
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
		result.PlanBonus = sub.Contract.ExtraConcurrency()
		result.Bonus = result.PlanBonus
		result.Limit += result.PlanBonus
	}
	result.ImageLimit = result.Limit
	var manualBonus int
	err = q.QueryRow(ctx, `SELECT
 (SELECT COALESCE(sum(GREATEST(work_units,count,1)),0) FROM tasks task WHERE user_id=$1 AND `+taskExecutionActiveSQL("task")+`)
 +(SELECT COALESCE(sum(`+assistantImageUnitsSQL("run")+`),0) FROM assistant_runs run WHERE user_id=$1 AND `+assistantExecutionActiveSQL("run")+` AND `+assistantImageSQL("run")+`),
 (SELECT count(*) FROM assistant_runs run WHERE user_id=$1 AND status='running' AND NOT `+assistantImageSQL("run")+`),
 COALESCE((SELECT concurrency_bonus FROM users WHERE id=$1),0)`, userID).Scan(&result.ImageRunning, &result.ChatRunning, &manualBonus)
	if err != nil {
		// Leave the limit at base+plan rather than widening it from a partial scan;
		// a zero limit would read as "unlimited" in checkExecutionBatchLimits.
		return result, err
	}
	result.ManualBonus = manualBonus
	result.Bonus += manualBonus
	result.Limit += manualBonus
	result.ImageLimit = result.Limit
	result.Running = result.ImageRunning
	return result, nil
}

func GetUserConcurrencyBonus(ctx context.Context, q Q, userID uuid.UUID) (int, error) {
	var bonus int
	err := q.QueryRow(ctx, `SELECT COALESCE((SELECT concurrency_bonus FROM users WHERE id=$1),0)`, userID).Scan(&bonus)
	return bonus, err
}

func SetUserConcurrencyBonus(ctx context.Context, q Q, userID uuid.UUID, bonus int) error {
	if bonus < 0 || bonus > MaxUserConcurrencyBonus {
		return fmt.Errorf("concurrency bonus out of range")
	}
	_, err := q.Exec(ctx, `UPDATE users SET concurrency_bonus=$2 WHERE id=$1`, userID, bonus)
	return err
}
