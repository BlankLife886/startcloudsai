package worker

import (
	"testing"

	"github.com/google/uuid"
)

func TestUserUploadObjectOwner(t *testing.T) {
	owner := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	tests := []struct {
		name string
		key  string
		want bool
	}{
		{name: "original", key: "uploads/" + owner.String() + "/original/file.png", want: true},
		{name: "thumbnail", key: "uploads/" + owner.String() + "/thumb/file.jpg", want: true},
		{name: "wrong directory", key: "uploads/" + owner.String() + "/other/file.png"},
		{name: "wrong shape", key: "uploads/" + owner.String() + "/original/nested/file.png"},
		{name: "invalid owner", key: "uploads/not-a-uuid/original/file.png"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := userUploadObjectOwner(test.key)
			if ok != test.want || (ok && got != owner) {
				t.Fatalf("userUploadObjectOwner(%q) = (%s, %v), want owner=%s ok=%v", test.key, got, ok, owner, test.want)
			}
		})
	}
}
