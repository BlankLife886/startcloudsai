package userupload

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const maxStudioFigureBytes = 10 << 20

func IsProfileStudioTask(task *store.Task) bool {
	if task == nil {
		return false
	}
	params := task.Params
	source := strings.ToLower(strings.TrimSpace(stringParam(params, "_source")))
	kind := strings.ToLower(strings.TrimSpace(stringParam(params, "_kind")))
	if kind == "profile-studio-outfit" {
		return false
	}
	return source == "profile_studio" || kind == "profile-studio-figure"
}

func FileURL(key string) string {
	key = strings.TrimLeft(strings.TrimSpace(key), "/")
	if key == "" {
		return ""
	}
	return "/api/v1/files/" + key
}

func ObjectKeyFromFileURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if i := strings.Index(value, "/api/v1/files/"); i >= 0 {
		value = value[i+len("/api/v1/files/"):]
	}
	if q := strings.IndexAny(value, "?#"); q >= 0 {
		value = value[:q]
	}
	return strings.TrimLeft(value, "/")
}

func PersistStudioFigure(ctx context.Context, st *store.Store, blobStore *storage.Storage, userID uuid.UUID, sourceKey string) (string, error) {
	if st == nil || blobStore == nil {
		return "", fmt.Errorf("studio figure storage is unavailable")
	}
	sourceKey, data, err := loadStudioFigureOriginal(ctx, blobStore, sourceKey)
	if err != nil {
		return "", err
	}
	if isOwnedUploadOriginal(userID, sourceKey) {
		if err := saveStudioFigureURL(ctx, st, blobStore, userID, sourceKey, nil); err != nil {
			return "", err
		}
		return FileURL(sourceKey), nil
	}
	ext, contentType := media.Detect(data)
	if ext == "" {
		return "", fmt.Errorf("studio figure is not a supported image")
	}
	fileID := studioFigureObjectID(userID, sourceKey)
	originalKey := fmt.Sprintf("uploads/%s/original/%s.%s", userID, fileID, ext)
	thumbnailKey := fmt.Sprintf("uploads/%s/thumb/%s", userID, fileID)
	displayKey := store.DisplayKeyForOriginal(originalKey)
	variantCfg, err := settings.ResolveImageVariants(ctx, st.Pool)
	if err != nil {
		variantCfg = settings.ImageVariantConfig{Format: "webp", Quality: 85, DisplayMaxEdge: 2048, ThumbMaxEdge: 512}
	}
	thumbnail, err := media.EncodeVariant(data, media.VariantOptions{
		Format: variantCfg.Format, Quality: 75, MaxEdge: variantCfg.ThumbMaxEdge,
	})
	if err != nil {
		return "", err
	}
	uploaded := make([]string, 0, 3)
	cleanup := func() {
		if len(uploaded) == 0 {
			return
		}
		_ = blobStore.DeleteKeys(ctx, uploaded)
	}
	if err := blobStore.UploadBytes(ctx, originalKey, data, contentType); err != nil {
		return "", err
	}
	uploaded = append(uploaded, originalKey)
	if err := blobStore.UploadBytes(ctx, thumbnailKey, thumbnail.Data, thumbnail.ContentType); err != nil {
		cleanup()
		return "", err
	}
	uploaded = append(uploaded, thumbnailKey)
	if display, displayErr := media.EncodeVariant(data, media.VariantOptions{
		Format: variantCfg.Format, Lossless: variantCfg.Lossless,
		Quality: variantCfg.Quality, MaxEdge: variantCfg.DisplayMaxEdge,
	}); displayErr == nil {
		if err := blobStore.UploadBytes(ctx, displayKey, display.Data, display.ContentType); err == nil {
			uploaded = append(uploaded, displayKey)
		}
	}
	if err := saveStudioFigureURL(ctx, st, blobStore, userID, originalKey, uploaded); err != nil {
		cleanup()
		return "", err
	}
	return FileURL(originalKey), nil
}

func saveStudioFigureURL(ctx context.Context, st *store.Store, blobStore *storage.Storage, userID uuid.UUID, originalKey string, objectKeys []string) error {
	previousKey := ""
	if current, err := store.GetUserByID(ctx, st.Pool, userID); err == nil && current != nil && current.StudioFigureURL != nil {
		previousKey = ownedUploadOriginalKey(userID, ObjectKeyFromFileURL(*current.StudioFigureURL))
	}
	figureURL := FileURL(originalKey)
	keys := append([]string{originalKey}, objectKeys...)
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.RegisterUserUploadObjects(ctx, tx, userID, keys); err != nil {
			return err
		}
		var value *string
		if figureURL != "" {
			value = &figureURL
		}
		ptr := &value
		return store.UpdateUserProfile(ctx, tx, userID, nil, nil, nil, nil, nil, nil, nil, ptr)
	}); err != nil {
		return err
	}
	if refErr := store.ReplaceUserUploadReferences(ctx, st.Pool, userID, store.UploadReferenceUserStudioFigure, userID, []string{originalKey}); refErr != nil {
		log.Printf("studio figure reference: %v", refErr)
	}
	if previousKey != "" && previousKey != originalKey {
		DeleteUnreferencedFigure(ctx, st, blobStore, userID, previousKey)
	}
	return nil
}

