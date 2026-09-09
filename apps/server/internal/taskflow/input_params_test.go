package taskflow

import "testing"

func TestIncomingTaskParamsSeparatesPublicAndTrustedState(t *testing.T) {
	client := map[string]any{"quality": "high", "_source": "react_canvas", "_kind": "wallpaper-image-generation", "_providerConfigId": "private", "_modelConfigId": "private", "_apiKeyId": "forged", "_inputImageLongEdge": 1, "_automatic": true, "_completionClaimId": "fake", "_outputSlots": map[string]any{"version": 1}}
	params := incomingTaskParams(client, map[string]any{"_apiKeyId": "actual-key", "_inputImageLongEdge": 4096, "_automatic": true})
	for _, key := range []string{"_providerConfigId", "_modelConfigId", "_completionClaimId", "_outputSlots"} {
		if _, ok := params[key]; ok {
			t.Fatalf("untrusted execution key survived: %s", key)
		}
	}
	if params["_apiKeyId"] != "actual-key" || params["_inputImageLongEdge"] != 4096 || params["_automatic"] != true || params["_source"] != "react_canvas" || params["quality"] != "high" {
		t.Fatalf("public/trusted fields lost: %v", params)
	}
	if client["_apiKeyId"] != "forged" {
		t.Fatal("input map was modified")
	}
}
