package modelconfig

import (
	"fmt"
	"strings"
)

// ResolutionSlot routes one resolution of a public image model. Exactly one
// primary model serves it; backups (0..n, in order) take over when the model
// in use fails. Without AutoFailover the admin switches by hand.
type ResolutionSlot struct {
	PrimaryModelID string   `json:"primaryModelId"`
	BackupModelIDs []string `json:"backupModelIds"`
	AutoFailover   bool     `json:"autoFailover"`
}

// Chain is the primary followed by the backups, in failover order.
func (s ResolutionSlot) Chain() []string {
	return append([]string{s.PrimaryModelID}, s.BackupModelIDs...)
}

// SlotFor returns the model's slot for a resolution tier.
func SlotFor(model Model, resolution string) (ResolutionSlot, bool) {
	if model.Kind != ModelKindImage {
		return ResolutionSlot{}, false
	}
	slot, ok := model.ResolutionSlots[strings.ToUpper(strings.TrimSpace(resolution))]
	return slot, ok && slot.PrimaryModelID != ""
}

func normalizeResolutionSlots(model *Model) {
	if model.Kind != ModelKindImage || len(model.ResolutionSlots) == 0 {
		model.ResolutionSlots = nil
		return
	}
	out := make(map[string]ResolutionSlot, len(model.ResolutionSlots))
	for resolution, slot := range model.ResolutionSlots {
		resolution = strings.ToUpper(strings.TrimSpace(resolution))
		slot.PrimaryModelID = strings.TrimSpace(slot.PrimaryModelID)
		slot.BackupModelIDs = cleanStrings(slot.BackupModelIDs)
		if resolution == "" || (slot.PrimaryModelID == "" && len(slot.BackupModelIDs) == 0) {
			continue
		}
		out[resolution] = slot
	}
	if len(out) == 0 {
		out = nil
	}
	model.ResolutionSlots = out
}

func validateResolutionSlots(list []Model, models map[string]Model) error {
	for _, owner := range list {
		if len(owner.ResolutionSlots) == 0 {
			continue
		}
		for resolution, slot := range owner.ResolutionSlots {
			label := fmt.Sprintf("模型 %s 的 %s 槽位", owner.Name, resolution)
			if !containsFold(owner.Resolutions, resolution) {
				return fmt.Errorf("%s不在该模型开放的分辨率中", label)
			}
			if slot.PrimaryModelID == "" {
				return fmt.Errorf("%s必须指定一个主模型", label)
			}
			if slot.AutoFailover && len(slot.BackupModelIDs) == 0 {
				return fmt.Errorf("%s开启了自动切换，至少需要一个备用模型", label)
			}
			seen := map[string]bool{}
			for index, memberID := range slot.Chain() {
				role := "主模型"
				if index > 0 {
					role = fmt.Sprintf("备用模型 %d", index)
				}
				if seen[memberID] {
					return fmt.Errorf("%s的模型 %s 重复出现", label, memberID)
				}
				seen[memberID] = true
				member, ok := models[memberID]
				if !ok {
					return fmt.Errorf("%s的%s不存在：%s", label, role, memberID)
				}
				if err := validateSlotMember(owner, member, resolution, label+"的"+role+" "+member.Name); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func validateSlotMember(owner, member Model, resolution, label string) error {
	if member.Kind != ModelKindImage {
		return fmt.Errorf("%s 不是生图模型", label)
	}
	if !member.Enabled {
		return fmt.Errorf("%s 未启用", label)
	}
	if member.ID != owner.ID && len(member.ResolutionSlots) > 0 {
		return fmt.Errorf("%s 自身也配置了分辨率槽位，槽位不能嵌套", label)
	}
	if !containsFold(member.Resolutions, resolution) {
		return fmt.Errorf("%s 不支持 %s", label, resolution)
	}
	if member.ID != owner.ID {
		if err := validateSlotMemberCapabilities(owner, member, resolution, label); err != nil {
			return err
		}
	}
	for _, quality := range owner.Qualities {
		if len(member.Qualities) > 0 && !containsExact(member.Qualities, quality) {
			return fmt.Errorf("%s 不支持质量 %s", label, quality)
		}
		tier := ImageTier{Resolution: resolution, Quality: quality}
		price := ResolveImageTierPrice(owner, tier).EffectiveCents
		cost := ImageTierUpstreamCost(member, tier)
		if owner.Enabled && owner.Public && price < cost && !owner.AllowLossLeader {
			return fmt.Errorf("%s 在 %s · %s 档的上游成本高于用户价格", label, resolution, quality)
		}
	}
	return nil
}

// validateSlotMemberCapabilities checks, at save time, what the worker checks
// per task: a member that cannot take a request the owner accepts is skipped
// silently at run time, so the admin is told now instead.
func validateSlotMemberCapabilities(owner, member Model, resolution, label string) error {
	memberRatios := AspectRatiosForResolution(member, resolution)
	for _, ratio := range AspectRatiosForResolution(owner, resolution) {
		if !containsFold(memberRatios, ratio) {
			return fmt.Errorf("%s 在 %s 不支持比例 %s，请在它的「生图能力」里开启或从槽位移除", label, resolution, ratio)
		}
	}
	// A member with no quality at all would be skipped for every quality the
	// owner bills by; the owner-side loop covers members that list some.
	if len(owner.Qualities) > 0 && len(member.Qualities) == 0 {
		return fmt.Errorf("%s 没有开放任何质量档，请在它的「生图能力」里勾选 %s 或从槽位移除", label, strings.Join(owner.Qualities, "、"))
	}
	if member.MaxReferenceImages < owner.MaxReferenceImages {
		return fmt.Errorf("%s 最多接受 %d 张参考图，少于本模型的 %d 张", label, member.MaxReferenceImages, owner.MaxReferenceImages)
	}
	if CRUNRequiresReference(member) && !CRUNRequiresReference(owner) {
		return fmt.Errorf("%s 只支持改图，而本模型允许不带参考图生成", label)
	}
	return nil
}
