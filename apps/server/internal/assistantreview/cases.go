// Package assistantreview is how the assistant gets better from real use
// without anyone reviewing turns by hand: users correct a wrong turn with one
// tap, which both fixes it for them and labels it; behaviour signals become
// rates; and a new model or prompt is checked by replaying real turns and
// looking only where its first move differs. With no routing step, the
// thing to measure is the agent's own first move on a turn.
package assistantreview

// First-move categories. A case lists the ones that count as right.
const (
	ExpectAnswer    = "answer"    // reply in words, no tool
	ExpectImage     = "image"     // propose an image or an e-commerce set
	ExpectWeb       = "web"       // search the web
	ExpectData      = "data"      // the user's own data, account, tasks, assets or memory
	ExpectWorkspace = "workspace" // a site tool (upscale, export, send to a workspace…)
	ExpectFiles     = "files"     // read or create files
)

// Expectations lists the categories in display order.
var Expectations = []string{ExpectAnswer, ExpectImage, ExpectWeb, ExpectData, ExpectWorkspace, ExpectFiles}

// ValidExpectation reports whether value is a known category.
func ValidExpectation(value string) bool {
	for _, item := range Expectations {
		if item == value {
			return true
		}
	}
	return false
}

// Modes a case runs in, matching the assistant page's 问答 and Agent modes.
const (
	ModeChat  = "chat"
	ModeAgent = "agent"
)

// Message is one earlier turn of a case's conversation, as text.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Case is one turn with the first moves that count as right.
type Case struct {
	ID      string    `json:"id"`
	Source  string    `json:"source"`
	Mode    string    `json:"mode"`
	Context []Message `json:"context,omitempty"`
	Prompt  string    `json:"prompt"`
	// ReferenceCount is how many images the user attached; the evaluation
	// says so in words instead of sending pixels.
	ReferenceCount int      `json:"referenceCount,omitempty"`
	Expected       []string `json:"expected"`
	Note           string   `json:"note,omitempty"`
	Active         bool     `json:"active"`
}

// Case sources.
const (
	SourceBuiltin = "builtin"
	SourceUser    = "user" // from a user's one-tap correction
)

