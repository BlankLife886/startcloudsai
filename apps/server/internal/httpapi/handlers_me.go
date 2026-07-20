package httpapi

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

type passwordChange struct {
	Old string `json:"old"`
	New string `json:"new"`
}

type profilePatch struct {
	Username  Opt[string]         `json:"username"`
	AvatarURL Opt[string]         `json:"avatarUrl"`
	Password  Opt[passwordChange] `json:"password"`
}

func (s *Server) patchProfile(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body profilePatch
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Username.Valid && (strings.TrimSpace(body.Username.Value) == "" || len([]rune(body.Username.Value)) > 64) {
		fail(c, apperr.E("validation_error", "username: 长度须在 1-64 之间", 422))
		return
	}
	if body.Password.Valid && (len(body.Password.Value.New) < 6 || len(body.Password.Value.New) > 128) {
		fail(c, apperr.E("validation_error", "password.new: 长度须在 6-128 之间", 422))
		return
	}

	var username *string
	if body.Username.Valid {
		v := strings.TrimSpace(body.Username.Value)
		username = &v
		user.Username = v
	}
	var avatarURL **string
	if body.AvatarURL.Valid {
		var v *string
		if body.AvatarURL.Value != "" {
			av := body.AvatarURL.Value
			v = &av
		}
		avatarURL = &v
		user.AvatarURL = v
	}
	var passwordHash *string
	if body.Password.Valid {
		if !auth.VerifyPassword(body.Password.Value.Old, user.PasswordHash) {
			fail(c, apperr.E("invalid_credentials", "原密码错误", 400))
			return
		}
		h, herr := auth.HashPassword(body.Password.Value.New)
		if herr != nil {
			fail(c, herr)
			return
		}
		passwordHash = &h
	}
	if err := store.UpdateUserProfile(c.Request.Context(), s.St.Pool, user.ID, username, avatarURL, passwordHash); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"user": userDict(user)})
}

func (s *Server) overview(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()

	wallet, err := store.GetWallet(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if wallet == nil {
		fail(c, apperr.E("not_found", "钱包不存在", 404))
		return
	}
	byStatus, err := store.TaskCountsBy(ctx, s.St.Pool, user.ID, "status")
	if err != nil {
		fail(c, err)
		return
	}
	byType, err := store.TaskCountsBy(ctx, s.St.Pool, user.ID, "type")
	if err != nil {
		fail(c, err)
		return
	}
	recent, err := store.ListRecentTasks(ctx, s.St.Pool, user.ID, 5)
	if err != nil {
		fail(c, err)
		return
	}
	unread, err := store.CountUnreadNotifications(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}

	var total int64
	for _, n := range byStatus {
		total += n
	}
	recentTasks := make([]gin.H, 0, len(recent))
	for _, t := range recent {
		recentTasks = append(recentTasks, taskDict(t, nil))
	}
	ok(c, gin.H{
		"wallet": gin.H{"balanceCents": wallet.BalanceCents, "frozenCents": wallet.FrozenCents},
		"taskStats": gin.H{
			"total":     total,
			"succeeded": byStatus["succeeded"],
			"failed":    byStatus["failed"],
			"running":   byStatus["running"] + byStatus["queued"],
		},
		"taskStatsByType":     byType,
		"unreadNotifications": unread,
		"recentTasks":         recentTasks,
	})
}

func (s *Server) myWallet(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	wallet, err := store.GetWallet(c.Request.Context(), s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if wallet == nil {
		fail(c, apperr.E("not_found", "钱包不存在", 404))
		return
	}
	ok(c, gin.H{"balanceCents": wallet.BalanceCents, "frozenCents": wallet.FrozenCents})
}

func (s *Server) myLedger(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	rows, err := store.ListLedger(c.Request.Context(), s.St.Pool, user.ID, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, ledgerDict))
}

func (s *Server) myNotifications(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	rows, err := store.ListVisibleNotifications(ctx, s.St.Pool, user.ID, limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}

	var globalIDs []uuid.UUID
	for _, n := range rows {
		if n.UserID == nil {
			globalIDs = append(globalIDs, n.ID)
		}
	}
	reads, err := store.GetNotificationReadTimes(ctx, s.St.Pool, user.ID, globalIDs)
	if err != nil {
		fail(c, err)
		return
	}

	page := buildPage(rows, limit, func(n *store.Notification) gin.H {
		var globalReadAt *string
		if at, found := reads[n.ID]; found {
			globalReadAt = iso(&at)
		}
		return notificationDict(n, globalReadAt)
	})
	unread, err := store.CountUnreadNotifications(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	page["unread"] = unread
	ok(c, page)
}

type notificationsReadIn struct {
	IDs []string `json:"ids"`
}

func (s *Server) markNotificationsRead(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body notificationsReadIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	var ids []uuid.UUID
	for _, raw := range body.IDs {
		id, perr := uuid.Parse(raw)
		if perr != nil {
			fail(c, apperr.E("validation_error", "ids: 无效的 UUID", 422))
			return
		}
		ids = append(ids, id)
	}
	ctx := c.Request.Context()

	var targets []*store.Notification
	if len(ids) > 0 {
		targets, err = store.ListVisibleNotificationsByIDs(ctx, s.St.Pool, user.ID, ids)
	} else {
		targets, err = store.ListAllVisibleNotifications(ctx, s.St.Pool, user.ID)
	}
	if err != nil {
		fail(c, err)
		return
	}

	var personalIDs, globalIDs []uuid.UUID
	for _, n := range targets {
		if n.UserID == nil {
			globalIDs = append(globalIDs, n.ID)
		} else if *n.UserID == user.ID {
			personalIDs = append(personalIDs, n.ID)
		}
	}
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if terr := store.MarkPersonalNotificationsRead(ctx, tx, personalIDs, time.Now().UTC()); terr != nil {
			return terr
		}
		for _, nid := range globalIDs {
			if terr := store.InsertNotificationRead(ctx, tx, user.ID, nid); terr != nil {
				return terr
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{})
}
