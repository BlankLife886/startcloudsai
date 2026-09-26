package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

func handheldAtomicFixture(t *testing.T, balance int64) (*Server, *store.User, handheldJobIn) {
	t.Helper()
	st := testdb.Setup(t)
	ctx := context.Background()
	user, err := store.InsertUser(ctx, st.Pool, "handheld-"+uuid.NewString()+"@test.dev", "test", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InsertWallet(ctx, st.Pool, user.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		_, err := wallet.Grant(ctx, tx, user.ID, balance, "grant", "signup_bonus", user.ID.String(), nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	body := handheldJobIn{IdempotencyKey: "same-batch", Spec: validHandheldSpec()}
	body.Spec.Inputs[0].Key = "uploads/" + user.ID.String() + "/original/product.png"
	body.Spec.Shots = append(body.Spec.Shots, handheldShotIn{ID: "detail", Label: "Detail"})
	if err := validateHandheldSpec(&body.Spec); err != nil {
		t.Fatal(err)
	}
	return &Server{St: st}, user, body
}

func atomicHandheldInput(t *testing.T, userID uuid.UUID, body handheldJobIn) (*store.EcommerceHandheldBatch, string) {
	t.Helper()
	id, hash, err := handheldRequestIdentity(userID, body, "")
	if err != nil {
		t.Fatal(err)
	}
	return &store.EcommerceHandheldBatch{ID: id, UserID: userID, Status: "queued", ModelID: body.ModelID, ProductSnapshot: map[string]any{}, ItemCount: len(body.Spec.Shots)}, hash
}

func assertNoHandheldArtifacts(t *testing.T, server *Server, userID uuid.UUID, balance int64) {
	t.Helper()
	for _, table := range []string{"ecommerce_handheld_batches", "ecommerce_handheld_items", "tasks"} {
		var count int
		if err := server.St.Pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table+" WHERE user_id=$1", userID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s left %d partial rows", table, count)
		}
	}
	funds, err := store.GetWallet(context.Background(), server.St.Pool, userID)
	if err != nil {
		t.Fatal(err)
	}
	if funds.BalanceCents != balance || funds.FrozenCents != 0 {
		t.Fatalf("partial wallet change: balance=%d frozen=%d", funds.BalanceCents, funds.FrozenCents)
	}
}

func TestHandheldAtomicInsufficientBalanceRollsBackAllItems(t *testing.T) {
	server, user, body := handheldAtomicFixture(t, 40)
	batch, hash := atomicHandheldInput(t, user.ID, body)
	_, err := server.createHandheldBatchAtomic(context.Background(), batch, body.Spec, hash)
	app, ok := apperr.As(err)
	if !ok || app.Code != "insufficient_balance" {
		t.Fatalf("err=%v", err)
	}
	assertNoHandheldArtifacts(t, server, user.ID, 40)
}

func TestHandheldAtomicConcurrentReplayAndPayloadConflict(t *testing.T) {
	server, user, body := handheldAtomicFixture(t, 200)
	var group sync.WaitGroup
	results := make(chan *handheldBatchResult, 4)
	errors := make(chan error, 4)
	for i := 0; i < 4; i++ {
		batch, hash := atomicHandheldInput(t, user.ID, body)
		group.Go(func() {
			result, err := server.createHandheldBatchAtomic(context.Background(), batch, body.Spec, hash)
			results <- result
			errors <- err
		})
	}
	group.Wait()
	close(results)
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	created := 0
	var ids []uuid.UUID
	for result := range results {
		if result.created {
			created++
		}
		if len(result.tasks) != 2 || len(result.items) != 2 {
			t.Fatalf("partial replay: %+v", result)
		}
		if len(ids) == 0 {
			for _, task := range result.tasks {
				ids = append(ids, task.ID)
			}
		}
		for i, task := range result.tasks {
			if task.ID != ids[i] {
				t.Fatal("replay created different task")
			}
		}
	}
	if created != 1 {
		t.Fatalf("created=%d", created)
	}
	funds, _ := store.GetWallet(context.Background(), server.St.Pool, user.ID)
	if funds.BalanceCents != 140 || funds.FrozenCents != 60 {
		t.Fatalf("wallet=%+v", funds)
	}
	body.Spec.ProductName = "changed"
	batch, hash := atomicHandheldInput(t, user.ID, body)
	_, err := server.createHandheldBatchAtomic(context.Background(), batch, body.Spec, hash)
	app, ok := apperr.As(err)
	if !ok || app.Code != "idempotency_conflict" {
		t.Fatalf("conflict err=%v", err)
	}
}

func TestHandheldAtomicDisconnectAfterFirstFreezeRollsBack(t *testing.T) {
	server, user, body := handheldAtomicFixture(t, 200)
	ctx, stop := context.WithTimeout(context.Background(), 20*time.Second)
	defer stop()
	gate, err := server.St.Pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Release()
	const lockID = int64(773195214)
	if _, err := gate.Exec(ctx, "SELECT pg_advisory_lock($1)", lockID); err != nil {
		t.Fatal(err)
	}
	defer gate.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", lockID)
	_, err = server.St.Pool.Exec(ctx, fmt.Sprintf(`CREATE FUNCTION pause_second_handheld_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.item_index=1 THEN PERFORM pg_advisory_xact_lock(%d); END IF; RETURN NEW; END $$; CREATE TRIGGER pause_second_handheld BEFORE INSERT ON ecommerce_handheld_items FOR EACH ROW EXECUTE FUNCTION pause_second_handheld_item();`, lockID))
	if err != nil {
		t.Fatal(err)
	}
	requestCtx, disconnect := context.WithCancel(ctx)
	defer disconnect()
	batch, hash := atomicHandheldInput(t, user.ID, body)
	done := make(chan error, 1)
	go func() { _, err := server.createHandheldBatchAtomic(requestCtx, batch, body.Spec, hash); done <- err }()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var blocked bool
		if err := server.St.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE 'INSERT INTO ecommerce_handheld_items%')`).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("request ended before second item: %v", err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
	disconnect()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("err=%v", err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if _, err := gate.Exec(ctx, "SELECT pg_advisory_unlock($1)", lockID); err != nil {
		t.Fatal(err)
	}
	assertNoHandheldArtifacts(t, server, user.ID, 200)
}

func TestHandheldIdempotencyIdentityIsUserScoped(t *testing.T) {
	body := handheldJobIn{IdempotencyKey: "key", Spec: validHandheldSpec()}
	user := uuid.New()
	first, hash, err := handheldRequestIdentity(user, body, "")
	if err != nil {
		t.Fatal(err)
	}
	second, secondHash, _ := handheldRequestIdentity(user, body, "")
	other, _, _ := handheldRequestIdentity(uuid.New(), body, "")
	if first != second || hash != secondHash || first == other {
		t.Fatal("invalid identity scope")
	}
	body.IdempotencyKey = ""
	header, _, _ := handheldRequestIdentity(user, body, "key")
	if first != header {
		t.Fatal("header key differs from body key")
	}
}

func TestHandheldAtomicHTTPReplayKeepsOriginalInputsAndBilling(t *testing.T) {
	server, user, body := handheldAtomicFixture(t, 200)
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	var reads atomic.Int32
	var unavailable atomic.Bool
	objects := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads.Add(1)
		if unavailable.Load() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", fmt.Sprint(pngData.Len()))
		_, _ = w.Write(pngData.Bytes())
	}))
	defer objects.Close()
	cfg := config.Load()
	cfg.AppEnv = "development"
	cfg.ObjectStorageEndpoint = objects.URL
	cfg.ObjectStoragePublicEndpoint = ""
	cfg.ObjectStorageRegion = "test"
	cfg.ObjectStorageAccessKeyID = "test-key"
	cfg.ObjectStorageSecretAccessKey = "test-secret"
	cfg.ObjectStorageBucket = "handheld-test"
	cfg.ObjectStorageUsePathStyle = true
	stg, err := storage.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server.Cfg, server.Storage = cfg, stg
	router := gin.New()
	router.POST("/handheld", func(c *gin.Context) { c.Set(ctxOpenAPIUser, user); server.createHandheldJob(c) })
	request := func(input handheldJobIn) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(input)
		req := httptest.NewRequest(http.MethodPost, "/handheld", bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	first := request(body)
	if first.Code != 201 {
		t.Fatalf("first=%d %s", first.Code, first.Body.String())
	}
	firstData, _ := decode(t, first)
	beforeReads := reads.Load()
	unavailable.Store(true)
	if err := settings.Set(context.Background(), server.St.Pool, "task_prices", json.RawMessage(`{"ecommerce_design":90}`)); err != nil {
		t.Fatal(err)
	}
	replay := request(body)
	if replay.Code != 200 {
		t.Fatalf("replay=%d %s", replay.Code, replay.Body.String())
	}
	data, _ := decode(t, replay)
	if data["id"] != firstData["id"] || data["totalCostCents"] != float64(60) || reads.Load() != beforeReads {
		t.Fatalf("replay changed request/price or revalidated old input: %+v reads=%d", data, reads.Load())
	}
	body.Spec.ProductName = "changed"
	if changed := request(body); changed.Code != 409 {
		t.Fatalf("conflict=%d %s", changed.Code, changed.Body.String())
	}
	body.IdempotencyKey = "new-key"
	body.Spec.Inputs[0].Key = "uploads/" + uuid.NewString() + "/original/foreign.png"
	if foreign := request(body); foreign.Code != 422 {
		t.Fatalf("foreign input=%d %s", foreign.Code, foreign.Body.String())
	}
	funds, _ := store.GetWallet(context.Background(), server.St.Pool, user.ID)
	if funds.FrozenCents != 60 || funds.BalanceCents != 140 {
		t.Fatalf("wallet=%+v", funds)
	}
}
