import {
  AssistantBatchProgress,
  AssistantChoiceCard,
  AssistantCitedText,
  AssistantCostConfirm,
  AssistantDataTable,
  AssistantDataToolbar,
  AssistantDetailPagePreview,
  AssistantDiagramPreview,
  AssistantDislikeReasons,
  AssistantErrorCard,
  AssistantFollowUpSuggestions,
  AssistantImageCompare,
  AssistantOrderLinks,
  AssistantReplyOutline,
  AssistantSavedImages,
  AssistantSharePanel,
  AssistantTaskCard,
  AssistantVersionSwitcher,
  AssistantVideoCard,
} from "../features/assistant/AssistantMessageExtensions.jsx";

// Bottom section of the dev gallery: UI drafts of the planned extensions,
// each shown inside an assistant message frame.

const img = (name) => `/sucai/${name}`;

function Reply({ text, children }) {
  return (
    <div className="message-turn">
      <article className="message message--assistant">
        <div className="message-content">
          {text ? <p>{text}</p> : null}
          {children}
        </div>
      </article>
    </div>
  );
}

function Sample({ label, priority, children }) {
  return (
    <div className="assistant-gallery-sample">
      <p className="assistant-gallery-label">{label}{priority ? <b className="assistant-gallery-priority">{priority}</b> : null}</p>
      {children}
    </div>
  );
}

const sources = [
  { url: "https://www.tmall.com/rules/main-image", title: "天猫主图发布规范" },
  { url: "https://developer.taobao.com/docs/image", title: "淘宝开放平台 · 图片要求" },
];

