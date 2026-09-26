package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type ImageSkillOAuthAuthorizationCode struct {
	CodeHash      string
	UserID        uuid.UUID
	ClientID      string
	RedirectURI   string
	CodeChallenge string
	Scope         string
	ExpiresAt     time.Time
}

func InsertImageSkillOAuthAuthorizationCode(ctx context.Context, q Q, code ImageSkillOAuthAuthorizationCode) error {
	_, err := q.Exec(ctx, `INSERT INTO image_skill_oauth_authorization_codes
		(code_hash,user_id,client_id,redirect_uri,code_challenge,scope,expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, code.CodeHash, code.UserID, code.ClientID,
		code.RedirectURI, code.CodeChallenge, code.Scope, code.ExpiresAt)
	return err
}

// ConsumeImageSkillOAuthAuthorizationCode atomically makes an authorization code
// single-use and returns the values needed for PKCE and client validation.
func ConsumeImageSkillOAuthAuthorizationCode(ctx context.Context, q Q, codeHash string, now time.Time) (*ImageSkillOAuthAuthorizationCode, error) {
	var code ImageSkillOAuthAuthorizationCode
	err := q.QueryRow(ctx, `UPDATE image_skill_oauth_authorization_codes
		SET consumed_at=$2
		WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>$2
		RETURNING code_hash,user_id,client_id,redirect_uri,code_challenge,scope,expires_at`, codeHash, now).Scan(
		&code.CodeHash, &code.UserID, &code.ClientID, &code.RedirectURI, &code.CodeChallenge, &code.Scope, &code.ExpiresAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &code, err
}
