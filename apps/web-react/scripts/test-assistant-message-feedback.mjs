import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiFile = new URL("../src/features/assistant/services/assistantApi.js", import.meta.url);
const viewFile = new URL("../src/features/assistant/useAssistantWorkspaceController.js", import.meta.url);
const partsFile = new URL("../src/features/assistant/AssistantMessageComponents.jsx", import.meta.url);
const styleFile = new URL("../src/views/assistant-workspace-react.css", import.meta.url);

test("assistant feedback API sends the PUT contract and supports cancellation", async () => {
  const source = await readFile(apiFile, "utf8");
  const apiImport = `import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiRequest,
  buildApiPath,
} from '@react/legacy-modules/services/apiClient.js'\n`;
  assert.ok(source.includes(apiImport), "assistantApi apiClient import changed");

  const calls = [];
  const unexpected = () => {
    throw new Error("unexpected API dependency call");
  };
  globalThis.__assistantFeedbackApiTestDeps = {
    ApiError: class extends Error {},
    apiDelete: unexpected,
    apiGet: unexpected,
    apiPatch: unexpected,
    apiPost: unexpected,
    apiRequest: async (...args) => {
      calls.push(args);
      return { id: "answer/42", feedback: args[1].body.rating };
    },
    buildApiPath: unexpected,
  };

  try {
    const executable = source.replace(
      apiImport,
      "const { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiRequest, buildApiPath } = globalThis.__assistantFeedbackApiTestDeps\n",
    );
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(executable).toString("base64")}#feedback-test`;
    const assistantApi = await import(moduleUrl);

    const positive = await assistantApi.setAssistantMessageFeedback("answer/42", "positive");
    assert.equal(positive.feedback, "positive");
    assert.deepEqual(calls[0], [
      "/assistant/messages/answer%2F42/feedback",
      {
        method: "PUT",
        body: { rating: "positive" },
        fallbackMessage: "回复评价提交失败",
      },
    ]);

    const canceled = await assistantApi.setAssistantMessageFeedback("answer/42", "");
    assert.equal(canceled.feedback, "");
    assert.deepEqual(calls[1][1].body, { rating: "" });

    await assert.rejects(
      assistantApi.setAssistantMessageFeedback("answer/42", "mixed"),
      /不支持的回复评价/,
    );
    assert.equal(calls.length, 2, "invalid feedback must not reach the API");
  } finally {
    delete globalThis.__assistantFeedbackApiTestDeps;
  }
});

test("completed assistant messages expose accessible, request-safe feedback controls", async () => {
  const [viewSource, partsSource, styleSource] = await Promise.all([
    readFile(viewFile, "utf8"),
    readFile(partsFile, "utf8"),
    readFile(styleFile, "utf8"),
  ]);
  const start = partsSource.indexOf("function AssistantMessageFeedbackActions");
  const end = partsSource.indexOf("\nfunction ", start + 1);
  assert.ok(start >= 0 && end > start, "feedback action component is missing");
  const controls = partsSource.slice(start, end);

  assert.equal((controls.match(/<button/g) || []).length, 2, "feedback UI must contain only two icon buttons");
  assert.equal((controls.match(/disabled=\{busy\}/g) || []).length, 2);
  assert.match(controls, /aria-pressed=\{feedback === "positive"\}/);
  assert.match(controls, /aria-pressed=\{feedback === "negative"\}/);
  assert.match(controls, /title=\{feedback === "positive" \? "取消赞" : "赞"\}/);
  assert.match(controls, /title=\{feedback === "negative" \? "取消踩" : "踩"\}/);
  assert.match(controls, /bi-hand-thumbs-up/);
  assert.match(controls, /bi-hand-thumbs-down/);
  assert.doesNotMatch(controls, /<span/, "feedback buttons must not show text labels");

  assert.match(partsSource, /message\.role === "assistant" && !message\.pending/);
  assert.match(partsSource, /message\.kind === "context-divider" \?/);
  assert.match(viewSource, /nextRating = message\.feedback === rating \? "" : rating/);
  assert.match(viewSource, /feedbackRequestsRef\.current\.has\(messageId\)/);
  assert.match(viewSource, /messages: conversation\.messages\.map\(/);
  assert.match(viewSource, /notificationService\.error\(error\?\.message \|\| "回复评价提交失败"\)/);
  assert.match(partsSource, /className="regenerate-button"/);
  assert.match(styleSource, /button\.message-feedback-button\.is-active/);
});
