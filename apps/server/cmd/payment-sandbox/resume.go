package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/jackc/pgx/v5"
)

type savedLab struct {
	Scenarios []scenarioReport `json:"scenarios,omitempty"`
	DB        string           `json:"db"`
	Clock     time.Time        `json:"clock"`
	Mode      string           `json:"mode"`
	Creates   int              `json:"creates"`
	Gateways  []gatewayOrder   `json:"gateways"`
	Accounts  []struct {
		Account account `json:"account"`
	} `json:"accounts"`
	AdminPassword string `json:"adminPassword"`
}

func readSavedLab(path string) (*savedLab, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var saved savedLab
	if err := json.Unmarshal(data, &saved); err != nil {
		return nil, err
	}
	if !regexp.MustCompile(`^sc_payment_lab_[a-f0-9]{12}$`).MatchString(saved.DB) || len(saved.Accounts) == 0 || saved.Clock.IsZero() {
		return nil, fmt.Errorf("invalid isolated sandbox snapshot")
	}
	return &saved, nil
}
func (l *lab) currentClock() time.Time {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.currentClockLocked()
}
func (l *lab) currentClockLocked() time.Time {
	if l.clockAnchor.IsZero() {
		return l.clock
	}
	return l.clock.Add(time.Since(l.clockAnchor))
}
func (l *lab) resume(ctx context.Context, saved *savedLab) error {
	l.scenarioRuns = map[string]*scenarioReport{}
	for _, r := range saved.Scenarios {
		report := r
		if report.Status == "running" || report.Status == "stopping" {
			report.Status = "interrupted"
			report.Error = "服务重启中断了测试，请重新运行"
		}
		l.scenarioRuns[report.ID] = &report
	}
	l.clock = saved.Clock
	l.mode = saved.Mode
	l.creates = saved.Creates
	l.adminPassword = saved.AdminPassword
	for _, item := range saved.Accounts {
		u, err := store.GetUserByID(ctx, l.st.Pool, item.Account.ID)
		if err != nil {
			return err
		}
		if u == nil || u.Email != item.Account.Email {
			return fmt.Errorf("sandbox account mismatch")
		}
		l.users[item.Account.Key] = item.Account
	}
	for _, entry := range saved.Gateways {
		order := entry
		l.gateway[order.ID] = &order
	}
	for key, code := range map[string]string{"basic": "lab-basic", "plus": "lab-plus", "sub": "lab-sub", "renewal": "lab-renewal", "catchup": "lab-catchup"} {
		plan, err := store.GetPlanByCode(ctx, l.st.Pool, code)
		if err != nil {
			return err
		}
		if plan == nil {
			return fmt.Errorf("missing sandbox plan %s", code)
		}
		l.plans[key] = plan
	}
	if err := l.st.Pool.QueryRow(ctx, `SELECT id FROM admin_accounts WHERE email='admin@payment.test'`).Scan(&l.adminID); err != nil {
		return err
	}
	l.adminToken = auth.NewSessionToken()
	return store.InsertAdminSession(ctx, l.st.Pool, l.adminID, auth.HashToken(l.adminToken), time.Now().Add(24*time.Hour), nil, nil)
}
func (l *lab) ensureUpgradePlan(ctx context.Context) error {
	p, err := store.GetPlanByCode(ctx, l.st.Pool, "lab-sub-plus")
	if err != nil || p != nil {
		return err
	}
	policy := store.DefaultSubscriptionPolicy()
	policy.Tier = 2
	_, err = store.InsertPlan(ctx, l.st.Pool, &store.Plan{Code: "lab-sub-plus", Name: "三日进阶订阅测试", Kind: "subscription", PriceCents: 3990, DurationDays: 3, DailyGrantCents: 300, Active: true, SubscriptionPolicy: policy})
	return err
}

func (l *lab) ensureLifecycleAccount(ctx context.Context) error {
	a := account{Key: "subscriptions", Name: "订阅测试", Email: "subscriptions@example.com"}
	err := l.st.Pool.QueryRow(ctx, `SELECT id FROM users WHERE email=$1`, a.Email).Scan(&a.ID)
	if err == pgx.ErrNoRows {
		u, createErr := store.InsertUser(ctx, l.st.Pool, a.Email, a.Name, "sandbox-no-password", "user", nil)
		if createErr != nil {
			return createErr
		}
		a.ID = u.ID
	} else if err != nil {
		return err
	}
	if err := store.InsertWallet(ctx, l.st.Pool, a.ID); err != nil {
		return err
	}
	l.users[a.Key] = a
	return nil
}
func (l *lab) persist() {
	if l.stateFile == "" {
		return
	}
	l.persistMu.Lock()
	defer l.persistMu.Unlock()
	l.mu.Lock()
	state := savedLab{DB: l.dbName, Clock: l.currentClockLocked(), Mode: l.mode, Creates: l.creates, AdminPassword: l.adminPassword, Gateways: []gatewayOrder{}}
	state.Scenarios = l.scenarioSnapshotLocked()
	for _, order := range l.gateway {
		state.Gateways = append(state.Gateways, *order)
	}
	for _, a := range l.users {
		state.Accounts = append(state.Accounts, struct {
			Account account `json:"account"`
		}{a})
	}
	l.mu.Unlock()
	data, err := json.Marshal(state)
	if err != nil {
		log.Printf("sandbox snapshot: %v", err)
		return
	}
	temp, err := os.CreateTemp(filepath.Dir(l.stateFile), ".sandbox-state-")
	if err != nil {
		log.Printf("sandbox snapshot: %v", err)
		return
	}
	name := temp.Name()
	defer os.Remove(name)
	if _, err = temp.Write(data); err == nil {
		err = temp.Sync()
	}
	closeErr := temp.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, l.stateFile)
	}
	if err != nil {
		log.Printf("sandbox snapshot: %v", err)
	}
}
