package userassets

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

var shanghai = time.FixedZone("CST", 8*3600)

type fixture struct {
	t   *testing.T
	st  *store.Store
	ctx context.Context
}

func (f fixture) user() uuid.UUID {
	f.t.Helper()
	user, err := store.InsertUser(f.ctx, f.st.Pool, "a-"+uuid.NewString()+"@example.com", "", "", "user", nil)
	if err != nil {
		f.t.Fatal(err)
	}
	return user.ID
}

func (f fixture) asset(user uuid.UUID, title string, group *uuid.UUID, tags ...string) uuid.UUID {
	f.t.Helper()
	name := uuid.NewString()
	asset, err := store.InsertUserAssetDAM(f.ctx, f.st.Pool, user, title,
		"uploads/"+user.String()+"/original/"+name+".png", "uploads/"+user.String()+"/thumb/"+name+".jpg",
		"image/png", 128, group, tags, "hash-"+name, "upload", nil, json.RawMessage(`{}`), nil)
	if err != nil {
		f.t.Fatal(err)
	}
	return asset.ID
}

func setup(t *testing.T) fixture {
	return fixture{t: t, st: testdb.Setup(t), ctx: context.Background()}
}

func TestSearchFindsLibraryAssetsAndGeneratedImages(t *testing.T) {
	f := setup(t)
	user := f.user()
	other := f.user()
	group, err := store.InsertUserAssetGroup(f.ctx, f.st.Pool, user, "节日海报", 0)
	if err != nil {
		t.Fatal(err)
	}
	poster := f.asset(user, "中秋猫咪海报", &group.ID, "猫")
	f.asset(user, "产品白底图", nil)
	f.asset(other, "别人的猫咪海报", nil)
	if _, err := f.st.Pool.Exec(f.ctx, `INSERT INTO tasks (user_id, type, status, prompt, params, count, output_keys, thumbnail_keys, cost_cents, model)
		VALUES ($1, 't2i', 'succeeded', '一只橘猫坐在月亮上的海报，暖色调', '{}', 1, '["tasks/x/out.png"]', '["tasks/x/thumb.jpg"]', 1, 'm'),
		       ($1, 't2i', 'failed', '失败的猫咪海报', '{}', 1, '[]', '[]', 0, 'm'),
		       ($2, 't2i', 'succeeded', '别人的猫咪海报', '{}', 1, '["tasks/y/out.png"]', '[]', 1, 'm')`, user, other); err != nil {
		t.Fatal(err)
	}

	result, err := Search(f.ctx, f.st.Pool, user, SearchRequest{Query: "猫 海报"}, shanghai)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 2 {
		t.Fatalf("items = %+v", result.Items)
	}
	if result.Items[0].ID != "asset:"+poster.String() || result.Items[0].Group != "节日海报" || result.Items[0].Link != "/assets" {
		t.Fatalf("library item = %+v", result.Items[0])
	}
	generated := result.Items[1]
	if generated.Kind != "generated" || !strings.Contains(generated.Prompt, "橘猫") || generated.ImageURL != "/api/v1/files/tasks/x/thumb.jpg" || generated.Workspace != "文生图" {
		t.Fatalf("generated item = %+v", generated)
	}
	if len(result.Groups) != 1 || result.Groups[0].Count != 1 {
		t.Fatalf("groups = %+v", result.Groups)
	}
	library, err := Search(f.ctx, f.st.Pool, user, SearchRequest{Source: SourceLibrary}, shanghai)
	if err != nil || len(library.Items) != 2 {
		t.Fatalf("library = %+v %v", library, err)
	}
}

