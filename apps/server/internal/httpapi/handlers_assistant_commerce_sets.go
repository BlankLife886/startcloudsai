package httpapi

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantmodel"
	"github.com/BlankLife886/startcloudsai/server/internal/commerceset"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// Commerce sets are planned by the assistant (worker); these endpoints let
// the card show progress, take the user's confirmation, redo shots, run the
// quality check and download the finished set.

const (
	commerceReviewTimeout   = 4 * time.Minute
	commerceReviewImageSize = 16 << 20
)

func (s *Server) commerceSets() commerceset.Service {
	service := commerceset.Service{St: s.St}
	if s.Queue != nil {
		service.Enqueue = s.Queue.EnqueueRunTask
	}
	return service
}

func commerceSetError(err error) error {
	switch {
	case errors.Is(err, commerceset.ErrNeedsConfirmation):
		return apperr.E("commerce_set_needs_confirmation", strings.TrimPrefix(err.Error(), commerceset.ErrNeedsConfirmation.Error()+": "), 422)
	case errors.Is(err, commerceset.ErrPriceChanged):
		return apperr.E("commerce_set_price_changed", strings.TrimPrefix(err.Error(), commerceset.ErrPriceChanged.Error()+": "), 409)
	case errors.Is(err, commerceset.ErrInvalid):
		return apperr.E("validation_error", strings.TrimPrefix(err.Error(), commerceset.ErrInvalid.Error()+": "), 422)
	}
	return err
}

func (s *Server) commerceSetRequest(c *gin.Context) (*store.User, uuid.UUID, bool) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return nil, uuid.Nil, false
	}
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return nil, uuid.Nil, false
	}
	return user, id, true
}

func (s *Server) respondCommerceSet(c *gin.Context, userID, setID uuid.UUID) {
	view, err := s.commerceSets().ViewByID(c.Request.Context(), userID, setID)
	if err != nil {
		fail(c, err)
		return
	}
	if view == nil {
		fail(c, apperr.E("not_found", "套图不存在", 404))
		return
	}
	c.Header("Cache-Control", "no-store")
	ok(c, view)
}

func (s *Server) getAssistantCommerceSet(c *gin.Context) {
	user, id, valid := s.commerceSetRequest(c)
	if !valid {
		return
	}
	s.respondCommerceSet(c, user.ID, id)
}

