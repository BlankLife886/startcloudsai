package assistantproactive

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantmemory"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// Suggestions are shown on an empty conversation: a few "carry on" ideas
// built from what the user remembered and the sets they made recently. They
// are plain arithmetic over the user's own rows — no model call, no charge —
// and only fill the user's draft or open a conversation; nothing runs until
// the user sends it.

const (
	// habitWindow is how far back usage habits are counted.
	habitWindow = 60 * 24 * time.Hour
	// resumeWindow is how long an unstarted plan is worth bringing back.
	resumeWindow = 3 * 24 * time.Hour
	// HabitMinSets is how many sets on one platform make it a habit.
	HabitMinSets = 2
	// MaxSuggestions caps the cards on the empty state.
	MaxSuggestions = 3
	maxRecentSets  = 60
)

// Suggestion is one card. Prompt fills the composer; ConversationID opens
// an existing conversation instead.
type Suggestion struct {
	ID             string     `json:"id"`
	Kind           string     `json:"kind"`
	Icon           string     `json:"icon"`
	Text           string     `json:"text"`
	Reason         string     `json:"reason"`
	Prompt         string     `json:"prompt,omitempty"`
	ConversationID *uuid.UUID `json:"conversationId,omitempty"`
}

// RecentSet is the part of a commerce set the suggestions look at.
type RecentSet struct {
	ID             uuid.UUID
	ConversationID *uuid.UUID
	Status         string
	ProductName    string
	Platform       string
	CreatedAt      time.Time
}

// Habits summarise recent commerce sets.
type Habits struct {
	Sets          int
	TopPlatform   string
	PlatformCount int
}

// HabitsFrom counts sets per platform; ties go to the most recent.
func HabitsFrom(sets []RecentSet) Habits {
	counts := map[string]int{}
	habits := Habits{}
	for _, set := range sets {
		if set.Status == store.CommerceSetCanceled {
			continue
		}
		habits.Sets++
		if set.Platform != "" {
			counts[set.Platform]++
		}
	}
	// sets are newest first, so the first platform to reach the top count wins ties.
	for _, set := range sets {
		if count := counts[set.Platform]; set.Platform != "" && count > habits.PlatformCount {
			habits.TopPlatform, habits.PlatformCount = set.Platform, count
		}
	}
	return habits
}

// Build picks the suggestions. sets are newest first; memories may be nil
// when memory is off.
func Build(sets []RecentSet, memories []assistantmemory.Memory, now time.Time) []Suggestion {
	out := []Suggestion{}
	habits := HabitsFrom(sets)
	habitual := habits.PlatformCount >= HabitMinSets

	// 1. A plan that was made but never started.
	for _, set := range sets {
		if set.Status != store.CommerceSetPlanned || set.ConversationID == nil || now.Sub(set.CreatedAt) > resumeWindow {
			continue
		}
		out = append(out, Suggestion{
			ID: "resume:" + set.ID.String(), Kind: "resume", Icon: "bi-play-circle",
			Text:   fmt.Sprintf("继续%s套图方案", quoted(set.ProductName, set.Platform)),
			Reason: "方案已经出好，还没开始生成", ConversationID: set.ConversationID,
		})
		break
	}

	// 2. The latest favourite, framed by the habitual platform when there is one.
	var favorite *assistantmemory.Memory
	for index := range memories {
		if memories[index].Kind == assistantmemory.KindFavorite {
			if favorite == nil || memories[index].UpdatedAt.After(favorite.UpdatedAt) {
				favorite = &memories[index]
			}
		}
	}
	if favorite != nil {
		name := favoriteName(favorite.Title)
		suggestion := Suggestion{
			ID: "favorite:" + favorite.ID.String(), Kind: "favorite", Icon: "bi-bookmark-star",
			Text:   fmt.Sprintf("按满意方案「%s」再做一套", name),
			Reason: "你记下的满意方案",
			Prompt: fmt.Sprintf("按我记住的满意方案「%s」再做一套电商套图，商品换成：", favorite.Title),
		}
		if habitual {
			if !strings.Contains(name, habits.TopPlatform) {
				suggestion.Text = fmt.Sprintf("按满意方案「%s」再做一套%s套图", name, habits.TopPlatform)
			}
			suggestion.Reason = fmt.Sprintf("你最近常做%s套图（%d 套）", habits.TopPlatform, habits.PlatformCount)
			suggestion.Prompt = fmt.Sprintf("按我记住的满意方案「%s」再做一套%s电商套图，商品换成：", favorite.Title, habits.TopPlatform)
		}
		out = append(out, suggestion)
	} else if habitual {
		out = append(out, Suggestion{
			ID: "habit:" + habits.TopPlatform, Kind: "habit", Icon: "bi-arrow-repeat",
			Text:   fmt.Sprintf("再做一套%s电商套图", habits.TopPlatform),
			Reason: fmt.Sprintf("你最近常做%s套图（%d 套）", habits.TopPlatform, habits.PlatformCount),
			Prompt: fmt.Sprintf("帮我做一套%s电商套图，商品是：", habits.TopPlatform),
		})
	}

	// 3. Remembered products with photos that have no set yet: the prompt
	// names the product, so the set can start from the remembered photos.
	made := map[string]bool{}
	for _, set := range sets {
		if set.ProductName != "" {
			made[strings.ToLower(set.ProductName)] = true
		}
	}
	platform := ""
	if habitual {
		platform = habits.TopPlatform
	}
	for _, m := range memories {
		if len(out) >= MaxSuggestions {
			break
		}
		if m.Kind != assistantmemory.KindProduct || len(m.ImageKeys) == 0 || productMade(made, m.Title) {
			continue
		}
		out = append(out, Suggestion{
			ID: "product:" + m.ID.String(), Kind: "product", Icon: "bi-box-seam",
			Text:   fmt.Sprintf("用记住的「%s」做一套%s主图", m.Title, platform),
			Reason: "记住了商品图，还没做过套图",
			Prompt: fmt.Sprintf("用我的%s做一套%s电商套图", m.Title, platform),
		})
	}
	if len(out) > MaxSuggestions {
		out = out[:MaxSuggestions]
	}
	return out
}

