package httpapi

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const maxUserBehaviorEventsPerBatch = 50

var allowedUserBehaviorEvents = map[string]bool{
	"feature_open": true, "reference_upload_started": true, "reference_upload_completed": true,
	"reference_upload_failed": true, "form_started": true, "form_abandoned": true,
	"template_open": true, "template_used": true,
}

var allowedUserBehaviorFeatures = map[string]bool{
	"home": true, "text_to_image": true, "assistant": true, "canvas": true, "ecommerce": true,
	"coloring": true, "design_workshop": true, "model_sheet": true, "game_art": true,
	"background_remove": true, "media_tools": true, "assets": true, "history": true,
	"prompt_library": true, "other": true,
}

var allowedUserBehaviorMetadata = map[string]bool{
	"entryPoint": true, "uploadKind": true, "itemCount": true, "source": true,
	"errorType": true, "batch": true,
}

var behaviorMetadataToken = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{1,64}$`)

type userBehaviorEventIn struct {
	ClientEventID string         `json:"clientEventId"`
	EventName     string         `json:"eventName"`
	Feature       string         `json:"feature"`
	Metadata      map[string]any `json:"metadata"`
}

type userBehaviorBatchIn struct {
	Events []userBehaviorEventIn `json:"events"`
}

func sanitizeUserBehaviorEvent(input userBehaviorEventIn) (store.UserBehaviorEventInput, error) {
	id, err := uuid.Parse(strings.TrimSpace(input.ClientEventID))
	if err != nil {
		return store.UserBehaviorEventInput{}, apperr.E("validation_error", "clientEventId: 无效的事件编号", 422)
	}
	eventName := strings.TrimSpace(input.EventName)
	feature := strings.TrimSpace(input.Feature)
	if !allowedUserBehaviorEvents[eventName] {
		return store.UserBehaviorEventInput{}, apperr.E("validation_error", "eventName: 不支持的行为事件", 422)
	}
	if !allowedUserBehaviorFeatures[feature] {
		return store.UserBehaviorEventInput{}, apperr.E("validation_error", "feature: 不支持的业务类型", 422)
	}
	metadata := make(map[string]any, len(input.Metadata))
	for key, value := range input.Metadata {
		if !allowedUserBehaviorMetadata[key] {
			return store.UserBehaviorEventInput{}, apperr.E("validation_error", fmt.Sprintf("metadata.%s: 不允许记录该字段", key), 422)
		}
		switch typed := value.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			if utf8.RuneCountInString(trimmed) > 64 || (trimmed != "" && !behaviorMetadataToken.MatchString(trimmed)) {
				return store.UserBehaviorEventInput{}, apperr.E("validation_error", fmt.Sprintf("metadata.%s: 仅支持简短标识", key), 422)
			}
			metadata[key] = trimmed
		case bool:
			metadata[key] = typed
		case float64:
			if math.Trunc(typed) != typed || typed < 0 || typed > 1000 {
				return store.UserBehaviorEventInput{}, apperr.E("validation_error", fmt.Sprintf("metadata.%s: 数值超出范围", key), 422)
			}
			metadata[key] = int(typed)
		default:
			return store.UserBehaviorEventInput{}, apperr.E("validation_error", fmt.Sprintf("metadata.%s: 仅支持标识、整数或布尔值", key), 422)
		}
	}
	return store.UserBehaviorEventInput{ClientEventID: id, EventName: eventName, Feature: feature, Metadata: metadata}, nil
}

func (s *Server) recordMyBehaviorEvents(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body userBehaviorBatchIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if len(body.Events) == 0 || len(body.Events) > maxUserBehaviorEventsPerBatch {
		fail(c, apperr.E("validation_error", "events: 每批须包含 1-50 条事件", 422))
		return
	}
	events := make([]store.UserBehaviorEventInput, 0, len(body.Events))
	for _, raw := range body.Events {
		event, err := sanitizeUserBehaviorEvent(raw)
		if err != nil {
			fail(c, err)
			return
		}
		events = append(events, event)
	}
	var accepted int64
	err = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		var insertErr error
		accepted, insertErr = store.InsertUserBehaviorEvents(c.Request.Context(), tx, user.ID, events)
		return insertErr
	})
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"accepted": accepted})
}
