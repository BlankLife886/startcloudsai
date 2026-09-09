package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/userupload"
)

type profilePatch struct {
	Username           Opt[string] `json:"username"`
	AvatarURL          Opt[string] `json:"avatarUrl"`
	StudioFigureURL    Opt[string] `json:"studioFigureUrl"`
	Bio                Opt[string] `json:"bio"`
	Location           Opt[string] `json:"location"`
	WebsiteURL         Opt[string] `json:"websiteUrl"`
	RequireCostConfirm Opt[bool]   `json:"requireCostConfirm"`
	Password           Opt[any]    `json:"password"`
}

type deleteAccountIn struct {
	Code         string `json:"code"`
	Confirmation string `json:"confirmation"`
}

func (s *Server) exportPersonalData(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	now := time.Now().UTC()
	raw, err := store.BuildPersonalDataExport(c.Request.Context(), s.St.Pool, user.ID, now)
	if err != nil {
		fail(c, err)
		return
	}
	var formatted bytes.Buffer
	if err := json.Indent(&formatted, raw, "", "  "); err != nil {
		fail(c, err)
		return
	}
	formatted.WriteByte('\n')
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Disposition", fmt.Sprintf(
		`attachment; filename="starclouds-data-%s.json"`,
		now.Format("20060102-150405"),
	))
	c.Data(http.StatusOK, "application/json; charset=utf-8", formatted.Bytes())
}

func (s *Server) cookieSession(c *gin.Context, userID uuid.UUID) (*store.Session, error) {
	token, err := c.Cookie(s.Cfg.SessionCookieName)
	if err != nil || token == "" {
		return nil, apperr.E("auth_required", "请使用登录设备管理会话", 401)
	}
	session, err := store.GetSessionByTokenHash(c.Request.Context(), s.St.Pool, auth.HashToken(token))
	if err != nil {
		return nil, err
	}
	if session == nil || session.UserID != userID || !session.ExpiresAt.After(time.Now().UTC()) {
		return nil, apperr.E("auth_required", "登录状态已失效", 401)
	}
	return session, nil
}

func userSessionDict(item *store.Session, currentID uuid.UUID) gin.H {
	return gin.H{
		"id":        item.ID.String(),
		"current":   item.ID == currentID,
		"ip":        optionalString(item.IP),
		"userAgent": optionalString(item.UserAgent),
		"createdAt": isoValue(item.CreatedAt),
		"expiresAt": isoValue(item.ExpiresAt),
	}
}

func (s *Server) userSessions(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	current, err := s.cookieSession(c, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	items, err := store.ListActiveUserSessions(c.Request.Context(), s.St.Pool, user.ID, time.Now().UTC())
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(items))
	for _, item := range items {
		out = append(out, userSessionDict(item, current.ID))
	}
	ok(c, gin.H{"items": out})
}

func (s *Server) deleteUserSession(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	current, err := s.cookieSession(c, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	sessionID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	deleted, err := store.DeleteUserSession(c.Request.Context(), s.St.Pool, user.ID, sessionID)
	if err != nil {
		fail(c, err)
		return
	}
	if !deleted {
		fail(c, apperr.E("not_found", "登录设备不存在或已退出", 404))
		return
	}
	if sessionID == current.ID {
		clearSessionCookie(s, c)
	}
	respondNoContent(c)
}

func (s *Server) deleteUserSessions(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	if strings.TrimSpace(c.Query("scope")) != "others" {
		fail(c, apperr.E("validation_error", "scope 仅支持 others", 422))
		return
	}
	current, err := s.cookieSession(c, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	revoked, err := store.DeleteOtherUserSessions(c.Request.Context(), s.St.Pool, user.ID, current.ID)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"revoked": revoked})
}

func clearSessionCookie(s *Server, c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(s.Cfg.SessionCookieName, "", -1, "/", "", s.Cfg.AppEnv == "production", true)
}

