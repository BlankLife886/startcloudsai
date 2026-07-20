// Package redemption 实现兑换码（CDK）生成与兑换核心逻辑。
//
// 兑换 = 条件更新（active 且未过期 → redeemed）+ 同事务钱包幂等入账，
// ledger 幂等键 ('grant','redeem_code',code_id)，与 wallet 包模式一致。
package redemption

import (
	"context"
	"crypto/rand"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

// charset 去易混字符 0O1IL 后的 32 字符集。
const charset = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// NewCode 生成 SC-XXXX-XXXX-XXXX 格式兑换码（crypto/rand）。
func NewCode() (string, error) {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate code: %w", err)
	}
	chars := make([]byte, 12)
	for i, b := range buf {
		chars[i] = charset[int(b)%len(charset)]
	}
	return fmt.Sprintf("SC-%s-%s-%s", chars[0:4], chars[4:8], chars[8:12]), nil
}

// NewBatchID 生成短批次 id（uuid 前 8 位）。
func NewBatchID() string {
	return uuid.NewString()[:8]
}

// NormalizeCode 用户输入标准化：去空白 + 转大写。
func NormalizeCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

var (
	ErrInvalid  = apperr.E("code_invalid", "兑换码不存在", 404)
	ErrRedeemed = apperr.E("code_redeemed", "兑换码已被使用", 409)
	ErrExpired  = apperr.E("code_expired", "兑换码已过期", 410)
	ErrDisabled = apperr.E("code_disabled", "兑换码已被禁用", 410)
)

// Redeem 兑换：条件更新 + 同事务钱包入账（幂等键 ('grant','redeem_code',code_id)）。
// 失败返回上方业务错误之一，调用方据此计入防爆破失败次数。
func Redeem(ctx context.Context, st *store.Store, userID uuid.UUID, code string) (*store.RedemptionCode, *store.LedgerEntry, error) {
	var redeemed *store.RedemptionCode
	var entry *store.LedgerEntry
	run := func() error {
		return st.Tx(ctx, func(tx pgx.Tx) error {
			now := time.Now().UTC()
			r, err := store.RedeemCodeUpdate(ctx, tx, code, userID, now)
			if err != nil {
				return err
			}
			if r == nil {
				// 未抢到：读一次判定具体失败原因
				existing, gerr := store.GetRedemptionCodeByCode(ctx, tx, code)
				if gerr != nil {
					return gerr
				}
				switch {
				case existing == nil:
					return ErrInvalid
				case existing.Status == "redeemed":
					return ErrRedeemed
				case existing.Status == "disabled":
					return ErrDisabled
				case existing.ExpiresAt != nil && !existing.ExpiresAt.After(now):
					return ErrExpired
				default:
					return ErrInvalid
				}
			}
			reason := fmt.Sprintf("兑换码入账（%s）", r.Code)
			entry, err = wallet.Grant(ctx, tx, userID, r.GrantCents,
				"grant", "redeem_code", r.ID.String(), &reason)
			if err != nil {
				return err
			}
			redeemed = r
			return nil
		})
	}
	err := run()
	if err != nil && store.IsUniqueViolation(err, "uq_wallet_ledger_idem") {
		// 并发竞态：重试命中 Grant 前置幂等检查
		err = run()
	}
	if err != nil {
		return nil, nil, err
	}
	return redeemed, entry, nil
}
