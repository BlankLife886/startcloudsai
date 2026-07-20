# 收藏壁纸

更新时间：2026-06-03

这里承接全屏预览里的收藏业务：收藏状态同步、收藏/取消收藏事件和提示。

当前实现：

- `usePreviewFavorite.js` 包装 favorites store，统一维护 `isFavorite`。
- 主弹窗在换图时调用 `syncFavoriteState`。
- 工具栏只派发收藏事件，不直接访问 store。
