package userassets

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// memoryObjects is a tiny path-style object store: GET, PUT and DELETE by key.
type memoryObjects struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (m *memoryObjects) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := strings.TrimPrefix(r.URL.Path, "/save-test/")
	switch r.Method {
	case http.MethodPut:
		data, _ := io.ReadAll(r.Body)
		m.objects[key] = data
	case http.MethodGet, http.MethodHead:
		data, ok := m.objects[key]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`<Error><Code>NoSuchKey</Code></Error>`))
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		_, _ = w.Write(data)
	case http.MethodDelete:
		delete(m.objects, key)
		w.WriteHeader(http.StatusNoContent)
	case http.MethodPost:
		// Multi-object delete: drop every <Key> in the body.
		body, _ := io.ReadAll(r.Body)
		for _, part := range strings.Split(string(body), "<Key>")[1:] {
			delete(m.objects, part[:strings.Index(part, "</Key>")])
		}
		_, _ = w.Write([]byte(`<DeleteResult></DeleteResult>`))
	}
}

func (m *memoryObjects) has(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.objects[key]
	return ok
}

func testStorage(t *testing.T) (*storage.Storage, *memoryObjects) {
	t.Helper()
	objects := &memoryObjects{objects: map[string][]byte{}}
	server := httptest.NewServer(objects)
	t.Cleanup(server.Close)
	cfg := config.Load()
	cfg.AppEnv = "development"
	cfg.ObjectStorageEndpoint = server.URL
	cfg.ObjectStoragePublicEndpoint = ""
	cfg.ObjectStorageRegion = "test"
	cfg.ObjectStorageAccessKeyID = "test-key"
	cfg.ObjectStorageSecretAccessKey = "test-secret"
	cfg.ObjectStorageBucket = "save-test"
	cfg.ObjectStorageUsePathStyle = true
	stg, err := storage.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return stg, objects
}

