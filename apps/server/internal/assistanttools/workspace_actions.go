package assistanttools

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"

	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
)

const (
	ToolMediaAction      = "media_action"
	ToolImageSearch      = "image_search"
	ToolWebpageCapture   = "webpage_capture"
	ToolSendToWorkspace  = "send_to_workspace"
	ToolReferenceRebuild = "reference_rebuild"
	ToolProductImport    = "product_import"
	ToolDeliveryExport   = "delivery_export"
	ToolSiteOperator     = "site_operator"

	maxExternalPageBytes = 2 << 20
	maxExternalImageHits = 12
)

var workspaceToolNames = []string{
	ToolMediaAction, ToolImageSearch, ToolWebpageCapture, ToolSendToWorkspace,
	ToolReferenceRebuild, ToolProductImport, ToolDeliveryExport, ToolSiteOperator,
}

// WorkspaceToolNames returns a copy so callers cannot mutate the registry catalog.
func WorkspaceToolNames() []string { return append([]string(nil), workspaceToolNames...) }

func NewWorkspaceActionManifest() Manifest {
	return Manifest{
		ID: "workspace-actions", Version: "1.0.0", Description: "Safe user-facing workspace and research actions",
		Tools: []Definition{
			{
				Name: ToolMediaAction, Description: "为当前对话中的图片准备抠图、压缩、高清放大、裁剪或切图操作。这里只准备可确认的操作卡，不会自动扣费或开始处理。",
				InputSchema: objectSchema(map[string]any{
					"operation":            imageEnum("background_remove", "compress", "upscale", "crop", "split"),
					"referenced_image_ids": stringArraySchema(0, 8, "图片目录中的 id；没有明确指定时返回空数组，界面会使用最近图片"),
					"instruction":          shortStringSchema(0, 1000, "用户的处理要求"),
				}, "operation", "referenced_image_ids", "instruction"),
				Permissions: []Permission{PermissionActionsCreate}, Risk: RiskWrite, Timeout: 5 * time.Second, Strict: true,
				Execute: mediaActionExecutor,
			},
			{
				Name: ToolImageSearch, Description: "从 Wikimedia Commons 公开图库搜索真实图片，返回缩略图、原图来源和授权信息。适合用户缺少参考图时使用。",
				InputSchema: objectSchema(map[string]any{
					"query": shortStringSchema(1, 300, "具体图片关键词，优先使用中英文主体词"),
					"limit": map[string]any{"type": "integer", "minimum": 1, "maximum": maxExternalImageHits},
				}, "query", "limit"),
				Permissions: []Permission{PermissionWebRead}, Risk: RiskRead, Timeout: 20 * time.Second, MaxResultBytes: 64 << 10, Strict: true,
				Execute: imageSearchExecutor,
			},
			{
				Name: ToolWebpageCapture, Description: "为用户提供的公网网页准备真实视觉截图预览。仅允许 HTTP(S) 公网页面，拒绝内网地址。",
				InputSchema: objectSchema(map[string]any{
					"url":       shortStringSchema(1, 2000, "需要截图的完整公网 URL"),
					"width":     map[string]any{"type": "integer", "minimum": 640, "maximum": 1600},
					"full_page": map[string]any{"type": "boolean"},
				}, "url", "width", "full_page"),
				Permissions: []Permission{PermissionWebRead}, Risk: RiskRead, Timeout: 15 * time.Second, MaxResultBytes: 16 << 10, Strict: true,
				Execute: webpageCaptureExecutor,
			},
			{
				Name: ToolSendToWorkspace, Description: "把当前对话中的需求和所选图片准备发送到无限画布、AI 电商、文生图、UI 设计、模型设计或游戏设计。用户确认后才跳转。",
				InputSchema: objectSchema(map[string]any{
					"destination":          imageEnum("canvas", "ecommerce", "text_to_image", "ui_design", "model_sheet", "game_art"),
					"referenced_image_ids": stringArraySchema(0, 8, "图片目录中的 id"),
					"instruction":          shortStringSchema(0, 2000, "发送到目标工作区的完整需求"),
				}, "destination", "referenced_image_ids", "instruction"),
				Permissions: []Permission{PermissionActionsCreate}, Risk: RiskWrite, Timeout: 5 * time.Second, Strict: true,
				Execute: sendToWorkspaceExecutor,
			},
			{
				Name: ToolReferenceRebuild, Description: "根据当前参考图准备一个可编辑的无限画布复刻草稿。只创建草稿入口，不会自动运行工作流或扣费。",
				InputSchema: objectSchema(map[string]any{
					"referenced_image_ids": stringArraySchema(0, 8, "需要复刻的图片目录 id"),
					"goal":                 shortStringSchema(1, 2000, "希望复刻的效果、用途和必须保留的细节"),
					"complexity":           imageEnum("simple", "standard", "detailed"),
				}, "referenced_image_ids", "goal", "complexity"),
				Permissions: []Permission{PermissionActionsCreate}, Risk: RiskWrite, Timeout: 5 * time.Second, Strict: true,
				Execute: referenceRebuildExecutor,
			},
			{
				Name: ToolProductImport, Description: "读取一个公网商品页的公开标题、描述、商品图和价格信息，并准备导入 AI 电商工作区。导入前由用户确认。",
				InputSchema: objectSchema(map[string]any{
					"url": shortStringSchema(1, 2000, "商品页完整公网 URL"),
				}, "url"),
				Permissions: []Permission{PermissionWebRead, PermissionActionsCreate}, Risk: RiskWrite, Timeout: 20 * time.Second, MaxResultBytes: 32 << 10, Strict: true,
				Execute: productImportExecutor,
			},
			{
				Name: ToolDeliveryExport, Description: "准备把本次对话的图片、提示词、生成参数和清单打包为 ZIP。打包在用户浏览器本地完成，不占用服务器内存。",
				InputSchema: objectSchema(map[string]any{
					"scope": imageEnum("latest", "conversation", "all_images"),
					"name":  shortStringSchema(1, 120, "交付包名称，不含扩展名"),
				}, "scope", "name"),
				Permissions: []Permission{PermissionActionsCreate}, Risk: RiskWrite, Timeout: 5 * time.Second, Strict: true,
				Execute: deliveryExportExecutor,
			},
			{
				Name: ToolSiteOperator, Description: "打开站内指定业务页面。只能跳转到允许的页面，不能操作账号、安全、支付或后台设置。",
				InputSchema: objectSchema(map[string]any{
					"destination": imageEnum("home", "assistant", "canvas", "ecommerce", "text_to_image", "assets", "materials", "ui_design", "model_sheet", "game_art", "history", "wallet", "all_tools"),
				}, "destination"),
				Permissions: []Permission{PermissionActionsCreate}, Risk: RiskRead, Timeout: 5 * time.Second, Strict: true,
				Execute: siteOperatorExecutor,
			},
		},
	}
}

