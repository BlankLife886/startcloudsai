package taskflow

import "strings"

// Params comes from clients, including historical request reconstruction.
// Only these two underscore-prefixed values are public business labels;
// routing, pricing, leases and upstream IDs are always produced by the server.
func incomingTaskParams(params, trusted map[string]any) map[string]any {
	out := make(map[string]any, len(params)+len(trusted))
	for key, value := range params {
		if strings.HasPrefix(key, "_") && key != "_kind" && key != "_source" {
			continue
		}
		if key == "_kind" && value == "ui-design-region-edit" {
			continue
		}
		out[key] = value
	}
	for key, value := range trusted {
		out[key] = value
	}
	return out
}
