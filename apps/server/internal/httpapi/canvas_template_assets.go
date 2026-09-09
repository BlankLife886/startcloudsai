package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
)

const (
	canvasTemplatePackageMaxBytes = 128 << 20
	canvasTemplateAssetMaxBytes   = 32 << 20
	canvasTemplateAssetMaxCount   = 300
	canvasTemplateExpandedMax     = 192 << 20
)

var canvasTemplateAssetExtensionPattern = regexp.MustCompile(`^[a-z0-9]{1,8}$`)

type canvasTemplatePackageAsset struct {
	Data        []byte
	ContentType string
}

type canvasTemplatePackage struct {
	Document json.RawMessage
	Assets   map[string]canvasTemplatePackageAsset
}

type canvasTemplateAssetRef struct {
	Key string
	URL string
}

func readCanvasTemplatePackage(fileHeader *multipart.FileHeader) (*canvasTemplatePackage, error) {
	if fileHeader == nil || fileHeader.Size <= 0 || fileHeader.Size > canvasTemplatePackageMaxBytes {
		return nil, apperr.E("validation_error", "package: 画布 ZIP 无效或超过 128 MiB", 422)
	}
	file, err := fileHeader.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, canvasTemplatePackageMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > canvasTemplatePackageMaxBytes {
		return nil, apperr.E("validation_error", "package: 画布 ZIP 超过 128 MiB", 422)
	}
	archive, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, apperr.E("validation_error", "package: 无法读取画布 ZIP", 422)
	}
	entries := make(map[string]*zip.File, len(archive.File))
	var expanded uint64
	for _, entry := range archive.File {
		name := strings.TrimPrefix(filepath.ToSlash(entry.Name), "./")
		if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "../") {
			return nil, apperr.E("validation_error", "package: ZIP 包含无效路径", 422)
		}
		expanded += entry.UncompressedSize64
		if expanded > canvasTemplateExpandedMax {
			return nil, apperr.E("validation_error", "package: ZIP 解压后超过 192 MiB", 422)
		}
		entries[name] = entry
	}
	manifestEntry := entries["projects.json"]
	if manifestEntry == nil || manifestEntry.UncompressedSize64 > 2<<20 {
		return nil, apperr.E("validation_error", "package: 缺少有效的 projects.json", 422)
	}
	manifestRaw, err := readCanvasTemplateZipEntry(manifestEntry, 2<<20)
	if err != nil {
		return nil, err
	}
	var manifest struct {
		App      string `json:"app"`
		Version  int    `json:"version"`
		Projects []struct {
			Project struct {
				Nodes          json.RawMessage `json:"nodes"`
				Connections    json.RawMessage `json:"connections"`
				BackgroundMode string          `json:"backgroundMode,omitempty"`
				ShowImageInfo  bool            `json:"showImageInfo,omitempty"`
				Viewport       json.RawMessage `json:"viewport,omitempty"`
			} `json:"project"`
			Files []struct {
				StorageKey string `json:"storageKey"`
				Path       string `json:"path"`
				MimeType   string `json:"mimeType"`
				Bytes      int64  `json:"bytes"`
			} `json:"files"`
		} `json:"projects"`
	}
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil || manifest.App != "infinite-canvas" || manifest.Version != 3 || len(manifest.Projects) == 0 {
		return nil, apperr.E("validation_error", "package: 只支持无限画布 v3 导出包", 422)
	}
	project := manifest.Projects[0]
	documentValue := map[string]any{
		"version": 3, "nodes": project.Project.Nodes, "connections": project.Project.Connections,
		"showImageInfo": project.Project.ShowImageInfo,
	}
	if project.Project.BackgroundMode != "" {
		documentValue["backgroundMode"] = project.Project.BackgroundMode
	}
	if len(project.Project.Viewport) > 0 && string(project.Project.Viewport) != "null" {
		documentValue["viewport"] = project.Project.Viewport
	}
	document, err := json.Marshal(documentValue)
	if err != nil {
		return nil, err
	}
	if _, _, err := validateCanvasTemplateDocument(document); err != nil {
		return nil, err
	}
	if len(project.Files) > canvasTemplateAssetMaxCount {
		return nil, apperr.E("validation_error", "package: 模板资源不能超过 300 个", 422)
	}
	assets := make(map[string]canvasTemplatePackageAsset, len(project.Files))
	for _, item := range project.Files {
		storageKey := strings.TrimSpace(item.StorageKey)
		entryPath := strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(item.Path)), "./")
		entry := entries[entryPath]
		if storageKey == "" || entry == nil {
			return nil, apperr.E("validation_error", "package: 资源清单与 ZIP 内容不一致", 422)
		}
		if entry.UncompressedSize64 > canvasTemplateAssetMaxBytes {
			return nil, apperr.E("validation_error", "package: 单个模板资源不能超过 32 MiB", 422)
		}
		data, err := readCanvasTemplateZipEntry(entry, canvasTemplateAssetMaxBytes)
		if err != nil {
			return nil, err
		}
		contentType := strings.TrimSpace(item.MimeType)
		if contentType == "" || contentType == "application/octet-stream" {
			contentType = http.DetectContentType(data)
		}
		if !strings.HasPrefix(contentType, "image/") && !strings.HasPrefix(contentType, "video/") && !strings.HasPrefix(contentType, "audio/") {
			return nil, apperr.E("validation_error", "package: 模板资源类型无效", 422)
		}
		assets[storageKey] = canvasTemplatePackageAsset{Data: data, ContentType: contentType}
	}
	return &canvasTemplatePackage{Document: document, Assets: assets}, nil
}

