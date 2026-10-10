package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/announcementstream"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

type announcementTestBus struct {
	mu          sync.Mutex
	subscribers map[chan struct{}]struct{}
	published   int
	fail        bool
}

func (b *announcementTestBus) Publish(context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.published++
	if b.fail {
		return errors.New("fake announcement bus unavailable")
	}
	for client := range b.subscribers {
		select {
		case client <- struct{}{}:
		default:
		}
	}
	return nil
}

func (b *announcementTestBus) Subscribe(context.Context) (<-chan struct{}, func(), error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.subscribers == nil {
		b.subscribers = map[chan struct{}]struct{}{}
	}
	client := make(chan struct{}, 1)
	b.subscribers[client] = struct{}{}
	var once sync.Once
	return client, func() { once.Do(func() { b.mu.Lock(); delete(b.subscribers, client); close(client); b.mu.Unlock() }) }, nil
}

func (b *announcementTestBus) Close() error { return nil }
func (b *announcementTestBus) count() int   { b.mu.Lock(); defer b.mu.Unlock(); return b.published }

func newAnnouncementRealtimeEnv(t *testing.T) (*communityEnv, *Server, *announcementTestBus) {
	t.Helper()
	env := newCommunityEnv(t)
	bus := &announcementTestBus{}
	server := &Server{Cfg: env.cfg, St: env.st}
	server.AnnouncementStream = announcementstream.New(server.announcementSnapshot, bus, announcementstream.Options{RefreshInterval: time.Hour})
	t.Cleanup(server.Close)
	env.engine = server.Router()
	return env, server, bus
}

type announcementEventFrame struct {
	ID    string
	Items []map[string]any
}

func readAnnouncementEvent(t *testing.T, reader *bufio.Reader) announcementEventFrame {
	t.Helper()
	var id, event, data string
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("read announcement SSE: %v", err)
		}
		line = strings.TrimRight(line, "\r\n")
		switch {
		case strings.HasPrefix(line, "id:"):
			id = strings.TrimSpace(strings.TrimPrefix(line, "id:"))
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			data = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		case line == "" && event == "announcements":
			var payload struct {
				Items []map[string]any `json:"items"`
			}
			if err := json.Unmarshal([]byte(data), &payload); err != nil {
				t.Fatal(err)
			}
			if len(id) != 64 {
				t.Fatalf("missing snapshot hash: %q", id)
			}
			return announcementEventFrame{ID: id, Items: payload.Items}
		}
	}
}

func openAnnouncementEvents(t *testing.T, server *httptest.Server, lastID string) (*http.Response, *bufio.Reader) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/v1/announcements/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	if lastID != "" {
		request.Header.Set("Last-Event-ID", lastID)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	if response.StatusCode != http.StatusOK || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") || response.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("announcement stream response: status=%d headers=%v", response.StatusCode, response.Header)
	}
	return response, bufio.NewReader(response.Body)
}

func announcementMutation(t *testing.T, env *communityEnv, method, path, token string, body any, status int) map[string]any {
	t.Helper()
	response := env.do(t, method, path, body, token)
	if response.Code != status {
		t.Fatalf("%s %s status=%d want=%d body=%s", method, path, response.Code, status, response.Body.String())
	}
	if status == http.StatusNoContent {
		return nil
	}
	var payload struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Data
}

