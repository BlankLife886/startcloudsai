package httpapi

import (
	"context"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

type profilePatch struct {
	Username           Opt[string] `json:"username"`
	AvatarURL          Opt[string] `json:"avatarUrl"`
	Bio                Opt[string] `json:"bio"`
	Location           Opt[string] `json:"location"`
	WebsiteURL         Opt[string] `json:"websiteUrl"`
	RequireCostConfirm Opt[bool]   `json:"requireCostConfirm"`
	Password           Opt[any]    `json:"password"`
}

func normalizeProfileWebsite(raw string) (string, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", true
	}
	if len([]rune(value)) > 300 {
		return "", false
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return "", false
	}
	return value, true
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
	if body.Password.Valid {
		fail(c, apperr.E("validation_error", "用户账号仅支持邮箱验证码登录，不能设置密码", 422))
		return
	}
	if body.Username.Valid && (strings.TrimSpace(body.Username.Value) == "" || len([]rune(body.Username.Value)) > 64) {
		fail(c, apperr.E("validation_error", "username: 长度须在 1-64 之间", 422))
		return
	}
	if body.Bio.Valid && len([]rune(strings.TrimSpace(body.Bio.Value))) > 280 {
		fail(c, apperr.E("validation_error", "bio: 长度不能超过 280 个字符", 422))
		return
	}
	if body.Location.Valid && len([]rune(strings.TrimSpace(body.Location.Value))) > 80 {
		fail(c, apperr.E("validation_error", "location: 长度不能超过 80 个字符", 422))
		return
	}
	websiteURL := ""
	if body.WebsiteURL.Valid {
		var valid bool
		websiteURL, valid = normalizeProfileWebsite(body.WebsiteURL.Value)
		if !valid {
			fail(c, apperr.E("validation_error", "websiteUrl: 请输入完整的 http/https 地址", 422))
			return
		}
	}
	if body.AvatarURL.Valid && body.AvatarURL.Value != "" {
		avatar := strings.TrimSpace(body.AvatarURL.Value)
		allowedPrefix := "/api/v1/files/uploads/" + user.ID.String() + "/"
		if len(avatar) > 2048 || !strings.HasPrefix(avatar, allowedPrefix) {
			fail(c, apperr.E("validation_error", "avatarUrl: 仅允许使用自己上传的站内图片", 422))
			return
		}
		key := strings.TrimPrefix(avatar, "/api/v1/files/")
		if _, _, err := s.inspectOwnedUserUploadImage(c.Request.Context(), user.ID, key, maxUserAssetImageBytes); err != nil {
			fail(c, apperr.E("validation_error", "avatarUrl: 文件不存在或不是有效图片", 422))
			return
		}
	}
	avatarUploadKey := ""
	if body.AvatarURL.Valid && body.AvatarURL.Value != "" {
		avatarUploadKey = strings.TrimPrefix(strings.TrimSpace(body.AvatarURL.Value), "/api/v1/files/")
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
			av := strings.TrimSpace(body.AvatarURL.Value)
			v = &av
		}
		avatarURL = &v
		user.AvatarURL = v
	}
	var bio *string
	if body.Bio.Valid {
		v := strings.TrimSpace(body.Bio.Value)
		bio = &v
		user.Bio = v
	}
	var location *string
	if body.Location.Valid {
		v := strings.TrimSpace(body.Location.Value)
		location = &v
		user.Location = v
	}
	var website *string
	if body.WebsiteURL.Valid {
		website = &websiteURL
		user.WebsiteURL = websiteURL
	}
	var requireCostConfirm *bool
	if body.RequireCostConfirm.Valid {
		requireCostConfirm = &body.RequireCostConfirm.Value
		user.RequireCostConfirm = body.RequireCostConfirm.Value
	}
	ctx := c.Request.Context()
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.UpdateUserProfile(ctx, tx, user.ID, username, avatarURL, bio, location, website, requireCostConfirm, nil); err != nil {
			return err
		}
		if !body.AvatarURL.Valid {
			return nil
		}
		return store.ReplaceUserUploadReferences(ctx, tx, user.ID, store.UploadReferenceUserAvatar, user.ID,
			[]string{avatarUploadKey})
	})
	if err != nil {
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
	assetCount, err := store.CountUserAssets(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	submissionsByStatus, err := store.SubmissionCountsByStatus(ctx, s.St.Pool, user.ID)
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
		recentTasks = append(recentTasks, taskDict(t, nil, nil))
	}
	ok(c, gin.H{
		"wallet": walletDict(wallet),
		"taskStats": gin.H{
			"total":     total,
			"succeeded": byStatus["succeeded"],
			"failed":    byStatus["failed"],
			"running":   byStatus["running"] + byStatus["queued"],
		},
		"taskStatsByType": byType,
		"assetCount":      assetCount,
		"submissionStats": gin.H{
			"total":    submissionsByStatus["pending"] + submissionsByStatus["approved"] + submissionsByStatus["rejected"] + submissionsByStatus["removed"],
			"pending":  submissionsByStatus["pending"],
			"approved": submissionsByStatus["approved"],
			"rejected": submissionsByStatus["rejected"],
			"removed":  submissionsByStatus["removed"],
		},
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
	ok(c, walletDict(wallet))
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
	taskIDs := make([]uuid.UUID, 0, len(rows))
	runIDs := make([]uuid.UUID, 0, len(rows))
	seenTaskIDs := make(map[uuid.UUID]struct{}, len(rows))
	seenRunIDs := make(map[uuid.UUID]struct{}, len(rows))
	for _, entry := range rows {
		sourceID, ok := ledgerSourceUUID(entry)
		if !ok {
			continue
		}
		switch entry.SourceType {
		case "task":
			if _, exists := seenTaskIDs[sourceID]; exists {
				continue
			}
			seenTaskIDs[sourceID] = struct{}{}
			taskIDs = append(taskIDs, sourceID)
		case "assistant_run":
			if _, exists := seenRunIDs[sourceID]; exists {
				continue
			}
			seenRunIDs[sourceID] = struct{}{}
			runIDs = append(runIDs, sourceID)
		}
	}
	ctx := c.Request.Context()
	tasksByID, err := store.GetTasksByIDs(ctx, s.St.Pool, taskIDs)
	if err != nil {
		fail(c, err)
		return
	}
	runsByID, err := store.GetAssistantRunsByIDs(ctx, s.St.Pool, runIDs)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(entry *store.LedgerEntry) gin.H {
		sourceID, ok := ledgerSourceUUID(entry)
		if !ok {
			return ledgerDict(entry)
		}
		if entry.SourceType == "assistant_run" {
			return ledgerDictWithAssistantRun(entry, runsByID[sourceID])
		}
		if entry.SourceType != "task" {
			return ledgerDict(entry)
		}
		return ledgerDictWithTask(entry, tasksByID[sourceID])
	}))
}

