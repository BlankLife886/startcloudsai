// Keep the same logical submission (including uploaded keys) until the server
// acknowledges it. Editing the draft or switching accounts starts a new one.
export function prepareHandheldSubmission(previous, input, createId = () => crypto.randomUUID()) {
  const { roleFiles = [], ...options } = input;
  const signature = JSON.stringify(options);
  if (previous?.signature === signature && previous.sources.length === roleFiles.length
    && previous.sources.every((source, index) => source.role === roleFiles[index].role && source.file === roleFiles[index].file)) {
    return previous;
  }
  return {
    signature,
    sources: roleFiles.map(({ role, file }) => ({ role, file })),
    idempotencyKey: createId(),
    payload: null,
  };
}
