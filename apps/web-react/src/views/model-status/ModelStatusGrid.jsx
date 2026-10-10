import { ModelCatalogIcon } from "../../components/common/ModelCatalogIcon.jsx";
import {
  BandLegend,
  HourStrip,
  KIND_LABEL,
  PriceBars,
  Spark,
  StatusBadge,
  formatDuration,
  formatPercent,
  formatPrice,
  dayTone,
  formatSpeed,
  sortModels,
} from "./modelStatusParts.jsx";
import { PriceAdjustmentTag } from "../../components/common/PriceAdjustmentTag.jsx";

/** Inline metric: "单轮耗时 19.9秒". */
function Stat({ label, value, title }) {
  return (
    <span className="msg-stat" title={title}>
      {label}
      <b>{value.replace(/ /g, "")}</b>
    </span>
  );
}

/** Price change over the 30 days, e.g. "↓20%", against the earliest known day. */
function priceChange(price) {
  const first = (price?.days || []).find((day) => day.cents != null)?.cents;
  const last = price?.currentCents;
  if (!first || last == null || first === last) return null;
  const pct = Math.round(((last - first) / first) * 100);
  return {
    down: last < first,
    text: `${last < first ? "↓" : "↑"}${Math.abs(pct)}%`,
    from: first,
  };
}

function Card({ model }) {
  const day = model.day || {};
  const isChat = model.kind === "chat";
  const change = priceChange(model.price);
  const uptimeTone = dayTone(day.successRate);
  return (
    <article className={`msg-card is-${model.status}`}>
      <header className="msg-card__head">
        <span className="msg-card__icon">
          <ModelCatalogIcon model={model} size="md" />
        </span>
        <div className="msg-card__title">
          <strong title={model.name}>{model.name}</strong>
          <div className="msg-card__meta">
            {KIND_LABEL[model.kind] || "模型"}
          </div>
        </div>
        <StatusBadge status={model.status} />
      </header>

      <div className="msg-card__hero">
        <div className="msg-card__uptime">
          <span className="msg-cap">24 小时可用</span>
          <strong className={`is-${uptimeTone}`}>
            {day.successRate == null
              ? "—"
              : formatPercent(day.successRate, 1).replace("%", "")}
            {day.successRate == null ? null : <small>%</small>}
          </strong>
        </div>
        <div className="msg-card__spark" title="近 24 小时每小时耗时">
          <Spark points={model.hourly || []} height={48} zoomed />
        </div>
      </div>

      <div className="msg-card__stats">
        {isChat ? (
          <>
            <Stat
              label="单轮耗时"
              value={formatDuration(day.latencyP50Ms)}
              title={
                day.latencyP95Ms != null
                  ? `P95 ${formatDuration(day.latencyP95Ms)}`
                  : undefined
              }
            />
            <Stat
              label="首字延迟"
              value={formatDuration(day.ttftP50Ms)}
              title={
                day.ttftP95Ms != null
                  ? `P95 ${formatDuration(day.ttftP95Ms)}`
                  : undefined
              }
            />
            <Stat
              label="输出速度"
              value={formatSpeed(day.speed, model.speedUnit)}
            />
          </>
        ) : (
          <>
            <Stat
              label="平均耗时"
              value={formatDuration(day.latencyAvgMs)}
              title="近 24 小时每次生成的平均耗时"
            />
            <Stat
              label="单张耗时"
              value={formatDuration(day.perImageAvgMs)}
              title="每次生成耗时 ÷ 出图张数，取 24 小时平均"
            />
            <Stat
              label="慢时耗时"
              value={formatDuration(day.latencyP95Ms)}
              title="100 次里最慢的 5 次大约要这么久（P95）"
            />
          </>
        )}
      </div>

      <div className="msg-card__price">
        <div className="msg-card__price-head">
          <span className="msg-cap">30 天单价</span>
          <span className="msg-card__price-now">
            <b>{formatPrice(model.price?.currentCents, model.price?.unit)}</b>
            {model.price?.standardCents > model.price?.currentCents ? (
              <del className="msg-card__price-was" title={model.price?.adjustment ? "调价前标准价" : "标准价"}>
                {formatPrice(model.price.standardCents, model.price.unit)}
              </del>
            ) : null}
            <PriceAdjustmentTag model={{ priceAdjustment: model.price?.adjustment }} />
            {change ? (
              <span
                className={`msg-change${change.down ? " is-down" : " is-up"}`}
                title={`30 天内由 ${formatPrice(change.from, model.price.unit)} 调整`}
              >
                {change.text}
              </span>
            ) : model.price?.adjustment ? null : (
              <span className="msg-cap">未调价</span>
            )}
          </span>
        </div>
        <PriceBars price={model.price} height={34} />

        <HourStrip points={model.hourly || []} />
        <div className="msg-card__axis">
          <span>24 小时前</span>
          <span>现在</span>
        </div>
      </div>
    </article>
  );
}

/** 卡片墙：卡片铺满宽度，每张卡自带耗时与速度、耗时与价格走势、24 小时逐时可用状态。 */
export function ModelStatusGrid({ data }) {
  const models = sortModels(data.models);
  return (
    <section className="msg">
      <div className="msg-grid">
        {models.map((model) => (
          <Card key={model.id} model={model} />
        ))}
      </div>
      <div className="msg-foot">
        <BandLegend />
        <span>
          生图为近 24 小时平均值，慢时耗时为最慢 5%
          的调用；对话为中位数；曲线为每小时耗时，底部细条每格一小时（最后一格为当前小时）；悬停查看详情。
        </span>
      </div>
    </section>
  );
}
