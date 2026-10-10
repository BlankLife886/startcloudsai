package announcementstream

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeBus struct {
	mu      sync.Mutex
	clients map[chan struct{}]struct{}
	drop    bool
}

func (b *fakeBus) Subscribe(context.Context) (<-chan struct{}, func(), error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.clients == nil {
		b.clients = map[chan struct{}]struct{}{}
	}
	client := make(chan struct{}, 1)
	b.clients[client] = struct{}{}
	var once sync.Once
	return client, func() { once.Do(func() { b.mu.Lock(); delete(b.clients, client); close(client); b.mu.Unlock() }) }, nil
}

func (b *fakeBus) Publish(context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.drop {
		return errors.New("fake transport unavailable")
	}
	for client := range b.clients {
		select {
		case client <- struct{}{}:
		default:
		}
	}
	return nil
}

func (b *fakeBus) Close() error { return nil }

func nextSnapshot(t *testing.T, changes <-chan Snapshot) Snapshot {
	t.Helper()
	select {
	case snapshot, ok := <-changes:
		if !ok {
			t.Fatal("stream closed before update")
		}
		return snapshot
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for announcement snapshot")
		return Snapshot{}
	}
}

func TestSourceSharesCacheAcrossSubscribers(t *testing.T) {
	var loads atomic.Int64
	var state atomic.Value
	state.Store(`{"items":[]}`)
	source := New(func(context.Context) ([]byte, error) { loads.Add(1); return []byte(state.Load().(string)), nil }, nil, Options{RefreshInterval: time.Hour})
	defer source.Close()
	clients := make([]<-chan Snapshot, 0, 20)
	for range 20 {
		snapshot, changes, cancel, err := source.Subscribe(context.Background())
		if err != nil || string(snapshot.Data) != `{"items":[]}` {
			t.Fatalf("initial snapshot=%s err=%v", snapshot.Data, err)
		}
		defer cancel()
		clients = append(clients, changes)
	}
	if loads.Load() != 1 {
		t.Fatalf("20 subscribers triggered %d database reads", loads.Load())
	}
	state.Store(`{"items":[{"pushId":"new-push"}]}`)
	if err := source.Notify(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, client := range clients {
		if got := nextSnapshot(t, client); string(got.Data) != state.Load().(string) {
			t.Fatalf("update = %s", got.Data)
		}
	}
	if loads.Load() != 2 {
		t.Fatalf("broadcast triggered %d database reads, want 2 total", loads.Load())
	}
}

func TestSourceBroadcastsAcrossInstancesAndReconnectsFromState(t *testing.T) {
	bus := &fakeBus{}
	var state atomic.Value
	state.Store(`{"items":[]}`)
	load := func(context.Context) ([]byte, error) { return []byte(state.Load().(string)), nil }
	producer, consumer := New(load, bus, Options{RefreshInterval: time.Hour}), New(load, bus, Options{RefreshInterval: time.Hour})
	defer producer.Close()
	defer consumer.Close()
	_, _, ready, err := producer.Subscribe(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ready()
	initial, updates, unsubscribe, err := consumer.Subscribe(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	state.Store(`{"items":[{"pushId":"first"}]}`)
	if err := producer.Notify(context.Background()); err != nil {
		t.Fatal(err)
	}
	latest := nextSnapshot(t, updates)
	if latest.ID == initial.ID || string(latest.Data) != state.Load().(string) {
		t.Fatalf("cross-instance snapshot = %#v", latest)
	}
	unsubscribe()
	reconnected, _, stop, err := consumer.Subscribe(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	if reconnected.ID != latest.ID || string(reconnected.Data) != string(latest.Data) {
		t.Fatalf("reconnect lost persisted state: %#v", reconnected)
	}
}

func TestSourcePeriodicRefreshRecoversDroppedBroadcast(t *testing.T) {
	bus := &fakeBus{drop: true}
	var state atomic.Value
	state.Store(`{"items":[]}`)
	source := New(func(context.Context) ([]byte, error) { return []byte(state.Load().(string)), nil }, bus, Options{RefreshInterval: 10 * time.Millisecond})
	defer source.Close()
	_, updates, cancel, err := source.Subscribe(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	state.Store(`{"items":[{"pushId":"missed-during-disconnect"}]}`)
	if err := bus.Publish(context.Background()); err == nil {
		t.Fatal("fake transport should fail")
	}
	if snapshot := nextSnapshot(t, updates); string(snapshot.Data) != state.Load().(string) {
		t.Fatalf("fallback snapshot = %s", snapshot.Data)
	}
}

func TestSourceCloseReleasesSubscriber(t *testing.T) {
	source := New(func(context.Context) ([]byte, error) { return []byte(`{"items":[]}`), nil }, nil, Options{})
	_, updates, cancel, err := source.Subscribe(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := source.Close(); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case _, open := <-updates:
		if open {
			t.Fatal("subscriber remained open")
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber leaked after source close")
	}
	if _, _, _, err := source.Subscribe(context.Background()); err == nil {
		t.Fatal("closed source accepted a subscriber")
	}
}

func TestChannelIsolatesDatabasesWithoutDependingOnCredentials(t *testing.T) {
	first := Channel("postgres://alice:first@localhost:5432/site")
	if first != Channel("postgres://bob:second@127.0.0.1/site") {
		t.Fatal("same database credentials split broadcasts")
	}
	if first == Channel("postgres://alice:first@localhost:5432/site_test") {
		t.Fatal("test database shared production announcement channel")
	}
}
