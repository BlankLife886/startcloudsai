package httpapi

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const maxSavedImageKeys = 60

// listAssistantSavedImages marks generated images that are already in the
// asset library, so the conversation can show "已存入素材库" on them.
// GET /assistant/saved-images?keys=a,b,c
func (s *Server) listAssistantSavedImages(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	seen := map[string]bool{}
	keys := []string{}
	for _, key := range strings.Split(c.Query("keys"), ",") {
		key = strings.TrimSpace(key)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		keys = append(keys, key)
	}
	if len(keys) > maxSavedImageKeys {
		fail(c, apperr.E("validation_error", "keys: 一次最多查询 60 张", 422))
		return
	}
	items, err := store.ListSavedAssistantImages(c.Request.Context(), s.St.Pool, user.ID, keys)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": items})
}
