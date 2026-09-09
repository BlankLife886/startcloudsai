// Package upstreamguard fences the exact boundary before a generation request
// leaves the process. Reference downloads and free estimates do not invoke it.
package upstreamguard

import (
	"context"
	"errors"
)

type key struct{}
type BeforeSubmit func(context.Context) error
type NotSentError struct{ Err error }

func (e *NotSentError) Error() string { return "generation request was not sent: " + e.Err.Error() }
func (e *NotSentError) Unwrap() error { return e.Err }
func WasNotSent(err error) bool       { var blocked *NotSentError; return errors.As(err, &blocked) }
func With(ctx context.Context, before BeforeSubmit) context.Context {
	return context.WithValue(ctx, key{}, before)
}
func Check(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return &NotSentError{Err: err}
	}
	if before, ok := ctx.Value(key{}).(BeforeSubmit); ok {
		if err := before(ctx); err != nil {
			return &NotSentError{Err: err}
		}
	}
	return nil
}
