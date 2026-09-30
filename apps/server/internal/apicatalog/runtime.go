package apicatalog

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

var (
	// ErrNotFound: no callable entry by that name for this Key (404).
	ErrNotFound = errors.New("model not found")
	// ErrUnavailable: the entry is under maintenance or its site model cannot
	// run now (503, safe to retry).
	ErrUnavailable = errors.New("model unavailable")
	// ErrRetired: the entry has been retired (410); Resolved carries it so the
	// caller can name the replacement.
	ErrRetired = errors.New("model retired")
)

// Public statuses reported on /v1/models and in the console.
const (
	PublicLive        = "live"
	PublicDeprecated  = "deprecated"
	PublicMaintenance = "maintenance"
	PublicRetired     = "retired"
)

// Resolved is a catalog entry with the site model that executes it.
type Resolved struct {
	Entry     *store.DeveloperAPIModel
	Selection modelconfig.Selection
}

// Listing is an entry as integrators see it: PublicStatus is maintenance
// when the entry is paused or its site model cannot run.
type Listing struct {
	Resolved
	PublicStatus string
	Runnable     bool
}

func allows(allowed []string, id string) bool {
	return len(allowed) == 0 || store.Contains(allowed, id)
}

// Offered lists the entries a Key may call right now (callable, allowed,
// and runnable).
func Offered(entries []*store.DeveloperAPIModel, cfg modelconfig.Config, allowed []string, now time.Time) []Resolved {
	result := []Resolved{}
	for _, listing := range Listed(entries, cfg, allowed, now) {
		if listing.PublicStatus == PublicLive || listing.PublicStatus == PublicDeprecated {
			result = append(result, listing.Resolved)
		}
	}
	return result
}

// Listed is what /v1/models shows a Key: live, deprecated and maintenance
// entries it may use. Drafts and retired entries are left out.
func Listed(entries []*store.DeveloperAPIModel, cfg modelconfig.Config, allowed []string, now time.Time) []Listing {
	result := []Listing{}
	for _, entry := range entries {
		if !entry.InServiceAt(now) || !allows(allowed, entry.ID) {
			continue
		}
		result = append(result, list(entry, cfg, now))
	}
	return result
}

// Visible is the console's model page: everything but drafts, with retired
// entries dropped RetiredHiddenAfter their retirement.
func Visible(entries []*store.DeveloperAPIModel, cfg modelconfig.Config, now time.Time) []Listing {
	result := []Listing{}
	for _, entry := range entries {
		status := entry.StatusAt(now)
		if status == store.DeveloperAPIModelDraft {
			continue
		}
		if status == store.DeveloperAPIModelRetired {
			if retired := RetiredAt(entry); retired != nil && now.Sub(*retired) > RetiredHiddenAfter {
				continue
			}
		}
		result = append(result, list(entry, cfg, now))
	}
	return result
}

// RetiredAt is when an entry retired, including a lazily retired one.
func RetiredAt(entry *store.DeveloperAPIModel) *time.Time {
	if entry.RetiredAt != nil {
		return entry.RetiredAt
	}
	return entry.SunsetAt
}

func list(entry *store.DeveloperAPIModel, cfg modelconfig.Config, now time.Time) Listing {
	selection, runnable := Runnable(cfg, entry.TargetModelID)
	if !runnable {
		selection = modelconfig.Selection{Model: siteModel(cfg, entry.TargetModelID)}
	}
	status := entry.StatusAt(now)
	public := PublicLive
	switch {
	case status == store.DeveloperAPIModelRetired:
		public = PublicRetired
	case status == store.DeveloperAPIModelMaintenance || !runnable:
		public = PublicMaintenance
	case status == store.DeveloperAPIModelDeprecated:
		public = PublicDeprecated
	}
	return Listing{Resolved: Resolved{Entry: entry, Selection: selection}, PublicStatus: public, Runnable: runnable}
}

func siteModel(cfg modelconfig.Config, id string) modelconfig.Model {
	for _, model := range cfg.Models {
		if model.ID == id {
			return model
		}
	}
	return modelconfig.Model{}
}

