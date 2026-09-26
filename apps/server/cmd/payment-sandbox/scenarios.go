package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

type scenarioDefinition struct {
	ID, Title, Description, Test string
	MinimumChecks                int
}

var scenarioDefinitions = []scenarioDefinition{
	{"plan_price", "套餐中途调价", "验证旧页面、待支付订单、已订阅用户和新订单的价格及权益快照。", "TestBillingScenarioPlanPrice", 8},
	{"model_price", "模型调价与实际消费", "验证3→5积分、旧订阅锁价、新订阅、额度包、升级及退款重购的实际结算。", "TestBillingScenarioModelPrice", 11},
	{"multi_user", "多用户对话并发", "三个账号各最多并发4次对话；订阅图片额度仍为4/6/8。验证对话排队、取消和实际消费。", "TestBillingScenarioMultiUser", 14},
	{"image_multi_user", "多用户生图并发", "自动模拟两个账号提交6张图：个人最多2张、全局3张，超额排队；图片等待时对话照常完成，再放行图片并核对扣费。", "TestTaskScenarioMultiUserImages", 18},
	{"execution_config", "任务中途更新模型配置", "旧任务入队后修改模型、价格、地址、密钥和线路容量；用本地HTTP请求验证旧任务保持原配置，新任务使用新配置。", "TestExecutionSnapshotFreezesActualRequestAndOnlyUpdatesLiveCapacity", 12},
	{"execution_recovery", "中断恢复与并发名额", "模拟4张图执行中断，再将名额降为1并停用线路；验证恢复沿用原连接、名额不丢失也不重复计算。", "TestExecutionRecoveryKeepsAssistantReservationAndOriginalConnection", 14},
	{"partial_image", "上游报错与部分退款", "自动模拟500、502和断连：只接收已知图片结果，不重复提交未知任务，按实际交付结算并退还差额。", "TestCRUNUnknownSubmissionPollsOnlyKnownJobsAndRefundsRemainder", 18},
}

