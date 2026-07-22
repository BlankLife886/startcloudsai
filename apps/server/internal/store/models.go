package store

import (
	"time"

	"github.com/google/uuid"
)

var (
	TaskTypes          = []string{"t2i", "coloring", "ui_design", "model_sheet", "game_art", "puzzle"}
	TaskStatuses       = []string{"queued", "running", "succeeded", "failed", "canceled"}
	OrderStatuses      = []string{"pending", "paid", "completed", "failed", "expired"}
	SubmissionStatuses = []string{"pending", "approved", "rejected", "removed"}
	LedgerKinds        = []string{"grant", "spend", "freeze", "release", "refund", "admin_adjust"}
)

func Contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

type User struct {
	ID                    uuid.UUID
	Email                 string
	Username              string
	PasswordHash          string
	AvatarURL             *string
	Bio                   string
	Location              string
	WebsiteURL            string
	Role                  string
	Status                string
	LastLoginAt           *time.Time
	SubmissionBannedUntil *time.Time
	CreatedAt             time.Time
}

type UserAsset struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	Title        string
	FileKey      string
	ThumbnailKey string
	ContentType  string
	SizeBytes    int64
	CreatedAt    time.Time
}

func (a *UserAsset) CursorKey() (time.Time, uuid.UUID) { return a.CreatedAt, a.ID }

type Session struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	TokenHash string
	ExpiresAt time.Time
	IP        *string
	UserAgent *string
	CreatedAt time.Time
}

type UserSessionSummary struct {
	ActiveCount   int64
	LastIP        *string
	LastUserAgent *string
	LastCreatedAt *time.Time
	LastExpiresAt *time.Time
}

type AdminAccount struct {
	ID           uuid.UUID
	Email        string
	Username     string
	PasswordHash string
	Status       string
	LastLoginAt  *time.Time
	CreatedAt    time.Time
}

type AdminSession struct {
	ID        uuid.UUID
	AdminID   uuid.UUID
	TokenHash string
	ExpiresAt time.Time
	IP        *string
	UserAgent *string
	CreatedAt time.Time
}

type Wallet struct {
	UserID       uuid.UUID
	BalanceCents int64
	FrozenCents  int64
	UpdatedAt    *time.Time
}

type LedgerEntry struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	Kind              string
	DeltaCents        int64
	BalanceAfterCents int64
	SourceType        string
	SourceID          *string
	Reason            *string
	CreatedAt         time.Time
}

type Plan struct {
	ID              uuid.UUID
	Code            string
	Name            string
	Kind            string // topup 充值包 / subscription 订阅
	PriceCents      int64
	GrantCents      int64
	BonusCents      int64
	DurationDays    int   // subscription：订阅时长（天）
	DailyGrantCents int64 // subscription：每日发放额度
	Features        []string
	Active          bool
	Sort            int
	CreatedAt       time.Time
}

// Subscription 订阅期（续购同套餐 = ends_at 顺延）。
type Subscription struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	PlanID          uuid.UUID
	OrderID         *uuid.UUID
	StartsAt        time.Time
	EndsAt          time.Time
	DailyGrantCents int64
	LastGrantedDate *time.Time // date 列，仅日期部分（北京时间日界）
	Status          string     // active / expired
	CreatedAt       time.Time
}

// RedemptionCode 兑换码；RedeemedByEmail 仅后台列表 JOIN users 时填充。
type RedemptionCode struct {
	ID              uuid.UUID
	Code            string
	GrantCents      int64
	BatchID         string
	Note            *string
	Status          string // active / redeemed / disabled
	ExpiresAt       *time.Time
	RedeemedBy      *uuid.UUID
	RedeemedAt      *time.Time
	CreatedBy       *uuid.UUID
	CreatedAt       time.Time
	RedeemedByEmail *string
}

type Order struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	PlanID          uuid.UUID
	AmountCents     int64
	GrantCents      int64
	BonusCents      int64
	Status          string
	Provider        string
	ProviderOrderID *string
	PaidAt          *time.Time
	CompletedAt     *time.Time
	CreatedAt       time.Time
}

