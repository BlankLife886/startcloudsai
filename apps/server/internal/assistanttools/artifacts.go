package assistanttools

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	ToolFilesCreate       = "files_create"
	maxArtifactBytes      = 512 << 10
	maxArtifactNameRunes  = 120
	maxArtifactCSVRecords = 10000
)

type ArtifactStorage interface {
	UploadBytes(context.Context, string, []byte, string) error
	DeleteKeys(context.Context, []string) error
}

type artifactInput struct {
	Name    string `json:"name"`
	Format  string `json:"format"`
	Content string `json:"content"`
}

func NewArtifactManifest(st *store.Store, storage ArtifactStorage) Manifest {
	return Manifest{
		ID: "artifacts", Version: "1.1.0", Description: "Create safe downloadable documents",
		Tools: []Definition{{
			Name:        ToolFilesCreate,
			Description: "Create a downloadable TXT, Markdown, CSV, JSON, or PPTX file owned by the current user. For PPTX, content must be JSON with title, optional subtitle, and up to 40 concise slides containing a title and at most 8 short bullets. Use this only when the user asks for a file or export.",
			InputSchema: map[string]any{
				"type": "object", "additionalProperties": false,
				"properties": map[string]any{
					"name":   map[string]any{"type": "string", "minLength": 1, "maxLength": maxArtifactNameRunes, "description": "Download file name"},
					"format": map[string]any{"type": "string", "enum": []string{"txt", "md", "csv", "json", "pptx"}},
					"content": map[string]any{"type": "string", "minLength": 1, "maxLength": maxArtifactBytes,
						"description": `Complete file content. For pptx use JSON: {"title":"...","subtitle":"...","slides":[{"title":"...","bullets":["..."]}]}`},
				},
				"required": []string{"name", "format", "content"},
			},
			Permissions: []Permission{PermissionFilesWrite}, Risk: RiskWrite,
			Timeout: 90 * time.Second, MaxResultBytes: 8 << 10, Strict: true,
			Execute: artifactCreateExecutor(st, storage),
		}},
	}
}

func artifactCreateExecutor(st *store.Store, storage ArtifactStorage) Executor {
	return func(ctx context.Context, invocation Invocation) (Result, error) {
		if st == nil || storage == nil {
			return Result{}, errors.New("artifact storage is unavailable")
		}
		if invocation.UserID == uuid.Nil || invocation.RunID == uuid.Nil || invocation.AssistantMessageID == uuid.Nil {
			return Result{}, errors.New("artifact ownership context is incomplete")
		}
		var input artifactInput
		if err := decodeArguments(invocation.Arguments, &input); err != nil {
			return Result{}, err
		}
		name, contentType, data, err := prepareArtifact(input)
		if err != nil {
			return Result{}, err
		}
		artifact, err := persistArtifact(ctx, st, storage, invocation, name, contentType, data)
		if err != nil {
			return Result{}, err
		}
		result, err := jsonResult(map[string]any{"artifact": artifact})
		result.Meta = map[string]any{"artifact": artifact}
		return result, err
	}
}

func persistArtifact(
	ctx context.Context,
	st *store.Store,
	storage ArtifactStorage,
	invocation Invocation,
	name string,
	contentType string,
	data []byte,
) (map[string]any, error) {
	if st == nil || storage == nil {
		return nil, errors.New("artifact storage is unavailable")
	}
	if invocation.UserID == uuid.Nil || invocation.RunID == uuid.Nil || invocation.AssistantMessageID == uuid.Nil {
		return nil, errors.New("artifact ownership context is incomplete")
	}
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	if ext == "" || len(data) == 0 || strings.TrimSpace(contentType) == "" {
		return nil, errors.New("artifact data is incomplete")
	}
	sum := sha256.Sum256(append(append([]byte(name), 0), data...))
	artifactID := uuid.NewSHA1(invocation.RunID, sum[:])
	key := fmt.Sprintf("uploads/%s/original/%s.%s", invocation.UserID, artifactID, ext)
	if err := storage.UploadBytes(ctx, key, data, contentType); err != nil {
		return nil, fmt.Errorf("store generated file: %w", err)
	}
	artifact := map[string]any{
		"id": artifactID.String(), "name": name, "format": ext, "contentType": contentType,
		"sizeBytes": len(data), "downloadUrl": "/api/v1/files/" + key + "?download=1&name=" + url.QueryEscape(name),
	}
	if err := st.Tx(ctx, func(tx pgx.Tx) error {
		if err := store.RegisterUserUploadObjects(ctx, tx, invocation.UserID, []string{key}); err != nil {
			return err
		}
		if err := store.AddUserUploadReferences(ctx, tx, invocation.UserID,
			store.UploadReferenceAssistantMsg, invocation.AssistantMessageID, []string{key}); err != nil {
			return err
		}
		return store.AppendAssistantMessageArtifact(ctx, tx, invocation.AssistantMessageID, artifact)
	}); err != nil {
		cleanupArtifact(storage, key)
		return nil, err
	}
	return artifact, nil
}

