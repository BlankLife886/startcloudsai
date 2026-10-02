package httpapi

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantmemory"
)

// The memory panel in the assistant lists, edits and deletes what the
// assistant remembers; the change cards in replies use the same endpoints
// for their undo.

func memoryError(err error) error {
	switch {
	case errors.Is(err, assistantmemory.ErrInvalid):
		return apperr.E("validation_error", strings.TrimPrefix(err.Error(), assistantmemory.ErrInvalid.Error()+": "), 422)
	case errors.Is(err, assistantmemory.ErrNotFound):
		return apperr.E("not_found", "这条记忆不存在", 404)
	}
	return err
}

func (s *Server) listAssistantMemories(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	enabled, err := assistantmemory.Enabled(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	items, err := assistantmemory.List(ctx, s.St.Pool, user.ID)
	if err != nil {
		fail(c, err)
		return
	}
	kinds := make([]gin.H, 0, len(assistantmemory.Kinds))
	for _, kind := range assistantmemory.Kinds {
		kinds = append(kinds, gin.H{"id": kind, "label": assistantmemory.KindLabels[kind]})
	}
	ok(c, gin.H{"enabled": enabled, "items": items, "kinds": kinds, "limit": assistantmemory.MaxPerUser})
}

func (s *Server) createAssistantMemory(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body struct {
		assistantmemory.Input
		// CommerceSetID keeps a finished commerce set as a favourite.
		CommerceSetID string `json:"commerceSetId"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	in := body.Input
	origin := assistantmemory.Origin{Source: assistantmemory.SourceUser}
	if body.CommerceSetID != "" {
		setID, err := uuid.Parse(body.CommerceSetID)
		if err != nil {
			fail(c, memoryError(assistantmemory.ErrNotFound))
			return
		}
		favorite, err := assistantmemory.FavoriteFromSet(ctx, s.St.Pool, user.ID, setID)
		if err != nil {
			fail(c, memoryError(err))
			return
		}
		if strings.TrimSpace(in.Title) != "" {
			favorite.Title = in.Title
		}
		in, origin.CommerceSetID = favorite, &setID
	}
	change, err := assistantmemory.Remember(ctx, s.St, user.ID, in, origin)
	if err != nil {
		fail(c, memoryError(err))
		return
	}
	ok(c, change)
}

func (s *Server) updateAssistantMemory(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, memoryError(assistantmemory.ErrNotFound))
		return
	}
	var patch assistantmemory.Patch
	if err := bindJSON(c, &patch); err != nil {
		fail(c, err)
		return
	}
	change, err := assistantmemory.Update(c.Request.Context(), s.St, user.ID, id, patch)
	if err != nil {
		fail(c, memoryError(err))
		return
	}
	ok(c, change)
}

func (s *Server) deleteAssistantMemory(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, memoryError(assistantmemory.ErrNotFound))
		return
	}
	change, err := assistantmemory.Forget(c.Request.Context(), s.St.Pool, user.ID, id)
	if err != nil {
		fail(c, memoryError(err))
		return
	}
	ok(c, change)
}

func (s *Server) updateAssistantMemorySettings(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if body.Enabled == nil {
		fail(c, apperr.E("validation_error", "缺少 enabled", 422))
		return
	}
	if err := assistantmemory.SetEnabled(c.Request.Context(), s.St.Pool, user.ID, *body.Enabled); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"enabled": *body.Enabled})
}