// generateAssistantCommerceSet is the user's confirmation on the plan card.
// expectedTotalCents is the price the card showed; a different current
// price is refused so the user never pays an amount they did not see.
func (s *Server) generateAssistantCommerceSet(c *gin.Context) {
	user, id, valid := s.commerceSetRequest(c)
	if !valid {
		return
	}
	if !s.enforceUsageLimit(c, "task-create-minute", user.ID.String(), highCostRequestsPerMinute, 1, time.Minute) {
		return
	}
	var body struct {
		ExpectedTotalCents *int64 `json:"expectedTotalCents"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.ExpectedTotalCents == nil {
		fail(c, apperr.E("validation_error", "缺少确认的价格", 422))
		return
	}
	if _, err := s.commerceSets().Generate(c.Request.Context(), user.ID, id, commerceset.GenerateInput{
		Via: store.CommerceApprovedByUser, ExpectedTotalCents: body.ExpectedTotalCents,
	}); err != nil {
		fail(c, commerceSetError(err))
		return
	}
	s.respondCommerceSet(c, user.ID, id)
}

func (s *Server) redoAssistantCommerceSet(c *gin.Context) {
	user, id, valid := s.commerceSetRequest(c)
	if !valid {
		return
	}
	if !s.enforceUsageLimit(c, "task-create-minute", user.ID.String(), highCostRequestsPerMinute, 1, time.Minute) {
		return
	}
	var body struct {
		ShotIDs            []string `json:"shotIds"`
		Note               string   `json:"note"`
		ExpectedTotalCents *int64   `json:"expectedTotalCents"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if len(body.ShotIDs) == 0 || len(body.ShotIDs) > 18 || body.ExpectedTotalCents == nil {
		fail(c, apperr.E("validation_error", "请选择要重做的图片并确认价格", 422))
		return
	}
	if _, err := s.commerceSets().Redo(c.Request.Context(), user.ID, id, body.ShotIDs, body.Note, body.ExpectedTotalCents); err != nil {
		fail(c, commerceSetError(err))
		return
	}
	s.respondCommerceSet(c, user.ID, id)
}

// adoptAssistantCommerceShot puts an image the user edited in the
// assistant's image viewer in place of one shot of the set.
func (s *Server) adoptAssistantCommerceShot(c *gin.Context) {
	user, id, valid := s.commerceSetRequest(c)
	if !valid {
		return
	}
	var body struct {
		ShotID  string `json:"shotId"`
		FileKey string `json:"fileKey"`
		Note    string `json:"note"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	key := strings.TrimSpace(body.FileKey)
	if !isOwnedAssistantOutputImageKey(user.ID, key) {
		fail(c, apperr.E("validation_error", "只能用你在助手里生成的图片替换", 422))
		return
	}
	thumb := strings.TrimSuffix(key, path.Ext(key)) + "-thumb"
	if err := s.commerceSets().Adopt(c.Request.Context(), user.ID, id, commerceset.AdoptInput{
		ShotID: body.ShotID, FileKey: key, ThumbKey: thumb, Note: body.Note,
	}); err != nil {
		fail(c, commerceSetError(err))
		return
	}
	s.respondCommerceSet(c, user.ID, id)
}

// commerceChecker builds the quality check: the assistant page's default
// chat model looks at the finished image next to the product photos.
func (s *Server) commerceChecker(ctx context.Context) (commerceset.Checker, error) {
	selection, err := assistantmodel.Resolve(ctx, s.St.Pool, s.Cfg.AppSecret, "")
	if err != nil {
		return nil, err
	}
	client, err := assistantmodel.NewChatClient(selection)
	if err != nil {
		return nil, err
	}
	client = client.WithoutReasoning().WithMaxOutputTokens(400)
	return func(ctx context.Context, prompt, outputKey string, referenceKeys []string) (string, error) {
		images := []string{}
		for _, key := range append([]string{outputKey}, referenceKeys...) {
			data, err := s.Storage.GetBytesLimit(ctx, key, commerceReviewImageSize)
			if err != nil {
				return "", err
			}
			contentType := http.DetectContentType(data)
			if _, _, err := media.Dimensions(data); err != nil || !strings.HasPrefix(contentType, "image/") {
				return "", fmt.Errorf("image %s is not readable", key)
			}
			images = append(images, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(data))
		}
		return client.ChatTextWithImages(ctx, []sub2api.Message{{Role: "user", Content: prompt}}, images, nil)
	}, nil
}

// reviewAssistantCommerceSet checks finished images. The card calls it once
// every image of a round has finished; it is idempotent.
func (s *Server) reviewAssistantCommerceSet(c *gin.Context) {
	user, id, valid := s.commerceSetRequest(c)
	if !valid {
		return
	}
	if s.Storage == nil {
		fail(c, apperr.E("storage_unavailable", "图片存储服务暂不可用", http.StatusServiceUnavailable))
		return
	}
	if !s.enforceUsageLimit(c, "commerce-review-minute", user.ID.String(), highCostRequestsPerMinute, 1, time.Minute) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), commerceReviewTimeout)
	defer cancel()
	checker, err := s.commerceChecker(ctx)
	if err != nil {
		// Without a checker every finished image is marked unchecked rather
		// than blocking delivery.
		checker = nil
	}
	result, err := s.commerceSets().Review(ctx, user.ID, id, checker)
	if err != nil {
		fail(c, commerceSetError(err))
		return
	}
	view, err := s.commerceSets().BuildView(c.Request.Context(), result.Set)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"set": view, "reviewed": result.Reviewed, "failed": result.Failed, "autoRedo": result.AutoRedo, "redoBlocked": result.RedoError})
}

// archiveAssistantCommerceSet streams the latest successful image of every
// shot as a zip named after the set.
func (s *Server) archiveAssistantCommerceSet(c *gin.Context) {
	user, id, valid := s.commerceSetRequest(c)
	if !valid {
		return
	}
	if s.Storage == nil {
		fail(c, apperr.E("storage_unavailable", "图片存储服务暂不可用", http.StatusServiceUnavailable))
		return
	}
	ctx := c.Request.Context()
	set, err := store.GetUserCommerceSet(ctx, s.St.Pool, user.ID, id)
	if err != nil || set == nil {
		if err == nil {
			err = apperr.E("not_found", "套图不存在", 404)
		}
		fail(c, err)
		return
	}
	ids := []uuid.UUID{}
	for _, shot := range set.Shots {
		if len(shot.Attempts) > 0 {
			ids = append(ids, shot.Attempts[len(shot.Attempts)-1].TaskID)
		}
	}
	tasks, err := store.GetTasksByIDs(ctx, s.St.Pool, ids)
	if err != nil {
		fail(c, err)
		return
	}
	type entry struct{ name, key string }
	entries := []entry{}
	for index, shot := range set.Shots {
		if len(shot.Attempts) == 0 {
			continue
		}
		key, _ := commerceset.AttemptOutput(&shot.Attempts[len(shot.Attempts)-1], tasks)
		if key == "" {
			continue
		}
		ext := path.Ext(key)
		if ext == "" {
			ext = ".png"
		}
		entries = append(entries, entry{name: fmt.Sprintf("%02d-%s%s", index+1, strings.ReplaceAll(shot.Label, "/", "-"), ext), key: key})
	}
	if len(entries) == 0 {
		fail(c, apperr.E("validation_error", "这套图还没有出完的图片", 422))
		return
	}
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="commerce-set-%s.zip"`, set.ID.String()[:8]))
	c.Status(http.StatusOK)
	archive := zip.NewWriter(c.Writer)
	for _, item := range entries {
		data, err := s.Storage.GetBytesLimit(ctx, item.key, 64<<20)
		if err != nil {
			// Headers are sent; end the archive so the user still gets the
			// images that were readable.
			break
		}
		writer, err := archive.CreateHeader(&zip.FileHeader{Name: item.name, Method: zip.Store, Modified: time.Now()})
		if err != nil {
			break
		}
		if _, err := writer.Write(data); err != nil {
			break
		}
	}
	_ = archive.Close()
}
