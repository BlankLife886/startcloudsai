package userassets

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// Saving generated images into the asset library. The library only holds
// the user's own uploads, so each image is copied into uploads/<user>/ with
// a thumbnail, exactly as if the user had uploaded it. Like the other
// actions it is proposed first and runs after the user confirms; undo moves
// the new copies to the recycle bin.

const (
	ActionSave = "save"

	// MaxSaveImages caps one save.
	MaxSaveImages = 20
	// MaxLibraryAssets and MaxAssetImageBytes match the asset library page.
	MaxLibraryAssets   = 200
	MaxAssetImageBytes = 10 << 20

	recentMessageScan = 40
)

// SaveImage is one generated image to copy into the library.
type SaveImage struct {
	Key        string `json:"key"`
	ThumbURL   string `json:"thumbUrl"`
	Title      string `json:"title"`
	SourceType string `json:"sourceType"`
	SourceID   string `json:"sourceId,omitempty"`
}

// SaveRequest is what the model asks to save. Exactly one source is used:
// ids from assets_search ("task:<id>"), a commerce set, or the latest images
// generated in this conversation.
type SaveRequest struct {
	ImageIDs      []string `json:"imageIds,omitempty"`
	CommerceSetID string   `json:"commerceSetId,omitempty"`
	RecentImages  int      `json:"recentImages,omitempty"`
	// Title names the saved images ("精华瓶透明底图"); several images get
	// " 1", " 2"… Empty keeps each image's own name.
	Title string   `json:"title,omitempty"`
	Group string   `json:"group,omitempty"`
	Tags  []string `json:"tags,omitempty"`
}

// ownsGeneratedKey accepts only the user's own task outputs: generated
// images live under tasks/<user>/.
func ownsGeneratedKey(userID uuid.UUID, key string) bool {
	key = strings.TrimSpace(key)
	return strings.HasPrefix(key, "tasks/"+userID.String()+"/") && !strings.Contains(key, "..") && !strings.HasSuffix(key, "/")
}

func taskTitle(task *store.Task) string {
	if label, _ := task.Params["viewLabel"].(string); strings.TrimSpace(label) != "" {
		return truncate(label, 60)
	}
	return truncate(task.Prompt, 60)
}

func taskImages(task *store.Task, all bool) []SaveImage {
	out := []SaveImage{}
	if task == nil || task.Status != "succeeded" {
		return out
	}
	for index, key := range task.OutputKeys {
		thumb := key
		if index < len(task.ThumbnailKeys) && task.ThumbnailKeys[index] != "" {
			thumb = task.ThumbnailKeys[index]
		}
		out = append(out, SaveImage{Key: key, ThumbURL: fileURL(thumb), Title: taskTitle(task), SourceType: "task", SourceID: task.ID.String()})
		if !all {
			break
		}
	}
	return out
}

func (r SaveRequest) sources() int {
	count := 0
	if len(r.ImageIDs) > 0 {
		count++
	}
	if strings.TrimSpace(r.CommerceSetID) != "" {
		count++
	}
	if r.RecentImages > 0 {
		count++
	}
	return count
}

