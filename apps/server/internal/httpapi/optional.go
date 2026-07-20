package httpapi

import "encoding/json"

// Opt 区分「字段缺省」与「显式 null」，实现 pydantic exclude_unset 等价语义。
type Opt[T any] struct {
	Set   bool // 请求体中出现了该字段
	Valid bool // 且值非 null
	Value T
}

func (o *Opt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		return nil
	}
	if err := json.Unmarshal(b, &o.Value); err != nil {
		return err
	}
	o.Valid = true
	return nil
}

// Ptr 返回 *T：未提供或 null → nil。
func (o Opt[T]) Ptr() *T {
	if !o.Valid {
		return nil
	}
	v := o.Value
	return &v
}