func objectSchema(properties map[string]any, required ...string) map[string]any {
	return map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}
}

func imageEnum(values ...string) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}

func shortStringSchema(minimum, maximum int, description string) map[string]any {
	return map[string]any{"type": "string", "minLength": minimum, "maxLength": maximum, "description": description}
}

func stringArraySchema(minimum, maximum int, description string) map[string]any {
	return map[string]any{"type": "array", "minItems": minimum, "maxItems": maximum, "items": map[string]any{"type": "string", "maxLength": 180}, "description": description}
}

type actionInput struct {
	Operation          string   `json:"operation"`
	Destination        string   `json:"destination"`
	ReferencedImageIDs []string `json:"referenced_image_ids"`
	Instruction        string   `json:"instruction"`
	Goal               string   `json:"goal"`
	Complexity         string   `json:"complexity"`
	Scope              string   `json:"scope"`
	Name               string   `json:"name"`
}

func actionID(invocation Invocation, tool string) string {
	sum := sha256.Sum256(append(append([]byte(invocation.RunID.String()+":"+tool+":"), invocation.Arguments...), byte(0)))
	return "action-" + hex.EncodeToString(sum[:8])
}

func actionResult(action map[string]any) (Result, error) {
	result, err := jsonResult(map[string]any{"action": action})
	result.Meta = map[string]any{"toolActions": []map[string]any{action}}
	return result, err
}

func baseAction(invocation Invocation, tool, kind, title, description string, confirm bool) map[string]any {
	return map[string]any{
		"id": actionID(invocation, tool), "tool": tool, "kind": kind,
		"title": title, "description": description,
		"risk":                 map[bool]string{true: "write", false: "read"}[confirm],
		"requiresConfirmation": confirm,
	}
}

