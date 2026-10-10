package announcementstream

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisBus struct {
	client  *redis.Client
	channel string
}

func Channel(databaseURL string) string {
	identity := databaseURL
	if parsed, err := url.Parse(databaseURL); err == nil {
		host, port := strings.ToLower(parsed.Hostname()), parsed.Port()
		if host == "localhost" || host == "127.0.0.1" || host == "::1" {
			host = "loopback"
		}
		if port == "" {
			port = "5432"
		}
		identity = net.JoinHostPort(host, port) + parsed.Path
	}
	digest := sha256.Sum256([]byte(identity))
	return "site:announcements:changed:" + hex.EncodeToString(digest[:16])
}

func NewRedisBus(redisURL, databaseURL string) (*RedisBus, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	options.ContextTimeoutEnabled = true
	options.DialTimeout = time.Second
	return &RedisBus{client: redis.NewClient(options), channel: Channel(databaseURL)}, nil
}

func (b *RedisBus) Publish(ctx context.Context) error {
	publishCtx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	return b.client.Publish(publishCtx, b.channel, "changed").Err()
}

func (b *RedisBus) Subscribe(ctx context.Context) (<-chan struct{}, func(), error) {
	subscription := b.client.Subscribe(ctx, b.channel)
	receiveCtx, receiveCancel := context.WithTimeout(ctx, time.Second)
	_, err := subscription.Receive(receiveCtx)
	receiveCancel()
	if err != nil {
		_ = subscription.Close()
		return nil, nil, err
	}
	streamCtx, cancel := context.WithCancel(ctx)
	changes := make(chan struct{}, 1)
	messages := subscription.Channel()
	go func() {
		defer close(changes)
		for {
			select {
			case <-streamCtx.Done():
				return
			case _, ok := <-messages:
				if !ok {
					return
				}
				select {
				case changes <- struct{}{}:
				default:
				}
			}
		}
	}()
	var once sync.Once
	unsubscribe := func() { once.Do(func() { cancel(); _ = subscription.Close() }) }
	return changes, unsubscribe, nil
}

func (b *RedisBus) Close() error { return b.client.Close() }
