package settings

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const encryptedSecretPrefix = "enc:v1:"

func secretAEAD(masterKey string) (cipher.AEAD, error) {
	if masterKey == "" {
		return nil, errors.New("应用密钥为空，无法加密设置")
	}
	key := sha256.Sum256([]byte(masterKey))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// EncryptSecret returns a versioned AES-GCM value suitable for JSON storage.
func EncryptSecret(plain, masterKey string) (string, error) {
	if plain == "" || strings.HasPrefix(plain, encryptedSecretPrefix) {
		return plain, nil
	}
	aead, err := secretAEAD(masterKey)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nonce, nonce, []byte(plain), nil)
	return encryptedSecretPrefix + base64.RawURLEncoding.EncodeToString(sealed), nil
}

// DecryptSecret accepts legacy plaintext so startup can migrate existing rows.
func DecryptSecret(value, masterKey string) (string, error) {
	if value == "" || !strings.HasPrefix(value, encryptedSecretPrefix) {
		return value, nil
	}
	aead, err := secretAEAD(masterKey)
	if err != nil {
		return "", err
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, encryptedSecretPrefix))
	if err != nil || len(raw) < aead.NonceSize() {
		return "", errors.New("加密设置格式损坏")
	}
	nonce, ciphertext := raw[:aead.NonceSize()], raw[aead.NonceSize():]
	plain, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", errors.New("无法使用当前 APP_SECRET 解密设置")
	}
	return string(plain), nil
}

// EncryptStoredSecrets upgrades legacy plaintext settings in place at startup.
func EncryptStoredSecrets(ctx context.Context, q store.Q, masterKey string) error {
	for _, key := range []string{"c2a_api_key", "sub2api_api_key"} {
		raw, err := store.GetAppSetting(ctx, q, key)
		if err != nil {
			return err
		}
		if raw == nil {
			continue
		}
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return fmt.Errorf("读取 %s: %w", key, err)
		}
		if value == "" || strings.HasPrefix(value, encryptedSecretPrefix) {
			continue
		}
		encrypted, err := EncryptSecret(value, masterKey)
		if err != nil {
			return err
		}
		encoded, _ := json.Marshal(encrypted)
		if err := store.SetAppSetting(ctx, q, key, encoded, time.Now().UTC()); err != nil {
			return err
		}
	}
	return nil
}
