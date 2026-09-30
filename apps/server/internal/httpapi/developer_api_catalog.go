package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apicatalog"
	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/trialfeature"
)

// /v1 resolves models through the developer API catalog
// (docs/DEVELOPER_API_MODEL_CATALOG.md): a stable public name points at a
// site model, so renaming, re-routing or un-binding site models from site
// workspaces no longer changes what integrators can call.

func (s *Server) developerCatalog(ctx context.Context) ([]*store.DeveloperAPIModel, error) {
	return store.ListDeveloperAPIModels(ctx, s.St.Pool)
}

func keyAllowlist(key *store.UserAPIKey) []string {
	if key == nil {
		return nil
	}
	return key.AllowedAPIModelIDs
}

// resolveDeveloperModel maps a request's model name to a catalog entry the
// Key may call. Unknown or disallowed names are 404 model_not_found; an entry
// under maintenance or whose site model is down is 503 model_unavailable
// (safe to retry, see failOpenAI); a retired entry is 410 model_retired and
// names its replacement. A deprecated entry answers normally with
// Deprecation, Sunset and Link headers.
func resolveDeveloperModel(c *gin.Context, entries []*store.DeveloperAPIModel, cfg modelconfig.Config, key *store.UserAPIKey, kind, requested string) (*apicatalog.Resolved, error) {
	now := time.Now()
	resolved, err := apicatalog.Match(entries, cfg, keyAllowlist(key), kind, requested, now)
	name := strings.TrimSpace(requested)
	switch {
	case errors.Is(err, apicatalog.ErrUnavailable):
		return nil, apperr.E("model_unavailable", fmt.Sprintf("模型 %q 暂时不可用，请稍后重试；本次不扣费", name), http.StatusServiceUnavailable)
	case errors.Is(err, apicatalog.ErrRetired):
		message := fmt.Sprintf("模型 %q 已下线", name)
		if replacement := replacementName(entries, resolved.Entry); replacement != "" {
			message += fmt.Sprintf("，请改用 %q", replacement)
		}
		return nil, apperr.E("model_retired", message, http.StatusGone)
	case err != nil:
		return nil, modelNotFoundError(requested)
	}
	setDeprecationHeaders(c, entries, resolved.Entry, now)
	return resolved, nil
}

func replacementName(entries []*store.DeveloperAPIModel, entry *store.DeveloperAPIModel) string {
	if entry == nil || entry.ReplacementID == nil {
		return ""
	}
	for _, candidate := range entries {
		if candidate.ID == *entry.ReplacementID {
			return candidate.APIName
		}
	}
	return ""
}

// setDeprecationHeaders marks a deprecated model's responses: Deprecation
// (RFC 9745), Sunset (RFC 8594) and a successor-version Link to the
// replacement's /v1/models entry.
func setDeprecationHeaders(c *gin.Context, entries []*store.DeveloperAPIModel, entry *store.DeveloperAPIModel, now time.Time) {
	if c == nil || entry.StatusAt(now) != store.DeveloperAPIModelDeprecated || entry.SunsetAt == nil {
		return
	}
	deprecated := entry.SunsetAt
	if entry.DeprecatedAt != nil {
		deprecated = entry.DeprecatedAt
	}
	c.Header("Deprecation", fmt.Sprintf("@%d", deprecated.Unix()))
	c.Header("Sunset", entry.SunsetAt.UTC().Format(http.TimeFormat))
	if replacement := replacementName(entries, entry); replacement != "" {
		c.Header("Link", fmt.Sprintf(`</v1/models/%s>; rel="successor-version"`, url.PathEscape(replacement)))
	}
}

// developerFeature is the feature key /v1 charges under. It is not a trial
// feature, so trial credits never pay for API calls.
func developerFeature(kind string) trialfeature.Feature {
	return trialfeature.Feature{Key: apicatalog.FeatureFor(kind)}
}

// developerModelItems is the console view of the catalog: every entry but
// drafts, retired ones for RetiredHiddenAfter. `id` is the catalog id a Key's
// allowlist stores; `model` is the exact value /v1 takes; `status` is the
// public status (maintenance also when the site model cannot run).
func developerModelItems(entries []*store.DeveloperAPIModel, cfg modelconfig.Config) []gin.H {
	now := time.Now()
	listed := apicatalog.Visible(entries, cfg, now)
	items := make([]gin.H, 0, len(listed))
	for _, listing := range listed {
		entry, model := listing.Entry, listing.Selection.Model
		var price, pending any
		if model.ID != "" {
			price = apicatalog.UnitPrice(cfg, listing.Resolved, now)
		}
		if next, at, ok := apicatalog.UpcomingPrice(entry, now); ok {
			pending = gin.H{"priceCents": next, "effectiveAt": isoValue(at)}
		}
		var replacement any
		if name := replacementName(entries, entry); name != "" {
			replacement = gin.H{"id": *entry.ReplacementID, "model": name}
		}
		items = append(items, gin.H{
			"id": entry.ID, "model": entry.APIName, "name": model.Name, "kind": entry.Kind,
			"status": listing.PublicStatus, "priceCents": price, "pendingPrice": pending,
			"sunsetAt": iso(entry.SunsetAt), "retiredAt": iso(apicatalog.RetiredAt(entryIfRetired(entry, now))), "replacement": replacement,
			"maxImages": model.GenerationMaxImages(), "maxReferenceImages": model.MaxReferenceImages, "resolutions": model.Resolutions,
		})
	}
	return items
}

// normalizeAPIModelIDs validates a Key allowlist against catalog entries in
// service (live, deprecated or under maintenance) and returns it with the
// matching site model ids, which are still written to the legacy column
// during the compatibility window.
func normalizeAPIModelIDs(entries []*store.DeveloperAPIModel, values []string) ([]string, []string, error) {
	byID := map[string]*store.DeveloperAPIModel{}
	now := time.Now()
	for _, entry := range entries {
		if entry.InServiceAt(now) {
			byID[entry.ID] = entry
		}
	}
	seen := map[string]bool{}
	apiIDs, targets := make([]string, 0, len(values)), make([]string, 0, len(values))
	for _, raw := range values {
		id := strings.TrimSpace(raw)
		if id == "" || seen[id] {
			continue
		}
		entry := byID[id]
		if entry == nil {
			return nil, nil, apperr.E("validation_error", "allowedModelIds: 包含未开放或不存在的模型", 422)
		}
		seen[id] = true
		apiIDs = append(apiIDs, id)
		if !store.Contains(targets, entry.TargetModelID) {
			targets = append(targets, entry.TargetModelID)
		}
	}
	return apiIDs, targets, nil
}

// asCatalogModel is a /v1/models entry. status, sunset_at and replacement
// are extensions OpenAI SDKs ignore.
func asCatalogModel(entries []*store.DeveloperAPIModel, listing apicatalog.Listing) openAIModelObject {
	// The catalog has no model-created timestamp; zero explicitly denotes unknown.
	object := openAIModelObject{ID: listing.Entry.APIName, Object: "model", Created: 0, OwnedBy: "starcloudsai", Status: listing.PublicStatus}
	if listing.PublicStatus == apicatalog.PublicDeprecated && listing.Entry.SunsetAt != nil {
		sunset := listing.Entry.SunsetAt.UTC().Format(time.RFC3339)
		object.SunsetAt = &sunset
	}
	object.Replacement = replacementName(entries, listing.Entry)
	return object
}
