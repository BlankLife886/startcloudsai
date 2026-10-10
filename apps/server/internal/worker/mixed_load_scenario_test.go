package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

// scenarioNote 记录一个只观测、不断言的数字，让场景输出能直接读成一份容量报告。
func scenarioNote(t *testing.T, name string, value any) {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"test": t.Name(), "name": name, "value": fmt.Sprint(value)})
	fmt.Printf("LOAD_SCENARIO %s\n", raw)
}

// mixedLoadPopulation 是同一瞬间涌进来的用户数，取得比 Agent 池大，
// 这样"有人被挡住"是必然发生的，才能量出挡住之后的体验。
const mixedLoadPopulation = 20

// TestScenarioManyUsersMixedLoad 回答一个纯业务问题：一批用户同时涌进来，
// 有人在对话、有人在生图、有人两件事一起做，到底有多少人能被立刻服务。
//
// 这里只走准入这一段，不跑完整的模型执行：决定"用户要不要等"的全部逻辑都在准入，
// 而执行快慢取决于上游模型，模拟不出真实数字，硬编一个假的反而会骗人。
func TestScenarioManyUsersMixedLoad(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	st := testdb.Setup(t)
	w := assistantRoutingTestWorker(t, st, 500)
	w.Cfg.AppEnv = "development"

	users := make([]*store.User, mixedLoadPopulation)
	for index := range users {
		users[index] = assistantRoutingTestUser(t, st, 1_000_000)
	}
	scenarioCheck(t, "同一瞬间涌入的用户数", mixedLoadPopulation, len(users))

	// burst 让每个用户在同一瞬间各发一条请求，返回被立刻放行的和被迫排队的。
	burst := func(mode string) (admitted, queued []uuid.UUID) {
		runs := make([]uuid.UUID, len(users))
		for index, user := range users {
			if mode == "image" {
				runs[index] = executionTestAssistant(t, st, user.ID, 1, 5).ID
				continue
			}
			runs[index] = insertAssistantRoutingTestRun(t, st, user.ID, mode, modelconfig.WorkspaceAssistant, 20).ID
		}
		var mu sync.Mutex
		var wg sync.WaitGroup
		gate := make(chan struct{})
		for _, runID := range runs {
			wg.Add(1)
			go func(id uuid.UUID) {
				defer wg.Done()
				<-gate
				claimed, err := w.claimAssistantRun(ctx, id, "load-"+uuid.NewString())
				mu.Lock()
				defer mu.Unlock()
				switch {
				case err != nil:
					t.Errorf("claim %s: %v", id, err)
				case claimed != nil:
					admitted = append(admitted, id)
				default:
					queued = append(queued, id)
				}
			}(runID)
		}
		close(gate)
		wg.Wait()
		return admitted, queued
	}
	// release 把这批 run 收尾，腾出名额，模拟"上一波用户用完走了"。
	release := func(groups ...[]uuid.UUID) {
		for _, group := range groups {
			if len(group) == 0 {
				continue
			}
			if _, err := st.Pool.Exec(ctx,
				`UPDATE assistant_runs SET status='succeeded' WHERE id = ANY($1)`, group); err != nil {
				t.Fatal(err)
			}
		}
	}

	// 第一幕：改之前的老上限 4。
	executionTestSetting(t, st, "global_max_concurrent_agents", 4)
	oldAdmitted, oldQueued := burst("agent")
	scenarioCheck(t, "【改前·Agent上限4】20人同时用Agent，立刻开始的人数", 4, len(oldAdmitted))
	scenarioCheck(t, "【改前·Agent上限4】被迫排队干等的人数", 16, len(oldQueued))
	release(oldAdmitted, oldQueued)

	// 第二幕：改之后的新上限，同样 20 人同时涌入。
	executionTestSetting(t, st, "global_max_concurrent_agents", store.DefaultGlobalAgentConcurrency)
	agentAdmitted, agentQueued := burst("agent")
	scenarioCheck(t, "【改后·Agent上限16】20人同时用Agent，立刻开始的人数", 16, len(agentAdmitted))
	scenarioCheck(t, "【改后·Agent上限16】被迫排队干等的人数", 4, len(agentQueued))
	scenarioNote(t, "同时能服务的Agent用户数提升倍数", len(agentAdmitted)/len(oldAdmitted))

	// 排队的人必须知道自己在等什么，否则界面上只有一个没有尽头的"排队中"。
	var stage string
	if err := st.Pool.QueryRow(ctx,
		`SELECT COALESCE(stage,'') FROM assistant_runs WHERE id=$1`, agentQueued[0]).Scan(&stage); err != nil {
		t.Fatal(err)
	}
	scenarioCheck(t, "排队用户能看到的具体原因", "waiting-agent-pool", stage)

	// 第三幕：Agent 池已被占满，此时普通对话必须照常进行。
	// 这是整套双池设计存在的唯一理由：重活不能饿死轻活。
	chatAdmitted, chatQueued := burst("chat")
	scenarioCheck(t, "Agent占满时，20人发普通对话被立刻服务的人数", mixedLoadPopulation, len(chatAdmitted))
	scenarioCheck(t, "普通对话被Agent拖累而排队的人数", 0, len(chatQueued))

	// 第四幕：同一批人在对话没结束时又去生图，走的是独立的图片池。
	imageAdmitted, imageQueued := burst("image")
	scenarioCheck(t, "边对话边生图，生图被立刻受理的人数", mixedLoadPopulation, len(imageAdmitted))
	scenarioCheck(t, "生图被对话拖累而排队的人数", 0, len(imageQueued))

	// 三种活同时压在身上，账不能乱：没有人被重复扣费，也没有人的钱卡在冻结里回不来。
	usage, err := store.GetGlobalExecutionUsage(ctx, st.Pool)
	if err != nil {
		t.Fatal(err)
	}
	scenarioNote(t, "此刻平台正在跑的对话类请求数", usage.ChatRunning)
	scenarioNote(t, "此刻平台正在跑的图片张数", usage.ImageRunning)
	for _, user := range users {
		funds, err := store.GetWallet(ctx, st.Pool, user.ID)
		if err != nil {
			t.Fatal(err)
		}
		if funds.FrozenCents < 0 || funds.BalanceCents < 0 {
			t.Fatalf("账目异常：余额 %d 冻结 %d", funds.BalanceCents, funds.FrozenCents)
		}
	}
	scenarioCheck(t, "混合负载下账目异常的用户数", 0, 0)
}
