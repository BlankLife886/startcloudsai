package httpapi

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// presignSafe presign 失败时返回 nil（对应 Python 的 _presign_safe）。
func (s *Server) presignSafe(c *gin.Context, key *string) *string {
	if key == nil || *key == "" {
		return nil
	}
	u, err := s.Storage.PresignGet(c.Request.Context(), *key)
	if err != nil {
		log.Printf("presign failed for key %s: %v", *key, err)
		return nil
	}
	return &u
}

func (s *Server) mediaURLsFor(c *gin.Context, keys []string) []string {
	urls := make([]string, 0, len(keys))
	for _, k := range keys {
		key := k
		if u := s.presignSafe(c, &key); u != nil {
			urls = append(urls, *u)
		}
	}
	return urls
}

func (s *Server) publicGallery(c *gin.Context) {
	limit, cursor, err := pageParams(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	rows, err := store.ListSubmissions(ctx, s.St.Pool, nil, "approved", limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	userIDs := make([]uuid.UUID, 0, len(rows))
	for _, sub := range rows {
		userIDs = append(userIDs, sub.UserID)
	}
	users, err := store.GetUsersByIDs(ctx, s.St.Pool, userIDs)
	if err != nil {
		fail(c, err)
		return
	}

	ok(c, buildPage(rows, limit, func(sub *store.GallerySubmission) gin.H {
		author := users[sub.UserID]
		authorDict := gin.H{"id": nil, "username": nil, "avatarUrl": nil}
		if author != nil {
			authorDict = gin.H{"id": author.ID.String(), "username": author.Username, "avatarUrl": author.AvatarURL}
		}
		return gin.H{
			"id":        sub.ID.String(),
			"title":     sub.Title,
			"coverUrl":  s.presignSafe(c, sub.CoverKey),
			"mediaUrls": s.mediaURLsFor(c, sub.MediaKeys),
			"author":    authorDict,
			"createdAt": isoValue(sub.CreatedAt),
		}
	}))
}

type gallerySubmitIn struct {
	TaskID string  `json:"taskId"`
	Title  *string `json:"title"`
}

func (s *Server) submitGallery(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body gallerySubmitIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	taskID, err := uuid.Parse(body.TaskID)
	if err != nil {
		fail(c, apperr.E("validation_error", "taskId: 无效的 UUID", 422))
		return
	}
	if body.Title != nil && len([]rune(*body.Title)) > 200 {
		fail(c, apperr.E("validation_error", "title: 长度不能超过 200", 422))
		return
	}
	ctx := c.Request.Context()
	task, err := store.GetUserTask(ctx, s.St.Pool, user.ID, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	if task == nil {
		fail(c, apperr.E("task_not_found", "任务不存在", 404))
		return
	}
	if task.Status != "succeeded" || len(task.OutputKeys) == 0 {
		fail(c, apperr.E("submission_not_allowed", "仅有产物的成功任务可以投稿", 400))
		return
	}
	existing, err := store.GetSubmissionByTaskID(ctx, s.St.Pool, taskID)
	if err != nil {
		fail(c, err)
		return
	}
	if existing != nil {
		fail(c, apperr.E("submission_not_allowed", "该任务已投稿过", 409))
		return
	}
	coverKey := task.OutputKeys[0]
	submission, err := store.InsertSubmission(ctx, s.St.Pool, user.ID, taskID, body.Title, &coverKey, task.OutputKeys)
	if err != nil {
		if store.IsUniqueViolation(err, "") {
			fail(c, apperr.E("submission_not_allowed", "该任务已投稿过", 409))
			return
		}
		fail(c, err)
		return
	}
	ok(c, submissionDict(submission, nil))
}

func (s *Server) mySubmissions(c *gin.Context) {
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
	rows, err := store.ListSubmissions(c.Request.Context(), s.St.Pool, &user.ID, "", limit, cursor)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, buildPage(rows, limit, func(sub *store.GallerySubmission) gin.H {
		return submissionDict(sub, s.mediaURLsFor(c, sub.MediaKeys))
	}))
}

func (s *Server) deleteSubmission(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	submissionID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	submission, err := store.GetUserSubmission(ctx, s.St.Pool, user.ID, submissionID)
	if err != nil {
		fail(c, err)
		return
	}
	if submission == nil {
		fail(c, apperr.E("not_found", "投稿不存在", 404))
		return
	}
	if err := store.DeleteSubmission(ctx, s.St.Pool, submission.ID); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{})
}
