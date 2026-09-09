package worker

import (
	"fmt"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func taskOutputMemoryWeight(task *store.Task, encoded string, incomingBytes int, budget int64) (int64, error) {
	if budget < 1 {
		return 0, fmt.Errorf("image memory budget is unavailable")
	}
	width, height, err := media.Base64Dimensions(encoded)
	if err != nil {
		return 0, fmt.Errorf("upstream output dimensions: %w", err)
	}
	// Cover parallel decoders, RGBA transforms and encoder scratch buffers.
	weight := min(max(int64(incomingBytes)*6, int64(width)*int64(height)*32, 1<<20), budget)
	if taskParamBool(task.Params, "preserveSourceCanvas") || (taskParamString(task.Params, "maskKey") != "" && taskParamString(task.Params, "maskBaseKey") != "") {
		weight = budget
	}
	if taskParamBool(task.Params, "strictAlphaOutput") {
		alphaWeight, err := strictAlphaOutputMemoryWeight(encoded)
		if err != nil {
			return 0, err
		}
		weight = min(max(weight, alphaWeight), budget)
	}
	return weight, nil
}