// ProposeSave resolves the images to save and describes the change. It
// changes nothing. conversationID scopes recentImages; nil disables it.
func ProposeSave(ctx context.Context, q store.Q, userID uuid.UUID, conversationID *uuid.UUID, req SaveRequest) (*Action, error) {
	if req.sources() != 1 {
		return nil, invalid("请只用一种方式指定图片：imageIds、commerceSetId 或 recentImages")
	}
	images := []SaveImage{}
	switch {
	case len(req.ImageIDs) > 0:
		if len(req.ImageIDs) > MaxSaveImages {
			return nil, invalid("一次最多存 %d 张", MaxSaveImages)
		}
		for _, raw := range req.ImageIDs {
			raw = strings.TrimSpace(raw)
			if strings.HasPrefix(raw, "asset:") {
				return nil, invalid("%s 已经在资产库里了", raw)
			}
			id, err := uuid.Parse(strings.TrimPrefix(raw, "task:"))
			if err != nil {
				return nil, invalid("图片 id 无效：%s（用 assets_search 返回的 task: 开头的 id）", raw)
			}
			task, err := store.GetUserTask(ctx, q, userID, id)
			if err != nil {
				return nil, err
			}
			found := taskImages(task, false)
			if len(found) == 0 {
				return nil, invalid("没有找到这张生成的图：%s", raw)
			}
			images = append(images, found...)
		}
	case strings.TrimSpace(req.CommerceSetID) != "":
		setID, err := uuid.Parse(strings.TrimSpace(req.CommerceSetID))
		if err != nil {
			return nil, invalid("套图 id 无效")
		}
		set, err := store.GetUserCommerceSet(ctx, q, userID, setID)
		if err != nil {
			return nil, err
		}
		if set == nil {
			return nil, invalid("没有找到这套图")
		}
		// The latest attempt of each shot is the image the user sees on the card.
		for _, shot := range set.Shots {
			if len(shot.Attempts) == 0 {
				continue
			}
			task, err := store.GetUserTask(ctx, q, userID, shot.Attempts[len(shot.Attempts)-1].TaskID)
			if err != nil {
				return nil, err
			}
			for _, image := range taskImages(task, false) {
				image.Title = truncate(shot.Label, 60)
				if name := strings.TrimSpace(gjsonString(set.Brief, "productName")); name != "" {
					image.Title = truncate(name+" · "+shot.Label, 60)
				}
				image.SourceType, image.SourceID = "assistant_set", set.ID.String()
				images = append(images, image)
			}
		}
		if len(images) == 0 {
			return nil, invalid("这套图还没有生成成功的图片")
		}
	default:
		if conversationID == nil {
			return nil, invalid("没有可以存的对话图片")
		}
		recent, err := conversationImages(ctx, q, userID, *conversationID, min(req.RecentImages, MaxSaveImages))
		if err != nil {
			return nil, err
		}
		if len(recent) == 0 {
			return nil, invalid("这个对话里还没有生成的图片")
		}
		images = recent
	}
	if len(images) > MaxSaveImages {
		images = images[:MaxSaveImages]
	}

	if title := truncate(req.Title, 56); title != "" {
		for index := range images {
			images[index].Title = title
			if len(images) > 1 {
				images[index].Title = fmt.Sprintf("%s %d", title, index+1)
			}
		}
	}
	out := Action{Action: ActionSave, Images: images}
	for _, image := range images {
		out.Titles = append(out.Titles, image.Title)
	}
	var err error
	if out.Group, out.CreateGroup, err = proposeGroup(ctx, q, userID, req.Group); err != nil {
		return nil, err
	}
	if len(req.Tags) > 0 {
		if out.Tags, err = store.NormalizeAssetTags(req.Tags); err != nil {
			return nil, invalid("标签无效（最多 10 个，每个最多 32 个字符）")
		}
	}
	out.Summary = fmt.Sprintf("把 %d 张图存进资产库", len(images))
	if out.Group != "" {
		out.Summary += "，放到「" + out.Group + "」"
		if out.CreateGroup {
			out.Summary += "（新建这个分组）"
		}
	}
	if len(out.Tags) > 0 {
		out.Summary += "，标签：" + strings.Join(out.Tags, "、")
	}
	return &out, nil
}

func proposeGroup(ctx context.Context, q store.Q, userID uuid.UUID, raw string) (string, bool, error) {
	name := store.NormalizeAssetGroupName(raw)
	if utf8.RuneCountInString(name) > 64 {
		return "", false, invalid("分组名称不能超过 64 个字符")
	}
	if name == "" {
		return "", false, nil
	}
	group, err := findGroup(ctx, q, userID, name)
	return name, group == nil, err
}

// conversationImages lists the newest images the assistant generated in
// one of the user's conversations, newest first.
func conversationImages(ctx context.Context, q store.Q, userID, conversationID uuid.UUID, limit int) ([]SaveImage, error) {
	var owner uuid.UUID
	if err := q.QueryRow(ctx, `SELECT user_id FROM assistant_conversations WHERE id = $1`, conversationID).Scan(&owner); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if owner != userID {
		return nil, nil
	}
	messages, err := store.ListAssistantMessages(ctx, q, conversationID, recentMessageScan)
	if err != nil {
		return nil, err
	}
	out := []SaveImage{}
	for index := len(messages) - 1; index >= 0 && len(out) < limit; index-- {
		message := messages[index]
		if message.Role != "assistant" || message.Status != "complete" {
			continue
		}
		raw, _ := json.Marshal(message.Metadata["images"])
		var items []struct {
			FileKey       string `json:"fileKey"`
			ThumbURL      string `json:"thumbUrl"`
			RevisedPrompt string `json:"revisedPrompt"`
		}
		if json.Unmarshal(raw, &items) != nil {
			continue
		}
		prompt, _ := message.Metadata["prompt"].(string)
		for _, item := range items {
			if len(out) >= limit || !ownsGeneratedKey(userID, item.FileKey) {
				continue
			}
			title := strings.TrimSpace(prompt)
			if title == "" {
				title = item.RevisedPrompt
			}
			if title == "" {
				title = "AI 助手图片"
			}
			thumb := item.ThumbURL
			if thumb == "" {
				thumb = fileURL(item.FileKey)
			}
			out = append(out, SaveImage{Key: item.FileKey, ThumbURL: thumb, Title: truncate(title, 60), SourceType: "assistant", SourceID: message.ID.String()})
		}
	}
	return out, nil
}

