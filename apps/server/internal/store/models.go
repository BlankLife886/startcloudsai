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
	Role                  string
	Status                string
	LastLoginAt           *time.Time
	SubmissionBannedUntil *time.Time
	CreatedAt             time.Time
}

type Session struct {
	ID        uuid.UUID
	UserID    uuid.UUID
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
	ID         uuid.UUID
	Code       string
	Name       string
	PriceCents int64
	GrantCents int64
	BonusCents int64
	Features   []string
	Active     bool
	Sort       int
	CreatedAt  time.Time
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
	Status         string
	Prompt         string
	Params         map[string]any
	Count          int
	InputKeys      []string
	OutputKeys     []string
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
