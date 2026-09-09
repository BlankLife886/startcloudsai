package worker

import (
	"encoding/json"
	"path"
	"strconv"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// Public output lists are compact; only the private slot record or a legacy
// worker-generated object name establishes the original upstream position.
func restoreTaskOutputSlots(task *store.Task, originals, thumbnails []string) []string {
	allowedOriginals, allowedThumbnails := map[string]bool{}, map[string]bool{}
	for _, key := range task.OutputKeys {
		if key != "" {
			allowedOriginals[key] = true
		}
	}
	for _, key := range task.ThumbnailKeys {
		if key != "" {
			allowedThumbnails[key] = true
		}
	}
	seen := map[string]bool{}
	var slots store.TaskOutputSlots
	if raw, err := json.Marshal(task.Params[store.TaskOutputSlotsParam]); err == nil && json.Unmarshal(raw, &slots) == nil && slots.Version == 1 {
		for index, key := range slots.Originals {
			if index >= len(originals) || !allowedOriginals[key] || seen[key] {
				continue
			}
			originals[index] = key
			seen[key] = true
			if index < len(slots.Thumbnails) && allowedThumbnails[slots.Thumbnails[index]] {
				thumbnails[index] = slots.Thumbnails[index]
			}
		}
	}
	var obsolete []string
	for position, key := range task.OutputKeys {
		if key == "" || seen[key] {
			continue
		}
		name := path.Base(key)
		end := strings.IndexAny(name, "-.")
		index, err := strconv.Atoi(name)
		if end > 0 {
			index, err = strconv.Atoi(name[:end])
		}
		if err != nil && (len(task.OutputKeys) == len(originals) || len(originals) == 1) {
			index, err = position, nil
		}
		if err == nil && index >= 0 && index < len(originals) && originals[index] == "" {
			originals[index] = key
			seen[key] = true
			if position < len(task.ThumbnailKeys) && allowedThumbnails[task.ThumbnailKeys[position]] {
				thumbnails[index] = task.ThumbnailKeys[position]
			}
			continue
		}
		// Unknown partial positions are fetched again instead of guessed. Their
		// old objects are queued for reference-aware cleanup after a new write.
		obsolete = append(obsolete, key)
		if position < len(task.ThumbnailKeys) {
			obsolete = append(obsolete, task.ThumbnailKeys[position])
		}
	}
	return store.WithDisplayKeys(obsolete)
}
