package store

import "testing"

// unionCursorPage copies filters into each branch; a UNION ALL added inside a
// nested subquery of the source SQL would split a branch and break the query.
func TestTaskUnionSourceBranches(t *testing.T) {
	if got := len(adminTaskSourceBranches); got != 2 {
		t.Fatalf("admin task source branches = %d, want 2", got)
	}
	if got := len(adminTaskOverviewSourceBranches); got != 2 {
		t.Fatalf("admin task overview source branches = %d, want 2", got)
	}
	if got := len(userHistoryTaskSourceBranches); got != 3 {
		t.Fatalf("user history task source branches = %d, want 3", got)
	}
}