func gjsonString(raw json.RawMessage, field string) string {
	var values map[string]any
	if json.Unmarshal(raw, &values) != nil {
		return ""
	}
	value, _ := values[field].(string)
	return value
}

type preparedImage struct {
	image       SaveImage
	originalKey string
	thumbKey    string
	displayKey  string
	contentType string
	size        int64
	hash        string
	uploaded    []string
}

// ExecuteSave copies the confirmed images into the library. Images already
// in the library (same content) are skipped and reported, not failed.
func ExecuteSave(ctx context.Context, st *store.Store, blobs *storage.Storage, userID uuid.UUID, action Action) (*Undo, error) {
	if blobs == nil {
		return nil, fmt.Errorf("object storage is unavailable")
	}
	if len(action.Images) == 0 || len(action.Images) > MaxSaveImages {
		return nil, invalid("一次可以存 1-%d 张图", MaxSaveImages)
	}
	groupName, _, err := proposeGroup(ctx, st.Pool, userID, action.Group)
	if err != nil {
		return nil, err
	}
	tags := noTags
	if len(action.Tags) > 0 {
		if tags, err = store.NormalizeAssetTags(action.Tags); err != nil {
			return nil, invalid("标签无效")
		}
	}
	variantCfg, err := settings.ResolveImageVariants(ctx, st.Pool)
	if err != nil {
		variantCfg = settings.ImageVariantConfig{Format: "webp", Quality: 85, DisplayMaxEdge: 2048, ThumbMaxEdge: 512}
	}

	// Copy the files first; the database transaction only references them.
	prepared := []*preparedImage{}
	cleanup := func() {
		keys := []string{}
		for _, item := range prepared {
			keys = append(keys, item.uploaded...)
		}
		if len(keys) > 0 {
			_ = blobs.DeleteKeys(context.WithoutCancel(ctx), keys)
		}
	}
	seen := map[string]bool{}
	for _, image := range action.Images {
		image.Key = strings.TrimSpace(image.Key)
		if !ownsGeneratedKey(userID, image.Key) {
			return nil, invalid("只能存你自己生成的图片")
		}
		// The card sends the proposal back; only the key is trusted, and only
		// after the ownership check. The rest is display text, kept in bounds.
		image.Title = truncate(strings.TrimSpace(image.Title), 60)
		if image.Title == "" {
			image.Title = "AI 助手图片"
		}
		switch image.SourceType {
		case "task", "assistant", "assistant_set":
		default:
			image.SourceType = "assistant"
		}
		image.SourceID = truncate(image.SourceID, 64)
		if seen[image.Key] {
			continue
		}
		seen[image.Key] = true
		data, err := blobs.GetBytesLimit(ctx, image.Key, MaxAssetImageBytes)
		if err != nil {
			cleanup()
			if storage.IsNotFound(err) {
				return nil, invalid("有图片已经不存在了")
			}
			return nil, invalid("有图片读取失败或超过 10MB")
		}
		ext, contentType := media.Detect(data)
		if ext == "" {
			cleanup()
			return nil, invalid("有图片不是支持的格式")
		}
		fileID := uuid.NewString()
		item := &preparedImage{image: image, contentType: contentType, size: int64(len(data)),
			hash:        fmt.Sprintf("%x", sha256.Sum256(data)),
			originalKey: fmt.Sprintf("uploads/%s/original/%s.%s", userID, fileID, ext),
			thumbKey:    fmt.Sprintf("uploads/%s/thumb/%s", userID, fileID)}
		item.displayKey = store.DisplayKeyForOriginal(item.originalKey)
		prepared = append(prepared, item)
		thumb, err := media.EncodeVariant(data, media.VariantOptions{Format: variantCfg.Format, Quality: 75, MaxEdge: variantCfg.ThumbMaxEdge})
		if err != nil {
			cleanup()
			return nil, err
		}
		if err := blobs.UploadBytes(ctx, item.originalKey, data, contentType); err != nil {
			cleanup()
			return nil, err
		}
		item.uploaded = append(item.uploaded, item.originalKey)
		if err := blobs.UploadBytes(ctx, item.thumbKey, thumb.Data, thumb.ContentType); err != nil {
			cleanup()
			return nil, err
		}
		item.uploaded = append(item.uploaded, item.thumbKey)
		if display, err := media.EncodeVariant(data, media.VariantOptions{Format: variantCfg.Format, Lossless: variantCfg.Lossless,
			Quality: variantCfg.Quality, MaxEdge: variantCfg.DisplayMaxEdge}); err == nil {
			if blobs.UploadBytes(ctx, item.displayKey, display.Data, display.ContentType) == nil {
				item.uploaded = append(item.uploaded, item.displayKey)
			}
		}
	}

	undo := &Undo{Action: ActionSave}
	skipped := []*preparedImage{}
	err = st.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.LockUserAssetCreation(ctx, tx, userID); err != nil {
			return err
		}
		var groupID *uuid.UUID
		if groupName != "" {
			group, err := findGroup(ctx, tx, userID, groupName)
			if err != nil {
				return err
			}
			if group == nil {
				if err := store.LockUserAssetGroupCreation(ctx, tx, userID); err != nil {
					return err
				}
				count, err := store.CountUserAssetGroups(ctx, tx, userID)
				if err != nil {
					return err
				}
				if count >= store.MaxUserAssetGroups {
					return invalid("最多创建 %d 个分组", store.MaxUserAssetGroups)
				}
				if group, err = store.InsertUserAssetGroup(ctx, tx, userID, groupName, int(count)); err != nil {
					return err
				}
				undo.CreatedGroup = group.ID.String()
			}
			groupID = &group.ID
		}
		count, err := store.CountUserAssets(ctx, tx, userID)
		if err != nil {
			return err
		}
		for _, item := range prepared {
			duplicate, err := store.GetUserAssetByContentHash(ctx, tx, userID, item.hash)
			if err != nil {
				return err
			}
			if duplicate != nil {
				skipped = append(skipped, item)
				continue
			}
			if count >= MaxLibraryAssets {
				return invalid("资产库最多保存 %d 项，已经满了", MaxLibraryAssets)
			}
			if err := store.RegisterUserUploadObjects(ctx, tx, userID, item.uploaded); err != nil {
				return err
			}
			sourceID := item.image.SourceID
			metadata, _ := json.Marshal(map[string]any{"from": "assistant", "sourceKey": item.image.Key})
			asset, err := store.InsertUserAssetDAM(ctx, tx, userID, item.image.Title, item.originalKey, item.thumbKey,
				item.contentType, item.size, groupID, tags, item.hash, item.image.SourceType, &sourceID, metadata, nil)
			if err != nil {
				return err
			}
			if err := store.AddUserUploadReferences(ctx, tx, userID, store.UploadReferenceUserAsset, asset.ID,
				[]string{asset.FileKey, asset.ThumbnailKey}); err != nil {
				return err
			}
			count++
			undo.Items = append(undo.Items, UndoItem{AssetID: asset.ID.String()})
		}
		if len(undo.Items) == 0 && undo.CreatedGroup != "" {
			// Nothing new went in: do not leave an empty group behind.
			id, _ := uuid.Parse(undo.CreatedGroup)
			undo.CreatedGroup = ""
			return store.DeleteUserAssetGroup(ctx, tx, userID, id)
		}
		return nil
	})
	if err != nil {
		cleanup()
		return nil, err
	}
	// Skipped copies were never referenced; remove them.
	keys := []string{}
	for _, item := range skipped {
		keys = append(keys, item.uploaded...)
	}
	if len(keys) > 0 {
		_ = blobs.DeleteKeys(context.WithoutCancel(ctx), keys)
	}
	undo.Skipped = len(skipped)
	if len(undo.Items) == 0 {
		return undo, invalid("这些图已经都在资产库里了")
	}
	return undo, nil
}

