package httpapi

import (
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"testing"
)

func TestAdminListFilterDateValidation(t *testing.T) {
	for _, query := range []string{"createdFrom=bad", "createdTo=2026-02-30", "createdFrom=2026-09-24&createdTo=2026-09-23", "method=bad"} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/?"+query, nil)
		if _, err := adminListFilter(c); err == nil {
			t.Fatalf("accepted invalid query %s", query)
		}
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/?createdFrom=2026-09-23&createdTo=2026-09-23", nil)
	f, err := adminListFilter(c)
	if err != nil {
		t.Fatal(err)
	}
	if f.From.UTC().Format("2006-01-02T15:04:05Z") != "2026-09-22T16:00:00Z" || f.To.Sub(*f.From).Hours() != 24 {
		t.Fatalf("wrong Beijing date range: %#v", f)
	}
}
