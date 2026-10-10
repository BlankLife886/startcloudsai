package worker

import (
	"context"
	"log"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/skillmention"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// taskPromptWithSkills 把任务提示词里的 `@官方技能` 展开成技能正文后再交给
// prompt.Compile。任务表只保存用户写的文字，官方技能正文只出现在发给上游的请求里。
// 技能是增强项：读取失败时按原提示词执行，不让它挡住生成。
func (w *Worker) taskPromptWithSkills(ctx context.Context, task *store.Task) string {
	if !strings.Contains(task.Prompt, "@") || w.St == nil || w.St.Pool == nil {
		return task.Prompt
	}
	if taskParamBool(task.Params, "_skillsDisabled") {
		return w.promptWithoutSkillMentions(ctx, task.Prompt)
	}
	expanded, skills, err := skillmention.ExpandOfficial(ctx, w.St.Pool, task.Prompt)
	if err != nil {
		log.Printf("task %s: expand official skills failed: %v", task.ID, err)
		return task.Prompt
	}
	if len(skills) > 0 {
		slugs := make([]string, 0, len(skills))
		for _, skill := range skills {
			slugs = append(slugs, skill.Slug)
		}
		log.Printf("task %s: official skills applied: %s", task.ID, strings.Join(slugs, ","))
	}
	return expanded
}

// promptWithoutSkillMentions drops @skill tokens for a model that does not use
// skills, so the upstream sees neither the skill text nor the bare mention.
func (w *Worker) promptWithoutSkillMentions(ctx context.Context, text string) string {
	mentions, err := skillmention.FindOfficial(ctx, w.St.Pool, text)
	if err != nil || len(mentions) == 0 {
		return text
	}
	return strings.TrimSpace(skillmention.Strip(text, mentions))
}
