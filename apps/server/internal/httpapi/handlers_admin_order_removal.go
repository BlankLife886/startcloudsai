package httpapi

import (
	"errors"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

func (s *Server) adminDeleteExpiredOrder(c *gin.Context, admin *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	ctx := c.Request.Context()
	err = s.St.Tx(ctx, func(tx pgx.Tx) error { _, err := store.RemoveExpiredOrder(ctx, tx, id, admin.ID); return err })
	if errors.Is(err, pgx.ErrNoRows) {
		err = apperr.E("not_found", "订单不存在", 404)
	}
	if errors.Is(err, store.ErrOrderNotRemovable) {
		err = apperr.E("order_not_deletable", "仅可删除未收款、未发放权益且未在对账或变更处理中的已过期订单", 409)
	}
	if err != nil {
		fail(c, err)
		return
	}
	c.Status(204)
}
