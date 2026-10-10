package httpapi

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apicatalog"
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
)

// openAIImageWaitTimeout bounds how long one /v1 image request waits for the
// upstream; clients and proxies should allow at least 270 seconds.
const openAIImageWaitTimeout = 240 * time.Second

type openAIModelObject struct {
	ID          string  `json:"id"`
	Object      string  `json:"object"`
	Created     int64   `json:"created"`
	OwnedBy     string  `json:"owned_by"`
	Status      string  `json:"status,omitempty"`
	SunsetAt    *string `json:"sunset_at,omitempty"`
	Replacement string  `json:"replacement,omitempty"`
}

func openAIPublicModelID(model modelconfig.Model) string {
	// Wire id is the admin-configured display name so OpenAI clients can pass
	// model="gpt-image-2" instead of an internal UUID. Names are expected to be
	// unique among developer-API image models.
	return strings.TrimSpace(model.Name)
}

func (s *Server) openAIModels(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	entries, err := s.developerCatalog(c.Request.Context())
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	items := make([]openAIModelObject, 0)
	for _, listing := range apicatalog.Listed(entries, cfg, keyAllowlist(openAPIKeyFromContext(c)), time.Now()) {
		items = append(items, asCatalogModel(entries, listing))
	}
	c.JSON(http.StatusOK, gin.H{"object": "list", "data": items})
}

func (s *Server) openAIModel(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	entries, err := s.developerCatalog(c.Request.Context())
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	// Retrieval shows any model the Key may use that is still in service,
	// including one under maintenance, like the list does.
	want := apicatalog.NormalizeName(c.Param("model"))
	for _, listing := range apicatalog.Listed(entries, cfg, keyAllowlist(openAPIKeyFromContext(c)), time.Now()) {
		if apicatalog.NormalizeName(listing.Entry.APIName) == want || slices.ContainsFunc(listing.Entry.Aliases, func(alias string) bool { return apicatalog.NormalizeName(alias) == want }) {
			c.JSON(http.StatusOK, asCatalogModel(entries, listing))
			return
		}
	}
	for _, kind := range []string{"image", "chat"} {
		if _, err := apicatalog.Match(entries, cfg, keyAllowlist(openAPIKeyFromContext(c)), kind, c.Param("model"), time.Now()); errors.Is(err, apicatalog.ErrRetired) {
			_, retiredErr := resolveDeveloperModel(nil, entries, cfg, openAPIKeyFromContext(c), kind, c.Param("model"))
			failOpenAI(c, retiredErr, "model")
			return
		}
	}
	failOpenAI(c, modelNotFoundError(c.Param("model")), "model")
}

func failOpenAIImage(c *gin.Context, err error) {
	var parameter *openAIParameterError
	if errors.As(err, &parameter) {
		failOpenAI(c, apperr.E(parameter.Code, parameter.Message, http.StatusBadRequest), parameter.Param)
		return
	}
	failOpenAI(c, err, "")
}

func (s *Server) openAIGenerateImage(c *gin.Context) { s.openAIImage(c, false) }
func (s *Server) openAIEditImage(c *gin.Context)     { s.openAIImage(c, true) }

type openAIImageData struct {
	B64JSON string `json:"b64_json,omitempty"`
	URL     string `json:"url,omitempty"`
}

type openAIImageResponse struct {
	Created int64             `json:"created"`
	Data    []openAIImageData `json:"data"`
}
