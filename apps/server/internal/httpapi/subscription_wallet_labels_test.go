package httpapi

import (
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"testing"
)

func TestSubscriptionWalletSummaryAndExportKeepBusinessCategories(t *testing.T) {
	summary := walletSummaryDict(&store.WalletLedgerStats{Income: []store.WalletSourceTotal{{SourceType: "subscription_cycle", Cents: 100, Count: 1}}})
	found := false
	for _, item := range summary["items"].([]gin.H) {
		if item["id"] == "subscription_cycle" {
			found = true
			if item["cents"] != int64(100) {
				t.Fatalf("subscription total=%v", item)
			}
		}
		if item["id"] == "other" && item["cents"] != int64(0) {
			t.Fatal("subscription grant fell into other income")
		}
	}
	if !found {
		t.Fatal("subscription source missing")
	}
	for kind, label := range map[string]string{"freeze": "退订冻结", "release": "退订解冻", "spend": "退订回收"} {
		entry := &store.LedgerEntry{Kind: kind, SourceType: "subscription_refund_hold", CreditBucket: "subscription"}
		if walletEntryKindLabel(entry) != label || walletExportTitle(entry, nil) != "订阅退订" || walletCreditBucketLabel(entry.CreditBucket) != "订阅积分" {
			t.Fatalf("wrong export label for %s", kind)
		}
	}
}
