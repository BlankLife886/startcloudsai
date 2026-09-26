package store

import "strings"

// Shared by cancellation settlement and public policy. A queued recovery with
// known upstream jobs is still submitted; its visual status alone is not proof.
func TaskUpstreamSubmitted(task *Task) bool {
	if task == nil {
		return false
	}
	if task.HasPendingUpstream || TaskHasKnownCRUNJobs(task) {
		return true
	}
	stage, _ := task.Params["_generationStage"].(string)
	return task.Status == "running" && stage != "preparing"
}

func hasStringID(raw any) bool {
	switch values := raw.(type) {
	case []string:
		for _, value := range values {
			if strings.TrimSpace(value) != "" {
				return true
			}
		}
	case []any:
		for _, value := range values {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				return true
			}
		}
	case map[string]string:
		for _, value := range values {
			if strings.TrimSpace(value) != "" {
				return true
			}
		}
	case map[string]any:
		for _, value := range values {
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				return true
			}
		}
	}
	return false
}

func TaskHasKnownCRUNJobs(task *Task) bool {
	if task == nil {
		return false
	}
	switch task.Params["_crunTaskIds"].(type) {
	case []string, []any:
		return hasStringID(task.Params["_crunTaskIds"])
	}
	return false
}

// Quota remains attached to an unfinished logical batch during lease recovery.
// Terminal rows and historical image projections never retain a reservation.
func TaskRetainsImageReservation(task *Task) bool {
	if task == nil || (task.LeaseOwner != nil && *task.LeaseOwner == UIDesignAssetHistoryLeaseOwner) {
		return false
	}
	return task.Status == "running" || (task.Status == "queued" && (task.HasPendingUpstream || TaskHasKnownCRUNJobs(task)))
}

// A retained ID also binds lookup to its original provider after completion;
// callers decide whether the run is still active before counting quota.
func AssistantRunHasKnownImageJobs(run *AssistantRun) bool {
	if !AssistantRunIsImage(run) {
		return false
	}
	arrayKnown, mapKnown := false, false
	switch run.Params["_crunTaskIds"].(type) {
	case []string, []any:
		arrayKnown = hasStringID(run.Params["_crunTaskIds"])
	}
	switch run.Params["_c2aTaskIdsBySlot"].(type) {
	case map[string]string, map[string]any:
		mapKnown = hasStringID(run.Params["_c2aTaskIdsBySlot"])
	}
	return arrayKnown || mapKnown
}

func knownCRUNJobsSQL(table string) string {
	return `EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(` + table + `.params->'_crunTaskIds')='array' THEN ` + table + `.params->'_crunTaskIds' ELSE '[]'::jsonb END) known(value) WHERE jsonb_typeof(known.value)='string' AND btrim(known.value #>> '{}', E' \t\r\n')<>'')`
}

func taskRetainedExecutionSQL(table string) string {
	return `(` + table + `.status='queued' AND (` + knownCRUNJobsSQL(table) + ` OR EXISTS (SELECT 1 FROM task_upstream_attempts held WHERE held.task_id=` + table + `.id AND held.status IN ('submitting','pending'))))`
}

func taskExecutionActiveSQL(table string) string {
	return `((` + table + `.status='running' OR ` + taskRetainedExecutionSQL(table) + `) AND COALESCE(` + table + `.lease_owner,'')<>'` + UIDesignAssetHistoryLeaseOwner + `')`
}

func assistantKnownImageJobsSQL(table string) string {
	return `(` + assistantImageSQL(table) + ` AND (` + knownCRUNJobsSQL(table) + ` OR EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(` + table + `.params->'_c2aTaskIdsBySlot')='object' THEN ` + table + `.params->'_c2aTaskIdsBySlot' ELSE '{}'::jsonb END) known WHERE jsonb_typeof(known.value)='string' AND btrim(known.value #>> '{}', E' \t\r\n')<>'')))`
}

func assistantExecutionActiveSQL(table string) string {
	return `(` + table + `.status='running' OR (` + table + `.status='queued' AND ` + assistantKnownImageJobsSQL(table) + `))`
}