func ledgerSourceUUID(entry *store.LedgerEntry) (uuid.UUID, bool) {
	if entry == nil || entry.SourceID == nil {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(strings.SplitN(*entry.SourceID, "/", 2)[0])
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
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
	if err := decorateTaskNotifications(ctx, s.St.Pool, user.ID, rows); err != nil {
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
	respondNoContent(c)
}

func (s *Server) clearNotifications(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	if err := store.ClearUserNotifications(c.Request.Context(), s.St.Pool, user.ID); err != nil {
		fail(c, err)
		return
	}
	respondNoContent(c)
}

const notifyTaskMatchWindow = 2 * time.Minute

func decorateTaskNotifications(ctx context.Context, q store.Q, userID uuid.UUID, rows []*store.Notification) error {
	var from, to time.Time
	hasTask := false
	for _, item := range rows {
		if item == nil || item.Kind != "task" {
			continue
		}
		hasTask = true
		if from.IsZero() || item.CreatedAt.Before(from) {
			from = item.CreatedAt
		}
		if to.IsZero() || item.CreatedAt.After(to) {
			to = item.CreatedAt
		}
	}
	if !hasTask {
		return nil
	}
	tasks, err := store.ListUserTasksFinishedBetween(ctx, q, userID, from.Add(-notifyTaskMatchWindow), to.Add(notifyTaskMatchWindow))
	if err != nil {
		return err
	}
	used := make(map[uuid.UUID]bool, len(tasks))
	for _, item := range rows {
		if item == nil || item.Kind != "task" {
			continue
		}
		task := closestUnusedTask(item.CreatedAt, tasks, used)
		if task == nil {
			continue
		}
		used[task.ID] = true
		taskflow.ApplyTaskNotificationDisplay(item, task)
	}
	return nil
}

func closestUnusedTask(at time.Time, tasks []*store.Task, used map[uuid.UUID]bool) *store.Task {
	var best *store.Task
	var bestDist time.Duration
	for _, task := range tasks {
		if task == nil || task.FinishedAt == nil || used[task.ID] {
			continue
		}
		dist := task.FinishedAt.Sub(at)
		if dist < 0 {
			dist = -dist
		}
		if dist > notifyTaskMatchWindow {
			continue
		}
		if best == nil || dist < bestDist {
			best = task
			bestDist = dist
		}
	}
	return best
}
