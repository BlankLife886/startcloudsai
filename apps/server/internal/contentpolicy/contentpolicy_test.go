package contentpolicy_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/contentpolicy"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestDefaultConfigMatch(t *testing.T) {
	cfg := contentpolicy.DefaultConfig()
	cases := []struct {
		message string
		rule    string
	}{
		{"非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。如果你认为此判断有误，请重试或修改提示语。", "防护限制"},
		{"非常抱歉，该提示可能违反了我们的内容政策。如果你认为此判断有误，请重试或修改提示语。", "内容政策"},
		{"抱歉，我不能帮助移除真实人物照片中的衣物或生成裸露版本。", "不能帮助 + 裸露"},
		{"Your request was rejected by the safety system.", "safety system"},
		{"内容审核拒绝：参考图不符合服务政策", "内容审核拒绝"},
		// 正常的文字回复和平台故障不能算违规。
		{"请上传需要处理的原图，我会基于原图进行高清增强、去雾、提升清晰度。", ""},
		{"抱歉，我无法帮助你完成这个请求，请上传参考图片。", ""},
		{"No available compatible accounts", ""},
		{"API Key 已失效", ""},
	}
	for _, tc := range cases {
		rule, ok := cfg.Match(tc.message)
		if ok != (tc.rule != "") || rule != tc.rule {
			t.Errorf("Match(%q) = %q, %v; want %q", tc.message, rule, ok, tc.rule)
		}
	}
}

func TestCustomPhrasesAreCaseInsensitiveAndValidated(t *testing.T) {
	result := contentpolicy.Test(contentpolicy.Config{PolicyPhrases: []string{"  Community Guidelines ", ""}}, "This violates our community guidelines.")
	if !result.Violation || result.Rule != "Community Guidelines" {
		t.Fatalf("custom phrase result = %#v", result)
	}
	if err := (contentpolicy.Config{DailyFreeCount: -1, PolicyPhrases: []string{"x"}}).Validate(); err == nil {
		t.Fatal("negative daily free count must be rejected")
	}
	if err := (contentpolicy.Config{RefusalPhrases: []string{"不能帮助"}}).Validate(); err == nil {
		t.Fatal("rules that can never match must be rejected")
	}
}

func newUser(t *testing.T, st *store.Store) uuid.UUID {
	t.Helper()
	user, err := store.InsertUser(context.Background(), st.Pool, fmt.Sprintf("cp-%s@test.dev", uuid.NewString()[:8]), "tester", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	return user.ID
}

func TestDecideWaivesDailyFreeCountThenCharges(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	cfg := contentpolicy.DefaultConfig()
	cfg.DailyFreeCount = 2
	if _, err := contentpolicy.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	userID := newUser(t, st)
	now := time.Now().UTC()
	decide := func(code, message string) contentpolicy.Decision {
		t.Helper()
		decision, err := contentpolicy.Decide(ctx, st.Pool, contentpolicy.Event{
			UserID: userID, SourceType: contentpolicy.SourceTask, SourceID: uuid.NewString(),
			Prompt: "prompt", ErrorCode: code, Message: message, AmountCents: 5,
		}, now)
		if err != nil {
			t.Fatal(err)
		}
		return decision
	}
	if d := decide("upstream_error", "No available compatible accounts"); d.Violation || d.Code != "upstream_error" {
		t.Fatalf("ordinary failure = %#v", d)
	}
	if d := decide("user_canceled", "违反了内容政策"); d.Violation {
		t.Fatalf("non-upstream failure must never be a violation: %#v", d)
	}
	for i := 0; i < 2; i++ {
		d := decide("upstream_error", "生成的图片可能违反了防护限制")
		if !d.Violation || d.Charge || d.Code != contentpolicy.WaivedCode || d.Record.WaiveReason != contentpolicy.WaiveDailyFree {
			t.Fatalf("free violation %d = %#v", i+1, d)
		}
	}
	d := decide("upstream_rejected", "该提示可能违反了我们的内容政策")
	if !d.Charge || d.Code != contentpolicy.Code || d.Record.ChargedCents != 5 || d.Record.MatchedRule != "内容政策" {
		t.Fatalf("third violation = %#v", d)
	}

	// 关闭扣费后仍然记录违规，但一律退回。
	cfg.Enabled = false
	if _, err := contentpolicy.Save(ctx, st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	if d := decide("upstream_error", "防护限制"); !d.Violation || d.Charge || d.Record.WaiveReason != contentpolicy.WaiveDisabled {
		t.Fatalf("disabled violation = %#v", d)
	}
}

func TestDecideReusesEarlierDecisionForSameSource(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	userID := newUser(t, st)
	event := contentpolicy.Event{
		UserID: userID, SourceType: contentpolicy.SourceAssistantRun, SourceID: "run:0",
		ErrorCode: "upstream_rejected", Message: "防护限制", AmountCents: 3,
	}
	first, err := contentpolicy.Decide(ctx, st.Pool, event, time.Now().UTC())
	if err != nil || !first.Charge {
		t.Fatalf("first = %#v err=%v", first, err)
	}
	second, err := contentpolicy.Decide(ctx, st.Pool, event, time.Now().UTC())
	if err != nil || second.Record.ID != first.Record.ID || !second.Charge {
		t.Fatalf("second = %#v err=%v", second, err)
	}
}
