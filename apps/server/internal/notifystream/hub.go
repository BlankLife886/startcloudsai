// Package notifystream fans out "this user has a new notification" signals to
// the SSE connections of the current API instance.
//
// The signal comes from Postgres: an AFTER INSERT trigger on notifications
// (migration 00187) calls pg_notify(Channel, user_id). Every insert site — Go
// helpers, raw SQL in the worker, batch expiry jobs — is covered without
// touching it, and every API instance holds its own LISTEN connection.
package notifystream

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Channel is the pg_notify channel written by the notifications trigger.
const Channel = "user_notifications"

type Hub struct {
	mu     sync.Mutex
	subs   map[uuid.UUID]map[chan struct{}]struct{}
	cancel context.CancelFunc
	done   chan struct{}
}

func New() *Hub {
	return &Hub{subs: map[uuid.UUID]map[chan struct{}]struct{}{}}
}

// Start listens on Channel until Close, reconnecting with backoff.
func (h *Hub) Start(pool *pgxpool.Pool) {
	if h == nil || pool == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	h.done = make(chan struct{})
	go func() {
		defer close(h.done)
		backoff := time.Second
		for ctx.Err() == nil {
			err := h.listen(ctx, pool, func() { backoff = time.Second })
			if ctx.Err() != nil {
				return
			}
			log.Printf("notifystream: listen: %v (retry in %s)", err, backoff)
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			backoff = min(backoff*2, 30*time.Second)
		}
	}()
}

func (h *Hub) listen(ctx context.Context, pool *pgxpool.Pool, connected func()) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN "+Channel); err != nil {
		return err
	}
	connected()
	for {
		n, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}
		if userID, perr := uuid.Parse(n.Payload); perr == nil {
			h.Signal(userID)
		}
	}
}

// Subscribe returns a channel that receives a value whenever userID gets a new
// notification. Signals coalesce: a slow reader sees at most one pending value.
func (h *Hub) Subscribe(userID uuid.UUID) (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	if h == nil {
		return ch, func() {}
	}
	h.mu.Lock()
	if h.subs[userID] == nil {
		h.subs[userID] = map[chan struct{}]struct{}{}
	}
	h.subs[userID][ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs[userID], ch)
		if len(h.subs[userID]) == 0 {
			delete(h.subs, userID)
		}
		h.mu.Unlock()
	}
}

func (h *Hub) Signal(userID uuid.UUID) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[userID] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (h *Hub) Close() {
	if h == nil || h.cancel == nil {
		return
	}
	h.cancel()
	<-h.done
}
