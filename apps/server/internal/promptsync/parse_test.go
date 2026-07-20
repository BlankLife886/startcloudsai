// 三格式解析器单测（内嵌样本文本）+ itemKey 稳定性。
package promptsync

import (
	"testing"
)

func TestParseJSONPrompts(t *testing.T) {
	text := `[
		{"id": 1, "title_cn": "中文标题", "title": "English Title", "category": "advertising",
		 "category_cn": "广告设计", "prompt": "a long enough prompt text", "image": "images/a.png"},
		{"title": "短提示词被过滤", "prompt": "short"},
		{"name": "Named", "prompt_text": "another prompt body here", "tags": ["x", "y"],
		 "preview": "https://cdn.example.com/b.jpg"}
	]`
	items, err := Parse(text, "json", "https://example.com/dir/prompts.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %d", len(items))
	}
	first := items[0]
	if first.Key != "1" || first.Label != "中文标题" || first.Prompt != "a long enough prompt text" {
		t.Fatalf("unexpected first item: %+v", first)
	}
	// 相对路径按 sourceUrl 解析为绝对 URL
	if first.ImageURL != "https://example.com/dir/images/a.png" {
		t.Fatalf("unexpected imageUrl: %q", first.ImageURL)
	}
	if len(first.Tags) != 2 || first.Tags[0] != "广告设计" || first.Tags[1] != "advertising" {
		t.Fatalf("unexpected tags: %v", first.Tags)
	}
	if items[1].Key != "" || items[1].Label != "Named" {
		t.Fatalf("unexpected second item: %+v", items[1])
	}
	// 有 id 的词条 itemKey = id；无 id 的用 sha256(label\nprompt)
	if k := StableItemKey(first, 0); k != "1" {
		t.Fatalf("want key 1, got %q", k)
	}
	if k := StableItemKey(items[1], 1); k != sha256Hex("Named\nanother prompt body here") {
		t.Fatalf("unexpected hash key: %q", k)
	}
}

func TestParseJSONWrappedAndInvalid(t *testing.T) {
	items, err := Parse(`{"prompts": [{"title": "t", "prompt": "long enough prompt"}]}`, "json", "https://e.com/p.json")
	if err != nil || len(items) != 1 {
		t.Fatalf("wrapped prompts: items=%d err=%v", len(items), err)
	}
	if _, err := Parse(`not json`, "json", "https://e.com/p.json"); err == nil {
		t.Fatal("invalid json should error")
	}
}

const markdownSample = "# 大标题\n\n## 人物类\n\n### No. 1: 提示词甲\n\n<img src=\"./img/one.png\" width=\"300\">\n\n**提示词:**\n```\n把人物变成手办风格，细节丰富\n```\n\n**来源**：某处\n\n### 提示词乙\n\n#### 📝 提示词\n\n第二段提示词内容足够长\n\n#### 其它\n\n## 场景类\n\n### 提示词丙\n\n![预览](https://cdn.example.com/three.jpg)\n\n**Prompt:**\n\n第三段提示词内容也够长\n"

func TestParseMarkdownPrompts(t *testing.T) {
	items, err := Parse(markdownSample, "markdown", "https://cdn.jsdelivr.net/gh/x/y@main/README.md")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 {
		t.Fatalf("want 3 items, got %d", len(items))
	}
	// No.前缀与 markdown 符号被清理；``` 围栏被剥掉
	if items[0].Label != "提示词甲" || items[0].Prompt != "把人物变成手办风格，细节丰富" {
		t.Fatalf("unexpected item0: %+v", items[0])
	}
	// <img src> 相对路径解析
	if items[0].ImageURL != "https://cdn.jsdelivr.net/gh/x/y@main/img/one.png" {
		t.Fatalf("unexpected item0 image: %q", items[0].ImageURL)
	}
	// 最近的 ## 标题作为 tag
	if len(items[0].Tags) != 1 || items[0].Tags[0] != "人物类" {
		t.Fatalf("unexpected item0 tags: %v", items[0].Tags)
	}
	if items[1].Prompt != "第二段提示词内容足够长" {
		t.Fatalf("unexpected item1 prompt: %q", items[1].Prompt)
	}
	if items[2].Tags[0] != "场景类" || items[2].ImageURL != "https://cdn.example.com/three.jpg" {
		t.Fatalf("unexpected item2: %+v", items[2])
	}
}

const htmlSample = `<html><body>
<article><h2>卡片一 &amp; 示例</h2>
<img src="/covers/1.png">
<p class="text-xs">说明文字</p>
<p class="whitespace-pre-wrap">这是第一条完整提示词内容</p>
</article>
<article><h3>卡片二</h3>
<p style="word-break:break-all">too&nbsp;low</p>
</article>
<article><p class="whitespace-pre-wrap">没有标题但提示词足够长</p></article>
</body></html>`

func TestParseHTMLPrompts(t *testing.T) {
	items, err := Parse(htmlSample, "html", "https://site.example.com/page/Prompts.html")
	if err != nil {
		t.Fatal(err)
	}
	// 卡片二 prompt 长度 < 8 被过滤
	if len(items) != 2 {
		t.Fatalf("want 2 items, got %d", len(items))
	}
	if items[0].Label != "卡片一 & 示例" || items[0].Prompt != "这是第一条完整提示词内容" {
		t.Fatalf("unexpected item0: %+v", items[0])
	}
	if items[0].ImageURL != "https://site.example.com/covers/1.png" {
		t.Fatalf("unexpected item0 image: %q", items[0].ImageURL)
	}
	if items[1].Label != "未命名提示词" {
		t.Fatalf("unexpected item1 label: %q", items[1].Label)
	}
}

func TestStableItemKeySanitizesKey(t *testing.T) {
	// key 含非法字符被清洗；清洗后为空退回序号
	if k := StableItemKey(ParsedPrompt{Key: "a b/c!"}, 3); k != "abc" {
		t.Fatalf("want abc, got %q", k)
	}
	if k := StableItemKey(ParsedPrompt{Key: "！！"}, 7); k != "7" {
		t.Fatalf("want 7, got %q", k)
	}
}
