package crun

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExactSizeIsSentToCRUNEstimateAndSubmission(t *testing.T) {
	for _, fields := range [][]string{{"size"}, {"width", "height"}} {
		t.Run(fields[0], func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Input map[string]any `json:"input"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if fields[0] == "size" && body.Input["size"] != "1001x777" {
					t.Errorf("exact size lost: %#v", body.Input)
				}
				if fields[0] == "width" && (body.Input["width"] != float64(1001) || body.Input["height"] != float64(777)) {
					t.Errorf("exact dimensions lost: %#v", body.Input)
				}
				if body.Input["resolution"] != nil || body.Input["aspect_ratio"] != nil {
					t.Errorf("approximate dimensions leaked: %#v", body.Input)
				}
				calls++
				if r.URL.Path == "/api/v1/client/job/EstimateTask" {
					fmt.Fprint(w, `{"code":200,"data":{"estimated_credits":2,"balance":50,"affordable":true}}`)
				} else {
					fmt.Fprint(w, `{"code":200,"data":{"task_id":"exact-image"}}`)
				}
			}))
			defer upstream.Close()
			client, err := New(upstream.URL, "test-key", "exact-model", 2)
			if err != nil {
				t.Fatal(err)
			}
			id, err := client.CreateTaskWithRequest(context.Background(), OpenAIImageRequest{
				Prompt: "poster", Size: "1001x777", ExactSize: true, ExactWidth: 1001, ExactHeight: 777,
				ExactSizeFields: fields, AllowedInputFields: append([]string{"prompt", "resolution", "aspect_ratio"}, fields...),
				Resolution: "4K", AspectRatio: "1:1",
			})
			if err != nil || id != "exact-image" || calls != 2 {
				t.Fatalf("id=%q calls=%d err=%v", id, calls, err)
			}
		})
	}
}

func TestExactSizeCRUNNeverDropsUnsupportedDimensions(t *testing.T) {
	client, err := New("http://127.0.0.1:1", "test-key", "ratio-only", 1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.CreateTaskWithRequest(context.Background(), OpenAIImageRequest{
		Prompt: "poster", Size: "1001x777", ExactSize: true, ExactWidth: 1001, ExactHeight: 777,
		AllowedInputFields: []string{"prompt", "resolution", "aspect_ratio"},
	})
	if err == nil {
		t.Fatal("exact dimensions were silently dropped")
	}
}
