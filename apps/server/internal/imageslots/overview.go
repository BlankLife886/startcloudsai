package imageslots

import (
	"context"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// MemberView is one slot member as the admin status panel shows it.
type MemberView struct {
	ModelID string `json:"modelId"`
	Name    string `json:"name"`
	// Order is 0 for the primary, 1.. for backups.
	Order               int        `json:"order"`
	Active              bool       `json:"active"`
	Status              string     `json:"status"`
	ConsecutiveFailures int        `json:"consecutiveFailures"`
	LastFailureAt       *time.Time `json:"lastFailureAt"`
	LastFailureMessage  string     `json:"lastFailureMessage"`
	LastSuccessAt       *time.Time `json:"lastSuccessAt"`
	DownSince           *time.Time `json:"downSince"`
	LastProbeAt         *time.Time `json:"lastProbeAt"`
	LastProbeOK         *bool      `json:"lastProbeOk"`
	LastProbeMessage    string     `json:"lastProbeMessage"`
	NextProbeAt         *time.Time `json:"nextProbeAt"`
}

// SlotView is one public model resolution slot.
type SlotView struct {
	ModelID      string       `json:"modelId"`
	ModelName    string       `json:"modelName"`
	Resolution   string       `json:"resolution"`
	AutoFailover bool         `json:"autoFailover"`
	Active       string       `json:"activeModelId"`
	OnBackup     bool         `json:"onBackup"`
	Unavailable  bool         `json:"unavailable"`
	SwitchedAt   *time.Time   `json:"switchedAt"`
	Members      []MemberView `json:"members"`
}

// Overview is the whole admin status panel.
type Overview struct {
	Settings       Settings               `json:"settings"`
	ProbesUsed24h  int64                  `json:"probesUsed24h"`
	Slots          []SlotView             `json:"slots"`
	Events         []store.ImageSlotEvent `json:"events"`
	ModelNames     map[string]string      `json:"modelNames"`
	GeneratedAtUTC time.Time              `json:"generatedAt"`
}

func BuildOverview(ctx context.Context, q store.Q, cfg modelconfig.Config, now time.Time) (Overview, error) {
	out := Overview{Settings: LoadSettings(ctx, q), Slots: []SlotView{}, ModelNames: map[string]string{}, GeneratedAtUTC: now}
	var err error
	if out.ProbesUsed24h, err = store.CountImageSlotProbesSince(ctx, q, now.Add(-24*time.Hour)); err != nil {
		return out, err
	}
	snap, err := load(ctx, q)
	if err != nil {
		return out, err
	}
	for _, model := range cfg.Models {
		out.ModelNames[model.ID] = model.Name
	}
	for _, ref := range configuredSlots(cfg) {
		plan := snap.decide(ref.Owner.ID, ref.Resolution, ref.Slot)
		view := SlotView{
			ModelID: ref.Owner.ID, ModelName: ref.Owner.Name, Resolution: ref.Resolution,
			AutoFailover: ref.Slot.AutoFailover, Active: plan.Active, Unavailable: plan.Unavailable,
			OnBackup: plan.Active != ref.Slot.PrimaryModelID, Members: []MemberView{},
		}
		if state, ok := snap.states[store.ImageSlotKey{ModelID: ref.Owner.ID, Resolution: ref.Resolution}]; ok {
			view.SwitchedAt = state.SwitchedAt
		}
		for order, memberID := range ref.Slot.Chain() {
			member := MemberView{ModelID: memberID, Name: modelName(cfg, memberID), Order: order, Active: memberID == plan.Active, Status: store.ImageSlotMemberHealthy}
			if h, ok := snap.health[store.ImageSlotKey{ModelID: memberID, Resolution: ref.Resolution}]; ok {
				member.Status, member.ConsecutiveFailures = h.Status, h.ConsecutiveFailures
				member.LastFailureAt, member.LastFailureMessage = h.LastFailureAt, h.LastFailureMessage
				member.LastSuccessAt, member.DownSince = h.LastSuccessAt, h.DownSince
				member.LastProbeAt, member.LastProbeOK, member.LastProbeMessage = h.LastProbeAt, h.LastProbeOK, h.LastProbeMessage
				if h.Down() {
					last := h.DownSince
					if h.LastProbeAt != nil && (last == nil || h.LastProbeAt.After(*last)) {
						last = h.LastProbeAt
					}
					if last != nil {
						next := last.Add(out.Settings.ProbeInterval())
						member.NextProbeAt = &next
					}
				}
			}
			view.Members = append(view.Members, member)
		}
		out.Slots = append(out.Slots, view)
	}
	if out.Events, err = store.ListImageSlotEvents(ctx, q, 200); err != nil {
		return out, err
	}
	return out, nil
}
