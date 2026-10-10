package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

type skillReferenceIn struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Purpose string `json:"purpose"`
	Content string `json:"content"`
}

type skillReferencesIn struct {
	Items []skillReferenceIn `json:"items"`
}

func skillReferenceDict(ref store.SkillReference, withContent bool) gin.H {
	dict := gin.H{
		"path": ref.Path, "title": ref.Title, "purpose": ref.Purpose,
		"sort": ref.Sort, "updatedAt": ref.UpdatedAt,
	}
	if withContent {
		dict["content"] = ref.Content
		dict["bytes"] = len(ref.Content)
	}
	return dict
}

func skillReferenceDicts(refs []store.SkillReference, withContent bool) []gin.H {
	out := make([]gin.H, 0, len(refs))
	for _, ref := range refs {
		out = append(out, skillReferenceDict(ref, withContent))
	}
	return out
}

// GET /admin/image-skills/:id/references —— 列出参考资料（含正文，供后台查看和导出）。
func (s *Server) adminImageSkillReferences(c *gin.Context, _ *store.User) {
	skill, found := s.officialSkillForImages(c)
	if !found {
		return
	}
	refs, err := store.ListSkillReferences(c.Request.Context(), s.St.Pool, skill.ID, true)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": skillReferenceDicts(refs, true)})
}

// PUT /admin/image-skills/:id/references —— 整体替换参考资料（顺序即展示顺序）。
func (s *Server) adminSetImageSkillReferences(c *gin.Context, _ *store.User) {
	skill, found := s.officialSkillForImages(c)
	if !found {
		return
	}
	var body skillReferencesIn
	if err := bindJSON(c, &body); err != nil {
		fail(c, err)
		return
	}
	refs := make([]store.SkillReference, 0, len(body.Items))
	for _, item := range body.Items {
		refs = append(refs, store.SkillReference{Path: item.Path, Title: item.Title, Purpose: item.Purpose, Content: item.Content})
	}
	ctx := c.Request.Context()
	tx, err := s.St.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		fail(c, err)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	saved, err := store.ReplaceSkillReferences(ctx, tx, skill.ID, refs)
	if err != nil {
		if strings.HasPrefix(err.Error(), "references:") {
			fail(c, apperr.E("validation_error", err.Error(), http.StatusUnprocessableEntity))
			return
		}
		fail(c, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		fail(c, err)
		return
	}
	ok(c, gin.H{"items": skillReferenceDicts(saved, false)})
}