// BuiltinCases are versioned with the code. They carry over every case from
// the old intent evaluation, including the keyword false positives found in
// production (物联网, 上网本, coding questions about tasks), now checked
// against the agent's first move.
var BuiltinCases = withSource([]Case{
	{ID: "answer-01", Mode: ModeAgent, Prompt: "帮我写一段 618 商品文案", Expected: []string{ExpectAnswer}},
	{ID: "answer-02", Mode: ModeAgent, Prompt: "物联网设备怎么配网", Expected: []string{ExpectAnswer}, Note: "曾被关键词误判为联网搜索"},
	{ID: "answer-03", Mode: ModeAgent, Prompt: "上网本和平板怎么选", Expected: []string{ExpectAnswer}, Note: "曾被关键词误判为联网搜索"},
	{ID: "answer-04", Mode: ModeAgent, Prompt: "帮我写一个定时任务失败自动重试的 Go 函数", Expected: []string{ExpectAnswer}, Note: "曾被误判为任务状态"},
	{ID: "answer-05", Mode: ModeAgent, Prompt: "Celery 任务状态一直是 PENDING 怎么排查", Expected: []string{ExpectAnswer}, Note: "曾被误判为任务状态"},
	{ID: "answer-06", Mode: ModeAgent, Prompt: "帮我优化一下简历的配色", Expected: []string{ExpectAnswer}, Note: "曾被问答模式误拦"},
	{ID: "answer-07", Mode: ModeAgent, Prompt: "我想修改一下这个界面的文案", Expected: []string{ExpectAnswer}, Note: "曾被问答模式误拦"},
	{ID: "answer-08", Mode: ModeAgent, Prompt: "如何写出好的生图提示词", Expected: []string{ExpectAnswer}},
	{ID: "answer-09", Mode: ModeAgent, Prompt: "你好", Expected: []string{ExpectAnswer}},
	{ID: "answer-10", Mode: ModeAgent, Prompt: "把这段话改得更简洁有力：我们的产品非常非常好用", Expected: []string{ExpectAnswer}},
	{ID: "answer-11", Mode: ModeAgent, Prompt: "电商主图一般用什么比例", Expected: []string{ExpectAnswer}},
	{ID: "answer-12", Mode: ModeAgent, Prompt: "这个平台的无限画布怎么用", Expected: []string{ExpectAnswer}},
	{ID: "answer-13", Mode: ModeAgent, Prompt: "真好看，颜色很舒服", Context: []Message{{Role: "assistant", Content: "[生成了 1 张图片：粉色小狗]"}}, Expected: []string{ExpectAnswer}, Note: "出图后的评价不是改图"},
	{ID: "answer-14", Mode: ModeAgent, Prompt: "图上那行英文是什么意思", Context: []Message{{Role: "assistant", Content: "[生成了 1 张图片：海报]"}}, Expected: []string{ExpectAnswer}},
	{ID: "answer-15", Mode: ModeAgent, Prompt: "你可以做图吗", Expected: []string{ExpectAnswer}, Note: "曾被当成出图，按原话自动出了一张图"},
	{ID: "answer-16", Mode: ModeAgent, Prompt: "你都能帮我做哪些图", Expected: []string{ExpectAnswer}},
	{ID: "mydata-01", Mode: ModeAgent, Prompt: "这个月积分都花在哪了", Expected: []string{ExpectData}},
	{ID: "mydata-02", Mode: ModeAgent, Prompt: "我最近 30 天创作了多少张图", Expected: []string{ExpectData}},
	{ID: "mydata-03", Mode: ModeAgent, Prompt: "最贵的 10 次生成是哪些", Expected: []string{ExpectData}},
	{ID: "mydata-04", Mode: ModeAgent, Prompt: "我的生成成功率怎么样", Expected: []string{ExpectData}},
	{ID: "mydata-05", Mode: ModeAgent, Prompt: "上周比前一周多花了多少", Expected: []string{ExpectData}},
	{ID: "mydata-06", Mode: ModeAgent, Prompt: "我一般什么时间段创作最多", Expected: []string{ExpectData}},
	{ID: "mydata-07", Mode: ModeAgent, Prompt: "哪个模型最费钱", Expected: []string{ExpectData}},
	{ID: "mydata-08", Mode: ModeAgent, Prompt: "今年我一共充值了多少积分", Expected: []string{ExpectData}},
	{ID: "mydata-09", Mode: ModeAgent, Prompt: "我刚才那个任务为什么失败了", Expected: []string{ExpectData}, Note: "任务排查也由 v2 的只读工具处理"},
	{ID: "mydata-10", Mode: ModeAgent, Prompt: "失败的那次生图退款了吗", Expected: []string{ExpectData}},
	{ID: "mydata-11", Mode: ModeAgent, Prompt: "找一下我之前生成的精华瓶图片", Expected: []string{ExpectData}, Note: "曾被规则误判为生成图片（含“生成”“图片”）"},
	{ID: "mydata-12", Mode: ModeAgent, Prompt: "把资产库里的海报都移到节日分组", Expected: []string{ExpectData}},
	{ID: "mydata-13", Mode: ModeAgent, Prompt: "记住我的品牌色是雾霾蓝，以后做图都用这个色", Expected: []string{ExpectData}, Note: "记忆由 v2 处理，不能交给原引擎"},
	{ID: "mydata-14", Mode: ModeAgent, Prompt: "你都记得我哪些事", Expected: []string{ExpectData}},
	{ID: "mydata-15", Mode: ModeAgent, Prompt: "忘掉我之前说的那个店铺名", Expected: []string{ExpectData}},
	{ID: "mydata-16", Mode: ModeAgent, Prompt: "把上面这张存进资产库", Context: []Message{{Role: "assistant", Content: "[生成了 1 张图片：精华瓶白底图]"}}, Expected: []string{ExpectData}, Note: "存图由 v2 出方案，紧跟在出图之后也不能判成继续改图"},
	{ID: "mydata-17", Mode: ModeAgent, Prompt: "这套图都保存到资产库，放到护肤新品分组", Expected: []string{ExpectData}},
	{ID: "create-01", Mode: ModeAgent, Prompt: "帮我生成一张猫咪海报", Expected: []string{ExpectImage}},
	{ID: "create-02", Mode: ModeAgent, Prompt: "画一只戴帽子的柴犬", Expected: []string{ExpectImage}},
	{ID: "create-03", Mode: ModeAgent, Prompt: "做一套保温杯的天猫主图", Expected: []string{ExpectImage}},
	{ID: "create-04", Mode: ModeAgent, Prompt: "再来一张", Context: []Message{{Role: "assistant", Content: "[生成了 2 张图片：戴帽子的猫]"}}, Expected: []string{ExpectImage}},
	{ID: "create-05", Mode: ModeAgent, Prompt: "背景改成星空", Context: []Message{{Role: "assistant", Content: "[生成了 1 张图片：城市夜景]"}}, Expected: []string{ExpectImage}},
	{ID: "create-12", Mode: ModeAgent, Prompt: "我要粉色的小狗，然后4K高清", Context: []Message{{Role: "assistant", Content: "[生成了 1 张图片：小狗在中间，四只老虎在四周]"}}, Expected: []string{ExpectImage}, Note: "判断模型超时时规则曾判成问答，v2 自己回了段文字"},
	{ID: "create-13", Mode: ModeAgent, Prompt: "老虎改成白色的，背景换成雪地", Context: []Message{{Role: "assistant", Content: "[出了图片方案：小狗位于画面正中央，四只老虎分布在四周]"}}, Expected: []string{ExpectImage}, Note: "还没出图、在改方案"},
	{ID: "create-06", Mode: ModeAgent, Prompt: "设计一个简洁的品牌图标", Expected: []string{ExpectImage}},
	{ID: "create-07", Mode: ModeAgent, Prompt: "把这张图的背景换成纯白", ReferenceCount: 1, Expected: []string{ExpectImage}},
	{ID: "create-08", Mode: ModeAgent, Prompt: "给我出 4 张不同风格的头像", Expected: []string{ExpectImage}},
	{ID: "create-09", Mode: ModeAgent, Prompt: "帮我把这张图抠图", ReferenceCount: 1, Expected: []string{ExpectImage}},
	{ID: "web-01", Mode: ModeAgent, Prompt: "联网搜索一下今天的科技新闻", Expected: []string{ExpectWeb}},
	{ID: "web-02", Mode: ModeAgent, Prompt: "查一下最新的 iPhone 发布会说了什么", Expected: []string{ExpectWeb}},
	{ID: "web-03", Mode: ModeAgent, Prompt: "帮我联网查一下物联网行业的最新融资消息", Expected: []string{ExpectWeb}},
	{ID: "web-04", Mode: ModeAgent, Prompt: "现在黄金价格是多少", Expected: []string{ExpectWeb}},
	{ID: "workspace-01", Mode: ModeAgent, Prompt: "帮我把这张图高清放大", ReferenceCount: 1, Expected: []string{ExpectWorkspace}},
	{ID: "workspace-02", Mode: ModeAgent, Prompt: "导出交付包", Expected: []string{ExpectWorkspace}},
	{ID: "workspace-03", Mode: ModeAgent, Prompt: "把这几张图发送到无限画布", Expected: []string{ExpectWorkspace}},
	{ID: "workspace-04", Mode: ModeAgent, Prompt: "给这个网站截个图 https://example.com", Expected: []string{ExpectWorkspace}},
	{ID: "workspace-05", Mode: ModeAgent, Prompt: "帮我找几张露营主题的参考图", Expected: []string{ExpectWorkspace}},
	{ID: "account-01", Mode: ModeAgent, Prompt: "怎么退订我的会员", Expected: []string{ExpectAnswer, ExpectData}},
	{ID: "account-02", Mode: ModeAgent, Prompt: "我想充值 100 元", Expected: []string{ExpectAnswer, ExpectData}},
	{ID: "account-03", Mode: ModeAgent, Prompt: "帮我改一下登录密码", Expected: []string{ExpectAnswer, ExpectData}},
	{ID: "account-04", Mode: ModeAgent, Prompt: "怎么创建一个 API Key", Expected: []string{ExpectAnswer, ExpectData}},
	// 问答 mode offers no image or site tools, so drawing requests get words.
	{ID: "chat-01", Mode: ModeChat, Prompt: "画一只戴帽子的柴犬", Expected: []string{ExpectAnswer}, Note: "问答模式不能出图，应说明切换模式"},
	{ID: "chat-02", Mode: ModeChat, Prompt: "你可以做图吗", Expected: []string{ExpectAnswer}},
	{ID: "chat-03", Mode: ModeChat, Prompt: "今天的金价是多少", Expected: []string{ExpectWeb}},
	{ID: "chat-04", Mode: ModeChat, Prompt: "我这个月花了多少积分", Expected: []string{ExpectData}},
	{ID: "create-14", Mode: ModeAgent, Prompt: "能帮我画只猫吗", Expected: []string{ExpectImage}, Note: "问句形式，但说了要画什么"},
})

func withSource(cases []Case) []Case {
	for index := range cases {
		cases[index].Source = SourceBuiltin
		cases[index].Active = true
	}
	return cases
}
