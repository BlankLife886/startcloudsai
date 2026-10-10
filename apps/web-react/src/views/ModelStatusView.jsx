import { useIsDark } from "../hooks/useIsDark.js";
import {
  OVERALL_META,
  StatusCountChips,
  formatClock,
  useModelStatus,
} from "./model-status/modelStatusParts.jsx";
import { ModelStatusGrid } from "./model-status/ModelStatusGrid.jsx";
import "./ModelStatusView.css";

/** 模型状态：公开页面，未登录也能看；数据全部来自真实调用。 */
export function ModelStatusView() {
  const isDark = useIsDark();
  const { data, loading, error, refresh } = useModelStatus();
  const overall = OVERALL_META[data?.overall] || OVERALL_META.operational;

  return (
    <div className={`msv ${isDark ? "is-dark" : "is-light"}`}>
      <header className="msv-head">
        <div className="msv-head__title">
          <h1>模型状态</h1>
          <span>
            基于平台真实调用统计 · 每小时更新
            {data?.generatedAt
              ? ` · ${formatClock(data.generatedAt)} 更新`
              : ""}
          </span>
        </div>
        <div className="msv-head__side">
          {data ? (
            <>
              <span className={`msv-overall is-${overall.tone}`}>
                <i className={`bi ${overall.icon}`} aria-hidden="true" />
                {overall.title}
              </span>
              <StatusCountChips models={data.models} />
            </>
          ) : null}
          <button
            type="button"
            className="msv-refresh"
            aria-label="刷新"
            title="刷新"
            disabled={loading}
            onClick={() => refresh()}
          >
            <i
              className={`bi bi-arrow-repeat${loading ? " is-spinning" : ""}`}
            />
          </button>
        </div>
      </header>

      {error && !data ? (
        <div className="msv-state">
          <i className="bi bi-wifi-off" aria-hidden="true" />
          <p>{error}</p>
          <button type="button" onClick={() => refresh()}>
            重试
          </button>
        </div>
      ) : null}

      {!data && loading ? (
        <div className="msv-skeleton" aria-busy="true" />
      ) : null}

      {data ? <ModelStatusGrid data={data} /> : null}

      {data ? (
        <footer className="msv-notes">
          <span>
            成功率 = 成功 ÷（成功 + 失败），用户取消与内容审核拦截不计入失败。
          </span>
          <span>
            生图耗时为一次生成从开始处理到出图，单张耗时 = 生成耗时 ÷
            出图张数；对话耗时为一轮回答的模型生成时间，首字为收到第一个字的时间。
          </span>
          <span>
            状态按最近 30 分钟判定（调用少时看 2 小时）：失败率 ≥ 50% 故障，≥
            15% 或耗时达当日中位数 2 倍为降级，24
            小时内只有失败也为降级；“暂无调用”不代表不可用。
          </span>
        </footer>
      ) : null}
    </div>
  );
}
