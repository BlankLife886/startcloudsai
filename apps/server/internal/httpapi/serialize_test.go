package httpapi

import (
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestTaskDictIncludesRecordedModel(t *testing.T) {
	task := &store.Task{ID: uuid.New(), Type: "t2i", Model: "gpt-image-2"}
	dict := taskDict(task, nil, nil)
	if got := dict["model"]; got != "gpt-image-2" {
		t.Fatalf("model = %v, want gpt-image-2", got)
	}
}

func TestUserDictIncludesProfileDetails(t *testing.T) {
	user := &store.User{
		ID:         uuid.New(),
		Username:   "星云画师",
		Bio:        "专注角色与场景设计",
		Location:   "上海",
		WebsiteURL: "https://example.com/portfolio",
	}
	dict := userDict(user)
	if dict["bio"] != user.Bio || dict["location"] != user.Location || dict["websiteUrl"] != user.WebsiteURL {
		t.Fatalf("profile details not serialized: %#v", dict)
	}
}