func mediaActionExecutor(_ context.Context, invocation Invocation) (Result, error) {
	var input actionInput
	if err := decodeArguments(invocation.Arguments, &input); err != nil {
		return Result{}, err
	}
	labels := map[string]string{"background_remove": "移除图片背景", "compress": "压缩图片", "upscale": "高清放大", "crop": "裁剪图片", "split": "智能切图"}
	routes := map[string]string{"background_remove": "/canvas?mode=new&agent=1", "compress": "/canvas?mode=new&agent=1", "upscale": "/canvas?mode=new&agent=1", "crop": "/canvas?mode=new&agent=1", "split": "/canvas?mode=new&agent=1"}
	label, ok := labels[input.Operation]
	if !ok {
		return Result{}, errors.New("unsupported media operation")
	}
	action := baseAction(invocation, ToolMediaAction, "handoff", label, "确认后把图片和要求带到对应处理工具。", true)
	action["route"] = routes[input.Operation]
	action["buttonLabel"] = "确认并打开"
	action["payload"] = map[string]any{"taskType": input.Operation, "instruction": strings.TrimSpace(input.Instruction), "referencedImageIds": cleanIDs(input.ReferencedImageIDs)}
	return actionResult(action)
}

func sendToWorkspaceExecutor(_ context.Context, invocation Invocation) (Result, error) {
	var input actionInput
	if err := decodeArguments(invocation.Arguments, &input); err != nil {
		return Result{}, err
	}
	routes := map[string]string{"canvas": "/canvas?mode=new", "ecommerce": "/ecommerce-design", "text_to_image": "/text-to-image", "ui_design": "/design-workshop", "model_sheet": "/model-sheet", "game_art": "/game-art"}
	labels := map[string]string{"canvas": "无限画布", "ecommerce": "AI 电商", "text_to_image": "文生图", "ui_design": "UI 设计", "model_sheet": "模型设计", "game_art": "游戏设计"}
	route, ok := routes[input.Destination]
	if !ok {
		return Result{}, errors.New("unsupported workspace destination")
	}
	action := baseAction(invocation, ToolSendToWorkspace, "handoff", "发送到"+labels[input.Destination], "确认后携带当前需求和所选图片进入目标工作区。", true)
	action["route"] = route
	action["buttonLabel"] = "确认发送"
	action["payload"] = map[string]any{"taskType": input.Destination, "instruction": strings.TrimSpace(input.Instruction), "referencedImageIds": cleanIDs(input.ReferencedImageIDs)}
	return actionResult(action)
}

func referenceRebuildExecutor(_ context.Context, invocation Invocation) (Result, error) {
	var input actionInput
	if err := decodeArguments(invocation.Arguments, &input); err != nil {
		return Result{}, err
	}
	action := baseAction(invocation, ToolReferenceRebuild, "handoff", "在无限画布复刻参考图", "确认后创建可继续编辑的复刻草稿，不会自动运行或扣费。", true)
	action["route"] = "/canvas?mode=new&agent=1"
	action["buttonLabel"] = "创建复刻草稿"
	action["payload"] = map[string]any{"taskType": "infinite_canvas", "instruction": strings.TrimSpace(input.Goal), "complexity": input.Complexity, "referencedImageIds": cleanIDs(input.ReferencedImageIDs)}
	return actionResult(action)
}

func deliveryExportExecutor(_ context.Context, invocation Invocation) (Result, error) {
	var input actionInput
	if err := decodeArguments(invocation.Arguments, &input); err != nil {
		return Result{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "AI-创作交付包"
	}
	action := baseAction(invocation, ToolDeliveryExport, "download", "导出交付包", "在本地打包图片、提示词、参数和 manifest.json。", true)
	action["buttonLabel"] = "确认并导出 ZIP"
	action["payload"] = map[string]any{"scope": input.Scope, "name": name}
	return actionResult(action)
}

func siteOperatorExecutor(_ context.Context, invocation Invocation) (Result, error) {
	var input actionInput
	if err := decodeArguments(invocation.Arguments, &input); err != nil {
		return Result{}, err
	}
	routes := map[string]string{
		"home": "/", "assistant": "/assistant", "canvas": "/canvas", "ecommerce": "/ecommerce-design",
		"text_to_image": "/text-to-image", "assets": "/assets", "materials": "/materials",
		"ui_design": "/design-workshop", "model_sheet": "/model-sheet", "game_art": "/game-art",
		"history": "/history", "wallet": "/wallet", "all_tools": "/ai-tools",
	}
	route, ok := routes[input.Destination]
	if !ok {
		return Result{}, errors.New("unsupported site destination")
	}
	action := baseAction(invocation, ToolSiteOperator, "navigate", "打开站内页面", "已准备安全的站内跳转。", false)
	action["route"] = route
	action["buttonLabel"] = "打开"
	return actionResult(action)
}

type imageSearchInput struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}

type commonsMetadataValue struct {
	Value any `json:"value"`
}