func TestAnnouncementEventsSyncCRUDPushAndReconnectAcrossInstances(t *testing.T) {
	env, _, bus := newAnnouncementRealtimeEnv(t)
	_, admin := env.newUserSession(t, "admin")
	consumer := &Server{Cfg: env.cfg, St: env.st}
	consumer.AnnouncementStream = announcementstream.New(consumer.announcementSnapshot, bus, announcementstream.Options{RefreshInterval: time.Hour})
	t.Cleanup(consumer.Close)
	server := httptest.NewServer(consumer.Router())
	t.Cleanup(server.Close)
	connection, reader := openAnnouncementEvents(t, server, "")
	if initial := readAnnouncementEvent(t, reader); len(initial.Items) != 0 {
		t.Fatalf("initial announcements = %#v", initial.Items)
	}
	created := announcementMutation(t, env, http.MethodPost, "/api/v1/admin/announcements", admin, gin.H{"title": "实时公告", "body": "内容"}, http.StatusCreated)
	id := created["id"].(string)
	path := "/api/v1/admin/announcements/" + id
	frame := readAnnouncementEvent(t, reader)
	if len(frame.Items) != 1 || frame.Items[0]["id"] != id || frame.Items[0]["pushId"] != nil {
		t.Fatalf("create snapshot=%#v", frame.Items)
	}
	announcementMutation(t, env, http.MethodPatch, path, admin, gin.H{"title": "普通编辑"}, http.StatusOK)
	frame = readAnnouncementEvent(t, reader)
	if frame.Items[0]["title"] != "普通编辑" || frame.Items[0]["pushId"] != nil {
		t.Fatalf("edit incorrectly forced display: %#v", frame.Items)
	}
	first := announcementMutation(t, env, http.MethodPost, path+"/push", admin, nil, http.StatusOK)
	firstPush, ok := first["pushId"].(string)
	if !ok || first["pushedAt"] == nil {
		t.Fatalf("push metadata=%#v", first)
	}
	if _, err := uuid.Parse(firstPush); err != nil {
		t.Fatal(err)
	}
	frame = readAnnouncementEvent(t, reader)
	if frame.Items[0]["pushId"] != firstPush {
		t.Fatalf("push was not streamed: %#v", frame.Items)
	}
	second := announcementMutation(t, env, http.MethodPost, path+"/push", admin, nil, http.StatusOK)
	secondPush := second["pushId"].(string)
	if secondPush == firstPush {
		t.Fatal("each explicit push must have a new identity")
	}
	frame = readAnnouncementEvent(t, reader)
	if frame.Items[0]["pushId"] != secondPush {
		t.Fatal("second push was not streamed")
	}
	_ = connection.Body.Close()
	_, reader = openAnnouncementEvents(t, server, frame.ID)
	reconnected := readAnnouncementEvent(t, reader)
	if reconnected.ID != frame.ID || reconnected.Items[0]["pushId"] != secondPush {
		t.Fatalf("reconnect state=%#v", reconnected)
	}
	updated := announcementMutation(t, env, http.MethodPatch, path, admin, gin.H{"body": "编辑后内容"}, http.StatusOK)
	frame = readAnnouncementEvent(t, reader)
	if updated["pushId"] != secondPush || frame.Items[0]["pushId"] != secondPush || frame.Items[0]["body"] != "编辑后内容" {
		t.Fatal("ordinary edit replaced push identity")
	}
	announcementMutation(t, env, http.MethodPatch, path, admin, gin.H{"active": false}, http.StatusOK)
	if frame = readAnnouncementEvent(t, reader); len(frame.Items) != 0 {
		t.Fatal("deactivated announcement remained visible")
	}
	before := bus.count()
	if response := env.do(t, http.MethodPost, path+"/push", nil, admin); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("inactive push status=%d", response.Code)
	}
	if bus.count() != before {
		t.Fatal("rejected push broadcast an event")
	}
	announcementMutation(t, env, http.MethodPatch, path, admin, gin.H{"active": true}, http.StatusOK)
	if frame = readAnnouncementEvent(t, reader); len(frame.Items) != 1 || frame.Items[0]["pushId"] != secondPush {
		t.Fatal("reactivation lost push identity")
	}
	announcementMutation(t, env, http.MethodDelete, path, admin, nil, http.StatusNoContent)
	if frame = readAnnouncementEvent(t, reader); len(frame.Items) != 0 {
		t.Fatal("deleted announcement remained visible")
	}
}

