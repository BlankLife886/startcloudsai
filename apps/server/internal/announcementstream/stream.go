// Package announcementstream shares one durable-state refresh loop per API instance.
package announcementstream

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

type Bus interface {
	Publish(context.Context) error
	Subscribe(context.Context) (<-chan struct{}, func(), error)
	Close() error
}

type Snapshot struct {
	ID   string
	Data []byte
}

type Loader func(context.Context) ([]byte, error)

type Options struct {
	RefreshInterval time.Duration
}

type Source struct {
	load    Loader
	bus     Bus
	cancel  context.CancelFunc
	done    chan struct{}
	ready   chan struct{}
	wake    chan struct{}
	mu      sync.Mutex
	latest  Snapshot
	err     error
	closed  bool
	clients map[chan Snapshot]struct{}
}

func New(load Loader, bus Bus, options Options) *Source {
	interval := options.RefreshInterval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Source{
		load: load, bus: bus, cancel: cancel, done: make(chan struct{}),
		ready: make(chan struct{}), wake: make(chan struct{}, 1), clients: map[chan Snapshot]struct{}{},
	}
	go s.run(ctx, interval)
	return s
}

func (s *Source) refresh(ctx context.Context) {
	loadCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	data, err := s.load(loadCtx)
	cancel()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err = err
	if err != nil {
		return
	}
	digest := sha256.Sum256(data)
	snapshot := Snapshot{ID: hex.EncodeToString(digest[:]), Data: data}
	if snapshot.ID == s.latest.ID {
		return
	}
	s.latest = snapshot
	for client := range s.clients {
		// Slow browsers need the latest complete state, not a backlog of edits.
		select {
		case <-client:
		default:
		}
		client <- snapshot
	}
}

func (s *Source) run(ctx context.Context, interval time.Duration) {
	defer close(s.done)
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.closed = true
		for client := range s.clients {
			close(client)
			delete(s.clients, client)
		}
	}()
	var events <-chan struct{}
	var unsubscribe func()
	connect := func() {
		if s.bus == nil || events != nil {
			return
		}
		if unsubscribe != nil {
			unsubscribe()
			unsubscribe = nil
		}
		if channel, cancel, err := s.bus.Subscribe(ctx); err == nil {
			events, unsubscribe = channel, cancel
		}
	}
	defer func() {
		if unsubscribe != nil {
			unsubscribe()
		}
	}()
	// Subscribe before reading so a write racing the first snapshot is observed.
	connect()
	s.refresh(ctx)
	close(s.ready)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
			s.refresh(ctx)
		case _, ok := <-events:
			if !ok {
				events = nil
			}
			s.refresh(ctx)
		case <-ticker.C:
			// One poll per instance also catches dropped broadcasts and schedule changes.
			s.refresh(ctx)
			connect()
		}
	}
}

func (s *Source) Subscribe(ctx context.Context) (Snapshot, <-chan Snapshot, func(), error) {
	select {
	case <-ctx.Done():
		return Snapshot{}, nil, nil, ctx.Err()
	case <-s.done:
		return Snapshot{}, nil, nil, errors.New("announcement stream is closed")
	case <-s.ready:
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return Snapshot{}, nil, nil, errors.New("announcement stream is closed")
	}
	if len(s.latest.Data) == 0 {
		if s.err == nil {
			return Snapshot{}, nil, nil, errors.New("announcement snapshot is unavailable")
		}
		return Snapshot{}, nil, nil, s.err
	}
	client := make(chan Snapshot, 1)
	s.clients[client] = struct{}{}
	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			if _, exists := s.clients[client]; exists {
				delete(s.clients, client)
				close(client)
			}
		})
	}
	return s.latest, client, unsubscribe, nil
}

// Notify is called only after a committed write. Redis is a wake-up signal;
// snapshots and push IDs remain durable in PostgreSQL when Redis is unavailable.
func (s *Source) Notify(ctx context.Context) error {
	select {
	case <-s.done:
		return errors.New("announcement stream is closed")
	case s.wake <- struct{}{}:
	default:
	}
	if s.bus != nil {
		return s.bus.Publish(ctx)
	}
	return nil
}

func (s *Source) Close() error {
	s.cancel()
	<-s.done
	if s.bus != nil {
		return s.bus.Close()
	}
	return nil
}
