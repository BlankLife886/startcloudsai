package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Developer API model catalog statuses (docs/DEVELOPER_API_MODEL_CATALOG.md
// section 5): draft 404, live, maintenance 503, deprecated (callable with
// Sunset headers until sunset_at), retired 410.
const (
	DeveloperAPIModelDraft       = "draft"
	DeveloperAPIModelLive        = "live"
	DeveloperAPIModelMaintenance = "maintenance"
	DeveloperAPIModelDeprecated  = "deprecated"
	DeveloperAPIModelRetired     = "retired"

	DeveloperAPIPriceFollow = "follow"
	DeveloperAPIPriceFixed  = "fixed"
)

// DeveloperAPIModel is one /v1 model: a stable public name pointing at a
// site model. The public name is locked once PublishedAt is set.
type DeveloperAPIModel struct {
	ID             string     `json:"id"`
	APIName        string     `json:"apiName"`
	Aliases        []string   `json:"aliases"`
	Kind           string     `json:"kind"`
	TargetModelID  string     `json:"targetModelId"`
	Status         string     `json:"status"`
	PriceMode      string     `json:"priceMode"`
	PriceCents     *int64     `json:"priceCents"`
	MaxConcurrency int        `json:"maxConcurrency"`
	Description    string     `json:"description"`
	PublishedAt    *time.Time `json:"publishedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	// Lifecycle: a deprecated entry retires at SunsetAt; ReplacementID is the
	// model integrators are pointed to.
	SunsetAt      *time.Time `json:"sunsetAt"`
	DeprecatedAt  *time.Time `json:"deprecatedAt"`
	RetiredAt     *time.Time `json:"retiredAt"`
	ReplacementID *string    `json:"replacementId"`
	// Scheduled pricing: CommittedPriceCents is the price a following entry
	// charges while a site increase waits out its notice; PendingPriceCents
	// takes effect at PendingPriceAt.
	CommittedPriceCents *int64     `json:"committedPriceCents"`
	PendingPriceCents   *int64     `json:"pendingPriceCents"`
	PendingPriceAt      *time.Time `json:"pendingPriceAt"`
}

// StatusAt is the status in force at now: a deprecated entry past its
// sunset is retired even before the sweep records it, as is one paused for
// maintenance while deprecated.
func (m DeveloperAPIModel) StatusAt(now time.Time) string {
	if (m.Status == DeveloperAPIModelDeprecated || m.Status == DeveloperAPIModelMaintenance) && m.SunsetAt != nil && !now.Before(*m.SunsetAt) {
		return DeveloperAPIModelRetired
	}
	return m.Status
}

// CallableAt reports whether the catalog entry itself accepts calls. The
// target site model must still be available and routed to an OpenAI-wire
// provider.
func (m DeveloperAPIModel) CallableAt(now time.Time) bool {
	status := m.StatusAt(now)
	return status == DeveloperAPIModelLive || status == DeveloperAPIModelDeprecated
}

// InServiceAt reports whether integrators depend on the entry: live, under
// maintenance or deprecated. Price increases on these need notice.
func (m DeveloperAPIModel) InServiceAt(now time.Time) bool {
	return m.CallableAt(now) || m.StatusAt(now) == DeveloperAPIModelMaintenance
}

const developerAPIModelCols = `id,api_name,aliases,kind,target_model_id,status,price_mode,price_cents,
	max_concurrency,description,published_at,created_at,updated_at,sunset_at,deprecated_at,retired_at,
	replacement_id,committed_price_cents,pending_price_cents,pending_price_at`

func scanDeveloperAPIModel(row interface{ Scan(...any) error }) (*DeveloperAPIModel, error) {
	var m DeveloperAPIModel
	err := row.Scan(&m.ID, &m.APIName, &m.Aliases, &m.Kind, &m.TargetModelID, &m.Status, &m.PriceMode,
		&m.PriceCents, &m.MaxConcurrency, &m.Description, &m.PublishedAt, &m.CreatedAt, &m.UpdatedAt,
		&m.SunsetAt, &m.DeprecatedAt, &m.RetiredAt, &m.ReplacementID, &m.CommittedPriceCents, &m.PendingPriceCents, &m.PendingPriceAt)
	if m.Aliases == nil {
		m.Aliases = []string{}
	}
	return &m, err
}

func ListDeveloperAPIModels(ctx context.Context, q Q) ([]*DeveloperAPIModel, error) {
	rows, err := q.Query(ctx, `SELECT `+developerAPIModelCols+` FROM developer_api_models ORDER BY kind, lower(api_name)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []*DeveloperAPIModel{}
	for rows.Next() {
		item, err := scanDeveloperAPIModel(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func GetDeveloperAPIModel(ctx context.Context, q Q, id string) (*DeveloperAPIModel, error) {
	return nilOnNoRows(scanDeveloperAPIModel(q.QueryRow(ctx, `SELECT `+developerAPIModelCols+` FROM developer_api_models WHERE id=$1`, id)))
}

func CountDeveloperAPIModels(ctx context.Context, q Q) (int, error) {
	var count int
	err := q.QueryRow(ctx, `SELECT count(*) FROM developer_api_models`).Scan(&count)
	return count, err
}

func InsertDeveloperAPIModel(ctx context.Context, q Q, m *DeveloperAPIModel) (*DeveloperAPIModel, error) {
	if m.Aliases == nil {
		m.Aliases = []string{}
	}
	return scanDeveloperAPIModel(q.QueryRow(ctx, `INSERT INTO developer_api_models
		(id,api_name,aliases,kind,target_model_id,status,price_mode,price_cents,max_concurrency,description,published_at,
		 sunset_at,deprecated_at,retired_at,replacement_id,committed_price_cents,pending_price_cents,pending_price_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING `+developerAPIModelCols,
		m.ID, m.APIName, m.Aliases, m.Kind, m.TargetModelID, m.Status, m.PriceMode, m.PriceCents,
		m.MaxConcurrency, m.Description, m.PublishedAt, m.SunsetAt, m.DeprecatedAt, m.RetiredAt, m.ReplacementID,
		m.CommittedPriceCents, m.PendingPriceCents, m.PendingPriceAt))
}

// LockDeveloperAPIModels locks every catalog row for a lifecycle or pricing
// sweep, so admin edits and the sweep never interleave on one entry.
func LockDeveloperAPIModels(ctx context.Context, q Q) ([]*DeveloperAPIModel, error) {
	rows, err := q.Query(ctx, `SELECT `+developerAPIModelCols+` FROM developer_api_models ORDER BY id FOR UPDATE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []*DeveloperAPIModel{}
	for rows.Next() {
		item, err := scanDeveloperAPIModel(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// DeveloperAPIModelAudience is who hears about a change to an API model:
// users who called it in the last 30 days, plus owners of active Keys that
// name it explicitly.
func DeveloperAPIModelAudience(ctx context.Context, q Q, apiModelID string, now time.Time) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, `SELECT user_id FROM developer_api_billing_requests
			WHERE api_model_id=$1 AND created_at > $2::timestamptz - interval '30 days' AND user_id IS NOT NULL
		UNION
		SELECT user_id FROM user_api_keys WHERE status<>'revoked' AND $1 = ANY(allowed_api_model_ids)`, apiModelID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		users = append(users, id)
	}
	return users, rows.Err()
}

// UpdateDeveloperAPIModel saves the mutable fields. The name is only written
// while the entry is unpublished; callers enforce that rule before calling.
func UpdateDeveloperAPIModel(ctx context.Context, q Q, m *DeveloperAPIModel) (*DeveloperAPIModel, error) {
	if m.Aliases == nil {
		m.Aliases = []string{}
	}
	return nilOnNoRows(scanDeveloperAPIModel(q.QueryRow(ctx, `UPDATE developer_api_models SET
		api_name=$2,aliases=$3,target_model_id=$4,status=$5,price_mode=$6,price_cents=$7,
		max_concurrency=$8,description=$9,published_at=$10,sunset_at=$11,deprecated_at=$12,retired_at=$13,
		replacement_id=$14,committed_price_cents=$15,pending_price_cents=$16,pending_price_at=$17,updated_at=now()
		WHERE id=$1 RETURNING `+developerAPIModelCols,
		m.ID, m.APIName, m.Aliases, m.TargetModelID, m.Status, m.PriceMode, m.PriceCents,
		m.MaxConcurrency, m.Description, m.PublishedAt, m.SunsetAt, m.DeprecatedAt, m.RetiredAt, m.ReplacementID,
		m.CommittedPriceCents, m.PendingPriceCents, m.PendingPriceAt)))
}

func InsertDeveloperAPIModelEvent(ctx context.Context, q Q, apiModelID string, adminID any, action, reason string, before, after any) error {
	encode := func(value any) ([]byte, error) {
		if value == nil {
			return nil, nil
		}
		return json.Marshal(value)
	}
	beforeJSON, err := encode(before)
	if err != nil {
		return err
	}
	afterJSON, err := encode(after)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO developer_api_model_events (api_model_id,admin_id,action,reason,before,after)
		VALUES ($1,$2,$3,$4,$5,$6)`, apiModelID, adminID, action, reason, beforeJSON, afterJSON)
	return err
}

// DeveloperAPIModelUsage is what an admin sees before changing an API model.
type DeveloperAPIModelUsage struct {
	Keys         int64 `json:"keys"`             // active Keys that list it explicitly
	OnlyModel    int64 `json:"onlyModel"`        // of those, Keys that list only it
	Calls7d      int64 `json:"calls7d"`          // requests in the last 7 days
	Calls30d     int64 `json:"calls30d"`         // requests in the last 30 days
	Users30d     int64 `json:"users30d"`         // distinct callers in the last 30 days
	Revenue30d   int64 `json:"revenue30d"`       // points charged in the last 30 days
	OpenKeysNote int64 `json:"unrestrictedKeys"` // active Keys without an allowlist (may call any model)
	// Load on the target site model in the last hour, site versus every /v1
	// entry pointing at it: shows whether API traffic needs its own route.
	TargetSiteCalls1h int64 `json:"targetSiteCalls1h"`
	TargetAPICalls1h  int64 `json:"targetApiCalls1h"`
}

// DeveloperAPIModelUsages returns usage for every catalog entry by id.
func DeveloperAPIModelUsages(ctx context.Context, q Q, now time.Time) (map[string]DeveloperAPIModelUsage, error) {
	var unrestricted int64
	if err := q.QueryRow(ctx, `SELECT count(*) FROM user_api_keys WHERE status NOT IN ('revoked') AND cardinality(allowed_api_model_ids)=0`).Scan(&unrestricted); err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx, `SELECT m.id,
		(SELECT count(*) FROM user_api_keys k WHERE k.status<>'revoked' AND m.id = ANY(k.allowed_api_model_ids)),
		(SELECT count(*) FROM user_api_keys k WHERE k.status<>'revoked' AND k.allowed_api_model_ids = ARRAY[m.id]),
		(SELECT count(*) FROM developer_api_billing_requests r WHERE r.api_model_id=m.id AND r.created_at > $1::timestamptz - interval '7 days'),
		(SELECT count(*) FROM developer_api_billing_requests r WHERE r.api_model_id=m.id AND r.created_at > $1::timestamptz - interval '30 days'),
		(SELECT count(DISTINCT r.user_id) FROM developer_api_billing_requests r WHERE r.api_model_id=m.id AND r.created_at > $1::timestamptz - interval '30 days'),
		(SELECT COALESCE(sum(r.price_cents),0) FROM developer_api_billing_requests r WHERE r.api_model_id=m.id AND r.status='succeeded' AND r.created_at > $1::timestamptz - interval '30 days'),
		(SELECT count(*) FROM usage_profit_ledger l WHERE l.model_id=m.target_model_id AND l.source_type<>'developer_api' AND l.created_at > $1::timestamptz - interval '1 hour'),
		(SELECT count(*) FROM usage_profit_ledger l WHERE l.model_id=m.target_model_id AND l.source_type='developer_api' AND l.created_at > $1::timestamptz - interval '1 hour')
		FROM developer_api_models m`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usages := map[string]DeveloperAPIModelUsage{}
	for rows.Next() {
		var id string
		usage := DeveloperAPIModelUsage{OpenKeysNote: unrestricted}
		if err := rows.Scan(&id, &usage.Keys, &usage.OnlyModel, &usage.Calls7d, &usage.Calls30d, &usage.Users30d, &usage.Revenue30d,
			&usage.TargetSiteCalls1h, &usage.TargetAPICalls1h); err != nil {
			return nil, err
		}
		usages[id] = usage
	}
	return usages, rows.Err()
}