func TestAnnouncementPushValidatesEligibilityAndPrioritizesRecentActivity(t *testing.T) {
	env, _, bus := newAnnouncementRealtimeEnv(t)
	_, admin := env.newUserSession(t, "admin")
	ctx := context.Background()
	create := func(title string, active bool, start, end *time.Time) *store.Announcement {
		t.Helper()
		row, err := store.InsertAnnouncement(ctx, env.st.Pool, title, nil, active, start, end, json.RawMessage(`{}`))
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	now := time.Now().UTC()
	future, past := now.Add(time.Hour), now.Add(-time.Hour)
	for _, row := range []*store.Announcement{create("未上架", false, nil, nil), create("未来公告", true, &future, nil), create("已过期", true, nil, &past)} {
		response := env.do(t, http.MethodPost, "/api/v1/admin/announcements/"+row.ID.String()+"/push", nil, admin)
		if response.Code != http.StatusUnprocessableEntity || !strings.Contains(response.Body.String(), "展示时间") {
			t.Fatalf("ineligible push response=%d %s", response.Code, response.Body.String())
		}
		stored, err := store.GetAnnouncement(ctx, env.st.Pool, row.ID)
		if err != nil || stored.PushID != nil || stored.PushedAt != nil {
			t.Fatalf("ineligible push mutated state: %#v err=%v", stored, err)
		}
	}
	if response := env.do(t, http.MethodPost, "/api/v1/admin/announcements/"+uuid.NewString()+"/push", nil, admin); response.Code != http.StatusNotFound {
		t.Fatalf("missing push status=%d", response.Code)
	}
	if response := env.do(t, http.MethodPost, "/api/v1/admin/announcements/"+uuid.NewString()+"/push", nil, ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated push status=%d", response.Code)
	}
	if bus.count() != 0 {
		t.Fatal("rejected pushes broadcast events")
	}
	old := create("旧公告", true, nil, nil)
	if _, err := env.st.Pool.Exec(ctx, `UPDATE announcements SET created_at=$2,pushed_at=$3,push_id=$4 WHERE id=$1`, old.ID, now.AddDate(0, -3, 0), now.AddDate(0, -2, 0), uuid.New()); err != nil {
		t.Fatal(err)
	}
	latest := create("新公告", true, nil, nil)
	items := listPublicAnnouncements(t, env)
	if len(items) != 2 {
		t.Fatalf("public announcements = %#v", items)
	}
	first, _ := items[0].(map[string]any)
	if first["id"] != latest.ID.String() {
		t.Fatalf("old push outranked new announcement: %#v", items)
	}
	pushed := announcementMutation(t, env, http.MethodPost, "/api/v1/admin/announcements/"+old.ID.String()+"/push", admin, nil, http.StatusOK)
	items = listPublicAnnouncements(t, env)
	first, _ = items[0].(map[string]any)
	if first["id"] != old.ID.String() || first["pushId"] != pushed["pushId"] {
		t.Fatalf("immediate push was not prioritized: %#v", items)
	}
}

func TestAnnouncementPushRemainsPersistedWhenBroadcastFails(t *testing.T) {
	env, _, bus := newAnnouncementRealtimeEnv(t)
	_, admin := env.newUserSession(t, "admin")
	row, err := store.InsertAnnouncement(context.Background(), env.st.Pool, "广播恢复", nil, true, nil, nil, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	bus.mu.Lock()
	bus.fail = true
	bus.mu.Unlock()
	pushed := announcementMutation(t, env, http.MethodPost, "/api/v1/admin/announcements/"+row.ID.String()+"/push", admin, nil, http.StatusOK)
	stored, err := store.GetAnnouncement(context.Background(), env.st.Pool, row.ID)
	if err != nil || stored.PushID == nil || stored.PushID.String() != pushed["pushId"] || stored.PushedAt == nil {
		t.Fatalf("push was not persisted: %#v err=%v", stored, err)
	}
}