func readCanvasTemplateZipEntry(entry *zip.File, maxBytes int64) ([]byte, error) {
	reader, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, apperr.E("validation_error", "package: 模板资源过大", 422)
	}
	return data, nil
}

func canvasTemplateStorageKey(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "tasks/") || strings.HasPrefix(value, "uploads/") || strings.HasPrefix(value, "canvas-template-assets/") || strings.HasPrefix(value, "image:") {
		return value
	}
	const marker = "/api/v1/files/"
	index := strings.Index(value, marker)
	if index < 0 {
		return ""
	}
	key := strings.SplitN(value[index+len(marker):], "?", 2)[0]
	key = strings.SplitN(key, "#", 2)[0]
	if decoded, err := url.PathUnescape(key); err == nil {
		key = decoded
	}
	return strings.Trim(key, "/")
}

func decodeCanvasTemplateDataURL(value string) ([]byte, string, bool) {
	if !strings.HasPrefix(value, "data:") {
		return nil, "", false
	}
	header, payload, found := strings.Cut(value, ",")
	if !found || !strings.HasSuffix(header, ";base64") {
		return nil, "", false
	}
	contentType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	if !strings.HasPrefix(contentType, "image/") {
		return nil, "", false
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil || len(data) == 0 || len(data) > canvasTemplateAssetMaxBytes {
		return nil, "", false
	}
	return data, contentType, true
}

func canvasTemplateAssetExtension(source, contentType string, data []byte) string {
	contentType = strings.SplitN(strings.TrimSpace(contentType), ";", 2)[0]
	if extensions, _ := mime.ExtensionsByType(contentType); len(extensions) > 0 {
		ext := strings.TrimPrefix(strings.ToLower(extensions[0]), ".")
		if canvasTemplateAssetExtensionPattern.MatchString(ext) {
			return ext
		}
	}
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(strings.SplitN(source, "?", 2)[0])), ".")
	if canvasTemplateAssetExtensionPattern.MatchString(ext) {
		return ext
	}
	detected := http.DetectContentType(data)
	if extensions, _ := mime.ExtensionsByType(strings.SplitN(detected, ";", 2)[0]); len(extensions) > 0 {
		return strings.TrimPrefix(strings.ToLower(extensions[0]), ".")
	}
	return "bin"
}

