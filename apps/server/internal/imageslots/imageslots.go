// Package imageslots runs the per-resolution primary/backup routing of public
// image models: which member a new task uses, when a failing member is taken
// out, when the slot switches back, and the admin alerts for both.
//
// The slot layout is configuration (modelconfig.ResolutionSlot); this package
// owns the runtime part: member health, the active member and the history.
package imageslots

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	DefaultFailureThreshold = 3
	DefaultProbeInterval    = time.Hour
	DefaultProbeDailyLimit  = 48

	incidentPrefix = "image_slot:"
	eventRetention = 30 * 24 * time.Hour
)

// Settings are the admin-tunable thresholds.
type Settings struct {
	FailureThreshold int `json:"failureThreshold"`
	ProbeIntervalMin int `json:"probeIntervalMinutes"`
	ProbeDailyLimit  int `json:"probeDailyLimit"`
}

func (s Settings) ProbeInterval() time.Duration {
	return time.Duration(s.ProbeIntervalMin) * time.Minute
}

// Setting bounds, shared by the admin API and LoadSettings.
const (
	MaxFailureThreshold = 20
	MinProbeIntervalMin = 5
	MaxProbeIntervalMin = 24 * 60
	MaxProbeDailyLimit  = 1000
)

func LoadSettings(ctx context.Context, q store.Q) Settings {
	read := func(key string, fallback, low, high int) int {
		value, err := settings.GetInt(ctx, q, key)
		if err != nil || value < int64(low) || value > int64(high) {
			return fallback
		}
		return int(value)
	}
	return Settings{
		FailureThreshold: read("image_slot_failure_threshold", DefaultFailureThreshold, 1, MaxFailureThreshold),
		ProbeIntervalMin: read("image_slot_probe_interval_minutes", int(DefaultProbeInterval/time.Minute), MinProbeIntervalMin, MaxProbeIntervalMin),
		ProbeDailyLimit:  read("image_slot_probe_daily_limit", DefaultProbeDailyLimit, 0, MaxProbeDailyLimit),
	}
}

// Plan is how a new task on a slot runs.
type Plan struct {
	// Configured is false when the resolution has no slot: the task keeps
	// the model's own routes.
	Configured bool
	// Candidates are the member model IDs the task may use, in order.
	Candidates []string
	Active     string
	// Unavailable: every member is down (auto) or the chosen one is (manual).
	Unavailable bool
}

type snapshot struct {
	health map[store.ImageSlotKey]store.ImageSlotMemberHealth
	states map[store.ImageSlotKey]store.ImageSlotState
}

func load(ctx context.Context, q store.Q) (snapshot, error) {
	health, err := store.ListImageSlotMemberHealth(ctx, q)
	if err != nil {
		return snapshot{}, err
	}
	states, err := store.ListImageSlotStates(ctx, q)
	if err != nil {
		return snapshot{}, err
	}
	return snapshot{health: health, states: states}, nil
}

func (s snapshot) down(modelID, resolution string) bool {
	health, ok := s.health[store.ImageSlotKey{ModelID: modelID, Resolution: resolution}]
	return ok && health.Down()
}

// decide derives the slot's active member. Auto failover uses the first
// healthy member in order, so a recovered primary is used again at once;
// manual mode keeps the member the admin chose.
func (s snapshot) decide(ownerID, resolution string, slot modelconfig.ResolutionSlot) Plan {
	plan := Plan{Configured: true}
	if !slot.AutoFailover {
		active := slot.PrimaryModelID
		if state, ok := s.states[store.ImageSlotKey{ModelID: ownerID, Resolution: resolution}]; ok && state.ManualModelID != nil {
			for _, member := range slot.Chain() {
				if member == *state.ManualModelID {
					active = member
				}
			}
		}
		plan.Active = active
		if s.down(active, resolution) {
			plan.Unavailable = true
			return plan
		}
		plan.Candidates = []string{active}
		return plan
	}
	for _, member := range slot.Chain() {
		if !s.down(member, resolution) {
			plan.Candidates = append(plan.Candidates, member)
		}
	}
	if len(plan.Candidates) == 0 {
		plan.Unavailable = true
		plan.Active = slot.PrimaryModelID
		if state, ok := s.states[store.ImageSlotKey{ModelID: ownerID, Resolution: resolution}]; ok {
			plan.Active = state.ActiveModelID
		}
		return plan
	}
	plan.Active = plan.Candidates[0]
	return plan
}

