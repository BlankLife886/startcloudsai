package userupload

import (
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestIsProfileStudioTask(t *testing.T) {
	if IsProfileStudioTask(nil) || IsProfileStudioTask(&store.Task{Params: map[string]any{"_source": "react_canvas"}}) {
		t.Fatal("rejected unrelated tasks")
	}
	if !IsProfileStudioTask(&store.Task{Params: map[string]any{"_source": "profile_studio"}}) {
		t.Fatal("source should match")
	}
	if !IsProfileStudioTask(&store.Task{Params: map[string]any{"_kind": "profile-studio-figure"}}) {
		t.Fatal("kind should match")
	}
	if IsProfileStudioTask(&store.Task{Params: map[string]any{"_source": "profile_studio", "_kind": "profile-studio-outfit"}}) {
		t.Fatal("outfit should wait for user confirm")
	}
}

func TestFileURL(t *testing.T) {
	userID := uuid.New()
	key := "uploads/" + userID.String() + "/original/figure.png"
	if got := FileURL(key); got != "/api/v1/files/"+key {
		t.Fatalf("FileURL = %q", got)
	}
	if FileURL("") != "" {
		t.Fatal("empty key should stay empty")
	}
}

func TestObjectKeyFromFileURL(t *testing.T) {
	key := "uploads/abc/original/figure.png"
	cases := []string{
		"/api/v1/files/" + key,
		"https://app.example/api/v1/files/" + key + "?v=4",
		key,
	}
	for _, raw := range cases {
		if got := ObjectKeyFromFileURL(raw); got != key {
			t.Fatalf("ObjectKeyFromFileURL(%q) = %q, want %s", raw, got, key)
		}
	}
	if ObjectKeyFromFileURL("") != "" {
		t.Fatal("empty url should stay empty")
	}
}

func TestFigureStorageKeys(t *testing.T) {
	userID := uuid.New()
	original := "uploads/" + userID.String() + "/original/studio-figure.png"
	got := figureStorageKeys(original)
	wantThumb := "uploads/" + userID.String() + "/thumb/studio-figure"
	wantDisplay := "uploads/" + userID.String() + "/display/studio-figure"
	if len(got) != 3 || got[0] != original || got[1] != wantThumb || got[2] != wantDisplay {
		t.Fatalf("figureStorageKeys = %#v", got)
	}
	if ownedUploadOriginalKey(userID, original) != original {
		t.Fatal("original key should stay original")
	}
	if ownedUploadOriginalKey(userID, "tasks/"+userID.String()+"/"+uuid.NewString()+"/original/0.png") != "" {
		t.Fatal("task output must not be treated as a deletable studio figure copy")
	}
}

func TestOriginalKeyCandidates(t *testing.T) {
	userID := uuid.New()
	taskID := uuid.New()
	display := fmt.Sprintf("tasks/%s/%s/display/0-abc", userID, taskID)
	got := originalKeyCandidates(display)
	want := fmt.Sprintf("tasks/%s/%s/original/0-abc.png", userID, taskID)
	if len(got) == 0 || got[0] != want {
		t.Fatalf("display candidates = %#v, want first %s", got, want)
	}
	thumb := fmt.Sprintf("uploads/%s/thumb/figure", userID)
	got = originalKeyCandidates(thumb)
	want = fmt.Sprintf("uploads/%s/original/figure.png", userID)
	if len(got) == 0 || got[0] != want {
		t.Fatalf("thumb candidates = %#v, want first %s", got, want)
	}
	original := fmt.Sprintf("tasks/%s/%s/original/0.png", userID, taskID)
	if got := originalKeyCandidates(original); got != nil {
		t.Fatalf("original key should not rewrite, got %#v", got)
	}
}

func TestIsOwnedUploadOriginal(t *testing.T) {
	userID := uuid.New()
	ok := "uploads/" + userID.String() + "/original/figure.png"
	if !isOwnedUploadOriginal(userID, ok) {
		t.Fatalf("expected owned original %s", ok)
	}
	if isOwnedUploadOriginal(userID, "tasks/"+userID.String()+"/"+uuid.NewString()+"/original/0.png") {
		t.Fatal("task output is not a user upload")
	}
	taskID := uuid.New()
	source := fmt.Sprintf("tasks/%s/%s/original/0.png", userID, taskID)
	if got := studioFigureObjectID(userID, source); got != "studio-figure-"+taskID.String() {
		t.Fatalf("object id = %q", got)
	}
}
