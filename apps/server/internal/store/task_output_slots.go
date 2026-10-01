package store

const TaskOutputSlotsParam = "_outputSlots"

type TaskOutputSlots struct {
	Version    int      `json:"version"`
	Originals  []string `json:"originals"`
	Thumbnails []string `json:"thumbnails"`
}

func compactOutputKeys(slots []string) []string {
	keys := make([]string, 0, len(slots))
	for _, key := range slots {
		if key != "" {
			keys = append(keys, key)
		}
	}
	return keys
}
