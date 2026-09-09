package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func setCheckinSetting(t *testing.T, env *communityEnv, key string, value any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := settings.Set(context.Background(), env.st.Pool, key, raw); err != nil {
		t.Fatal(err)
	}
}

func TestDailyCheckinGrantsWalletAndIsIdempotent(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, token := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	setCheckinSetting(t, env, "checkin_enabled", true)
	setCheckinSetting(t, env, "checkin_rewards", []int64{10, 20, 30, 40, 50, 60, 100})

	if w := env.do(t, http.MethodGet, "/api/v1/me/checkin", nil, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous state status = %d, body=%s", w.Code, w.Body.String())
	}
	before := env.do(t, http.MethodGet, "/api/v1/me/checkin", nil, token)
	beforeData, _ := decode(t, before)
	if before.Code != http.StatusOK || beforeData["todayChecked"] != false || beforeData["claimRewardCents"] != float64(10) {
		t.Fatalf("before checkin status=%d data=%#v", before.Code, beforeData)
	}

	claimed := env.do(t, http.MethodPost, "/api/v1/me/checkin", nil, token)
	claimedData, _ := decode(t, claimed)
	if claimed.Code != http.StatusOK || claimedData["todayChecked"] != true || claimedData["claimedRewardCents"] != float64(10) {
		t.Fatalf("claimed status=%d data=%#v", claimed.Code, claimedData)
	}
	walletState, err := store.GetWallet(ctx, env.st.Pool, user.ID)
	if err != nil || walletState == nil || walletState.BalanceCents != 10 {
		t.Fatalf("wallet=%#v err=%v", walletState, err)
	}

	replayed := env.do(t, http.MethodPost, "/api/v1/me/checkin", nil, token)
	replayedData, _ := decode(t, replayed)
	if replayed.Code != http.StatusOK || replayedData["alreadyChecked"] != true {
		t.Fatalf("replayed status=%d data=%#v", replayed.Code, replayedData)
	}
	walletState, _ = store.GetWallet(ctx, env.st.Pool, user.ID)
	if walletState.BalanceCents != 10 {
		t.Fatalf("replayed wallet balance = %d, want 10", walletState.BalanceCents)
	}
}

func TestDailyCheckinContinuesStreakAndHonorsCampaignSwitch(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, token := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	setCheckinSetting(t, env, "checkin_enabled", true)
	setCheckinSetting(t, env, "checkin_rewards", []int64{10, 20, 30, 40, 50, 60, 100})
	yesterday := addCheckinDays(checkinDateAt(testNow()), -1)
	if _, err := store.InsertDailyCheckin(ctx, env.st.Pool, user.ID, yesterday, 6, 6, 60); err != nil {
		t.Fatal(err)
	}

	claimed := env.do(t, http.MethodPost, "/api/v1/me/checkin", nil, token)
	data, _ := decode(t, claimed)
	if claimed.Code != http.StatusOK || data["currentStreak"] != float64(7) || data["claimedRewardCents"] != float64(100) {
		t.Fatalf("seventh-day status=%d data=%#v", claimed.Code, data)
	}

	other, otherToken := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, other.ID); err != nil {
		t.Fatal(err)
	}
	setCheckinSetting(t, env, "checkin_enabled", false)
	inactive := env.do(t, http.MethodPost, "/api/v1/me/checkin", nil, otherToken)
	if inactive.Code != http.StatusConflict {
		t.Fatalf("inactive status=%d body=%s", inactive.Code, inactive.Body.String())
	}
}

func TestConcurrentDailyCheckinOnlyGrantsOnce(t *testing.T) {
	env := newCommunityEnv(t)
	ctx := context.Background()
	user, token := env.newUserSession(t, "user")
	if err := store.InsertWallet(ctx, env.st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	setCheckinSetting(t, env, "checkin_enabled", true)
	setCheckinSetting(t, env, "checkin_rewards", []int64{25, 30, 35, 40, 45, 50, 100})

	const requests = 16
	statuses := make(chan int, requests)
	var wg sync.WaitGroup
	for i := 0; i < requests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses <- env.do(t, http.MethodPost, "/api/v1/me/checkin", nil, token).Code
		}()
	}
	wg.Wait()
	close(statuses)
	for status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("concurrent status = %d", status)
		}
	}

	walletState, err := store.GetWallet(ctx, env.st.Pool, user.ID)
	if err != nil || walletState == nil || walletState.BalanceCents != 25 {
		t.Fatalf("wallet=%#v err=%v", walletState, err)
	}
	today, err := store.GetDailyCheckin(ctx, env.st.Pool, user.ID, checkinDateAt(testNow()))
	if err != nil || today == nil || today.Streak != 1 {
		t.Fatalf("today=%#v err=%v", today, err)
	}
}

func testNow() time.Time { return time.Now() }