func (s *Server) deleteAccount(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body deleteAccountIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	code := strings.TrimSpace(body.Code)
	if len(code) != 6 || body.Confirmation != "DELETE" {
		fail(c, apperr.E("validation_error", "请完成邮箱验证并确认注销", 422))
		return
	}
	ctx := c.Request.Context()
	activeTasks, err := store.CountActiveTasks(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	activeRuns, err := store.ListActiveUserAssistantRuns(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	if activeTasks > 0 || len(activeRuns) > 0 {
		fail(c, apperr.E("account_has_active_tasks", "仍有创作或助手任务进行中，请先停止或等待完成", 409))
		return
	}
	passwordHash, err := auth.HashPassword(auth.NewSessionToken())
	if err != nil {
		fail(c, err)
		return
	}
	codeState := emailCodeValid
	deleted := false
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		var consumeErr error
		codeState, consumeErr = s.consumeEmailCodeTx(ctx, tx, user.Email, code)
		if consumeErr != nil || codeState != emailCodeValid {
			return consumeErr
		}
		deleted, consumeErr = store.AnonymizeUserAccount(ctx, tx, user.ID, passwordHash, time.Now().UTC())
		return consumeErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	if codeState == emailCodeLocked {
		fail(c, apperr.E("rate_limited", "验证码错误次数过多，请重新获取", 429))
		return
	}
	if codeState != emailCodeValid {
		fail(c, apperr.E("invalid_code", "验证码错误或已过期", 401))
		return
	}
	if !deleted {
		fail(c, apperr.E("account_not_deletable", "账号当前无法注销，请重新登录后再试", 409))
		return
	}
	clearSessionCookie(s, c)
	respondNoContent(c)
}

func (s *Server) ownedProfileImageURL(ctx context.Context, userID uuid.UUID, raw, field string) (string, string, error) {
	value := normalizeProfileFileURL(raw)
	if value == "" {
		return "", "", nil
	}
	if len(value) > 2048 || !strings.HasPrefix(value, "/api/v1/files/") {
		return "", "", apperr.E("validation_error", field+": 仅允许使用自己上传的站内图片", 422)
	}
	key := strings.TrimPrefix(value, "/api/v1/files/")
	if isOwnedUserUploadImageKey(userID, key) {
		if _, _, err := s.inspectOwnedUserUploadImage(ctx, userID, key, maxUserAssetImageBytes); err != nil {
			live, liveErr := store.HasLiveUserUploadObject(ctx, s.St.Pool, userID, key)
			if liveErr != nil || !live {
				return "", "", apperr.E("validation_error", field+": 文件不存在或不是有效图片", 422)
			}
		}
		if field == "studioFigureUrl" && !strings.Contains(key, "/original/") {
			figureURL, err := userupload.PersistStudioFigure(ctx, s.St, s.Storage, userID, key)
			if err != nil {
				log.Printf("persist studio figure from upload key %s: %v", key, err)
				return "/api/v1/files/" + key, key, nil
			}
			savedKey := strings.TrimPrefix(figureURL, "/api/v1/files/")
			return figureURL, savedKey, nil
		}
		return "/api/v1/files/" + key, key, nil
	}
	if field == "studioFigureUrl" && isOwnedTaskImageKey(userID, key) {
		figureURL, err := userupload.PersistStudioFigure(ctx, s.St, s.Storage, userID, key)
		if err != nil {
			log.Printf("persist studio figure from task key %s: %v", key, err)
			return "", "", apperr.E("validation_error", field+": 文件不存在或不是有效图片", 422)
		}
		savedKey := strings.TrimPrefix(figureURL, "/api/v1/files/")
		return figureURL, savedKey, nil
	}
	return "", "", apperr.E("validation_error", field+": 仅允许使用自己上传的站内图片", 422)
}

func normalizeProfileFileURL(raw string) string {
	value := strings.TrimSpace(raw)
	if i := strings.Index(value, "/api/v1/files/"); i >= 0 {
		value = value[i:]
	}
	if q := strings.IndexAny(value, "?#"); q >= 0 {
		value = value[:q]
	}
	return value
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
	previousStudioFigure := ""
	if user.StudioFigureURL != nil {
		previousStudioFigure = strings.TrimSpace(*user.StudioFigureURL)
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
	avatarUploadKey := ""
	if body.AvatarURL.Valid && body.AvatarURL.Value != "" {
		avatar, key, err := s.ownedProfileImageURL(c.Request.Context(), user.ID, body.AvatarURL.Value, "avatarUrl")
		if err != nil {
			fail(c, err)
			return
		}
		body.AvatarURL.Value = avatar
		avatarUploadKey = key
	}
	studioFigureUploadKey := ""
	if body.StudioFigureURL.Valid && body.StudioFigureURL.Value != "" {
		figure, key, err := s.ownedProfileImageURL(c.Request.Context(), user.ID, body.StudioFigureURL.Value, "studioFigureUrl")
		if err != nil {
			fail(c, err)
			return
		}
		body.StudioFigureURL.Value = figure
		studioFigureUploadKey = key
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
	var studioFigureURL **string
	if body.StudioFigureURL.Valid {
		var v *string
		if body.StudioFigureURL.Value != "" {
			figure := strings.TrimSpace(body.StudioFigureURL.Value)
			v = &figure
		}
		studioFigureURL = &v
		user.StudioFigureURL = v
	}
	ctx := c.Request.Context()
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.UpdateUserProfile(ctx, tx, user.ID, username, avatarURL, bio, location, website, requireCostConfirm, nil, studioFigureURL); err != nil {
			return err
		}
		if body.AvatarURL.Valid {
			if err := store.ReplaceUserUploadReferences(ctx, tx, user.ID, store.UploadReferenceUserAvatar, user.ID,
				[]string{avatarUploadKey}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(c, err)
		return
	}
	if body.StudioFigureURL.Valid {
		if refErr := store.ReplaceUserUploadReferences(ctx, s.St.Pool, user.ID, store.UploadReferenceUserStudioFigure, user.ID,
			[]string{studioFigureUploadKey}); refErr != nil {
			log.Printf("studio figure reference: %v", refErr)
		}
		previousKey := userupload.ObjectKeyFromFileURL(previousStudioFigure)
		if previousKey != "" && previousKey != studioFigureUploadKey {
			userupload.DeleteUnreferencedFigure(ctx, s.St, s.Storage, user.ID, previousKey)
		}
	}
	if stored, loadErr := store.GetUserByID(ctx, s.St.Pool, user.ID); loadErr == nil && stored != nil {
		user = stored
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
	recent, err := store.ListRecentTasks(ctx, s.St.Pool, user.ID, 24)
	if err != nil {
		fail(c, err)
		return
	}
	unreadPersonal, unreadBroadcast, err := store.CountUnreadNotificationBreakdown(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	assetCount, err := store.CountUserAssets(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	assetUngrouped, err := store.CountUserAssetsUngrouped(ctx, s.St.Pool, user.ID)
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
		"assetUngrouped":  assetUngrouped,
		"submissionStats": gin.H{
			"total":    submissionsByStatus["pending"] + submissionsByStatus["approved"] + submissionsByStatus["rejected"] + submissionsByStatus["removed"],
			"pending":  submissionsByStatus["pending"],
			"approved": submissionsByStatus["approved"],
			"rejected": submissionsByStatus["rejected"],
			"removed":  submissionsByStatus["removed"],
		},
		"unreadNotifications": unreadPersonal + unreadBroadcast,
		"unreadPersonal":      unreadPersonal,
		"unreadBroadcast":     unreadBroadcast,
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
	page, err := pageNumber(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	total, err := store.CountUserLedger(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	var rows []*store.LedgerEntry
	if page > 0 {
		offset := (page - 1) * limit
		rows, err = store.ListLedgerPage(ctx, s.St.Pool, user.ID, limit, offset)
	} else {
		rows, err = store.ListLedger(ctx, s.St.Pool, user.ID, limit, cursor)
	}
	if err != nil {
		fail(c, err)
		return
	}
	tasksByID, runsByID, err := loadLedgerRelated(ctx, s.St.Pool, rows)
	if err != nil {
		fail(c, err)
		return
	}
	serialize := func(entry *store.LedgerEntry) gin.H {
		return decorateLedgerEntry(entry, tasksByID, runsByID)
	}
	var payload gin.H
	if page > 0 {
		items := make([]gin.H, 0, len(rows))
		for _, entry := range rows {
			items = append(items, serialize(entry))
		}
		var next any
		if int64(page*limit) < total && len(rows) > 0 {
			t, id := rows[len(rows)-1].CursorKey()
			next = encodeCursor(t, id)
		}
		payload = gin.H{"items": items, "nextCursor": next, "page": page}
	} else {
		payload = buildPage(rows, limit, serialize)
		if cursor == nil {
			payload["page"] = 1
		}
	}
	payload["total"] = total
	payload["pageSize"] = limit
	ok(c, payload)
}

func loadLedgerRelated(ctx context.Context, q store.Q, rows []*store.LedgerEntry) (map[uuid.UUID]*store.Task, map[uuid.UUID]*store.AssistantRun, error) {
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
	tasksByID, err := store.GetTasksByIDs(ctx, q, taskIDs)
	if err != nil {
		return nil, nil, err
	}
	runsByID, err := store.GetAssistantRunsByIDs(ctx, q, runIDs)
	if err != nil {
		return nil, nil, err
	}
	return tasksByID, runsByID, nil
}

func decorateLedgerEntry(entry *store.LedgerEntry, tasksByID map[uuid.UUID]*store.Task, runsByID map[uuid.UUID]*store.AssistantRun) gin.H {
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

func (s *Server) dismissNotification(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	notificationID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, apperr.E("validation_error", "id: 无效的 UUID", 422))
		return
	}
	if err := store.DismissUserNotification(
		c.Request.Context(),
		s.St.Pool,
		user.ID,
		notificationID,
	); err != nil {
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
		attachTaskNotification(item, task)
	}
	return nil
}

func attachTaskNotification(notification *store.Notification, task *store.Task) {
	if notification == nil || task == nil {
		return
	}
	sourceType := "task"
	sourceID := task.ID
	notification.SourceType = &sourceType
	notification.SourceID = &sourceID
	taskflow.ApplyTaskNotificationDisplay(notification, task)
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
