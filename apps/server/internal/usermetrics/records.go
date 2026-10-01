package usermetrics

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// RecordType selects which kind of records to list.
type RecordType string

const (
	RecordCreations RecordType = "creations"
	RecordSpend     RecordType = "spend"
	RecordIncome    RecordType = "income"
)

// RecordSort orders the list.
type RecordSort string

const (
	SortRecent  RecordSort = "recent"
	SortLargest RecordSort = "largest"
)

const maxRecordLimit = 50

// RecordsRequest lists individual records behind a statistic.
type RecordsRequest struct {
	Type      RecordType `json:"type"`
	Sort      RecordSort `json:"sort,omitempty"`
	Filters   Filters    `json:"filters,omitempty"`
	TimeRange TimeRange  `json:"timeRange,omitempty"`
	Timezone  string     `json:"timezone,omitempty"`
	Limit     int        `json:"limit,omitempty"`
}

// Record is one task, assistant run or wallet entry.
type Record struct {
	ID             string `json:"id"`
	Time           string `json:"time"`
	Workspace      string `json:"workspace,omitempty"`
	WorkspaceLabel string `json:"workspaceLabel,omitempty"`
	Model          string `json:"model,omitempty"`
	Status         string `json:"status,omitempty"`
	StatusLabel    string `json:"statusLabel,omitempty"`
	Source         string `json:"source,omitempty"`
	SourceLabel    string `json:"sourceLabel,omitempty"`
	Images         int64  `json:"images,omitempty"`
	Seconds        int64  `json:"seconds,omitempty"`
	Points         int64  `json:"points,omitempty"`
	Prompt         string `json:"prompt,omitempty"`
	Note           string `json:"note,omitempty"`
	// Link is an in-app path where the user can see the original item.
	Link string `json:"link,omitempty"`
}

// RecordsResult is the answer to a RecordsRequest.
type RecordsResult struct {
	Timezone string        `json:"timezone"`
	Range    ResolvedRange `json:"range"`
	Type     RecordType    `json:"type"`
	Records  []Record      `json:"records"`
	HasMore  bool          `json:"hasMore"`
}

func recordLink(recordType, workspace, conversationID string) string {
	switch recordType {
	case "assistant_run":
		if workspace == "infinite_canvas" {
			return "/canvas"
		}
		if conversationID != "" {
			return "/assistant?c=" + conversationID
		}
		return "/assistant"
	case "task":
		return "/history"
	}
	return ""
}

// ListRecords returns the user's own records. Like Query, userID must come
// from the authenticated session.
func ListRecords(ctx context.Context, db TxRunner, userID uuid.UUID, req RecordsRequest, now time.Time) (*RecordsResult, error) {
	if userID == uuid.Nil {
		return nil, invalid("缺少用户")
	}
	loc, timezone := resolveLocation(req.Timezone)
	window, err := req.TimeRange.Resolve(now, loc)
	if err != nil {
		return nil, invalid("%s", err.Error())
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 10
	}
	if limit > maxRecordLimit {
		limit = maxRecordLimit
	}
	sortOrder := req.Sort
	if sortOrder == "" {
		sortOrder = SortRecent
	}
	if sortOrder != SortRecent && sortOrder != SortLargest {
		return nil, invalid("不支持的排序：%s", sortOrder)
	}

	args := []any{userID, window.Start, window.End}
	where := []string{"created_at >= $2", "created_at < $3"}
	addFilter := func(column, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		args = append(args, value)
		where = append(where, column+" = $"+strconv.Itoa(len(args)))
	}
	var sql string
	switch req.Type {
	case RecordCreations:
		if req.Filters.Source != "" {
			return nil, invalid("积分来源筛选不适用于创作记录")
		}
		addFilter("workspace", req.Filters.Workspace)
		addFilter("model", req.Filters.Model)
		addFilter("status", req.Filters.Status)
		order := "created_at DESC"
		if sortOrder == SortLargest {
			order = "images DESC, created_at DESC"
		}
		sql = `WITH activity AS (` + store.UserActivityFactsSQL + `)
			SELECT id, created_at, workspace, model, status, '' AS source, images, seconds, 0::bigint,
				record_type, conversation_id, prompt, '' AS reason
			FROM activity WHERE ` + strings.Join(where, " AND ") + ` ORDER BY ` + order
	case RecordSpend, RecordIncome:
		if req.Filters.Status != "" {
			return nil, invalid("状态筛选不适用于积分记录")
		}
		amount := "spend_points"
		if req.Type == RecordIncome {
			amount = "income_points"
		}
		where = append(where, amount+" > 0")
		addFilter("workspace", req.Filters.Workspace)
		addFilter("model", req.Filters.Model)
		addFilter("source_type", req.Filters.Source)
		order := "created_at DESC"
		if sortOrder == SortLargest {
			order = amount + " DESC, created_at DESC"
		}
		sql = `WITH ledger AS (` + store.UserLedgerFactsSQL + `)
			SELECT id, created_at, workspace, model, '' AS status, source_type, 0::bigint, 0::bigint, ` + amount + `,
				CASE WHEN source_type IN ('task', 'assistant_run') THEN source_type ELSE '' END,
				conversation_id, prompt, reason
			FROM ledger WHERE ` + strings.Join(where, " AND ") + ` ORDER BY ` + order
	default:
		return nil, invalid("不支持的记录类型：%s", req.Type)
	}
	args = append(args, limit+1)
	sql += " LIMIT $" + strconv.Itoa(len(args))

	result := &RecordsResult{Timezone: timezone, Range: window, Type: req.Type, Records: []Record{}}
	err = db.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET TRANSACTION READ ONLY"); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "SET LOCAL statement_timeout = '"+statementTimeout+"'"); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var record Record
			var created time.Time
			var recordType, conversationID string
			if err := rows.Scan(&record.ID, &created, &record.Workspace, &record.Model, &record.Status, &record.Source,
				&record.Images, &record.Seconds, &record.Points, &recordType, &conversationID, &record.Prompt, &record.Note); err != nil {
				return err
			}
			record.Time = created.In(loc).Format("2006-01-02 15:04")
			record.WorkspaceLabel = labelFor(DimWorkspace, record.Workspace)
			if record.Status != "" {
				record.StatusLabel = labelFor(DimStatus, record.Status)
			}
			if record.Source != "" {
				record.SourceLabel = labelFor(DimSource, record.Source)
			}
			record.Link = recordLink(recordType, record.Workspace, conversationID)
			if req.Type != RecordCreations {
				// Wallet entries are not individually addressable elsewhere;
				// link to the related creation when there is one.
				if record.Link == "" {
					record.Link = "/wallet"
				}
			}
			result.Records = append(result.Records, record)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if len(result.Records) > limit {
		result.Records = result.Records[:limit]
		result.HasMore = true
	}
	return result, nil
}