// PlanFor returns how a new task for the owner model at the tier runs.
func PlanFor(ctx context.Context, q store.Q, owner modelconfig.Model, resolution string) (Plan, error) {
	slot, ok := modelconfig.SlotFor(owner, resolution)
	if !ok {
		return Plan{}, nil
	}
	snap, err := load(ctx, q)
	if err != nil {
		return Plan{}, err
	}
	return snap.decide(owner.ID, strings.ToUpper(resolution), slot), nil
}

// UnavailableResolutions lists the owner's resolutions that cannot take new
// tasks right now (for the client's resolution picker).
func UnavailableResolutions(ctx context.Context, q store.Q, cfg modelconfig.Config) (map[string][]string, error) {
	out := map[string][]string{}
	snap, loaded := snapshot{}, false
	for _, owner := range cfg.Models {
		for resolution, slot := range owner.ResolutionSlots {
			if !loaded {
				var err error
				if snap, err = load(ctx, q); err != nil {
					return nil, err
				}
				loaded = true
			}
			if snap.decide(owner.ID, resolution, slot).Unavailable {
				out[owner.ID] = append(out[owner.ID], resolution)
			}
		}
	}
	for _, list := range out {
		sort.Strings(list)
	}
	return out, nil
}

// slotRef is one configured slot.
type slotRef struct {
	Owner      modelconfig.Model
	Resolution string
	Slot       modelconfig.ResolutionSlot
}

