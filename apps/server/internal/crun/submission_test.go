package crun

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestCreateErrorsAreNotRetryableWithoutAcknowledgement(t *testing.T) {
	for _, operation := range []string{"image", "background", "media"} {
		for _, response := range []string{"500", "502", "disconnect", "bad-json", "missing-id"} {
			t.Run(operation+"/"+response, func(t *testing.T) {
				var creates atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/api/v1/client/job/EstimateTask" {
						fmt.Fprint(w, `{"code":200,"data":{"affordable":true}}`)
						return
					}
					creates.Add(1)
					switch response {
					case "500", "502":
						status := http.StatusInternalServerError
						if response == "502" {
							status = http.StatusBadGateway
						}
						w.WriteHeader(status)
						fmt.Fprint(w, `{"code":500,"message":"lost acknowledgement"}`)
					case "disconnect":
						conn, _, err := w.(http.Hijacker).Hijack()
						if err == nil {
							_ = conn.Close()
						}
					case "bad-json":
						fmt.Fprint(w, `<html>gateway unavailable</html>`)
					case "missing-id":
						fmt.Fprint(w, `{"code":200,"data":{}}`)
					}
				}))
				defer server.Close()
				client, err := New(server.URL, "test", "image-model", 5)
				if err != nil {
					t.Fatal(err)
				}
				switch operation {
				case "image":
					_, err = client.CreateTaskWithRequest(context.Background(), OpenAIImageRequest{Prompt: "test"})
				case "background":
					_, err = client.CreateBackgroundRemovalTask(context.Background(), "https://example.test/image.png")
				case "media":
					_, err = client.CreateMediaTask(context.Background(), MediaTaskRequest{Model: "tool", Input: map[string]any{}})
				}
				var uncertain *SubmissionUncertainError
				if !errors.As(err, &uncertain) || IsRetryableError(err) || creates.Load() != 1 {
					t.Fatalf("err=%v retryable=%v creates=%d", err, IsRetryableError(err), creates.Load())
				}
			})
		}
	}
}

func TestEstimateFailureIsSafeBeforeCreatingAnyJob(t *testing.T) {
	var creates atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/client/job/CreateTask" {
			creates.Add(1)
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, `{"code":503,"message":"estimate unavailable"}`)
	}))
	defer server.Close()
	client, err := New(server.URL, "test", "image-model", 5)
	if err != nil {
		t.Fatal(err)
	}
	ids, err := client.CreateImageTasks(context.Background(), OpenAIImageRequest{Prompt: "test", N: 2}, nil, nil)
	var preflight *PreflightError
	if !errors.As(err, &preflight) || !IsRetryableError(err) || len(ids) != 0 || creates.Load() != 0 {
		t.Fatalf("ids=%v err=%v creates=%d", ids, err, creates.Load())
	}
}