func (s *Server) migrateCanvasTemplateDocument(ctx context.Context, templateID uuid.UUID, raw json.RawMessage, packageAssets map[string]canvasTemplatePackageAsset) (json.RawMessage, []string, error) {
	var document any
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, nil, err
	}
	prefix := "canvas-template-assets/" + templateID.String() + "/"
	cache := make(map[string]canvasTemplateAssetRef)
	uploaded := make([]string, 0)

	resolve := func(value string) (canvasTemplateAssetRef, bool, error) {
		value = strings.TrimSpace(value)
		if value == "" || strings.HasPrefix(value, "blob:") {
			return canvasTemplateAssetRef{}, false, nil
		}
		sourceKey := canvasTemplateStorageKey(value)
		if sourceKey == "" {
			if _, exists := packageAssets[value]; exists {
				sourceKey = value
			}
		}
		if strings.HasPrefix(sourceKey, prefix) {
			return canvasTemplateAssetRef{Key: sourceKey, URL: "/api/v1/files/" + sourceKey}, true, nil
		}
		cacheKey := sourceKey
		var asset canvasTemplatePackageAsset
		var ok bool
		if sourceKey != "" {
			asset, ok = packageAssets[sourceKey]
		}
		if !ok {
			if data, contentType, dataOK := decodeCanvasTemplateDataURL(value); dataOK {
				asset, ok, cacheKey = canvasTemplatePackageAsset{Data: data, ContentType: contentType}, true, value
			} else if sourceKey == "" {
				return canvasTemplateAssetRef{}, false, nil
			} else if strings.HasPrefix(sourceKey, "image:") {
				return canvasTemplateAssetRef{}, false, apperr.E("validation_error", "package: ZIP 中缺少本地画布图片", 422)
			} else if strings.HasPrefix(sourceKey, "tasks/") || strings.HasPrefix(sourceKey, "uploads/") || strings.HasPrefix(sourceKey, "canvas-template-assets/") {
				reader, _, contentType, err := s.Storage.OpenObject(ctx, sourceKey, canvasTemplateAssetMaxBytes)
				if err != nil {
					return canvasTemplateAssetRef{}, false, apperr.E("template_asset_unavailable", "模板中的图片已失效或无法读取", 422)
				}
				data, readErr := io.ReadAll(io.LimitReader(reader, canvasTemplateAssetMaxBytes+1))
				closeErr := reader.Close()
				if readErr != nil || closeErr != nil || len(data) == 0 || len(data) > canvasTemplateAssetMaxBytes {
					return canvasTemplateAssetRef{}, false, apperr.E("template_asset_unavailable", "模板中的图片读取失败", 422)
				}
				asset, ok = canvasTemplatePackageAsset{Data: data, ContentType: contentType}, true
			}
		}
		if !ok {
			return canvasTemplateAssetRef{}, false, nil
		}
		if cached, exists := cache[cacheKey]; exists {
			return cached, true, nil
		}
		if len(cache) >= canvasTemplateAssetMaxCount {
			return canvasTemplateAssetRef{}, false, apperr.E("validation_error", "document: 模板资源不能超过 300 个", 422)
		}
		sum := sha256.Sum256(asset.Data)
		extension := canvasTemplateAssetExtension(sourceKey, asset.ContentType, asset.Data)
		key := prefix + hex.EncodeToString(sum[:16]) + "." + extension
		contentType := strings.TrimSpace(asset.ContentType)
		if contentType == "" || contentType == "application/octet-stream" {
			contentType = http.DetectContentType(asset.Data)
		}
		if err := s.Storage.UploadBytes(ctx, key, asset.Data, contentType); err != nil {
			return canvasTemplateAssetRef{}, false, err
		}
		ref := canvasTemplateAssetRef{Key: key, URL: "/api/v1/files/" + key}
		cache[cacheKey] = ref
		uploaded = append(uploaded, key)
		return ref, true, nil
	}

	var rewrite func(any) error
	rewrite = func(value any) error {
		switch typed := value.(type) {
		case []any:
			for _, item := range typed {
				if err := rewrite(item); err != nil {
					return err
				}
			}
		case map[string]any:
			var primary canvasTemplateAssetRef
			primaryFound := false
			for _, field := range []string{"storageKey", "content", "dataUrl", "url"} {
				source, _ := typed[field].(string)
				ref, found, err := resolve(source)
				if err != nil {
					return err
				}
				if !found {
					continue
				}
				primary, primaryFound = ref, true
				typed["storageKey"] = ref.Key
				if _, exists := typed["content"]; exists || field == "content" || field == "storageKey" {
					typed["content"] = ref.URL
				}
				if _, exists := typed["dataUrl"]; exists {
					typed["dataUrl"] = ref.URL
				}
				if _, exists := typed["url"]; exists {
					typed["url"] = ref.URL
				}
				break
			}
			thumbnailSource, _ := typed["thumbnailKey"].(string)
			if thumbnailSource == "" {
				thumbnailSource, _ = typed["thumbnailUrl"].(string)
			}
			if thumbnailSource != "" {
				thumbnail, found, err := resolve(thumbnailSource)
				if err != nil && !primaryFound {
					return err
				}
				if !found && primaryFound {
					thumbnail, found = primary, true
				}
				if found {
					typed["thumbnailKey"], typed["thumbnailUrl"] = thumbnail.Key, thumbnail.URL
				}
			}
			for key, child := range typed {
				if key == "storageKey" || key == "content" || key == "dataUrl" || key == "url" || key == "thumbnailKey" || key == "thumbnailUrl" {
					continue
				}
				if key == "references" {
					if references, ok := child.([]any); ok {
						for index, item := range references {
							source, _ := item.(string)
							ref, found, err := resolve(source)
							if err != nil {
								return err
							}
							if found {
								references[index] = ref.URL
							}
						}
					}
				}
				if err := rewrite(child); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := rewrite(document); err != nil {
		return nil, uploaded, err
	}
	result, err := json.Marshal(document)
	if err != nil {
		return nil, uploaded, err
	}
	if _, _, err := validateCanvasTemplateDocument(result); err != nil {
		return nil, uploaded, err
	}
	return result, uploaded, nil
}

func canvasTemplateAssetKeys(raw json.RawMessage) map[string]bool {
	keys := make(map[string]bool)
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return keys
	}
	var walk func(any)
	walk = func(current any) {
		switch typed := current.(type) {
		case []any:
			for _, item := range typed {
				walk(item)
			}
		case map[string]any:
			for _, item := range typed {
				if text, ok := item.(string); ok {
					if key := canvasTemplateStorageKey(text); strings.HasPrefix(key, "canvas-template-assets/") {
						keys[key] = true
					}
				}
				walk(item)
			}
		}
	}
	walk(value)
	return keys
}

func (s *Server) cleanupCanvasTemplateAssets(ctx context.Context, templateID uuid.UUID, keep map[string]bool) error {
	prefix := "canvas-template-assets/" + templateID.String() + "/"
	objects, err := s.Storage.ListObjects(ctx, prefix, canvasTemplateAssetMaxCount+1)
	if err != nil {
		return err
	}
	remove := make([]string, 0)
	for _, object := range objects {
		if !keep[object.Key] {
			remove = append(remove, object.Key)
		}
	}
	if len(remove) == 0 {
		return nil
	}
	return s.Storage.DeleteKeys(ctx, remove)
}

func canvasTemplateMultipartError(err error) error {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) || errors.Is(err, multipart.ErrMessageTooLarge) {
		return apperr.E("upload_too_large", "画布模板导出包不能超过 128 MiB", 413)
	}
	return err
}