func TestProposeExecuteAndUndo(t *testing.T) {
	f := setup(t)
	user := f.user()
	other := f.user()
	old, err := store.InsertUserAssetGroup(f.ctx, f.st.Pool, user, "旧分组", 0)
	if err != nil {
		t.Fatal(err)
	}
	first := f.asset(user, "图一", &old.ID, "原有")
	second := f.asset(user, "图二", nil)
	foreign := f.asset(other, "别人的图", nil)

	// Proposals reject other users' assets and generated history.
	for _, bad := range []Action{
		{Action: ActionTrash, AssetIDs: []string{"asset:" + foreign.String()}},
		{Action: ActionTrash, AssetIDs: []string{"task:" + uuid.NewString()}},
		{Action: "delete_forever", AssetIDs: []string{"asset:" + first.String()}},
	} {
		if _, err := Propose(f.ctx, f.st.Pool, user, bad); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%+v: err = %v", bad, err)
		}
	}
	ids := []string{"asset:" + first.String(), second.String()}
	proposal, err := Propose(f.ctx, f.st.Pool, user, Action{Action: ActionMove, AssetIDs: ids, Group: "新品"})
	if err != nil {
		t.Fatal(err)
	}
	if !proposal.CreateGroup || !strings.Contains(proposal.Summary, "新建") || len(proposal.Titles) != 2 {
		t.Fatalf("proposal = %+v", proposal)
	}
	// Proposing changes nothing.
	if group, _ := findGroup(f.ctx, f.st.Pool, user, "新品"); group != nil {
		t.Fatal("propose created the group")
	}

	undo, err := Execute(f.ctx, f.st, user, *proposal)
	if err != nil {
		t.Fatal(err)
	}
	created, _ := findGroup(f.ctx, f.st.Pool, user, "新品")
	moved, _ := store.GetUserAsset(f.ctx, f.st.Pool, user, first)
	if created == nil || moved.GroupID == nil || *moved.GroupID != created.ID || undo.CreatedGroup != created.ID.String() {
		t.Fatalf("after move: group %+v asset %+v undo %+v", created, moved, undo)
	}
	if err := RevertUndo(f.ctx, f.st, user, *undo); err != nil {
		t.Fatal(err)
	}
	back, _ := store.GetUserAsset(f.ctx, f.st.Pool, user, first)
	loose, _ := store.GetUserAsset(f.ctx, f.st.Pool, user, second)
	if back.GroupID == nil || *back.GroupID != old.ID || loose.GroupID != nil {
		t.Fatalf("after undo: %+v %+v", back.GroupID, loose.GroupID)
	}
	if group, _ := findGroup(f.ctx, f.st.Pool, user, "新品"); group != nil {
		t.Fatal("undo left the empty group it created")
	}

	tagUndo, err := Execute(f.ctx, f.st, user, Action{Action: ActionTag, AssetIDs: ids, Tags: []string{"原有", "精选"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := RevertUndo(f.ctx, f.st, user, *tagUndo); err != nil {
		t.Fatal(err)
	}
	tagged, _ := store.GetUserAsset(f.ctx, f.st.Pool, user, first)
	if strings.Join(tagged.Tags, ",") != "原有" {
		t.Fatalf("tag undo removed a tag the asset already had: %v", tagged.Tags)
	}

	trashUndo, err := Execute(f.ctx, f.st, user, Action{Action: ActionTrash, AssetIDs: ids})
	if err != nil {
		t.Fatal(err)
	}
	if gone, _ := store.GetUserAsset(f.ctx, f.st.Pool, user, first); gone != nil && gone.DeletedAt == nil {
		t.Fatal("asset not trashed")
	}
	if err := RevertUndo(f.ctx, f.st, user, *trashUndo); err != nil {
		t.Fatal(err)
	}
	restored, _ := store.GetUserAsset(f.ctx, f.st.Pool, user, first)
	if restored == nil || restored.DeletedAt != nil {
		t.Fatalf("trash undo = %+v", restored)
	}
	// Another user replaying the undo touches nothing of theirs.
	if err := RevertUndo(f.ctx, f.st, other, *trashUndo); err != nil {
		t.Fatal(err)
	}
}
