package settings

import (
	"strings"
	"testing"
)

func TestEncryptSecretRoundTrip(t *testing.T) {
	const master = "a-production-master-key-with-enough-entropy"
	encrypted, err := EncryptSecret("c2a-sensitive-key", master)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if encrypted == "c2a-sensitive-key" || !strings.HasPrefix(encrypted, encryptedSecretPrefix) {
		t.Fatalf("secret was not encrypted: %q", encrypted)
	}
	plain, err := DecryptSecret(encrypted, master)
	if err != nil || plain != "c2a-sensitive-key" {
		t.Fatalf("decrypt = %q, %v", plain, err)
	}
	if _, err := DecryptSecret(encrypted, "different-key"); err == nil {
		t.Fatal("decrypt with a different key must fail")
	}
}

func TestDecryptSecretAcceptsLegacyPlaintext(t *testing.T) {
	plain, err := DecryptSecret("legacy-key", "master")
	if err != nil || plain != "legacy-key" {
		t.Fatalf("legacy plaintext = %q, %v", plain, err)
	}
}
