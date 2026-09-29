package httpapi

import (
	"context"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/gin-gonic/gin"
)

func TestOpenAPIFrozenKeyCannotRotate(t *testing.T) {
	st := testdb.Setup(t)
	ctx := context.Background()
	user, _ := makeOrder(t, st)
	secret, _ := newAPISecret()
	key, err := store.InsertUserAPIKey(ctx, st.Pool, &store.UserAPIKey{UserID: user.ID, KeyPrefix: secret[:18], KeyHash: hashAPISecret(secret), Label: "frozen", AllowedModelIDs: []string{}, DailyTaskLimit: 100, MonthlyTaskLimit: 1000, DailySpendLimitCents: 10000, MonthlySpendLimitCents: 100000})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE user_api_keys SET status='frozen' WHERE id=$1`, key.ID); err != nil {
		t.Fatal(err)
	}
	s := &Server{St: st, Cfg: config.Load()}
	r := gin.New()
	r.POST("/:id", func(c *gin.Context) { c.Set(ctxOpenAPIUser, user); s.rotateMyAPIKey(c) })
	response := authRequest(t, r, "POST", "/"+key.ID.String(), nil)
	if response.Code != 403 {
		t.Fatalf("rotation: %d %s", response.Code, response.Body.String())
	}
	var count int
	st.Pool.QueryRow(ctx, `SELECT count(*) FROM user_api_keys WHERE user_id=$1`, user.ID).Scan(&count)
	if count != 1 {
		t.Fatal("rotation created another key")
	}
}
