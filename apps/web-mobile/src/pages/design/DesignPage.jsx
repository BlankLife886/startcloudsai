import { useNavigate } from "react-router";
import { ClockCircleOutline, PicturesOutline } from "antd-mobile-icons";
import { PageHeader } from "@mobile/components/PageHeader.jsx";
import { SparkleIcon } from "@mobile/components/icons.jsx";
import "./design.css";

// 手机版还没有的页面暂时跳电脑版。
function openDesktop(path) {
  window.location.assign(path);
}

/** 与 App 的“设计”Tab 一致：创作工具入口 + 我的创作。 */
export default function DesignPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="设计" />
      <div className="m-tab-body m-design">
        <h2 className="m-design-title">创作工具</h2>
        <button type="button" className="m-design-featured m-card-surface m-pressable" onClick={() => navigate("/create")}>
          <span className="m-design-featured-text">
            <span className="m-design-tool"><SparkleIcon size={20} />文生图</span>
            <strong>从一句描述开始</strong>
            <small>文字创作</small>
          </span>
          <img src={`${import.meta.env.BASE_URL}brand/text_to_image.png`} alt="" width="72" height="88" />
        </button>

        <h2 className="m-design-title">我的创作</h2>
        <div className="m-design-utils">
          <button type="button" className="m-design-util m-card-surface m-pressable" onClick={() => navigate("/create")}>
            <ClockCircleOutline />
            <strong>历史记录</strong>
          </button>
          <button type="button" className="m-design-util m-card-surface m-pressable" onClick={() => openDesktop("/assets")}>
            <PicturesOutline />
            <strong>我的素材</strong>
          </button>
        </div>
      </div>
    </>
  );
}
