package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
)

func (s *Server) readOpenAIImageBytes(ctx context.Context, key string, maxBytes int64) ([]byte, error) {
	data, err := s.readOwnedTaskImageBytes(ctx, key, maxBytes)
	if errors.Is(err, storage.ErrObjectTooLarge) {
		return nil, apperr.E("image_response_too_large", "Use response_format=url with the same Idempotency-Key to retrieve these images.", http.StatusRequestEntityTooLarge)
	}
	return data, err
}