type commonsResponse struct {
	Query struct {
		Pages map[string]struct {
			PageID    int64  `json:"pageid"`
			Title     string `json:"title"`
			ImageInfo []struct {
				URL            string                          `json:"url"`
				ThumbURL       string                          `json:"thumburl"`
				DescriptionURL string                          `json:"descriptionurl"`
				ExtMetadata    map[string]commonsMetadataValue `json:"extmetadata"`
			} `json:"imageinfo"`
		} `json:"pages"`
	} `json:"query"`
}

func imageSearchExecutor(ctx context.Context, invocation Invocation) (Result, error) {
	var input imageSearchInput
	if err := decodeArguments(invocation.Arguments, &input); err != nil {
		return Result{}, err
	}
	input.Query = strings.TrimSpace(input.Query)
	input.Limit = min(max(input.Limit, 1), maxExternalImageHits)
	endpoint, _ := url.Parse("https://commons.wikimedia.org/w/api.php")
	query := endpoint.Query()
	query.Set("action", "query")
	query.Set("generator", "search")
	query.Set("gsrsearch", input.Query+" filetype:bitmap")
	query.Set("gsrnamespace", "6")
	query.Set("gsrlimit", strconv.Itoa(input.Limit))
	query.Set("prop", "imageinfo")
	query.Set("iiprop", "url|extmetadata")
	query.Set("iiurlwidth", "480")
	query.Set("format", "json")
	query.Set("origin", "*")
	endpoint.RawQuery = query.Encode()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	req.Header.Set("User-Agent", "StarCloudsAI/1.0 image-search")
	resp, err := netguard.NewHTTPClient(15*time.Second, false, true).Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("公开图库搜索失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Result{}, fmt.Errorf("公开图库搜索失败: HTTP %d", resp.StatusCode)
	}
	var payload commonsResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return Result{}, fmt.Errorf("解析公开图库结果: %w", err)
	}
	items := make([]map[string]any, 0, len(payload.Query.Pages))
	for _, page := range payload.Query.Pages {
		if len(page.ImageInfo) == 0 {
			continue
		}
		info := page.ImageInfo[0]
		items = append(items, map[string]any{
			"id": strconv.FormatInt(page.PageID, 10), "title": strings.TrimPrefix(page.Title, "File:"),
			"thumbnailUrl": info.ThumbURL, "imageUrl": info.URL, "sourceUrl": info.DescriptionURL,
			"license": metadataText(info.ExtMetadata, "LicenseShortName"), "creator": metadataText(info.ExtMetadata, "Artist"),
		})
		if len(items) >= input.Limit {
			break
		}
	}
	action := baseAction(invocation, ToolImageSearch, "image_results", "图片搜索结果", fmt.Sprintf("找到 %d 张公开图库图片，请查看原始来源和授权。", len(items)), false)
	action["query"] = input.Query
	action["items"] = items
	result, err := jsonResult(map[string]any{"query": input.Query, "images": items})
	result.Meta = map[string]any{"toolActions": []map[string]any{action}}
	return result, err
}

func metadataText(values map[string]commonsMetadataValue, key string) string {
	value := values[key].Value
	if value == nil {
		return ""
	}
	return strings.TrimSpace(stripHTML(fmt.Sprint(value)))
}

type captureInput struct {
	URL      string `json:"url"`
	Width    int    `json:"width"`
	FullPage bool   `json:"full_page"`
}

func webpageCaptureExecutor(ctx context.Context, invocation Invocation) (Result, error) {
	var input captureInput
	if err := decodeArguments(invocation.Arguments, &input); err != nil {
		return Result{}, err
	}
	target, err := validateExternalURL(input.URL)
	if err != nil {
		return Result{}, err
	}
	if _, err := fetchPublicPage(ctx, target, 64<<10); err != nil {
		return Result{}, fmt.Errorf("网页无法访问: %w", err)
	}
	width := min(max(input.Width, 640), 1600)
	previewURL := "https://s.wordpress.com/mshots/v1/" + url.QueryEscape(target) + "?w=" + strconv.Itoa(width)
	if input.FullPage {
		previewURL += "&h=2400"
	}
	action := baseAction(invocation, ToolWebpageCapture, "webpage_capture", "网页视觉截图", "截图由 WordPress mShots 从公开网页生成，首次预览可能需要稍等。", false)
	action["targetUrl"] = target
	action["previewUrl"] = previewURL
	action["buttonLabel"] = "打开原网页"
	return actionResult(action)
}

type productImportInput struct {
	URL string `json:"url"`
}

