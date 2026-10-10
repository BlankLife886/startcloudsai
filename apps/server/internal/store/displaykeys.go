package store

import "strings"

// DisplayKeyForOriginal 由原图 key 推导展示图（压缩图）key。
// 约定：.../original/{name}.{ext} → .../display/{name}（不带扩展名，
// 内容类型由对象存储元数据提供）。展示图不入库，靠该约定双向定位；
// 旧图没有展示图时前端回退加载原图。
func DisplayKeyForOriginal(key string) string {
	idx := strings.LastIndex(key, "/original/")
	if idx < 0 {
		return ""
	}
	name := key[idx+len("/original/"):]
	if dot := strings.LastIndex(name, "."); dot > 0 {
		name = name[:dot]
	}
	if name == "" || strings.Contains(name, "/") {
		return ""
	}
	return key[:idx] + "/display/" + name
}

// ThumbKeyForOriginal 由原图 key 推导小图 key（同展示图约定，不带扩展名）。
// 旧数据的小图带 .jpg 扩展名，取不到时前端回退原图。
func ThumbKeyForOriginal(key string) string {
	display := DisplayKeyForOriginal(key)
	if display == "" {
		return ""
	}
	return strings.Replace(display, "/display/", "/thumb/", 1)
}

// AssistantVariantKeys 由助手原图 key 推导小图/展示图 key。
// 约定：tasks/{u}/assistant/{run}/{n}.{ext} → 同目录 {n}-thumb 与 {n}-display。
func AssistantVariantKeys(key string) []string {
	if !strings.Contains(key, "/assistant/") {
		return nil
	}
	base := key
	if dot := strings.LastIndex(base, "."); dot > strings.LastIndex(base, "/") {
		base = base[:dot]
	}
	if base == "" {
		return nil
	}
	return []string{base + "-thumb", base + "-display"}
}

// WithDisplayKeys 在对象清理列表里补上由原图推导出的展示图 key，
// 防止删除任务时展示图变成孤儿对象。
func WithDisplayKeys(keys []string) []string {
	out := append([]string(nil), keys...)
	for _, key := range keys {
		if display := DisplayKeyForOriginal(key); display != "" {
			out = append(out, display)
		}
	}
	return out
}
