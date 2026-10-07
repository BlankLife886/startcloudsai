package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// skillImagePrefix 存放官方技能的封面与效果示例图，对用户端公开可读。
const skillImagePrefix = "skill-images/"

func skillSampleImageDicts(samples []store.SkillSampleImage) []gin.H {
	out := make([]gin.H, 0, len(samples))
	for _, sample := range samples {
		key := sample.Key
		out = append(out, gin.H{"key": key, "url": promptCoverURL(&key), "caption": sample.Caption})
	}
	return out
}

// deleteSkillImages 只清理本模块写入的 key，避免误删其它前缀下的对象。
func (s *Server) deleteSkillImages(ctx context.Context, keys []string) {
	owned := make([]string, 0, len(keys))
	for _, key := range keys {
		if strings.HasPrefix(key, skillImagePrefix) {
			owned = append(owned, key)
		}
	}
	if len(owned) == 0 || s.Storage == nil {
		return
	}
	if err := s.Storage.DeleteKeys(ctx, owned); err != nil {
		log.Printf("delete skill images %v: %v", owned, err)
	}
}

// officialSkillForImages 读取要配图的技能；只有官方技能可以配图。
func (s *Server) officialSkillForImages(c *gin.Context) (*store.ImageSkill, bool) {
	skillID, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return nil, false
	}
	skill, err := store.GetSkill(c.Request.Context(), s.St.Pool, skillID)
	if err != nil {
		fail(c, err)
		return nil, false
	}
	if skill == nil || !skill.Official() {
		fail(c, apperr.E("not_found", "Skill 不存在", http.StatusNotFound))
		return nil, false
	}
	return skill, true
}

// uploadSkillImage 读取 multipart 的 file 字段，校验并压缩后写入对象存储，返回 key。
func (s *Server) uploadSkillImage(c *gin.Context, skillID uuid.UUID, kind string) (string, bool) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) || errors.Is(err, multipart.ErrMessageTooLarge) {
			fail(c, apperr.E("upload_too_large", "图片不能超过 8MB", http.StatusRequestEntityTooLarge))
			return "", false
		}
		if errors.Is(err, io.ErrUnexpectedEOF) {
			fail(c, apperr.E("invalid_upload", "图片上传数据不完整，请重新选择后重试", http.StatusBadRequest))
			return "", false
		}
		fail(c, apperr.E("validation_error", "file: 缺少上传文件", http.StatusUnprocessableEntity))
		return "", false
	}
	if fileHeader.Size > promptCoverMaxBytes {
		fail(c, apperr.E("upload_too_large", "图片不能超过 8MB", http.StatusRequestEntityTooLarge))
		return "", false
	}
	file, err := fileHeader.Open()
	if err != nil {
		fail(c, err)
		return "", false
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, promptCoverMaxBytes+1))
	if err != nil {
		fail(c, err)
		return "", false
	}
	if int64(len(data)) > promptCoverMaxBytes {
		fail(c, apperr.E("upload_too_large", "图片不能超过 8MB", http.StatusRequestEntityTooLarge))
		return "", false
	}
	if len(data) == 0 {
		fail(c, apperr.E("unsupported_file", "文件为空", http.StatusBadRequest))
		return "", false
	}
	ext, contentType := sniffImage(data)
	if ext == "" {
		fail(c, apperr.E("unsupported_file", "仅支持 png / jpg / webp 图片", http.StatusBadRequest))
		return "", false
	}
	ctx := c.Request.Context()
	data, ext, contentType = s.compressCoverImage(ctx, data, ext, contentType)
	if _, _, err := media.Dimensions(data); err != nil {
		fail(c, apperr.E("unsupported_file", "图片尺寸过大或内容无法读取", http.StatusBadRequest))
		return "", false
	}
	key := fmt.Sprintf("%s%s/%s-%s.%s", skillImagePrefix, skillID, kind, uuid.NewString(), ext)
	if err := s.Storage.UploadBytes(ctx, key, data, contentType); err != nil {
		fail(c, err)
		return "", false
	}
	return key, true
}

