/**
 * 提示词库：旧后端接口已下线，返回空列表，工作台的提示词面板自动隐藏远端内容。
 */
export async function listPromptLibrary() {
  return { items: [], pagination: { hasMore: false } }
}