type Task struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	Type           string
	Model          string
	Status         string
	Prompt         string
	Params         map[string]any
	Count          int
	InputKeys      []string
	OutputKeys     []string
	ThumbnailKeys  []string
	CostCents      int64
	IdempotencyKey *string
	ErrorCode      *string
	ErrorMessage   *string
	Attempt        int
	StartedAt      *time.Time
	FinishedAt     *time.Time
	CreatedAt      time.Time
}

type GallerySubmission struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	TaskID       uuid.UUID
	Title        *string
	Status       string
	CoverKey     *string
	MediaKeys    []string
	RejectReason *string
	ReviewedBy   *uuid.UUID
	ReviewedAt   *time.Time
	Featured     bool
	CategoryID   *uuid.UUID
	Sort         int
	Tags         []string
	CreatedAt    time.Time
}

type GalleryCategory struct {
	ID        uuid.UUID
	Name      string
	Sort      int
	Active    bool
	CreatedAt time.Time
}

type PromptEntry struct {
	ID        uuid.UUID
	Title     string
	Prompt    string
	TaskType  string
	Category  *string
	Tags      []string
	CoverKey  *string
	Sort      int
	Active    bool
	CreatedAt time.Time
}

// GalleryAuthor 创作者聚合行（按用户分组统计投稿）。
type GalleryAuthor struct {
	UserID      uuid.UUID
	Email       string
	Username    string
	AvatarURL   *string
	Submissions int64
	Approved    int64
	Removed     int64
	BannedUntil *time.Time
	CreatedAt   time.Time // 用户创建时间，作分页游标
}

type Notification struct {
	ID        uuid.UUID
	UserID    *uuid.UUID
	Kind      string
	Title     string
	Body      *string
	ReadAt    *time.Time
	CreatedAt time.Time
}

type Announcement struct {
	ID        uuid.UUID
	Title     string
	Body      *string
	Active    bool
	StartsAt  *time.Time
	EndsAt    *time.Time
	CreatedAt time.Time
}

type ChangelogEntry struct {
	ID        uuid.UUID
	Version   string
	Date      time.Time // date 列，仅取日期部分
	Tag       string
	Title     string
	Summary   *string
	Items     []string
	Highlight bool
	Sort      int
	CreatedAt time.Time
}

type AdminAuditLog struct {
	ID         uuid.UUID
	AdminID    *uuid.UUID
	AdminEmail string
	Method     string
	Path       string
	Action     string
	TargetID   *string
	Status     int
	IP         *string
	Detail     []byte // jsonb 原文，可为 nil
	CreatedAt  time.Time
}

// CursorKey 实现 (created_at, id) 倒序分页游标。
func (u *User) CursorKey() (time.Time, uuid.UUID)              { return u.CreatedAt, u.ID }
func (e *LedgerEntry) CursorKey() (time.Time, uuid.UUID)       { return e.CreatedAt, e.ID }
func (t *Task) CursorKey() (time.Time, uuid.UUID)              { return t.CreatedAt, t.ID }
func (o *Order) CursorKey() (time.Time, uuid.UUID)             { return o.CreatedAt, o.ID }
func (s *GallerySubmission) CursorKey() (time.Time, uuid.UUID) { return s.CreatedAt, s.ID }
func (n *Notification) CursorKey() (time.Time, uuid.UUID)      { return n.CreatedAt, n.ID }
func (l *AdminAuditLog) CursorKey() (time.Time, uuid.UUID)     { return l.CreatedAt, l.ID }
func (p *PromptEntry) CursorKey() (time.Time, uuid.UUID)       { return p.CreatedAt, p.ID }
func (a *GalleryAuthor) CursorKey() (time.Time, uuid.UUID)     { return a.CreatedAt, a.UserID }
func (r *RedemptionCode) CursorKey() (time.Time, uuid.UUID)    { return r.CreatedAt, r.ID }
