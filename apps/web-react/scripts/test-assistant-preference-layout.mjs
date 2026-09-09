import assert from "node:assert/strict";
import test from "node:test";
import { balancedOptionColumns } from "../src/features/assistant/adaptiveOptionGrid.js";

test("dynamic option grids fill a single row when they fit", () => {
  assert.equal(balancedOptionColumns(1), 1);
  assert.equal(balancedOptionColumns(5), 5);
  assert.equal(balancedOptionColumns(8), 8);
});

test("large dynamic option sets use two balanced rows", () => {
  assert.equal(balancedOptionColumns(9), 5);
  assert.equal(balancedOptionColumns(12), 6);
  assert.equal(balancedOptionColumns(16), 8);
});

test("invalid option counts retain one stable column", () => {
  assert.equal(balancedOptionColumns(0), 1);
  assert.equal(balancedOptionColumns(undefined), 1);
});