func DeleteUnreferencedFigure(ctx context.Context, st *store.Store, blobStore *storage.Storage, userID uuid.UUID, fileURLOrKey string) {
	if st == nil || blobStore == nil {
		return
	}
	originalKey := ownedUploadOriginalKey(userID, ObjectKeyFromFileURL(fileURLOrKey))
	if originalKey == "" {
		originalKey = ownedUploadOriginalKey(userID, strings.TrimLeft(strings.TrimSpace(fileURLOrKey), "/"))
	}
	if originalKey == "" {
		return
	}
	variantKeys := figureStorageKeys(originalKey)
	registered := []string{originalKey}
	if thumb := store.ThumbKeyForOriginal(originalKey); thumb != "" {
		registered = append(registered, thumb)
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		live, err := store.HasLiveUserUploadObject(ctx, tx, userID, originalKey)
		if err != nil {
			return err
		}
		if live {
			claimed, err := store.ClaimUnreferencedUserUploadObjects(ctx, tx, []string{originalKey}, time.Now().UTC().Add(time.Hour))
			if err != nil {
				return err
			}
			if len(claimed) == 0 {
				return nil
			}
		}
		if err := blobStore.DeleteKeys(ctx, variantKeys); err != nil {
			return err
		}
		_, err = store.MarkUserUploadObjectsDeleted(ctx, tx, registered)
		return err
	}); err != nil {
		log.Printf("delete unreferenced studio figure %s: %v", originalKey, err)
	}
}

func figureStorageKeys(originalKey string) []string {
	keys := []string{originalKey}
	if thumb := store.ThumbKeyForOriginal(originalKey); thumb != "" {
		keys = append(keys, thumb)
	}
	if display := store.DisplayKeyForOriginal(originalKey); display != "" {
		keys = append(keys, display)
	}
	return keys
}

func ownedUploadOriginalKey(userID uuid.UUID, key string) string {
	key = strings.TrimLeft(strings.TrimSpace(key), "/")
	if isOwnedUploadOriginal(userID, key) {
		return key
	}
	return ""
}

func loadStudioFigureOriginal(ctx context.Context, blobStore *storage.Storage, sourceKey string) (string, []byte, error) {
	sourceKey = strings.TrimLeft(strings.TrimSpace(sourceKey), "/")
	if sourceKey == "" {
		return "", nil, fmt.Errorf("missing studio figure image")
	}
	candidates := originalKeyCandidates(sourceKey)
	if len(candidates) == 0 {
		candidates = []string{sourceKey}
	}
	var last error
	for _, candidate := range candidates {
		data, err := blobStore.GetBytesLimit(ctx, candidate, maxStudioFigureBytes)
		if err == nil {
			return candidate, data, nil
		}
		last = err
		if !storage.IsNotFound(err) {
			return "", nil, err
		}
	}
	if last == nil {
		last = fmt.Errorf("missing studio figure image")
	}
	return "", nil, last
}

func originalKeyCandidates(key string) []string {
	parts := strings.Split(strings.TrimLeft(strings.TrimSpace(key), "/"), "/")
	prefix := ""
	name := ""
	switch {
	case len(parts) == 5 && parts[0] == "tasks" && (parts[3] == "display" || parts[3] == "thumb"):
		prefix = fmt.Sprintf("tasks/%s/%s/original/", parts[1], parts[2])
		name = parts[4]
	case len(parts) == 4 && parts[0] == "uploads" && (parts[2] == "display" || parts[2] == "thumb"):
		prefix = fmt.Sprintf("uploads/%s/original/", parts[1])
		name = parts[3]
	default:
		return nil
	}
	if dot := strings.LastIndex(name, "."); dot > 0 {
		name = name[:dot]
	}
	if name == "" {
		return nil
	}
	out := make([]string, 0, 4)
	for _, ext := range []string{"png", "webp", "jpg", "jpeg"} {
		out = append(out, prefix+name+"."+ext)
	}
	return out
}

func isOwnedUploadOriginal(userID uuid.UUID, key string) bool {
	parts := strings.Split(strings.TrimSpace(key), "/")
	return len(parts) == 4 &&
		parts[0] == "uploads" &&
		parts[1] == userID.String() &&
		parts[2] == "original" &&
		parts[3] != "" &&
		!strings.Contains(parts[3], "..")
}

func studioFigureObjectID(userID uuid.UUID, sourceKey string) string {
	parts := strings.Split(strings.TrimLeft(strings.TrimSpace(sourceKey), "/"), "/")
	if len(parts) >= 5 &&
		parts[0] == "tasks" &&
		parts[1] == userID.String() &&
		parts[3] == "original" &&
		parts[2] != "" {
		if _, err := uuid.Parse(parts[2]); err == nil {
			return "studio-figure-" + parts[2]
		}
	}
	return uuid.NewString()
}

func stringParam(params map[string]any, key string) string {
	if params == nil {
		return ""
	}
	value, ok := params[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}
