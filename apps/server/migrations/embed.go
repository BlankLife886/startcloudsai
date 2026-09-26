// Package migrations embeds goose SQL migrations into the binary.
package migrations

import "embed"

// Only numbered migrations are embedded. This excludes AppleDouble files such
// as ._00001_initial_schema.sql that some archive extractors create.
//go:embed 0*.sql
var FS embed.FS