// favoriteName shortens a favourite's title for a card: sets saved with
// "记住这套方案" are titled "电商套图 · 商品 · 平台". The prompt keeps the
// full title so memory_search finds it.
func favoriteName(title string) string {
	if name := strings.TrimSpace(strings.TrimPrefix(title, "电商套图 · ")); name != "" {
		return name
	}
	return title
}

// productMade reports whether a set was made for a remembered product; set
// names are free text, so either name containing the other counts.
func productMade(made map[string]bool, title string) bool {
	title = strings.ToLower(strings.TrimSpace(title))
	for name := range made {
		if strings.Contains(name, title) || strings.Contains(title, name) {
			return true
		}
	}
	return false
}

func quoted(values ...string) string {
	name := strings.Join(nonEmpty(values...), " · ")
	if name == "" {
		return "上次的"
	}
	return "「" + name + "」"
}

// LoadRecentSets reads the user's commerce sets inside the habit window,
// newest first.
func LoadRecentSets(ctx context.Context, q store.Q, userID uuid.UUID, now time.Time) ([]RecentSet, error) {
	rows, err := q.Query(ctx, `SELECT id, conversation_id, status, COALESCE(brief->>'productName', ''),
			COALESCE(brief->>'platform', ''), created_at
		FROM assistant_commerce_sets WHERE user_id = $1 AND created_at > $2
		ORDER BY created_at DESC LIMIT $3`, userID, now.Add(-habitWindow), maxRecentSets)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sets := []RecentSet{}
	for rows.Next() {
		var set RecentSet
		if err := rows.Scan(&set.ID, &set.ConversationID, &set.Status, &set.ProductName, &set.Platform, &set.CreatedAt); err != nil {
			return nil, err
		}
		set.ProductName, set.Platform = strings.TrimSpace(set.ProductName), strings.TrimSpace(set.Platform)
		sets = append(sets, set)
	}
	return sets, rows.Err()
}

// Suggest returns the user's suggestions; empty when they are switched off.
// Memory-based ones are left out while memory is off.
func Suggest(ctx context.Context, q store.Q, userID uuid.UUID, now time.Time) ([]Suggestion, error) {
	settings, err := Get(ctx, q, userID)
	if err != nil || !settings.Suggestions {
		return []Suggestion{}, err
	}
	sets, err := LoadRecentSets(ctx, q, userID, now)
	if err != nil {
		return nil, err
	}
	recall, err := assistantmemory.Load(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	return Build(sets, recall.Memories, now), nil
}

// HabitFacts describes the user's habits for the model: the platform they
// keep making sets for and the latest favourite. Empty when suggestions are
// off or there is no habit worth mentioning.
func HabitFacts(ctx context.Context, q store.Q, userID uuid.UUID, memories []assistantmemory.Memory, now time.Time) (string, error) {
	settings, err := Get(ctx, q, userID)
	if err != nil || !settings.Suggestions {
		return "", err
	}
	sets, err := LoadRecentSets(ctx, q, userID, now)
	if err != nil {
		return "", err
	}
	return habitFacts(HabitsFrom(sets), memories), nil
}

func habitFacts(habits Habits, memories []assistantmemory.Memory) string {
	facts := []string{}
	if habits.PlatformCount >= HabitMinSets {
		facts = append(facts, fmt.Sprintf("近 60 天在助手里做了 %d 套电商套图，最常用平台是%s（%d 套）", habits.Sets, habits.TopPlatform, habits.PlatformCount))
	}
	var favorite *assistantmemory.Memory
	for index := range memories {
		if memories[index].Kind == assistantmemory.KindFavorite && (favorite == nil || memories[index].UpdatedAt.After(favorite.UpdatedAt)) {
			favorite = &memories[index]
		}
	}
	if favorite != nil {
		facts = append(facts, fmt.Sprintf("最近记下的满意方案是「%s」", favorite.Title))
	}
	return strings.Join(facts, "；")
}

// HabitNote tells the model to apply the habit when a set request leaves
// the platform or style open, and to say so once. It does not ask first:
// asking would cost the user another paid turn, and the plan card can be
// changed before anything is generated.
func HabitNote(facts string) string {
	if facts == "" {
		return ""
	}
	return "\n\n使用习惯（系统按用户自己的记录统计，不是用户本轮说的）：" + facts +
		"。用户做电商图但没说平台或风格时，直接按这个习惯定平台和风格，并在回复里点明一次（例如“按你常做的天猫规格”），告诉用户想换可以直接说；用户已说清楚时以用户说的为准，不要提习惯。"
}
