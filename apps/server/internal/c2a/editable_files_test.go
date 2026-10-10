package c2a

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEditableFileTaskSubmitPollAndDownload(t *testing.T) {
	var submitted map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/editable-file-tasks":
			if r.Method == http.MethodPost {
				if err := json.NewDecoder(r.Body).Decode(&submitted); err != nil {
					t.Fatal(err)
				}
				_, _ = w.Write([]byte(`{"id":"file-task-1","status":"queued","kind":"ppt"}`))
				return
			}
			if r.URL.Query().Get("ids") != "file-task-1" {
				t.Fatalf("ids = %q", r.URL.Query().Get("ids"))
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"file-task-1","status":"success","kind":"ppt","result":{"primary_url":"/files/deck.pptx","zip_url":"/files/assets.zip"}}],"missing_ids":[]}`))
		case "/files/deck.pptx":
			w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
			w.Header().Set("Content-Disposition", `attachment; filename="deck.pptx"`)
			_, _ = w.Write([]byte("PK\x03\x04pptx"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewWithPolicy(server.URL, "secret", 30, true)
	task, err := client.SubmitEditableFileTask(context.Background(), "file-task-1", "ppt", "制作产品介绍", nil)
	if err != nil || task.ID != "file-task-1" {
		t.Fatalf("submit task=%#v err=%v", task, err)
	}
	if submitted["client_task_id"] != "file-task-1" || submitted["kind"] != "ppt" {
		t.Fatalf("submitted = %#v", submitted)
	}
	task, err = client.PollEditableFileTask(context.Background(), "file-task-1")
	if err != nil || !task.Succeeded() || task.Result.PrimaryURL != "/files/deck.pptx" {
		t.Fatalf("poll task=%#v err=%v", task, err)
	}
	data, contentType, name, err := client.DownloadEditableFile(context.Background(), task.Result.PrimaryURL, 1<<20)
	if err != nil || string(data) != "PK\x03\x04pptx" || name != "deck.pptx" {
		t.Fatalf("download data=%q contentType=%q name=%q err=%v", data, contentType, name, err)
	}
}

func TestEditableFileTaskRequiresReferenceForPSD(t *testing.T) {
	client := NewWithPolicy("http://example.test", "secret", 30, true)
	if _, err := client.SubmitEditableFileTask(context.Background(), "task", "psd", "拆分海报", nil); err == nil {
		t.Fatal("PSD without reference image must fail before the request")
	}
}

func TestEditableFileDownloadRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "1024")
		_, _ = w.Write(make([]byte, 1024))
	}))
	defer server.Close()
	client := NewWithPolicy(server.URL, "secret", 30, true)
	if _, _, _, err := client.DownloadEditableFile(context.Background(), server.URL+"/file", 16); err == nil {
		t.Fatal("oversized response must be rejected")
	}
}
