package httpapi

import (
	"strings"
	"unicode"
)

// safeCSVCell prevents spreadsheet programs from evaluating exported text as a formula.
func safeCSVCell(value string) string {
	trimmed := strings.TrimLeftFunc(value, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	})
	if trimmed == "" {
		return value
	}
	switch trimmed[0] {
	case '=', '+', '-', '@':
		return "'" + value
	default:
		return value
	}
}

func safeCSVRow(values ...string) []string {
	for index := range values {
		values[index] = safeCSVCell(values[index])
	}
	return values
}