type scenarioStep struct {
	Test     string `json:"test"`
	Name     string `json:"name"`
	Expected string `json:"expected"`
	Actual   string `json:"actual"`
	Passed   bool   `json:"passed"`
}
type scenarioReport struct {
	ID          string         `json:"id"`
	RunID       string         `json:"runId"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Status      string         `json:"status"`
	StartedAt   *time.Time     `json:"startedAt,omitempty"`
	FinishedAt  *time.Time     `json:"finishedAt,omitempty"`
	Steps       []scenarioStep `json:"steps"`
	Error       string         `json:"error,omitempty"`
}

func (l *lab) scenarioSnapshotLocked() []scenarioReport {
	out := make([]scenarioReport, 0, len(scenarioDefinitions))
	for _, d := range scenarioDefinitions {
		r := scenarioReport{ID: d.ID, Title: d.Title, Description: d.Description, Status: "idle", Steps: []scenarioStep{}}
		if saved := l.scenarioRuns[d.ID]; saved != nil {
			r = *saved
			r.Steps = append([]scenarioStep{}, saved.Steps...)
			if r.Status == "passed" && (r.Title != d.Title || r.Description != d.Description) {
				r.Status = "stale"
				r.Error = "模拟场景规则已更新，请重新运行；下面保留的是上次结果。"
			}
			r.Title, r.Description = d.Title, d.Description
		}
		out = append(out, r)
	}
	return out
}
func (l *lab) scenarios(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	l.mu.Lock()
	items := l.scenarioSnapshotLocked()
	available := l.scenarioBinary != ""
	l.mu.Unlock()
	output(w, 200, map[string]any{"items": items, "available": available})
}
func (l *lab) startScenario(id string) (scenarioReport, error) {
	var definition *scenarioDefinition
	for i := range scenarioDefinitions {
		if scenarioDefinitions[i].ID == id {
			definition = &scenarioDefinitions[i]
			break
		}
	}
	if definition == nil {
		return scenarioReport{}, fmt.Errorf("未知测试项目")
	}
	l.mu.Lock()
	if l.scenarioBinary == "" {
		l.mu.Unlock()
		return scenarioReport{}, fmt.Errorf("测试程序尚未准备，请用启动脚本重启当前测试入口")
	}
	if l.scenarioContext != nil && l.scenarioContext.Err() != nil {
		l.mu.Unlock()
		return scenarioReport{}, fmt.Errorf("测试服务正在关闭，请重启后再试")
	}
	for _, r := range l.scenarioRuns {
		if r.Status == "running" || r.Status == "stopping" {
			l.mu.Unlock()
			return scenarioReport{}, fmt.Errorf("已有测试正在运行，请等待完成或先停止")
		}
	}
	if l.scenarioRuns == nil {
		l.scenarioRuns = map[string]*scenarioReport{}
	}
	at := time.Now().UTC()
	report := scenarioReport{ID: id, RunID: secret(), Title: definition.Title, Description: definition.Description, Status: "running", StartedAt: &at, Steps: []scenarioStep{}}
	l.scenarioRuns[id] = &report
	parent := l.scenarioContext
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 150*time.Second)
	l.scenarioCancel = cancel
	done := make(chan struct{})
	l.scenarioDone = done
	snapshot := report
	l.mu.Unlock()
	l.persist()
	go func() {
		defer close(done)
		l.executeScenario(ctx, cancel, *definition, report.RunID)
	}()
	return snapshot, nil
}
func (l *lab) stopScenario() {
	l.mu.Lock()
	cancel := l.scenarioCancel
	for _, r := range l.scenarioRuns {
		if r.Status == "running" {
			r.Status = "stopping"
		}
	}
	l.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	l.persist()
}

// Keep the server alive until its child has cleaned up its temporary database.
func (l *lab) waitScenario() {
	l.mu.Lock()
	done := l.scenarioDone
	l.mu.Unlock()
	if done != nil {
		select {
		case <-done:
		case <-time.After(10 * time.Second):
		}
	}
}
func scenarioEvent(line, testName string) (scenarioStep, bool) {
	if !strings.HasPrefix(line, "BILLING_SCENARIO ") {
		return scenarioStep{}, false
	}
	var step scenarioStep
	if json.Unmarshal([]byte(strings.TrimPrefix(line, "BILLING_SCENARIO ")), &step) != nil || (step.Test != testName && !strings.HasPrefix(step.Test, testName+"/")) || step.Name == "" || len(step.Name) > 500 || len(step.Expected) > 4096 || len(step.Actual) > 4096 {
		return scenarioStep{}, false
	}
	return step, true
}
func (l *lab) executeScenario(ctx context.Context, cancel context.CancelFunc, d scenarioDefinition, runID string) {
	defer cancel()
	command := exec.CommandContext(ctx, l.scenarioBinary, "-test.run=^"+d.Test+"$", "-test.v", "-test.timeout=120s")
	command.Env = []string{"APP_ENV=development", "GIN_MODE=release", "GOMAXPROCS=2", "APP_SECRET=scenario-process-local-only-secret-001", "TEST_DATABASE_URL=" + l.scenarioDB}
	command.Cancel = func() error { return command.Process.Signal(os.Interrupt) }
	command.WaitDelay = 8 * time.Second
	pipe, err := command.StdoutPipe()
	logs := []string{}
	if err == nil {
		command.Stderr = command.Stdout
		err = command.Start()
		if err == nil {
			scanner := bufio.NewScanner(pipe)
			scanner.Buffer(make([]byte, 8192), 256*1024)
			for scanner.Scan() {
				line := scanner.Text()
				if step, ok := scenarioEvent(line, d.Test); ok {
					l.mu.Lock()
					r := l.scenarioRuns[d.ID]
					if r != nil && r.RunID == runID && len(r.Steps) < 200 {
						r.Steps = append(r.Steps, step)
					}
					l.mu.Unlock()
				} else if strings.TrimSpace(line) != "" {
					logs = append(logs, line)
					if len(logs) > 12 {
						logs = logs[1:]
					}
				}
			}
			scanErr := scanner.Err()
			if scanErr != nil {
				cancel()
			}
			err = command.Wait()
			if err == nil {
				err = scanErr
			}
		}
	}
	l.mu.Lock()
	if r := l.scenarioRuns[d.ID]; r != nil && r.RunID == runID {
		at := time.Now().UTC()
		r.FinishedAt = &at
		r.Status = "passed"
		passed := len(r.Steps) >= d.MinimumChecks
		for _, step := range r.Steps {
			passed = passed && step.Passed
		}
		if ctx.Err() == context.DeadlineExceeded {
			r.Status = "failed"
			r.Error = "测试超时，未完整执行，请重试并查看日志"
		} else if ctx.Err() != nil {
			r.Status = "cancelled"
			r.Error = "测试已停止，未通过的检查不能视为完成"
		} else if err != nil || !passed {
			r.Status = "failed"
			r.Error = "测试未通过，请核对未通过项。"
			if len(r.Steps) < d.MinimumChecks {
				r.Error += " 测试未完整执行。"
			}
			if err != nil {
				diagnostic := strings.Join(logs, "\n")
				if diagnostic == "" {
					diagnostic = err.Error()
				}
				if len(diagnostic) > 2400 {
					diagnostic = diagnostic[len(diagnostic)-2400:]
				}
				r.Error += "\n" + diagnostic
			}
		}
		l.scenarioCancel = nil
	}
	l.mu.Unlock()
	l.persist()
}
