package httpapi

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/userassets"
)

// The assistant only proposes asset library changes; the card calls these
// after the user confirms, and offers the returned undo.

func assetActionError(err error) error {
	if errors.Is(err, userassets.ErrInvalid) {
		return apperr.E("validation_error", strings.TrimPrefix(err.Error(), userassets.ErrInvalid.Error()+": "), 422)
	}
	return err
}

func (s *Server) executeAssistantAssetAction(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body struct {
		Action userassets.Action `json:"action"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	undo, err := userassets.Execute(c.Request.Context(), s.St, user.ID, body.Action)
	if err != nil {
		fail(c, assetActionError(err))
		return
	}
	ok(c, gin.H{"undo": undo})
}

func (s *Server) undoAssistantAssetAction(c *gin.Context) {
	user, err := s.requireUser(c)
	if err != nil {
		fail(c, err)
		return
	}
	var body struct {
		Undo userassets.Undo `json:"undo"`
	}
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	if err := userassets.RevertUndo(c.Request.Context(), s.St, user.ID, body.Undo); err != nil {
		fail(c, assetActionError(err))
		return
	}
	ok(c, gin.H{"undone": true})
}
