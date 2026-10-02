// Package userassets lets the assistant find a user's own images (the asset
// library and generated history) and organise the library. Finding is read
// only. Organising is two-step: Propose validates and describes a change
// without touching anything; Execute runs it after the user confirms on the
// card and returns what Undo needs to put everything back.
package userassets

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/usermetrics"
)

// ErrInvalid marks a request the caller should fix.
var ErrInvalid = errors.New("invalid asset request")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

const (
	maxResults  = 24
	maxTerms    = 5
	maxActionID = 50
)

// Sources to search.
const (
	SourceAll     = "all"
	SourceLibrary = "library"
	SourceHistory = "history"
)

// SearchRequest finds images by keywords.
type SearchRequest struct {
	// Query holds keywords separated by spaces; every keyword must match.
	// Empty lists the most recent images.
	Query  string `json:"query,omitempty"`
	Source string `json:"source,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}

// Item is one image found.
type Item struct {
	// ID is "asset:<uuid>" for library assets and "task:<uuid>" for
	// generated images; organising only accepts asset ids.
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Title       string   `json:"title"`
	Prompt      string   `json:"prompt,omitempty"`
	ImageURL    string   `json:"imageUrl"`
	OriginalURL string   `json:"originalUrl,omitempty"`
	Group       string   `json:"group,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Workspace   string   `json:"workspace,omitempty"`
	Time        string   `json:"time"`
	Link        string   `json:"link"`
}

// Group is one asset group.
type Group struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

// SearchResult is the answer to a SearchRequest.
type SearchResult struct {
	Query  string  `json:"query"`
	Items  []Item  `json:"items"`
	Groups []Group `json:"groups"`
}

func fileURL(key string) string {
	key = strings.TrimLeft(strings.TrimSpace(key), "/")
	if key == "" {
		return ""
	}
	return "/api/v1/files/" + key
}

func terms(query string) []string {
	out := []string{}
	for _, term := range strings.Fields(query) {
		if term = strings.TrimSpace(term); term != "" && len(out) < maxTerms {
			out = append(out, term)
		}
	}
	return out
}

func truncate(value string, limit int) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit]) + "…"
}