func pngBytes(t *testing.T, shade uint8) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for x := 0; x < 8; x++ {
		for y := 0; y < 8; y++ {
			canvas.Set(x, y, color.RGBA{R: shade, G: 80, B: 160, A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, canvas); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func (f fixture) succeededTask(user uuid.UUID, prompt string, keys ...string) uuid.UUID {
	f.t.Helper()
	var id uuid.UUID
	raw := `["` + strings.Join(keys, `","`) + `"]`
	if err := f.st.Pool.QueryRow(f.ctx, `INSERT INTO tasks (user_id, type, status, prompt, count, output_keys, params, cost_cents, created_at)
		VALUES ($1, 'ecommerce_design', 'succeeded', $2, 1, $3::jsonb, '{"viewLabel":"精华瓶白底图"}', 0, now()) RETURNING id`,
		user, prompt, raw).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func TestSaveGeneratedImagesIntoLibrary(t *testing.T) {
	f := setup(t)
	stg, objects := testStorage(t)
	user := f.user()
	other := f.user()
	key := "tasks/" + user.String() + "/" + uuid.NewString() + "/original/0.png"
	objects.objects[key] = pngBytes(t, 10)
	task := f.succeededTask(user, "白底精华瓶", key)
	otherTask := f.succeededTask(other, "别人的图", "tasks/"+other.String()+"/x/original/0.png")

	if _, err := ProposeSave(f.ctx, f.st.Pool, user, nil, SaveRequest{ImageIDs: []string{"task:" + otherTask.String()}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("someone else's task must not resolve: %v", err)
	}
	if _, err := ProposeSave(f.ctx, f.st.Pool, user, nil, SaveRequest{ImageIDs: []string{"task:" + task.String()}, RecentImages: 1}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("two sources must be refused: %v", err)
	}
	proposal, err := ProposeSave(f.ctx, f.st.Pool, user, nil, SaveRequest{ImageIDs: []string{"task:" + task.String()}, Group: "护肤新品", Tags: []string{"精华"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(proposal.Images) != 1 || proposal.Images[0].Key != key || !proposal.CreateGroup ||
		!strings.Contains(proposal.Summary, "「护肤新品」（新建这个分组）") || proposal.Images[0].Title != "精华瓶白底图" {
		t.Fatalf("proposal: %+v", proposal)
	}
	if count, _ := store.CountUserAssets(f.ctx, f.st.Pool, user); count != 0 {
		t.Fatal("proposing must not save anything")
	}

	// A tampered card cannot copy someone else's file.
	tampered := *proposal
	tampered.Images = []SaveImage{{Key: "tasks/" + other.String() + "/x/original/0.png"}}
	if _, err := ExecuteSave(f.ctx, f.st, stg, user, tampered); !errors.Is(err, ErrInvalid) {
		t.Fatalf("foreign key must be refused: %v", err)
	}

	undo, err := ExecuteSave(f.ctx, f.st, stg, user, *proposal)
	if err != nil {
		t.Fatal(err)
	}
	if len(undo.Items) != 1 || undo.CreatedGroup == "" {
		t.Fatalf("undo: %+v", undo)
	}
	id, _ := uuid.Parse(undo.Items[0].AssetID)
	asset, err := store.GetUserAsset(f.ctx, f.st.Pool, user, id)
	if err != nil || asset == nil {
		t.Fatalf("saved asset: %v", err)
	}
	if !strings.HasPrefix(asset.FileKey, "uploads/"+user.String()+"/original/") || !objects.has(asset.FileKey) || !objects.has(asset.ThumbnailKey) ||
		asset.GroupID == nil || len(asset.Tags) != 1 || asset.SourceType != "task" || asset.Title != "精华瓶白底图" {
		t.Fatalf("asset: %+v", asset)
	}

	// The same image again is skipped, and no empty group or stray copy is left.
	again := *proposal
	again.Group = "另一个分组"
	if _, err := ExecuteSave(f.ctx, f.st, stg, user, again); !errors.Is(err, ErrInvalid) {
		t.Fatalf("duplicate save: %v", err)
	}
	if group, _ := findGroup(f.ctx, f.st.Pool, user, "另一个分组"); group != nil {
		t.Fatal("a group created for nothing must be removed")
	}
	uploads := 0
	for stored := range objects.objects {
		if strings.HasPrefix(stored, "uploads/") {
			uploads++
		}
	}
	if uploads != 3 { // original, thumb, display of the one saved copy
		t.Fatalf("stray copies left: %d objects", uploads)
	}

	if err := RevertUndo(f.ctx, f.st, user, *undo); err != nil {
		t.Fatal(err)
	}
	if count, _ := store.CountUserAssets(f.ctx, f.st.Pool, user); count != 0 {
		t.Fatal("undo must move the copy to the recycle bin")
	}
	if group, _ := findGroup(f.ctx, f.st.Pool, user, "护肤新品"); group != nil {
		t.Fatal("undo must remove the group it created")
	}
}

func TestSaveRecentConversationImages(t *testing.T) {
	f := setup(t)
	user := f.user()
	conversation := uuid.New()
	if _, err := f.st.Pool.Exec(f.ctx, `INSERT INTO assistant_conversations (id, user_id, title) VALUES ($1, $2, 't')`, conversation, user); err != nil {
		t.Fatal(err)
	}
	for index, keys := range [][]string{{"a.png"}, {"b.png", "c.png"}} {
		images := []map[string]any{}
		for _, name := range keys {
			images = append(images, map[string]any{"fileKey": "tasks/" + user.String() + "/assistant/run/" + name})
		}
		if _, err := store.InsertAssistantMessage(f.ctx, f.st.Pool, store.AssistantMessage{ID: uuid.New(), ConversationID: conversation,
			Role: "assistant", Kind: "image", Status: "complete", Metadata: map[string]any{"images": images, "prompt": "第" + strconv.Itoa(index+1) + "轮"}}); err != nil {
			t.Fatal(err)
		}
	}
	proposal, err := ProposeSave(f.ctx, f.st.Pool, user, &conversation, SaveRequest{RecentImages: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(proposal.Images) != 2 || !strings.HasSuffix(proposal.Images[0].Key, "b.png") || proposal.Images[0].Title != "第2轮" {
		t.Fatalf("newest images first: %+v", proposal.Images)
	}
	named, err := ProposeSave(f.ctx, f.st.Pool, user, &conversation, SaveRequest{RecentImages: 2, Title: "精华瓶透明底图"})
	if err != nil || named.Images[0].Title != "精华瓶透明底图 1" || named.Images[1].Title != "精华瓶透明底图 2" {
		t.Fatalf("named: %+v %v", named, err)
	}
	stranger := f.user()
	if _, err := ProposeSave(f.ctx, f.st.Pool, stranger, &conversation, SaveRequest{RecentImages: 2}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("another user's conversation must not resolve: %v", err)
	}
}
