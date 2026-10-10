package notifystream

import (
	"testing"

	"github.com/google/uuid"
)

func TestSignalReachesOnlyThatUserAndCoalesces(t *testing.T) {
	hub := New()
	alice, bob := uuid.New(), uuid.New()
	aliceCh, stopAlice := hub.Subscribe(alice)
	bobCh, stopBob := hub.Subscribe(bob)
	defer stopBob()

	hub.Signal(alice)
	hub.Signal(alice)
	if len(aliceCh) != 1 {
		t.Fatalf("alice pending = %d, want 1 (coalesced)", len(aliceCh))
	}
	if len(bobCh) != 0 {
		t.Fatalf("bob got a signal meant for alice")
	}

	<-aliceCh
	stopAlice()
	hub.Signal(alice)
	if len(aliceCh) != 0 {
		t.Fatalf("unsubscribed channel still signalled")
	}
}