// Match finds the entry a /v1 request names, by public name or alias. A name
// the Key may not use, or a draft, reads as not found; an entry under
// maintenance or whose site model is down reads as unavailable, so callers
// can retry later; a retired entry reads as retired. Live names win over a
// retired entry that shares an alias.
func Match(entries []*store.DeveloperAPIModel, cfg modelconfig.Config, allowed []string, kind, requested string, now time.Time) (*Resolved, error) {
	want := NormalizeName(requested)
	if want == "" {
		return nil, ErrNotFound
	}
	var retired *store.DeveloperAPIModel
	for _, entry := range entries {
		if entry.Kind != kind || !allows(allowed, entry.ID) || !nameMatches(entry, want) {
			continue
		}
		switch entry.StatusAt(now) {
		case store.DeveloperAPIModelDraft:
			continue
		case store.DeveloperAPIModelRetired:
			if retired == nil {
				retired = entry
			}
			continue
		case store.DeveloperAPIModelMaintenance:
			return &Resolved{Entry: entry}, ErrUnavailable
		}
		selection, ok := Runnable(cfg, entry.TargetModelID)
		if !ok {
			return &Resolved{Entry: entry}, ErrUnavailable
		}
		return &Resolved{Entry: entry, Selection: selection}, nil
	}
	if retired != nil {
		return &Resolved{Entry: retired}, ErrRetired
	}
	return nil, ErrNotFound
}

func nameMatches(entry *store.DeveloperAPIModel, want string) bool {
	if NormalizeName(entry.APIName) == want {
		return true
	}
	for _, alias := range entry.Aliases {
		if NormalizeName(alias) == want {
			return true
		}
	}
	return false
}

// WorkspaceFor is the site workspace whose price a following entry uses:
// text-to-image for images, the AI assistant for chat (today's /v1 prices).
func WorkspaceFor(kind string) string {
	if kind == "chat" {
		return modelconfig.WorkspaceAssistant
	}
	return modelconfig.WorkspaceT2I
}

// SitePrice is the site price a following entry tracks, including a site
// discount.
func SitePrice(cfg modelconfig.Config, entry *store.DeveloperAPIModel, model modelconfig.Model) int64 {
	return modelconfig.ResolveWorkspacePrice(cfg, WorkspaceFor(entry.Kind), model).EffectiveCents
}

// UnitPrice is the per-call price in points at now (see EffectivePrice).
func UnitPrice(cfg modelconfig.Config, resolved Resolved, now time.Time) int64 {
	return EffectivePrice(resolved.Entry, SitePrice(cfg, resolved.Entry, resolved.Selection.Model), now)
}

// ContractLockActive reports whether subscription price locks still apply
// to /v1 image calls (the grace period recorded by the migration).
func ContractLockActive(ctx context.Context, q store.Q, now time.Time) (bool, error) {
	raw, err := store.GetAppSetting(ctx, q, ContractLockSettingKey)
	if err != nil || len(raw) == 0 {
		return false, err
	}
	var until time.Time
	if err := json.Unmarshal(raw, &until); err != nil {
		return false, nil
	}
	return now.Before(until), nil
}

// BackfillSchemaVersion is the last migration before the legacy Key
// allowlist column is dropped (00174). Callers migrate up to it, run
// EnsureInitialized, then migrate the rest, so the backfill can still read
// the legacy column on a database that has never had a catalog.
const BackfillSchemaVersion int64 = 173

// EnsureInitialized builds the catalog on the first start after the schema
// migration, so /v1 never runs with an empty catalog. It is a no-op once the
// catalog has entries. The report goes to the log for review.
func EnsureInitialized(ctx context.Context, pool *pgxpool.Pool) error {
	count, err := store.CountDeveloperAPIModels(ctx, pool)
	if err != nil || count > 0 {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Instances starting together (blue/green) initialize one at a time; the
	// second sees the catalog and stops.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('developer_api_models_init'))`); err != nil {
		return err
	}
	if count, err := store.CountDeveloperAPIModels(ctx, tx); err != nil || count > 0 {
		return err
	}
	in, err := LoadMigrationInput(ctx, tx)
	if err != nil {
		return err
	}
	now := time.Now()
	cfg := in.Config
	plan := BuildPlan(in, now)
	if len(plan.Entries) == 0 {
		return nil
	}
	if err := Apply(ctx, tx, cfg, plan, now); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	log.Printf("developer API model catalog initialized:\n%s", plan.Report(cfg))
	return nil
}
