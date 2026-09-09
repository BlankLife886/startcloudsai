package main

import (
	"github.com/hibiken/asynq"
	"testing"
)

func TestWorkerPoolsReadinessRejectsOldOrStoppedConsumers(t *testing.T) {
	img := &asynq.ServerInfo{Host: "current", Status: "active", Concurrency: 32, Queues: map[string]int{"default": 3, "assistant-image": 3}}
	chat := &asynq.ServerInfo{Host: "old", Status: "active", Concurrency: 8, Queues: map[string]int{"assistant-chat": 1}}
	if workerPoolsReady([]*asynq.ServerInfo{img, chat}, "current") {
		t.Fatal("old host cannot make this release ready")
	}
	chat.Host = "current"
	chat.Status = "stopped"
	if workerPoolsReady([]*asynq.ServerInfo{img, chat}, "current") {
		t.Fatal("stopped consumer cannot make this release ready")
	}
	chat.Status = "active"
	if !workerPoolsReady([]*asynq.ServerInfo{img, chat}, "current") {
		t.Fatal("both active pools should be ready")
	}
}
