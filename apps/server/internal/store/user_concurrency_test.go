package store

import (
	"encoding/json"
	"testing"
)

func TestLegacyConcurrencyPreservesCombinedCapacity(t *testing.T) {
	old := BillingContract{TaskConcurrency: 5, AssistantConcurrency: 4, PriceBookID: "original-price-book"}
	if old.ExtraConcurrency() != 5 {
		t.Fatal("combined legacy capacity must stay at nine")
	}
	raw, err := json.Marshal(old)
	if err != nil {
		t.Fatal(err)
	}
	var decoded BillingContract
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.ExtraConcurrency() != 5 || decoded.PriceBookID != old.PriceBookID || old.ConcurrencyBonus != nil {
		t.Fatalf("round trip=%+v original=%+v", decoded, old)
	}
	zero := 0
	decoded.ConcurrencyBonus = &zero
	if decoded.ExtraConcurrency() != 0 {
		t.Fatal("explicit zero must override legacy fields")
	}
}

func TestSubscriptionConcurrencyBonusValidation(t *testing.T) {
	for _, value := range []int{-1, 1001} {
		policy := DefaultSubscriptionPolicy()
		policy.ConcurrencyBonus = &value
		if err := policy.Normalize(); err == nil {
			t.Fatalf("accepted bonus %d", value)
		}
	}
	policy := DefaultSubscriptionPolicy()
	policy.TaskConcurrency = 5
	policy.AssistantConcurrency = 4
	if err := policy.Normalize(); err != nil {
		t.Fatal(err)
	}
	if policy.ExtraConcurrency() != 5 || policy.TaskConcurrency != 0 || policy.AssistantConcurrency != 0 {
		t.Fatalf("legacy policy=%+v", policy)
	}
}
