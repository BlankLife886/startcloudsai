// Package apperr 定义统一业务错误模型：
// handler 返回 *Error → 中间件输出 {"success": false, "code": "...", "error": "..."}。
package apperr

import "errors"

type Error struct {
	Code    string
	Message string
	Status  int
}

func (e *Error) Error() string { return e.Message }

// E 构造业务错误。
func E(code, message string, status int) *Error {
	return &Error{Code: code, Message: message, Status: status}
}

// As 尝试把任意 error 解析为 *Error。
func As(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}
