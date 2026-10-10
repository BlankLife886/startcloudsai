import {
  AssistantImageCompare,
  AssistantSharePanel,
  AssistantTaskCard,
} from "../features/assistant/AssistantMessageExtensions.jsx";
import { AssistantCommerceSet } from "../features/assistant/AssistantCommerceSet.jsx";

// Bottom section of the dev gallery: UI drafts of the planned extensions,
// each shown inside an assistant message frame.

const img = (name) => `/sucai/${name}`;

const detailShot = (id, label, headline, file) => ({
  id, label, headline, role: "detail", aspectRatio: "3:4", attempts: 1, status: "succeeded",
  imageUrl: img(file), reviewed: true, pass: true, canRedo: true, priceCents: 10,
});

const DETAIL_SET = {
  id: "gallery-detail-set", productName: "保温杯", platform: "天猫", summary: "清爽白蓝，留白多，卖点一屏一个", modelId: "image-pro",
  quotedCents: 60, approvedCents: 60, spentCents: 60, total: 6, done: 6, ready: true, downloadable: 6, needsReview: false,
  status: "done", workbenchLink: "/ecommerce-design",
  shots: [
    { id: "main", label: "产品白底图", role: "main", aspectRatio: "1:1", attempts: 1, status: "succeeded", imageUrl: img("ecom-thumb-listing.webp"), reviewed: true, pass: true, canRedo: true, priceCents: 10 },
    detailShot("hero", "首屏视觉图", "一杯暖一天", "ecom-thumb-detail.webp"),
    detailShot("hand", "手持场景", "单手可握，通勤随身", "ecom-thumb-handheld.webp"),
    detailShot("material", "材质细节", "316 不锈钢内胆", "ecom-thumb-enhance.webp"),
    detailShot("shadow", "保温实测", "12 小时仍有 60℃", "ecom-thumb-shadow.webp"),
    detailShot("spec", "规格参数", "", "ecom-thumb-campaign.webp"),
  ],
};

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

      <Sample label="扩展 11 · 商品详情页长图预览：套图里详情页 ≥ 2 屏时出现「预览详情页」，全屏手机框内滚动" priority="P2">
        <Reply text="详情页 5 屏已经全部出完，可以在手机里预览拼起来的效果。">
          <AssistantCommerceSet initial={DETAIL_SET} />
        </Reply>
      </Sample>

      <Sample label="扩展 12 · 后台任务卡（进行中 / 已完成）" priority="P2">
        <Reply text="套图比较多，我放到后台生成，你可以继续聊别的。">
          <AssistantTaskCard title="批量生成 · 保温杯套图" done={7} total={12} eta="约 2 分钟" />
          <AssistantTaskCard title="批量生成 · 保温杯套图" done={12} total={12} state="done" />
        </Reply>
      </Sample>

      <Sample label="扩展 16 · 分享与导出" priority="P3">
        <Reply>
          <AssistantSharePanel />
        </Reply>
      </Sample>

    </div>
  );
}