func prepareArtifact(input artifactInput) (string, string, []byte, error) {
	format := strings.ToLower(strings.TrimSpace(input.Format))
	if format == "markdown" {
		format = "md"
	}
	contentTypes := map[string]string{
		"txt": "text/plain; charset=utf-8", "md": "text/markdown; charset=utf-8",
		"csv": "text/csv; charset=utf-8", "json": "application/json; charset=utf-8",
		"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	}
	contentType, ok := contentTypes[format]
	if !ok {
		return "", "", nil, errors.New("format must be txt, md, csv, json, or pptx")
	}
	if input.Content == "" || !utf8.ValidString(input.Content) || strings.ContainsRune(input.Content, 0) {
		return "", "", nil, errors.New("file content must be non-empty UTF-8 text without NUL bytes")
	}
	data := []byte(input.Content)
	if len(data) > maxArtifactBytes {
		return "", "", nil, fmt.Errorf("file content exceeds %d bytes", maxArtifactBytes)
	}
	if format == "json" && !json.Valid(data) {
		return "", "", nil, errors.New("JSON file content is invalid")
	}
	if format == "csv" {
		var err error
		data, err = safeCSV(data)
		if err != nil {
			return "", "", nil, err
		}
	}
	if format == "pptx" {
		built, err := buildPPTX(data)
		if err != nil {
			return "", "", nil, err
		}
		data = built
		if len(data) > maxArtifactBytes {
			return "", "", nil, fmt.Errorf("generated PPTX exceeds %d bytes", maxArtifactBytes)
		}
	}
	name := safeArtifactName(input.Name, format)
	return name, contentType, data, nil
}

func safeArtifactName(value, format string) string {
	value = filepath.Base(strings.ReplaceAll(strings.TrimSpace(value), "\\", "/"))
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, value)
	value = strings.Trim(value, " .")
	if value == "" {
		value = "assistant-output"
	}
	currentExt := strings.ToLower(filepath.Ext(value))
	if currentExt != "."+format {
		if currentExt != "" {
			value = strings.TrimSuffix(value, filepath.Ext(value))
		}
		value = strings.Trim(value, " .") + "." + format
	}
	runes := []rune(value)
	if len(runes) > maxArtifactNameRunes {
		ext := "." + format
		base := []rune(strings.TrimSuffix(value, filepath.Ext(value)))
		limit := maxArtifactNameRunes - len([]rune(ext))
		value = string(base[:min(len(base), max(1, limit))]) + ext
	}
	return value
}

func safeCSV(data []byte) ([]byte, error) {
	reader := csv.NewReader(bytes.NewReader(data))
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("CSV file content is invalid: %w", err)
	}
	if len(records) == 0 || len(records) > maxArtifactCSVRecords {
		return nil, errors.New("CSV file must contain between 1 and 10000 rows")
	}
	for row := range records {
		for column, cell := range records[row] {
			trimmed := strings.TrimLeft(cell, " \t\r\n")
			if trimmed != "" && strings.ContainsRune("=+-@", rune(trimmed[0])) {
				records[row][column] = "'" + cell
			}
		}
	}
	var out bytes.Buffer
	writer := csv.NewWriter(&out)
	if err := writer.WriteAll(records); err != nil {
		return nil, err
	}
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func cleanupArtifact(storage ArtifactStorage, key string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = storage.DeleteKeys(ctx, []string{key})
}
