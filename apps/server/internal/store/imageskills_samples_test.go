package store

import (
	"strings"
	"testing"
)

func TestNormalizeSkillSamplesLimitsCountAndCaption(t *testing.T) {
	samples := make([]SkillSampleImage, SkillMaxSampleImages+1)
	if _, err := NormalizeSkillSamples(samples); err == nil {
		t.Fatal("expected too many samples to be rejected")
	}
	if _, err := NormalizeSkillSamples([]SkillSampleImage{{Key: "k", Caption: strings.Repeat("字", SkillMaxSampleCaptionLen+1)}}); err == nil {
		t.Fatal("expected over-long caption to be rejected")
	}
	got, err := NormalizeSkillSamples([]SkillSampleImage{{Key: " k ", Caption: " 流程‮图 "}})
	if err != nil || len(got) != 1 || got[0].Key != "k" || got[0].Caption != "流程图" {
		t.Fatalf("normalized = %#v, %v", got, err)
	}
}