func productImportExecutor(ctx context.Context, invocation Invocation) (Result, error) {
	var input productImportInput
	if err := decodeArguments(invocation.Arguments, &input); err != nil {
		return Result{}, err
	}
	target, err := validateExternalURL(input.URL)
	if err != nil {
		return Result{}, err
	}
	body, err := fetchPublicPage(ctx, target, maxExternalPageBytes)
	if err != nil {
		return Result{}, fmt.Errorf("读取商品页失败: %w", err)
	}
	product := extractProductPage(body, target)
	if product.Title == "" {
		return Result{}, errors.New("没有从该页面识别到商品标题，请换一个公开商品详情页")
	}
	action := baseAction(invocation, ToolProductImport, "product_import", "导入商品到 AI 电商", "已读取公开商品信息；确认后带入 AI 电商工作区继续编辑。", true)
	action["route"] = "/ecommerce-design?tool=shoot"
	action["buttonLabel"] = "确认导入"
	action["previewUrl"] = product.Image
	action["payload"] = map[string]any{"taskType": "ecommerce", "sourceUrl": target, "title": product.Title, "description": product.Description, "imageUrl": product.Image, "price": product.Price}
	result, err := jsonResult(map[string]any{"product": product})
	result.Meta = map[string]any{"toolActions": []map[string]any{action}}
	return result, err
}

func validateExternalURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if len(raw) > 2000 || netguard.ValidateURL(raw, false, false) != nil {
		return "", errors.New("只支持可公开访问的 HTTP(S) 网页，不能访问内网、文件或带账号密码的地址")
	}
	parsed, _ := url.Parse(raw)
	parsed.Fragment = ""
	return parsed.String(), nil
}

func fetchPublicPage(ctx context.Context, target string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; StarCloudsAI/1.0; +https://starcloudisai.com)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2")
	resp, err := netguard.NewHTTPClient(15*time.Second, false, false).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if contentType != "" && !strings.Contains(contentType, "text/html") {
		return nil, errors.New("目标地址不是网页")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, errors.New("网页内容超过读取上限")
	}
	return body, nil
}

type productPage struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Image       string `json:"image,omitempty"`
	Price       string `json:"price,omitempty"`
	SourceURL   string `json:"sourceUrl"`
}

func extractProductPage(body []byte, sourceURL string) productPage {
	product := productPage{SourceURL: sourceURL}
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return product
	}
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode && node.Data == "title" && product.Title == "" && node.FirstChild != nil {
			product.Title = cleanPageText(node.FirstChild.Data, 240)
		}
		if node.Type == html.ElementNode && node.Data == "meta" {
			attrs := map[string]string{}
			for _, attr := range node.Attr {
				attrs[strings.ToLower(attr.Key)] = strings.TrimSpace(attr.Val)
			}
			key := strings.ToLower(firstNonEmpty(attrs["property"], attrs["name"], attrs["itemprop"]))
			value := attrs["content"]
			switch key {
			case "og:title", "twitter:title":
				if value != "" {
					product.Title = cleanPageText(value, 240)
				}
			case "og:description", "description", "twitter:description":
				if product.Description == "" || key == "og:description" {
					product.Description = cleanPageText(value, 1200)
				}
			case "og:image", "twitter:image", "image":
				if product.Image == "" || key == "og:image" {
					product.Image = resolvePageURL(sourceURL, value)
				}
			case "product:price:amount", "price":
				if product.Price == "" {
					product.Price = cleanPageText(value, 80)
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(doc)
	return product
}

func resolvePageURL(baseURL, value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	ref, err := url.Parse(value)
	if err != nil {
		return ""
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(ref)
	if netguard.ValidateURL(resolved.String(), false, false) != nil {
		return ""
	}
	return resolved.String()
}

func cleanPageText(value string, limit int) string {
	value = strings.Join(strings.Fields(stripHTML(value)), " ")
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return strings.TrimSpace(string(runes[:limit])) + "…"
}

func stripHTML(value string) string {
	value = strings.ReplaceAll(value, "<br>", " ")
	value = strings.ReplaceAll(value, "<br/>", " ")
	value = strings.ReplaceAll(value, "<br />", " ")
	var out strings.Builder
	inside := false
	for _, r := range value {
		if r == '<' {
			inside = true
			continue
		}
		if r == '>' {
			inside = false
			continue
		}
		if !inside {
			out.WriteRune(r)
		}
	}
	return out.String()
}

func cleanIDs(values []string) []string {
	out := make([]string, 0, min(len(values), 8))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && len(value) <= 180 && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
		if len(out) == 8 {
			break
		}
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