// PUT /admin/image-skills/:id/cover —— 上传或替换封面。
func (s *Server) adminUploadImageSkillCover(c *gin.Context, _ *store.User) {
	skill, found := s.officialSkillForImages(c)
	if !found {
		return
	}
	key, uploaded := s.uploadSkillImage(c, skill.ID, "cover")
	if !uploaded {
		return
	}
	ctx := c.Request.Context()
	updated, err := store.SetSkillCover(ctx, s.St.Pool, skill.ID, &key)
	if err != nil {
		s.deleteSkillImages(ctx, []string{key})
		fail(c, err)
		return
	}
	if skill.CoverKey != nil {
		s.deleteSkillImages(ctx, []string{*skill.CoverKey})
	}
	ok(c, imageSkillDict(*updated))
}

// DELETE /admin/image-skills/:id/cover —— 移除封面。
func (s *Server) adminDeleteImageSkillCover(c *gin.Context, _ *store.User) {
	skill, found := s.officialSkillForImages(c)
	if !found {
		return
	}
	ctx := c.Request.Context()
	updated, err := store.SetSkillCover(ctx, s.St.Pool, skill.ID, nil)
	if err != nil {
		fail(c, err)
		return
	}
	if skill.CoverKey != nil {
		s.deleteSkillImages(ctx, []string{*skill.CoverKey})
	}
	ok(c, imageSkillDict(*updated))
}

// POST /admin/image-skills/:id/samples —— 追加一张效果示例图（file + caption）。
func (s *Server) adminAddImageSkillSample(c *gin.Context, _ *store.User) {
	skill, found := s.officialSkillForImages(c)
	if !found {
		return
	}
	if len(skill.SampleImages) >= store.SkillMaxSampleImages {
		fail(c, apperr.E("validation_error", fmt.Sprintf("最多 %d 张示例图，先删掉一张", store.SkillMaxSampleImages), http.StatusUnprocessableEntity))
		return
	}
	key, uploaded := s.uploadSkillImage(c, skill.ID, "sample")
	if !uploaded {
		return
	}
	ctx := c.Request.Context()
	samples := append(append([]store.SkillSampleImage(nil), skill.SampleImages...),
		store.SkillSampleImage{Key: key, Caption: c.PostForm("caption")})
	updated, err := store.SetSkillSamples(ctx, s.St.Pool, skill.ID, samples)
	if err != nil {
		s.deleteSkillImages(ctx, []string{key})
		failSkillSamples(c, err)
		return
	}
	ok(c, imageSkillDict(*updated))
}

type imageSkillSamplesIn struct {
	Items []store.SkillSampleImage `json:"items"`
}

// PUT /admin/image-skills/:id/samples —— 调整示例图的顺序、说明或删除部分图片。
// 只能使用已上传的 key；从列表里去掉的图片会一并从存储删除。
func (s *Server) adminSetImageSkillSamples(c *gin.Context, _ *store.User) {
	skill, found := s.officialSkillForImages(c)
	if !found {
		return
	}
	var body imageSkillSamplesIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	existing := make(map[string]bool, len(skill.SampleImages))
	for _, sample := range skill.SampleImages {
		existing[sample.Key] = true
	}
	kept := make(map[string]bool, len(body.Items))
	for _, item := range body.Items {
		if !existing[item.Key] || kept[item.Key] {
			fail(c, apperr.E("validation_error", "sampleImages: 只能保留已上传的示例图", http.StatusUnprocessableEntity))
			return
		}
		kept[item.Key] = true
	}
	ctx := c.Request.Context()
	updated, err := store.SetSkillSamples(ctx, s.St.Pool, skill.ID, body.Items)
	if err != nil {
		failSkillSamples(c, err)
		return
	}
	removed := make([]string, 0)
	for key := range existing {
		if !kept[key] {
			removed = append(removed, key)
		}
	}
	s.deleteSkillImages(ctx, removed)
	ok(c, imageSkillDict(*updated))
}

func failSkillSamples(c *gin.Context, err error) {
	if errors.Is(err, store.ErrSkillNotFound) {
		fail(c, apperr.E("not_found", "Skill 不存在", http.StatusNotFound))
		return
	}
	if strings.HasPrefix(err.Error(), "sampleImages:") {
		fail(c, apperr.E("validation_error", err.Error(), http.StatusUnprocessableEntity))
		return
	}
	fail(c, err)
}