export function ExtensionGallery() {
  return (
    <div className="assistant-gallery-section is-extension">
      <h2 className="assistant-gallery-section-title">十、扩展内容（UI 草案，待接入）</h2>
      <p className="assistant-gallery-note">以下为计划新增的内容类型，目前只有界面与本地交互，尚未接入真实数据。标签上的 P1 / P2 / P3 为建议的接入优先级。</p>

      <Sample label="扩展 1 · 改图前后对比（拖动滑块）" priority="P1">
        <Reply text="背景已经换成浅灰色，拖动查看前后差异。">
          <AssistantImageCompare before={img("ecom-thumb-listing.webp")} after={img("ecom-thumb-backdrop.webp")} />
        </Reply>
      </Sample>

      <Sample label="扩展 2 · 批量生成逐张进度，失败单张重试" priority="P1">
        <Reply>
          <AssistantBatchProgress items={[
            { id: "b1", title: "产品白底图", status: "succeeded", imageUrl: img("ecom-thumb-listing.webp") },
            { id: "b2", title: "核心卖点图", status: "succeeded", imageUrl: img("ecom-thumb-detail.webp") },
            { id: "b3", title: "使用场景图", status: "generating" },
            { id: "b4", title: "细节特写", status: "queued" },
            { id: "b5", title: "尺寸说明图", status: "failed", error: "模型超时，未扣积分" },
          ]} />
        </Reply>
      </Sample>

      <Sample label="扩展 3 · 方案卡上的积分确认（正常 / 余额不足）" priority="P1">
        <Reply text="方案已整理，确认后开始生成。">
          <AssistantCostConfirm costPoints={40} balancePoints={1520} />
          <AssistantCostConfirm costPoints={40} balancePoints={30} />
        </Reply>
      </Sample>

      <Sample label="扩展 4 · 按类型区分的错误卡片" priority="P1">
        <Reply>
          <div className="assistant-ext-error-grid">
            <AssistantErrorCard kind="timeout" />
            <AssistantErrorCard kind="moderation" />
            <AssistantErrorCard kind="balance" />
            <AssistantErrorCard kind="upload" />
          </div>
        </Reply>
      </Sample>

      <Sample label="扩展 5 · 图片上的「已存入素材库」标记" priority="P2">
        <Reply>
          <AssistantSavedImages images={[
            { id: "s1", url: img("ecom-thumb-campaign.webp"), savedGroup: "节日海报" },
            { id: "s2", url: img("ecom-thumb-shoot.webp") },
            { id: "s3", url: img("ecom-thumb-tryon.webp"), savedGroup: "模特图" },
          ]} />
        </Reply>
      </Sample>

      <Sample label="扩展 6 · Markdown 增强：流程图 + 可排序 / 可复制表格（代码复制已有）" priority="P2">
        <Reply text="出图流程和各平台主图要求如下。">
          <AssistantDiagramPreview title="流程图" steps={["上传商品图", "AI 抠图", "生成场景", "质量检查", "打包下载"]} />
          <AssistantDataTable columns={["平台", "主图比例", "最小尺寸", "背景要求"]} rows={[
            ["天猫", "1:1", "800×800", "白底"],
            ["京东", "1:1", "800×800", "白底"],
            ["抖音", "3:4", "600×800", "不限"],
            ["小红书", "3:4", "1080×1440", "不限"],
          ]} />
        </Reply>
      </Sample>

      <Sample label="扩展 7 · 正文引用角标，对应联网来源" priority="P2">
        <Reply>
          <AssistantCitedText sources={sources} parts={["天猫主图首图要求白底、1:1 ", 1, "，尺寸不少于 800×800，且不能出现水印和外链二维码 ", 2, "。"]} />
        </Reply>
      </Sample>

      <Sample label="扩展 8 · 追问建议（问答模式只推荐提问）" priority="P1">
        <Reply text="保温杯适合通勤上班族、学生和户外运动人群。">
          <AssistantFollowUpSuggestions items={["不同人群各自最在意什么卖点？", "主图文案该怎么写？", "竞品一般怎么定价？"]} />
        </Reply>
      </Sample>

      <Sample label="扩展 9 · 长回复自动目录" priority="P3">
        <Reply>
          <AssistantReplyOutline headings={[
            { title: "一、市场概况", level: 2 },
            { title: "目标人群", level: 3 },
            { title: "价格带分布", level: 3 },
            { title: "二、竞品分析", level: 2 },
            { title: "三、视觉建议", level: 2 },
          ]} />
          <p style={{ marginTop: 12 }}>（正文……）</p>
        </Reply>
      </Sample>

      <Sample label="扩展 10 · 视频结果卡" priority="P3">
        <Reply text="10 秒产品展示视频已生成。">
          <AssistantVideoCard poster={img("canvas-hero.webp")} title="保温杯 360° 展示" duration="0:10" meta={["Video Pro", "1080p", "16:9"]} />
        </Reply>
      </Sample>

      <Sample label="扩展 11 · 商品详情页长图预览（可在手机框内滚动）" priority="P2">
        <Reply>
          <AssistantDetailPagePreview title="保温杯详情页" size="750 × 5000" screens={[
            img("ecom-thumb-listing.webp"), img("ecom-thumb-detail.webp"), img("ecom-thumb-handheld.webp"), img("ecom-thumb-shadow.webp"), img("ecom-thumb-enhance.webp"),
          ]} />
        </Reply>
      </Sample>

      <Sample label="扩展 12 · 后台任务卡（进行中 / 已完成）" priority="P2">
        <Reply text="套图比较多，我放到后台生成，你可以继续聊别的。">
          <AssistantTaskCard title="批量生成 · 保温杯套图" done={7} total={12} eta="约 2 分钟" />
          <AssistantTaskCard title="批量生成 · 保温杯套图" done={12} total={12} state="done" />
        </Reply>
      </Sample>

      <Sample label="扩展 13 · 选择卡：出图前补充信息" priority="P2">
        <Reply>
          <AssistantChoiceCard title="出图前确认几项：" groups={[
            { id: "ratio", label: "尺寸", options: ["1:1", "3:4", "9:16", "16:9"] },
            { id: "style", label: "风格", options: ["简约白底", "生活场景", "高级质感", "节日氛围"] },
            { id: "platform", label: "平台", options: ["天猫", "京东", "抖音", "小红书"] },
          ]} />
        </Reply>
      </Sample>

      <Sample label="扩展 14 · 数据视图补充：时间段切换、对比、导出，订单跳转" priority="P3">
        <Reply text="本月共消耗 240 积分。">
          <AssistantDataToolbar ranges={["本周", "本月", "近 90 天", "自定义"]} />
          <AssistantOrderLinks orderNo="o-20261001-0001" />
        </Reply>
      </Sample>

      <Sample label="扩展 15 · 消息分支：重新生成后切换版本" priority="P1">
        <Reply>
          <AssistantVersionSwitcher versions={[
            "第 1 版：适合通勤上班族和学生。",
            "第 2 版：主要面向通勤族、学生党，以及喜欢户外徒步的人群。",
            "第 3 版：核心人群是 25–35 岁的通勤上班族，其次是学生和户外运动爱好者。",
          ]} />
        </Reply>
      </Sample>

      <Sample label="扩展 16 · 分享与导出" priority="P3">
        <Reply>
          <AssistantSharePanel />
        </Reply>
      </Sample>

      <Sample label="扩展 17 · 点踩后选择原因（反馈给质量闭环）" priority="P2">
        <Reply text="适合通勤上班族、学生和户外运动人群。">
          <AssistantDislikeReasons />
        </Reply>
      </Sample>
    </div>
  );
}