// Search finds the user's images. Library assets match title, tags and group
// name; generated images match their prompt.
func Search(ctx context.Context, q store.Q, userID uuid.UUID, req SearchRequest, loc *time.Location) (*SearchResult, error) {
	if userID == uuid.Nil {
		return nil, invalid("缺少用户")
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 12
	}
	limit = min(limit, maxResults)
	source := req.Source
	if source == "" {
		source = SourceAll
	}
	if source != SourceAll && source != SourceLibrary && source != SourceHistory {
		return nil, invalid("不支持的来源：%s", source)
	}
	words := terms(req.Query)
	result := &SearchResult{Query: strings.Join(words, " "), Items: []Item{}, Groups: []Group{}}

	groups, err := store.ListUserAssetGroups(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	groupNames := map[uuid.UUID]string{}
	for _, group := range groups {
		groupNames[group.ID] = group.Name
		result.Groups = append(result.Groups, Group{ID: group.ID.String(), Name: group.Name, Count: group.AssetCount})
	}

	if source != SourceHistory {
		// The library matches one keyword in SQL and filters the rest here.
		first := ""
		if len(words) > 0 {
			first = words[0]
		}
		assets, err := store.ListUserAssetsDAM(ctx, q, userID, store.UserAssetListOptions{Limit: maxResults * 2, Query: first})
		if err != nil {
			return nil, err
		}
		for _, asset := range assets {
			group := ""
			if asset.GroupID != nil {
				group = groupNames[*asset.GroupID]
			}
			haystack := strings.ToLower(asset.Title + " " + strings.Join(asset.Tags, " ") + " " + group + " " + asset.SourceType)
			matched := true
			for _, word := range words[min(1, len(words)):] {
				if !strings.Contains(haystack, strings.ToLower(word)) {
					matched = false
					break
				}
			}
			if !matched {
				continue
			}
			thumb := asset.ThumbnailKey
			if thumb == "" {
				thumb = asset.FileKey
			}
			result.Items = append(result.Items, Item{ID: "asset:" + asset.ID.String(), Kind: "asset", Title: asset.Title,
				ImageURL: fileURL(thumb), OriginalURL: fileURL(asset.FileKey), Group: group, Tags: asset.Tags,
				Time: asset.CreatedAt.In(loc).Format("2006-01-02 15:04"), Link: "/assets"})
			if len(result.Items) >= limit {
				break
			}
		}
	}

	if source != SourceLibrary && len(result.Items) < limit {
		args := []any{userID}
		where := []string{"user_id = $1", "deleted_at IS NULL", "status = 'succeeded'",
			"jsonb_typeof(output_keys) = 'array'", "jsonb_array_length(output_keys) > 0",
			"lower(COALESCE(params->>'_historyMirror', '')) <> 'true'"}
		for _, word := range words {
			args = append(args, "%"+word+"%")
			where = append(where, fmt.Sprintf("prompt ILIKE $%d", len(args)))
		}
		args = append(args, limit-len(result.Items))
		rows, err := q.Query(ctx, `SELECT id, type, prompt, created_at, output_keys->>0,
				COALESCE(CASE WHEN jsonb_typeof(thumbnail_keys) = 'array' THEN thumbnail_keys->>0 END, '')
			FROM tasks WHERE `+strings.Join(where, " AND ")+fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d`, len(args)), args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id uuid.UUID
			var taskType, prompt, output, thumb string
			var created time.Time
			if err := rows.Scan(&id, &taskType, &prompt, &created, &output, &thumb); err != nil {
				return nil, err
			}
			if thumb == "" {
				thumb = output
			}
			label := usermetrics.WorkspaceLabels[taskType]
			result.Items = append(result.Items, Item{ID: "task:" + id.String(), Kind: "generated", Title: truncate(prompt, 40),
				Prompt: truncate(prompt, 500), ImageURL: fileURL(thumb), OriginalURL: fileURL(output), Workspace: label,
				Time: created.In(loc).Format("2006-01-02 15:04"), Link: "/history"})
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return result, nil
}

// noTags must be an empty slice, not nil: BatchUpdateUserAssets builds the
// new tag array from both lists, and a NULL list would erase every tag.
var noTags = []string{}

// Actions on library assets.
const (
	ActionMove  = "move"
	ActionTag   = "tag"
	ActionTrash = "trash"
)

// Action is a proposed or executed change to library assets.
type Action struct {
	Action   string   `json:"action"`
	AssetIDs []string `json:"assetIds"`
	// Group is the destination for a move; empty moves to "未分组".
	Group string `json:"group,omitempty"`
	// CreateGroup is set when Group does not exist yet.
	CreateGroup bool     `json:"createGroup,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	// Titles and Summary describe the change on the card.
	Titles  []string `json:"titles,omitempty"`
	Summary string   `json:"summary,omitempty"`
}

// Undo puts executed changes back.
type Undo struct {
	Action string     `json:"action"`
	Items  []UndoItem `json:"items"`
	Tags   []string   `json:"tags,omitempty"`
	// CreatedGroup is removed on undo when it is empty again.
	CreatedGroup string `json:"createdGroup,omitempty"`
}

// UndoItem is one asset's state before the change.
type UndoItem struct {
	AssetID       string   `json:"assetId"`
	PreviousGroup string   `json:"previousGroup,omitempty"`
	AddedTags     []string `json:"addedTags,omitempty"`
}

func parseAssetIDs(raw []string) ([]uuid.UUID, error) {
	if len(raw) == 0 {
		return nil, invalid("请先选择要整理的素材")
	}
	if len(raw) > maxActionID {
		return nil, invalid("一次最多整理 %d 个素材", maxActionID)
	}
	ids := []uuid.UUID{}
	seen := map[uuid.UUID]bool{}
	for _, value := range raw {
		value = strings.TrimPrefix(strings.TrimSpace(value), "asset:")
		if strings.HasPrefix(value, "task:") {
			return nil, invalid("生成记录不在资产库里，只能整理资产库中的素材")
		}
		id, err := uuid.Parse(value)
		if err != nil {
			return nil, invalid("素材 id 无效：%s", value)
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func findGroup(ctx context.Context, q store.Q, userID uuid.UUID, name string) (*store.UserAssetGroup, error) {
	groups, err := store.ListUserAssetGroups(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	for _, group := range groups {
		if group.Name == name {
			return group, nil
		}
	}
	return nil, nil
}

// Propose validates an action against the user's assets and describes it.
// It changes nothing.
func Propose(ctx context.Context, q store.Q, userID uuid.UUID, action Action) (*Action, error) {
	ids, err := parseAssetIDs(action.AssetIDs)
	if err != nil {
		return nil, err
	}
	assets, err := store.GetUserAssetsByIDs(ctx, q, userID, ids)
	if err != nil {
		return nil, err
	}
	if len(assets) != len(ids) {
		return nil, invalid("有素材不存在或已在回收站")
	}
	out := Action{Action: action.Action}
	for _, asset := range assets {
		out.AssetIDs = append(out.AssetIDs, "asset:"+asset.ID.String())
		out.Titles = append(out.Titles, asset.Title)
	}
	switch action.Action {
	case ActionMove:
		out.Group = store.NormalizeAssetGroupName(action.Group)
		if utf8.RuneCountInString(out.Group) > 64 {
			return nil, invalid("分组名称不能超过 64 个字符")
		}
		if out.Group != "" {
			group, err := findGroup(ctx, q, userID, out.Group)
			if err != nil {
				return nil, err
			}
			out.CreateGroup = group == nil
		}
		target := "「" + out.Group + "」"
		if out.Group == "" {
			target = "未分组"
		}
		out.Summary = fmt.Sprintf("把 %d 个素材移到%s", len(assets), target)
		if out.CreateGroup {
			out.Summary += "（新建这个分组）"
		}
	case ActionTag:
		out.Tags, err = store.NormalizeAssetTags(action.Tags)
		if err != nil || len(out.Tags) == 0 {
			return nil, invalid("请给出要添加的标签（每个最多 32 个字符）")
		}
		out.Summary = fmt.Sprintf("给 %d 个素材添加标签：%s", len(assets), strings.Join(out.Tags, "、"))
	case ActionTrash:
		out.Summary = fmt.Sprintf("把 %d 个素材移到回收站（可以撤销，回收站里的素材到期后才会彻底删除）", len(assets))
	default:
		return nil, invalid("不支持的整理操作：%s", action.Action)
	}
	return &out, nil
}

// Execute runs a confirmed action in one transaction and returns its undo.
func Execute(ctx context.Context, st *store.Store, userID uuid.UUID, action Action) (*Undo, error) {
	checked, err := Propose(ctx, st.Pool, userID, action)
	if err != nil {
		return nil, err
	}
	ids, _ := parseAssetIDs(checked.AssetIDs)
	undo := &Undo{Action: checked.Action}
	err = st.Tx(ctx, func(tx pgx.Tx) error {
		assets, err := store.GetUserAssetsByIDs(ctx, tx, userID, ids)
		if err != nil {
			return err
		}
		if len(assets) != len(ids) {
			return invalid("有素材不存在或已在回收站")
		}
		switch checked.Action {
		case ActionMove:
			var groupID *uuid.UUID
			if checked.Group != "" {
				group, err := findGroup(ctx, tx, userID, checked.Group)
				if err != nil {
					return err
				}
				if group == nil {
					if err := store.LockUserAssetGroupCreation(ctx, tx, userID); err != nil {
						return err
					}
					count, err := store.CountUserAssetGroups(ctx, tx, userID)
					if err != nil {
						return err
					}
					if count >= store.MaxUserAssetGroups {
						return invalid("最多创建 %d 个分组", store.MaxUserAssetGroups)
					}
					if group, err = store.InsertUserAssetGroup(ctx, tx, userID, checked.Group, int(count)); err != nil {
						return err
					}
					undo.CreatedGroup = group.ID.String()
				}
				groupID = &group.ID
			}
			for _, asset := range assets {
				item := UndoItem{AssetID: asset.ID.String()}
				if asset.GroupID != nil {
					item.PreviousGroup = asset.GroupID.String()
				}
				undo.Items = append(undo.Items, item)
			}
			_, err = store.BatchUpdateUserAssets(ctx, tx, userID, ids, true, groupID, noTags, noTags)
			return err
		case ActionTag:
			for _, asset := range assets {
				added := []string{}
				for _, tag := range checked.Tags {
					has := false
					for _, existing := range asset.Tags {
						if existing == tag {
							has = true
						}
					}
					if !has {
						added = append(added, tag)
					}
				}
				undo.Items = append(undo.Items, UndoItem{AssetID: asset.ID.String(), AddedTags: added})
			}
			_, err = store.BatchUpdateUserAssets(ctx, tx, userID, ids, false, nil, checked.Tags, noTags)
			return err
		case ActionTrash:
			for _, asset := range assets {
				undo.Items = append(undo.Items, UndoItem{AssetID: asset.ID.String()})
			}
			_, err = store.BatchTrashUserAssets(ctx, tx, userID, ids)
			return err
		}
		return invalid("不支持的整理操作")
	})
	if err != nil {
		return nil, err
	}
	return undo, nil
}

// RevertUndo puts the assets back as they were. Only the user's own assets
// and groups are touched, whatever the undo record says.
func RevertUndo(ctx context.Context, st *store.Store, userID uuid.UUID, undo Undo) error {
	if len(undo.Items) == 0 || len(undo.Items) > maxActionID {
		return invalid("没有可以撤销的操作")
	}
	return st.Tx(ctx, func(tx pgx.Tx) error {
		switch undo.Action {
		case ActionMove:
			byGroup := map[string][]uuid.UUID{}
			for _, item := range undo.Items {
				id, err := uuid.Parse(item.AssetID)
				if err != nil {
					return invalid("撤销记录无效")
				}
				byGroup[item.PreviousGroup] = append(byGroup[item.PreviousGroup], id)
			}
			for previous, ids := range byGroup {
				var groupID *uuid.UUID
				if previous != "" {
					parsed, err := uuid.Parse(previous)
					if err != nil {
						return invalid("撤销记录无效")
					}
					group, err := store.GetUserAssetGroup(ctx, tx, userID, parsed)
					if err != nil {
						return err
					}
					if group != nil {
						groupID = &group.ID
					}
				}
				if _, err := store.BatchUpdateUserAssets(ctx, tx, userID, ids, true, groupID, noTags, noTags); err != nil {
					return err
				}
			}
			if undo.CreatedGroup != "" {
				if id, err := uuid.Parse(undo.CreatedGroup); err == nil {
					var remaining int64
					if err := tx.QueryRow(ctx, `SELECT count(*) FROM user_assets WHERE user_id = $1 AND group_id = $2`, userID, id).Scan(&remaining); err != nil {
						return err
					}
					if remaining == 0 {
						if err := store.DeleteUserAssetGroup(ctx, tx, userID, id); err != nil {
							return err
						}
					}
				}
			}
			return nil
		case ActionTag:
			for _, item := range undo.Items {
				id, err := uuid.Parse(item.AssetID)
				if err != nil {
					return invalid("撤销记录无效")
				}
				if len(item.AddedTags) == 0 {
					continue
				}
				if _, err := store.BatchUpdateUserAssets(ctx, tx, userID, []uuid.UUID{id}, false, nil, noTags, item.AddedTags); err != nil {
					return err
				}
			}
			return nil
		case ActionTrash:
			ids := []uuid.UUID{}
			for _, item := range undo.Items {
				id, err := uuid.Parse(item.AssetID)
				if err != nil {
					return invalid("撤销记录无效")
				}
				ids = append(ids, id)
			}
			_, err := store.BatchRestoreUserAssets(ctx, tx, userID, ids)
			return err
		}
		return invalid("没有可以撤销的操作")
	})
}
