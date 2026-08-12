import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCommerceProduct,
  deleteCommerceProduct,
  listCommerceProducts,
  updateCommerceProduct,
} from "@react/legacy-modules/services/ecommerceApi.js";
import { createUserAsset, deleteUserAsset } from "@react/legacy-modules/services/meApi.js";
import { uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import "@react/legacy-styles/generated/components/ecommerce/CommerceProductLibrary.css";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";

const STATUS_OPTIONS = [
  { value: "active", label: "使用中" },
  { value: "archived", label: "已归档" },
  { value: "", label: "全部" },
];
const EDITOR_FIELDS = [
  ["title", "商品名称 *", "例如：便携榨汁杯"],
  ["sku", "SKU", "例如：BLENDER-01"],
  ["brand", "品牌", "品牌名称"],
  ["category", "类目", "例如：小家电"],
  ["platform", "默认平台", "Amazon"],
  ["market", "目标市场", "美国"],
  ["language", "文案语言", "英文"],
  ["color", "颜色 / 色号", "例如：薄荷绿 / #B8E5D2"],
  ["material", "材质", "例如：食品级 Tritan"],
  ["dimensions", "尺寸 / 规格", "只填写已确认的参数"],
  ["targetAudience", "目标人群", "例如：通勤和健身人群"],
];
const EMPTY_DRAFT = {
  title: "",
  sku: "",
  brand: "",
  category: "",
  platform: "Amazon",
  market: "美国",
  language: "英文",
  sellingPoints: "",
  targetAudience: "",
  material: "",
  color: "",
  dimensions: "",
  assetIds: [],
  assets: [],
  protectedElements: [],
};

function focusable(dialog) {
  return [
    ...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null);
}

export function CommerceProductLibrary({
  english = false,
  selectedProductId = "",
  busy = false,
  onSelect,
  onClearProduct,
  onClose,
}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [localPreviews, setLocalPreviews] = useState([]);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const requestRef = useRef(null);
  const deleteTriggerRef = useRef(null);
  const deleteCancelRef = useRef(null);
  const fileInputRef = useRef(null);
  const localPreviewsRef = useRef([]);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await listCommerceProducts({
        q: search.trim(),
        status,
        limit: 30,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setProducts(result.items);
    } catch (loadError) {
      if (loadError?.name !== "AbortError")
        setError(loadError?.message || "商品库读取失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const timer = window.setTimeout(load, search ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search, status]);
  useEffect(() => {
    localPreviewsRef.current = localPreviews;
  }, [localPreviews]);
  useEffect(
    () => () => {
      requestRef.current?.abort();
      localPreviewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  useEffect(() => {
    if (deleteCandidate)
      requestAnimationFrame(() => deleteCancelRef.current?.focus());
  }, [deleteCandidate]);

  function openCreate() {
    const next = {
      ...EMPTY_DRAFT,
      assetIds: [],
      assets: [],
      protectedElements: [],
    };
    setDraft(next);
    setEditingId("");
    setPendingFiles([]);
    setLocalPreviews([]);
    setSnapshot(JSON.stringify(next));
    setEditorOpen(true);
  }
  function openEdit(product) {
    const next = {
      ...EMPTY_DRAFT,
      ...product,
      assetIds: [...(product.assetIds || [])],
      assets: [...(product.assets || [])],
      protectedElements: [...(product.protectedElements || [])],
    };
    setEditingId(product.id);
    setPendingFiles([]);
    setLocalPreviews([]);
    setDraft(next);
    setSnapshot(JSON.stringify(next));
    setEditorOpen(true);
  }
  function closeEditor() {
    if (JSON.stringify(draft) !== snapshot || pendingFiles.length)
      setDiscardOpen(true);
    else setEditorOpen(false);
  }
  function chooseFiles(event) {
    const incoming = [...(event.target.files || [])].filter(
      (file) =>
        /^image\/(png|jpeg|webp)$/.test(file.type) &&
        file.size > 0 &&
        file.size <= 10 * 1024 * 1024,
    );
    event.target.value = "";
    const available = Math.max(
      0,
      6 - draft.assetIds.length - pendingFiles.length,
    );
    const next = incoming.slice(0, available);
    setPendingFiles((current) => [...current, ...next]);
    setLocalPreviews((current) => [
      ...current,
      ...next.map((file) => URL.createObjectURL(file)),
    ]);
  }
  function removeExistingAsset(id) {
    setDraft((value) => ({
      ...value,
      assetIds: value.assetIds.filter((assetId) => assetId !== id),
      assets: value.assets.filter((asset) => asset.id !== id),
    }));
  }
  function removePendingFile(index) {
    URL.revokeObjectURL(localPreviews[index]);
    setPendingFiles((current) => current.filter((_, at) => at !== index));
    setLocalPreviews((current) => current.filter((_, at) => at !== index));
  }
  async function save(event) {
    event.preventDefault();
    if (
      !draft.title.trim() ||
      (!draft.assetIds.length && !pendingFiles.length) ||
      saving
    )
      return;
    setSaving(true);
    const createdAssets = [];
    try {
      for (const [index, file] of pendingFiles.entries()) {
        const uploaded = await uploadFile(file);
        const asset = await createUserAsset({
          title: `${draft.title.trim()} ${index + 1}`,
          fileKey: uploaded.key,
          thumbnailKey: uploaded.thumbnailKey,
          contentType: uploaded.contentType || file.type,
          groupId: "",
        });
        createdAssets.push(asset);
      }
      const payload = {
        ...draft,
        title: draft.title.trim(),
        assetIds: [
          ...draft.assetIds,
          ...createdAssets.map((asset) => asset.id),
        ].slice(0, 6),
      };
      delete payload.assets;
      delete payload.id;
      delete payload.status;
      const product = editingId
        ? await updateCommerceProduct(editingId, payload)
        : await createCommerceProduct(payload);
      setProducts((current) =>
        editingId
          ? current.map((item) => (item.id === product.id ? product : item))
          : [product, ...current],
      );
      onSelect?.(product);
      setEditorOpen(false);
    } catch (saveError) {
      await Promise.allSettled(
        createdAssets.map((asset) => deleteUserAsset(asset.id)),
      );
      setError(saveError?.message || "商品保存失败");
    } finally {
      setSaving(false);
    }
  }
  async function toggleStatus(product) {
    const next = product.status === "archived" ? "active" : "archived";
    const updated = await updateCommerceProduct(product.id, { status: next });
    setProducts((current) =>
      status && updated.status !== status
        ? current.filter((item) => item.id !== product.id)
        : current.map((item) => (item.id === product.id ? updated : item)),
    );
    if (selectedProductId === product.id && next === "archived")
      onClearProduct?.();
  }
  async function removeProduct() {
    const product = deleteCandidate;
    if (!product) return;
    await deleteCommerceProduct(product.id);
    setProducts((current) => current.filter((item) => item.id !== product.id));
    if (selectedProductId === product.id) onClearProduct?.();
    setDeleteCandidate(null);
  }
  function closeDelete() {
    const trigger = deleteTriggerRef.current;
    setDeleteCandidate(null);
    requestAnimationFrame(() => trigger?.focus());
  }
  function trap(event, close) {
    if (event.key === "Escape") return close();
    if (event.key !== "Tab") return;
    const items = focusable(event.currentTarget);
    if (!items.length) return;
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items.at(-1).focus();
    } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault();
      items[0].focus();
    }
  }
  const emptyTitle = search
    ? english
      ? "No matching products"
      : "没有匹配的商品"
    : status === "archived"
      ? "还没有归档商品"
      : "先建立一个商品";

  return (
    <section className="commerce-products" aria-busy={loading || busy}>
      <header className="commerce-products__header">
        <div className="commerce-products__title">
          <span className="commerce-products__icon">
            <i className="bi bi-box-seam" />
          </span>
          <div>
            <small>商品资产中心</small>
            <h2>{english ? "Product library" : "商品库"}</h2>
          </div>
        </div>
        <div className="commerce-products__actions">
          <button
            type="button"
            className="commerce-products__icon-button"
            title="刷新商品库"
            aria-label="刷新商品库"
            disabled={loading || busy}
            onClick={load}
          >
            <i
              className={`bi bi-arrow-clockwise${loading ? " is-spinning" : ""}`}
            />
          </button>
          {editorOpen ? (
            <button
              type="button"
              className="commerce-products__ghost"
              onClick={closeEditor}
            >
              返回商品列表
            </button>
          ) : (
            <button
              type="button"
              className="commerce-products__primary"
              onClick={openCreate}
            >
              <i className="bi bi-plus-lg" />
              建立商品
            </button>
          )}
          <button
            type="button"
            className="commerce-products__icon-button"
            title="关闭商品库"
            aria-label="关闭商品库"
            onClick={() =>
              editorOpen && JSON.stringify(draft) !== snapshot
                ? setDiscardOpen(true)
                : onClose?.()
            }
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>
      </header>
      {!editorOpen ? (
        <div className="commerce-products__list">
          <div className="commerce-products__toolbar">
            <label className="commerce-products__search">
              <i className="bi bi-search" />
              <input
                type="search"
                value={search}
                aria-label={english ? "Search product library" : "搜索商品库"}
                placeholder="搜索商品名、SKU、品牌或类目"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="commerce-products__toolbar-meta">
              <div
                className="commerce-products__status-filter"
                role="group"
                aria-label="商品状态"
              >
                {STATUS_OPTIONS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={status === item.value ? "active" : ""}
                    aria-pressed={status === item.value}
                    onClick={() => setStatus(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <span>{products.length} 个商品</span>
            </div>
          </div>
          {error && (
            <div className="commerce-products__inline-error" role="alert">
              <span>
                <i className="bi bi-exclamation-circle" />
                {error}
              </span>
              <button type="button" onClick={load}>
                重试
              </button>
            </div>
          )}
          {loading && !products.length ? (
            <div className="commerce-products__skeletons">
              {Array.from({ length: 6 }, (_, index) => (
                <span key={index} />
              ))}
            </div>
          ) : products.length ? (
            <div className="commerce-products__grid">
              {products.map((product) => (
                <article
                  key={product.id}
                  className={`commerce-product-card${product.id === selectedProductId ? " selected" : ""}${product.status === "archived" ? " is-archived" : ""}`}
                >
                  <button
                    type="button"
                    className="commerce-product-card__media"
                    onClick={() => onSelect?.(product)}
                  >
                    {product.assets?.[0] ? (
                      <AuthenticatedImage
                        src={
                          product.assets[0].thumbnailUrl ||
                          product.assets[0].url
                        }
                        alt={product.title}
                        maxDimension={420}
                      />
                    ) : (
                      <span>
                        <i className="bi bi-image" />
                      </span>
                    )}
                    <b>{product.assets?.length || 0} 张参考</b>
                  </button>
                  <div className="commerce-product-card__body">
                    <div>
                      <strong>
                        {product.title}
                        {product.status === "archived" && <em>已归档</em>}
                      </strong>
                      <small>
                        {[product.sku, product.category, product.platform]
                          .filter(Boolean)
                          .join(" · ") || "待补充渠道资料"}
                      </small>
                    </div>
                    <div className="commerce-product-card__tags">
                      {[product.brand, product.market, product.language]
                        .filter(Boolean)
                        .map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                    </div>
                    <div className="commerce-product-card__actions">
                      <button
                        type="button"
                        className="is-primary"
                        onClick={() => onSelect?.(product)}
                      >
                        <i className="bi bi-arrow-right" />
                        开始创作
                      </button>
                      <button
                        type="button"
                        aria-label={
                          product.status === "archived"
                            ? "恢复商品"
                            : "归档商品"
                        }
                        title={
                          product.status === "archived"
                            ? "恢复商品"
                            : "归档商品"
                        }
                        onClick={() => toggleStatus(product)}
                      >
                        <i
                          className={`bi ${product.status === "archived" ? "bi-arrow-counterclockwise" : "bi-archive"}`}
                        />
                      </button>
                      <button
                        type="button"
                        aria-label="编辑商品"
                        title="编辑商品"
                        onClick={() => openEdit(product)}
                      >
                        <i className="bi bi-pencil" />
                      </button>
                      <button
                        type="button"
                        aria-label="删除商品"
                        title="删除商品"
                        onClick={(event) => {
                          deleteTriggerRef.current = event.currentTarget;
                          setDeleteCandidate(product);
                        }}
                      >
                        <i className="bi bi-trash3" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="commerce-products__empty">
              <span>
                <i className="bi bi-box-seam" />
              </span>
              <strong>{emptyTitle}</strong>
              <small>
                {search
                  ? "换一个关键词试试"
                  : "保存商品资料和参考图后，可以反复生成套图、详情页与营销素材。"}
              </small>
              {!search && status !== "archived" && (
                <button
                  type="button"
                  className="commerce-products__primary"
                  onClick={openCreate}
                >
                  <i className="bi bi-plus-lg" />
                  建立商品
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <form className="commerce-product-editor" onSubmit={save}>
          <div className="commerce-product-editor__intro">
            <span>
              <i className="bi bi-pencil-square" />
            </span>
            <div>
              <small>可复用的商品事实</small>
              <strong>{editingId ? "编辑商品资料" : "建立商品资料"}</strong>
            </div>
          </div>
          <div className="commerce-product-editor__body">
            <section className="commerce-product-editor__assets">
              <div className="commerce-product-editor__section-heading">
                <h3>商品参考图</h3>
                <small>{draft.assetIds.length + pendingFiles.length}/6</small>
              </div>
              <div className="commerce-product-editor__asset-grid">
                {draft.assets.map((asset) => (
                  <figure key={asset.id}>
                    <AuthenticatedImage
                      src={asset.thumbnailUrl || asset.url}
                      alt={asset.title || draft.title}
                      maxDimension={260}
                    />
                    <button
                      type="button"
                      aria-label={`移除${asset.title || "这张"}参考图`}
                      onClick={() => removeExistingAsset(asset.id)}
                    >
                      <i className="bi bi-x" />
                    </button>
                  </figure>
                ))}
                {localPreviews.map((url, index) => (
                  <figure key={url} className="is-local">
                    <img src={url} alt={`待上传参考图 ${index + 1}`} />
                    <button
                      type="button"
                      aria-label={`移除待上传参考图 ${index + 1}`}
                      onClick={() => removePendingFile(index)}
                    >
                      <i className="bi bi-x" />
                    </button>
                  </figure>
                ))}
                {draft.assetIds.length + pendingFiles.length < 6 && (
                  <button
                    type="button"
                    className="commerce-product-editor__add-asset"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <i className="bi bi-plus-lg" />
                    <small>添加图片</small>
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={chooseFiles}
              />
              <p>
                建议上传正面、包装和关键细节图；生成时会优先锁定这些真实信息。
              </p>
            </section>
            <section className="commerce-product-editor__fields">
              <div className="commerce-product-editor__section-heading">
                <h3>商品资料</h3>
                <small>用于创意和文案约束</small>
              </div>
              <div className="commerce-product-editor__field-grid">
                {EDITOR_FIELDS.map(([key, label, placeholder]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      value={draft[key] || ""}
                      placeholder={placeholder}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="commerce-product-editor__textarea">
                <span>核心卖点</span>
                <textarea
                  value={draft.sellingPoints || ""}
                  maxLength={1200}
                  placeholder="只填写真实、可验证的卖点和使用场景"
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      sellingPoints: event.target.value,
                    }))
                  }
                />
                <small>{(draft.sellingPoints || "").length}/1200</small>
              </label>
              <label className="commerce-product-editor__textarea">
                <span>必须保持的细节</span>
                <textarea
                  value={(draft.protectedElements || []).join("、")}
                  maxLength={600}
                  placeholder="用顿号分隔，例如：Logo、按钮数量、杯体刻度"
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      protectedElements: event.target.value
                        .split(/[、,，\n]/)
                        .map((item) => item.trim())
                        .filter(Boolean),
                    }))
                  }
                />
                <small>生成时会加入商品身份锁</small>
              </label>
            </section>
          </div>
          <footer className="commerce-product-editor__footer">
            <button
              type="button"
              className="commerce-products__ghost"
              onClick={closeEditor}
            >
              取消
            </button>
            <button
              type="submit"
              className="commerce-products__primary"
              disabled={
                saving ||
                !draft.title.trim() ||
                (!draft.assetIds.length && !pendingFiles.length)
              }
            >
              <i
                className={`bi ${saving ? "bi-arrow-repeat is-spinning" : "bi-check-lg"}`}
              />
              {saving ? "保存中" : "保存商品并使用"}
            </button>
          </footer>
        </form>
      )}
      {deleteCandidate && (
        <div
          className="commerce-delete-dialog__backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && closeDelete()
          }
        >
          <section
            className="commerce-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            tabIndex={-1}
            onKeyDown={(event) => trap(event, closeDelete)}
          >
            <header>
              <span>
                <i className="bi bi-trash3" />
              </span>
              <button
                ref={deleteCancelRef}
                type="button"
                aria-label="取消删除"
                onClick={closeDelete}
              >
                <i className="bi bi-x-lg" />
              </button>
            </header>
            <div>
              <small>删除商品资料</small>
              <h2>确定删除这个商品吗？</h2>
              <p>
                「{deleteCandidate.title}
                」的商品资料会被移除，关联个人素材仍会保留。
              </p>
            </div>
            <footer>
              <button
                type="button"
                className="commerce-products__ghost"
                onClick={closeDelete}
              >
                取消
              </button>
              <button
                type="button"
                className="commerce-delete-dialog__danger"
                onClick={removeProduct}
              >
                <i className="bi bi-trash3" />
                确认删除
              </button>
            </footer>
          </section>
        </div>
      )}
      {discardOpen && (
        <div className="commerce-delete-dialog__backdrop">
          <section
            className="commerce-delete-dialog"
            role="alertdialog"
            aria-modal="true"
          >
            <header>
              <span className="commerce-delete-dialog__warning">
                <i className="bi bi-pencil-square" />
              </span>
              <button
                type="button"
                aria-label="继续编辑"
                onClick={() => setDiscardOpen(false)}
              >
                <i className="bi bi-x-lg" />
              </button>
            </header>
            <div>
              <small>尚未保存</small>
              <h2>放弃当前编辑吗？</h2>
              <p>已经填写的商品资料和待上传图片不会被保存。</p>
            </div>
            <footer>
              <button
                type="button"
                className="commerce-products__ghost"
                onClick={() => setDiscardOpen(false)}
              >
                继续编辑
              </button>
              <button
                type="button"
                className="commerce-delete-dialog__danger"
                onClick={() => {
                  setDiscardOpen(false);
                  setEditorOpen(false);
                }}
              >
                <i className="bi bi-arrow-counterclockwise" />
                放弃修改
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
