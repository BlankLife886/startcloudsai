package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestScenarioEventValidation(t *testing.T) {
	valid := `BILLING_SCENARIO {"test":"expected","name":"扣费","expected":"3","actual":"3","passed":true}`
	if step, ok := scenarioEvent(valid, "expected"); !ok || !step.Passed {
		t.Fatal("valid result rejected")
	}
	child := strings.Replace(valid, `"test":"expected"`, `"test":"expected/c2a"`, 1)
	if _, ok := scenarioEvent(child, "expected"); !ok {
		t.Fatal("selected scenario subtest rejected")
	}
	nearby := strings.Replace(valid, `"test":"expected"`, `"test":"expected_other"`, 1)
	if _, ok := scenarioEvent(nearby, "expected"); ok {
		t.Fatal("another test's result was accepted")
	}
	for _, line := range []string{"PASS", "BILLING_SCENARIO {", strings.Replace(valid, "expected", "other", 1), strings.Replace(valid, "扣费", "", 1), strings.Replace(valid, "扣费", strings.Repeat("x", 501), 1)} {
		if _, ok := scenarioEvent(line, "expected"); ok {
			t.Fatalf("accepted invalid event: %.80s", line)
		}
	}
}

func TestScenarioStartGuardsAndSnapshot(t *testing.T) {
	l := &lab{}
	if _, err := l.startScenario("anything"); err == nil {
		t.Fatal("unknown scenario accepted")
	}
	if _, err := l.startScenario("plan_price"); err == nil {
		t.Fatal("missing executable accepted")
	}
	l.scenarioBinary = "/unused"
	l.scenarioRuns = map[string]*scenarioReport{"plan_price": {ID: "plan_price", Status: "running", Steps: []scenarioStep{{Name: "original"}}}}
	if _, err := l.startScenario("model_price"); err == nil {
		t.Fatal("parallel scenario accepted")
	}
	snapshot := l.scenarioSnapshotLocked()
	snapshot[0].Steps[0].Name = "changed"
	if l.scenarioRuns["plan_price"].Steps[0].Name != "original" {
		t.Fatal("snapshot aliases live result")
	}
	ctx, cancel := context.WithCancel(context.Background())
	l.scenarioCancel = cancel
	l.stopScenario()
	if ctx.Err() == nil || l.scenarioRuns["plan_price"].Status != "stopping" {
		t.Fatal("stop did not cancel")
	}
}

// Run as a subprocess by TestScenarioRunnerResults. Normal package runs skip it.
func TestScenarioProcessHelper(t *testing.T) {
	if os.Getenv("APP_SECRET") != "scenario-process-local-only-secret-001" {
		t.Skip("subprocess helper")
	}
	switch os.Getenv("TEST_DATABASE_URL") {
	case "empty":
		return
	case "failure":
		fmt.Println(`BILLING_SCENARIO {"test":"TestScenarioProcessHelper","name":"check","expected":"3","actual":"5","passed":false}`)
	case "success":
		fmt.Println(`BILLING_SCENARIO {"test":"TestScenarioProcessHelper","name":"check","expected":"3","actual":"3","passed":true}`)
	case "exit":
		t.Fatal("simulated subprocess failure")
	default:
		t.Fatal("unexpected helper mode")
	}
}

func TestScenarioRunnerResults(t *testing.T) {
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ mode, want string }{{"empty", "failed"}, {"failure", "failed"}, {"success", "passed"}, {"exit", "failed"}, {"cancel", "cancelled"}} {
		t.Run(tc.mode, func(t *testing.T) {
			l := &lab{scenarioBinary: binary, scenarioDB: tc.mode, scenarioRuns: map[string]*scenarioReport{"test": {RunID: "run", Status: "running"}}}
			ctx, cancel := context.WithCancel(context.Background())
			if tc.mode == "cancel" {
				cancel()
			}
			l.executeScenario(ctx, cancel, scenarioDefinition{ID: "test", Test: "TestScenarioProcessHelper", MinimumChecks: 1}, "run")
			r := l.scenarioRuns["test"]
			if r.Status != tc.want || r.FinishedAt == nil {
				t.Fatalf("result=%+v, want %s", r, tc.want)
			}
			if tc.want != "passed" && r.Error == "" {
				t.Fatal("failure has no explanation")
			}
		})
	}
}