func configuredSlots(cfg modelconfig.Config) []slotRef {
	out := []slotRef{}
	for _, owner := range cfg.Models {
		if owner.Kind != modelconfig.ModelKindImage {
			continue
		}
		for resolution, slot := range owner.ResolutionSlots {
			if slot.PrimaryModelID != "" {
				out = append(out, slotRef{Owner: owner, Resolution: resolution, Slot: slot})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Owner.Name != out[j].Owner.Name {
			return out[i].Owner.Name < out[j].Owner.Name
		}
		return out[i].Resolution < out[j].Resolution
	})
	return out
}

func modelName(cfg modelconfig.Config, id string) string {
	for _, model := range cfg.Models {
		if model.ID == id {
			return model.Name
		}
	}
	return id
}

func incidentKey(ownerID, resolution string) string {
	return incidentPrefix + ownerID + ":" + resolution
}

// Reconcile moves every slot to the member its health and mode call for,
// records the switches and raises or clears the admin alerts. Callers hold
// no slot lock; Reconcile takes it.
func Reconcile(ctx context.Context, q store.Q, cfg modelconfig.Config, at time.Time) error {
	if err := store.LockImageSlots(ctx, q); err != nil {
		return err
	}
	snap, err := load(ctx, q)
	if err != nil {
		return err
	}
	live := map[store.ImageSlotKey]bool{}
	for _, ref := range configuredSlots(cfg) {
		key := store.ImageSlotKey{ModelID: ref.Owner.ID, Resolution: ref.Resolution}
		live[key] = true
		plan := snap.decide(ref.Owner.ID, ref.Resolution, ref.Slot)
		previous, existed := snap.states[key]
		next := store.ImageSlotState{ModelID: key.ModelID, Resolution: key.Resolution, ActiveModelID: plan.Active, AllDown: plan.Unavailable}
		if existed {
			next.ManualModelID = previous.ManualModelID
		}
		if existed && previous.ActiveModelID == next.ActiveModelID && previous.AllDown == next.AllDown {
			continue
		}
		switched := existed || plan.Unavailable || plan.Active != ref.Slot.PrimaryModelID
		if err := store.SaveImageSlotState(ctx, q, next, at, switched); err != nil {
			return err
		}
		fromID := ref.Slot.PrimaryModelID
		if existed {
			fromID = previous.ActiveModelID
		}
		if err := recordTransition(ctx, q, cfg, ref, fromID, plan, existed, at); err != nil {
			return err
		}
	}
	for key := range snap.states {
		if live[key] {
			continue
		}
		if _, err := q.Exec(ctx, `DELETE FROM image_slot_states WHERE model_id = $1 AND resolution = $2`, key.ModelID, key.Resolution); err != nil {
			return err
		}
		if err := store.ResolveOperationalIncident(ctx, q, incidentKey(key.ModelID, key.Resolution), at); err != nil {
			return err
		}
	}
	return store.PruneImageSlotEvents(ctx, q, at.Add(-eventRetention))
}

func recordTransition(ctx context.Context, q store.Q, cfg modelconfig.Config, ref slotRef, fromID string, plan Plan, existed bool, at time.Time) error {
	owner, resolution := ref.Owner, ref.Resolution
	label := fmt.Sprintf("%s · %s", owner.Name, resolution)
	key := incidentKey(owner.ID, resolution)
	event := store.ImageSlotEvent{ModelID: owner.ID, Resolution: resolution, FromModelID: fromID, ToModelID: plan.Active, CreatedAt: at}
	switch {
	case plan.Unavailable:
		event.Kind = store.ImageSlotEventAllDown
		title := label + " 全部模型不可用"
		summary := "主模型和所有备用模型都已判定故障，该分辨率暂停接单；系统会按检测间隔继续检测各模型，恢复后自动启用。"
		if !ref.Slot.AutoFailover {
			title = label + " 当前模型故障"
			summary = fmt.Sprintf("手动模式下正在使用的 %s 已判定故障，该分辨率暂停接单。请在模型配置的「分辨率槽位」里手动切换到其他模型。", modelName(cfg, plan.Active))
		}
		event.Message = summary
		if err := store.UpsertOperationalIncident(ctx, q, store.OperationalIncident{
			Key: key, Severity: "critical", Title: title, Summary: summary,
			Details: map[string]any{"modelId": owner.ID, "resolution": resolution, "activeModelId": plan.Active},
		}, at); err != nil {
			return err
		}
	case plan.Active != ref.Slot.PrimaryModelID && ref.Slot.AutoFailover:
		event.Kind = store.ImageSlotEventSwitch
		summary := fmt.Sprintf("已从 %s 切换到备用模型 %s。系统会按检测间隔检测排在前面的模型，恢复后自动切回。", modelName(cfg, fromID), modelName(cfg, plan.Active))
		event.Message = summary
		if err := store.UpsertOperationalIncident(ctx, q, store.OperationalIncident{
			Key: key, Severity: "warning", Title: label + " 正在使用备用模型", Summary: summary,
			Details: map[string]any{"modelId": owner.ID, "resolution": resolution, "activeModelId": plan.Active},
		}, at); err != nil {
			return err
		}
	default:
		event.Kind = store.ImageSlotEventSwitch
		event.Message = fmt.Sprintf("已切换到 %s", modelName(cfg, plan.Active))
		if plan.Active == ref.Slot.PrimaryModelID {
			event.Message = fmt.Sprintf("已切回主模型 %s", modelName(cfg, plan.Active))
		}
		if err := store.ResolveOperationalIncident(ctx, q, key, at); err != nil {
			return err
		}
	}
	if !existed && !plan.Unavailable && plan.Active == ref.Slot.PrimaryModelID {
		// First sight of a healthy slot: nothing switched.
		return nil
	}
	return store.InsertImageSlotEvent(ctx, q, event)
}

// RecordOutcome feeds one real generation result on a slot member back into
// its health. A transition (down or recovered) is logged and reconciled.
func RecordOutcome(ctx context.Context, q store.Q, loadConfig func() (modelconfig.Config, error), memberID, resolution string, ok bool, message string, at time.Time) error {
	key := store.ImageSlotKey{ModelID: memberID, Resolution: strings.ToUpper(resolution)}
	var changed bool
	var err error
	event := store.ImageSlotEvent{Resolution: key.Resolution, MemberModelID: memberID, CreatedAt: at}
	if ok {
		changed, err = store.RecordImageSlotMemberSuccess(ctx, q, key, at)
		event.Kind, event.Message = store.ImageSlotEventMemberUp, "真实任务成功，恢复可用"
	} else {
		threshold := LoadSettings(ctx, q).FailureThreshold
		changed, err = store.RecordImageSlotMemberFailure(ctx, q, key, message, threshold, at)
		event.Kind = store.ImageSlotEventMemberDown
		event.Message = fmt.Sprintf("连续失败 %d 次，判定故障：%s", threshold, message)
	}
	if err != nil || !changed {
		return err
	}
	if err := store.InsertImageSlotEvent(ctx, q, event); err != nil {
		return err
	}
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	return Reconcile(ctx, q, cfg, at)
}

// ProbeTarget is a down member due for a health probe.
type ProbeTarget struct {
	ModelID    string
	Resolution string
	Qualities  []string
}

// DueProbes lists down members whose last probe (or failure) is older than
// the interval, within what is left of the 24-hour probe budget.
func DueProbes(ctx context.Context, q store.Q, cfg modelconfig.Config, now time.Time) ([]ProbeTarget, error) {
	conf := LoadSettings(ctx, q)
	if conf.ProbeDailyLimit <= 0 {
		return nil, nil
	}
	used, err := store.CountImageSlotProbesSince(ctx, q, now.Add(-24*time.Hour))
	if err != nil {
		return nil, err
	}
	budget := int64(conf.ProbeDailyLimit) - used
	if budget <= 0 {
		return nil, nil
	}
	health, err := store.ListImageSlotMemberHealth(ctx, q)
	if err != nil {
		return nil, err
	}
	seen := map[store.ImageSlotKey]bool{}
	out := []ProbeTarget{}
	for _, ref := range configuredSlots(cfg) {
		for _, member := range ref.Slot.Chain() {
			key := store.ImageSlotKey{ModelID: member, Resolution: ref.Resolution}
			h, ok := health[key]
			if seen[key] || !ok || !h.Down() {
				continue
			}
			seen[key] = true
			last := h.DownSince
			if h.LastProbeAt != nil && (last == nil || h.LastProbeAt.After(*last)) {
				last = h.LastProbeAt
			}
			if last != nil && now.Sub(*last) < conf.ProbeInterval() {
				continue
			}
			if int64(len(out)) >= budget {
				return out, nil
			}
			out = append(out, ProbeTarget{ModelID: member, Resolution: ref.Resolution, Qualities: ref.Owner.Qualities})
		}
	}
	return out, nil
}

// RecordProbe stores a probe and, when it passed, restores the member.
func RecordProbe(ctx context.Context, q store.Q, cfg modelconfig.Config, target ProbeTarget, ok bool, message string, at time.Time) error {
	key := store.ImageSlotKey{ModelID: target.ModelID, Resolution: target.Resolution}
	if err := store.RecordImageSlotMemberProbe(ctx, q, key, ok, message, at); err != nil {
		return err
	}
	if err := store.InsertImageSlotEvent(ctx, q, store.ImageSlotEvent{
		Resolution: target.Resolution, Kind: store.ImageSlotEventProbe, MemberModelID: target.ModelID,
		OK: &ok, Message: message, CreatedAt: at,
	}); err != nil {
		return err
	}
	if !ok {
		// A failed probe counts like a failed task, so probing a member that
		// is still marked healthy can take it out once the threshold is hit.
		threshold := LoadSettings(ctx, q).FailureThreshold
		wentDown, err := store.RecordImageSlotMemberFailure(ctx, q, key, "检测失败："+message, threshold, at)
		if err != nil || !wentDown {
			return err
		}
		if err := store.InsertImageSlotEvent(ctx, q, store.ImageSlotEvent{
			Resolution: target.Resolution, Kind: store.ImageSlotEventMemberDown, MemberModelID: target.ModelID,
			Message: fmt.Sprintf("连续失败 %d 次，判定故障：%s", threshold, message), CreatedAt: at,
		}); err != nil {
			return err
		}
		return Reconcile(ctx, q, cfg, at)
	}
	if _, err := store.RecordImageSlotMemberSuccess(ctx, q, key, at); err != nil {
		return err
	}
	if err := store.InsertImageSlotEvent(ctx, q, store.ImageSlotEvent{
		Resolution: target.Resolution, Kind: store.ImageSlotEventMemberUp, MemberModelID: target.ModelID,
		Message: "定时检测通过，恢复可用", CreatedAt: at,
	}); err != nil {
		return err
	}
	return Reconcile(ctx, q, cfg, at)
}

// ResetMember marks a member healthy by hand.
func ResetMember(ctx context.Context, q store.Q, cfg modelconfig.Config, memberID, resolution string, at time.Time) error {
	key := store.ImageSlotKey{ModelID: memberID, Resolution: strings.ToUpper(resolution)}
	if err := store.ResetImageSlotMember(ctx, q, key, at); err != nil {
		return err
	}
	if err := store.InsertImageSlotEvent(ctx, q, store.ImageSlotEvent{
		Resolution: key.Resolution, Kind: store.ImageSlotEventMemberReset, MemberModelID: memberID,
		Message: "管理员手动标记为正常", CreatedAt: at,
	}); err != nil {
		return err
	}
	return Reconcile(ctx, q, cfg, at)
}

// SwitchManual points a manual-mode slot at one of its members.
func SwitchManual(ctx context.Context, q store.Q, cfg modelconfig.Config, ownerID, resolution, memberID string, at time.Time) error {
	resolution = strings.ToUpper(strings.TrimSpace(resolution))
	var owner *modelconfig.Model
	for index := range cfg.Models {
		if cfg.Models[index].ID == ownerID {
			owner = &cfg.Models[index]
		}
	}
	if owner == nil {
		return fmt.Errorf("模型不存在")
	}
	slot, ok := modelconfig.SlotFor(*owner, resolution)
	if !ok {
		return fmt.Errorf("该模型的 %s 没有配置槽位", resolution)
	}
	if slot.AutoFailover {
		return fmt.Errorf("该槽位开启了自动切换，不能手动指定模型")
	}
	found := false
	for _, member := range slot.Chain() {
		found = found || member == memberID
	}
	if !found {
		return fmt.Errorf("所选模型不在该槽位中")
	}
	if err := store.LockImageSlots(ctx, q); err != nil {
		return err
	}
	snap, err := load(ctx, q)
	if err != nil {
		return err
	}
	key := store.ImageSlotKey{ModelID: ownerID, Resolution: resolution}
	state, existed := snap.states[key]
	if !existed {
		state = store.ImageSlotState{ModelID: ownerID, Resolution: resolution, ActiveModelID: slot.PrimaryModelID}
	}
	from := state.ActiveModelID
	state.ManualModelID = &memberID
	if err := store.SaveImageSlotState(ctx, q, state, at, false); err != nil {
		return err
	}
	if err := store.InsertImageSlotEvent(ctx, q, store.ImageSlotEvent{
		ModelID: ownerID, Resolution: resolution, Kind: store.ImageSlotEventManual,
		FromModelID: from, ToModelID: memberID, Message: "管理员手动切换到 " + modelName(cfg, memberID), CreatedAt: at,
	}); err != nil {
		return err
	}
	return Reconcile(ctx, q, cfg, at)
}