// revertSave moves the saved copies to the recycle bin and removes the
// group created for them when it is empty again.
func revertSave(ctx context.Context, tx pgx.Tx, userID uuid.UUID, undo Undo) error {
	ids := []uuid.UUID{}
	for _, item := range undo.Items {
		id, err := uuid.Parse(item.AssetID)
		if err != nil {
			return invalid("撤销记录无效")
		}
		ids = append(ids, id)
	}
	if _, err := store.BatchTrashUserAssets(ctx, tx, userID, ids); err != nil {
		return err
	}
	return removeEmptyCreatedGroup(ctx, tx, userID, undo.CreatedGroup)
}

func removeEmptyCreatedGroup(ctx context.Context, tx pgx.Tx, userID uuid.UUID, created string) error {
	id, err := uuid.Parse(created)
	if created == "" || err != nil {
		return nil
	}
	var remaining int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM user_assets WHERE user_id = $1 AND group_id = $2 AND deleted_at IS NULL`, userID, id).Scan(&remaining); err != nil {
		return err
	}
	if remaining > 0 {
		return nil
	}
	// Trashed copies still point at the group; detach them before deleting it.
	if _, err := tx.Exec(ctx, `UPDATE user_assets SET group_id = NULL WHERE user_id = $1 AND group_id = $2`, userID, id); err != nil {
		return err
	}
	return store.DeleteUserAssetGroup(ctx, tx, userID, id)
}
