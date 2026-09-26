package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestAdminUsersRegistrationDateThroughHTTP(t *testing.T) {
	env := newCommunityEnv(t)
	_, adminToken := env.newUserSession(t, "admin")
	for _, at := range []string{
		"2026-09-01T00:00:00Z", // Outside selected day.
		"2026-09-22T16:00:00Z", // Beijing September 23, start inclusive.
		"2026-09-23T15:59:59Z", // Beijing September 23, end inclusive.
		"2026-09-23T16:00:00Z", // Beijing September 24, excluded.
	} {
		user, _ := env.newUserSession(t, "user")
		date, err := time.Parse(time.RFC3339, at)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = env.st.Pool.Exec(context.Background(), `UPDATE users SET created_at=$2 WHERE id=$1`, user.ID, date); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		query string
		count int
	}{
		{"createdFrom=2026-09-23&createdTo=2026-09-23&", 2},
		{"createdFrom=2026-09-25&createdTo=2026-09-25&", 0},
		{"", 4},
	} {
		response := env.do(t, http.MethodGet, "/api/v1/admin/users?"+tc.query+"page=1&limit=20", nil, adminToken)
		data, code := decode(t, response)
		if response.Code != 200 || code != "" {
			t.Fatalf("request failed: %s", response.Body.String())
		}
		rows := data["items"].([]any)
		if len(rows) != tc.count || int(data["total"].(float64)) != tc.count {
			t.Fatalf("%s: rows=%d total=%v, want %d", tc.query, len(rows), data["total"], tc.count)
		}
		if tc.count == 2 {
			for _, row := range rows {
				date, err := time.Parse(time.RFC3339, row.(map[string]any)["createdAt"].(string))
				if err != nil || date.In(time.FixedZone("Beijing", 8*3600)).Format("2006-01-02") != "2026-09-23" {
					t.Fatalf("out-of-range user: %#v", row)
				}
			}
		}
	}
}
