package store

import "testing"

func TestRefundWindowDefaultsPreserveLegacySnapshots(t *testing.T) {
	legacy := SubscriptionPolicy{}
	if legacy.RefundGraceHours() != 24 {
		t.Fatal("legacy snapshot changed")
	}
	if err := legacy.Normalize(); err != nil {
		t.Fatal(err)
	}
	if legacy.RefundWindowHours == nil || legacy.RefundGraceHours() != 3 {
		t.Fatal("new plan did not save three-hour default")
	}
	for _, hours := range []int{0, 3, 24, 72} {
		policy := DefaultSubscriptionPolicy()
		policy.RefundWindowHours = &hours
		if err := policy.Normalize(); err != nil {
			t.Fatal(err)
		}
		if policy.RefundGraceHours() != hours {
			t.Fatalf("explicit %d-hour rule overwritten", hours)
		}
	}
}
