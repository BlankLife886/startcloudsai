export function balancedOptionColumns(count, singleRowMax = 8) {
  const total = Math.max(1, Math.floor(Number(count) || 1));
  const max = Math.max(1, Math.floor(Number(singleRowMax) || 1));
  return total <= max ? total : Math.ceil(total / 2);
}
