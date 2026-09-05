import assert from "node:assert/strict"
import test from "node:test"

import { assistantRunGuidance } from "../src/features/assistant/domain/assistantGuidance.js"

test("offers source-oriented follow-ups for live web work", () => {
  assert.deepEqual(
    assistantRunGuidance({ mode: "agent", stage: "web_search", prompt: "查今天新闻" }).map((item) => item.id),
    ["verify-sources", "summarize-table", "deeper-search"],
  )
})

test("offers image follow-ups for image runs", () => {
  assert.deepEqual(
    assistantRunGuidance({ mode: "image", stage: "generating-image" }).map((item) => item.id),
    ["image-variant", "image-refine", "image-prompt"],
  )
})

test("recognizes file creation from the prompt", () => {
  assert.deepEqual(
    assistantRunGuidance({ mode: "chat", stage: "answering", prompt: "制作一份产品 PPT" }).map((item) => item.id),
    ["file-summary", "file-table", "file-export"],
  )
})

test("keeps ordinary chat suggestions concise and immutable", () => {
  const first = assistantRunGuidance({ mode: "chat", prompt: "解释这个概念" })
  first[0].label = "changed"
  const second = assistantRunGuidance({ mode: "chat", prompt: "解释这个概念" })
  assert.equal(second.length, 3)
  assert.equal(second[0].label, "深入说明")
})
