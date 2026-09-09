export const PRODUCT_GUIDE_KEYS = {
  assistant: "starclouds:assistant-onboarding-v1",
  t2i: "starclouds:t2i-onboarding-v1",
  studio: "starclouds:studio-onboarding-v1",
  history: "starclouds:history-onboarding-v1",
  assets: "starclouds:assets-onboarding-v1",
  canvas: "starclouds:canvas-workspace-onboarding-v1",
};

export const CANVAS_GUIDE_PENDING_KEY = "starclouds:canvas-workspace-tour-pending";

export const ASSISTANT_TOUR_STEPS = [
  {
    id: "welcome",
    title: "先看一遍怎么用",
    body: "AI 助手能问答、整理方案，也可以直接生成图片。下面会标出你真正要点的位置。",
  },
  {
    id: "new-chat",
    title: "新对话",
    body: "换题目时点这里。当前对话会留在左侧历史里，不会丢掉。",
    target: '[data-assistant-tour="new-chat"]',
  },
  {
    id: "history",
    title: "历史对话",
    body: "以前的对话都在这里。点标题就能继续，右侧三点可以重命名、置顶或删除。",
    target: '[data-assistant-tour="history"]',
  },
  {
    id: "assets",
    title: "资产库",
    body: "会话里生成或上传过的图、文件可以再拿出来当参考，不用重新上传。",
    target: '[data-assistant-tour="assets"]',
  },
  {
    id: "mode",
    title: "创作类型",
    body: "问答只聊天；Agent 会整理生图方案再给你确认；图片生成直接出图。先选对类型再写需求。",
    target: '[data-assistant-tour="mode"]',
  },
  {
    id: "model",
    title: "模型和参数",
    body: "这里换模型。问答还能调推理强度；生图时旁边会出现比例、分辨率和张数。",
    target: '[data-assistant-tour="model"]',
  },
  {
    id: "attach",
    title: "添加参考",
    body: "回形针可以上传图片或文档，也可以把文件拖进输入框。生图时它只接受参考图。",
    target: '[data-assistant-tour="attach"]',
  },
  {
    id: "input",
    title: "写下需求",
    body: "说清楚要什么。空页面也可以先点一条示例，内容会进输入框，改完再发。",
    target: '[data-assistant-tour="input"]',
  },
  {
    id: "send",
    title: "发送",
    body: "回车或点发送。生成过程中再发，会排在后面自动继续，不用等它停。",
    target: '[data-assistant-tour="send"]',
  },
  {
    id: "clear",
    title: "清除上文",
    body: "右上角圆环是上下文占用。点「清除上文」会从这里重新开始，历史仍然看得到。",
    target: '[data-assistant-tour="clear-context"]',
  },
];

export const T2I_GUIDE_STEPS = [
  {
    id: "sidebar",
    title: "左侧是整套生成设置",
    body: "从这里完成一次出图：先选模型，再写提示词、加参考图，然后调比例、分辨率和张数。最下面的「立即生成」会按当前设置提交。这一栏决定画面长什么样，右侧只负责看结果。",
    target: '[data-guide="t2i-sidebar"]',
  },
  {
    id: "prompt",
    title: "提示词和参考图",
    body: "大输入框写画面描述，越具体越好，例如主体、光线、风格、构图。下方加号可以上传参考图，Skills 用来套常用技法。写完不必到处找按钮，继续往下看参数，再到这一栏底部生成。",
    target: '[data-guide="t2i-prompt"]',
  },
  {
    id: "params",
    title: "比例、张数和画质",
    body: "展开这些分类可以改宽高比、分辨率、一次出几张，以及安全和输出格式。改完参数不会立刻出图，需要再点左侧底部的生成。不同模型可选的比例和分辨率不一样，选好模型再调这里。",
    target: '[data-guide="t2i-params"]',
  },
  {
    id: "results",
    title: "右侧看作品和历史",
    body: "生成中的图和成品会出现在中间舞台，底部一排是这次会话的作品条，点缩略图就能切换。顶部可以切到历史记录或提示词库：历史用来回看以前的图，提示词库则是现成文案，点一下会填回左侧。",
    target: '[data-guide="t2i-results"]',
  },
];

export const STUDIO_GUIDE_STEPS = [
  {
    id: "input",
    title: "先输入信息",
    body: "顶部加号添加参考图，输入描述信息。",
    target: '[data-guide="studio-input"]',
  },
  {
    id: "params",
    title: "再调整参数",
    body: "底栏切换创作工具、模型、比例和张数。",
    target: '[data-guide="studio-params"]',
  },
  {
    id: "send",
    title: "最后发送",
    body: "右边可以看字数、用语音输入。点发送会带着提示词和参考图进入对应工作台。",
    target: '[data-guide="studio-send"]',
  },
];

export const HISTORY_GUIDE_STEPS = [
  {
    id: "toolbar",
    title: "搜索、筛选和批量操作",
    body: "顶栏按提示词搜索，右边可以筛成功/失败等状态，再右边切换宫格或列表。点「选择」后，卡片会出勾选框，就能批量下载或删除。先把范围收窄，再在下面的列表里点开单张。",
    target: '[data-guide="history-toolbar"]',
  },
  {
    id: "filters",
    title: "按来源看记录",
    body: "这排标签按创作入口分类，例如文生图、AI 助手、无限画布。点一个只看该来源，避免不同类型混在一起。和上面的搜索、状态筛选是叠加的，可以一起用。",
    target: '[data-guide="history-filters"]',
  },
  {
    id: "results",
    title: "作品列表",
    body: "每张卡片是一次生成结果。点图看大图和提示词，卡片上的按钮可以下载、投稿或删除。列表会往下加载更多。空的时候，去创作台、文生图或画布生成第一张，就会出现在这里。",
    target: '[data-guide="history-results"]',
  },
];

export const ASSETS_GUIDE_STEPS = [
  {
    id: "toolbar",
    title: "搜索和添加资产",
    body: "顶栏搜索标题、标签、来源或分组。「添加资产」会打开上传框，把本地图片放进资产库，之后可以在文生图、助手和画布里当参考，不必每次重传。",
    target: '[data-guide="assets-toolbar"]',
  },
  {
    id: "groups",
    title: "分组、回收站和多选",
    body: "中间这排是分组：全部、未分组、你建的文件夹，以及回收站。右侧可以新建分组、进入多选。多选后能批量改名、换组或移入回收站。先选对分组，下面的格子才是你要处理的那一批。",
    target: '[data-guide="assets-groups"]',
  },
  {
    id: "library",
    title: "资产格子",
    body: "每张卡片是一项素材。点开看大图和信息，可以改标题、换分组或删除。删除默认进回收站，30 天内还能恢复。这些图可以在其他创作页作为参考图再次使用。",
    target: '[data-guide="assets-library"]',
  },
];

export const CANVAS_WORKSPACE_GUIDE_STEPS = [
  {
    id: "side",
    title: "左侧面板：节点、资产和项目",
    body: "这一栏管理当前画布上的东西。顶部可切「画布 / 资产 / 提示词 / 最近」：画布列出节点和工作流，点一项会定位到画布上；资产和提示词可拖进画布；最近用于换项目。面板可以拉开或收成胶囊，不影响中间作画。",
    target: '[data-guide="canvas-side-panel"]',
  },
  {
    id: "toolbar",
    title: "中间工具条：往画布加内容",
    body: "顶栏正中是添加和编辑：返回项目列表、新建画布、加图片/文字/配置节点或编组，以及撤销重做、框选或拖动画布。空白处鼠标右键也能加节点。想生成一张图，通常先放一个配置节点，再连到输出。",
    target: '[data-guide="canvas-toolbar"]',
  },
  {
    id: "board",
    title: "无限画布本身",
    body: "中间这块可以无限平移、缩放。滚轮缩放，按住空格或中键拖动画布，点节点可选中、拖动或连线。节点之间的线代表数据怎么往下流。生成结果会出现在对应节点上，可以继续改参数再跑。",
    target: '[data-guide="canvas-board"]',
  },
  {
    id: "actions",
    title: "右上角：运行、导入和导出",
    body: "这里管整张画布的动作：跑或停止工作流、重命名、上传本地文件、导出项目，以及打开画布助手。助手可以按你的话在画布上加节点或改流程。改完结构后，用这里的运行把整条链路跑一遍。",
    target: '[data-guide="canvas-actions"]',
  },
  {
    id: "nav",
    title: "左下角：缩放和缩略图",
    body: "这里看当前缩放到多少、回到合适比例，并打开小地图。画布很大、节点散开时，用小地图能快速跳到另一块区域，不必一直拖。和左侧面板、顶栏工具是分开的，只负责「看全貌」。",
    target: '[data-guide="canvas-nav"]',
  },
];

export const PRODUCT_GUIDES_ENABLED_KEY = "starclouds:product-guides-enabled";
export const PRODUCT_GUIDE_REPLAY_EVENT = "starclouds:replay-product-guide";
export const PRODUCT_GUIDE_DOCK_SELECTOR = "[data-guide-dock]";

export function pageHasProductGuide(pathname = "") {
  const path = String(pathname).split("?")[0];
  if (path === "/studio" || path.startsWith("/studio/")) return true;
  if (path === "/text-to-image" || path.startsWith("/text-to-image/")) return true;
  if (path === "/history" || path.startsWith("/history/")) return true;
  if (path === "/assets" || path.startsWith("/assets/")) return true;
  if (path === "/assistant" || path.startsWith("/assistant/")) return true;
  return /^\/canvas\/[^/]+/.test(path);
}

export function replayProductGuide() {
  window.dispatchEvent(new CustomEvent(PRODUCT_GUIDE_REPLAY_EVENT));
}

export function subscribeProductGuideReplay(handler) {
  window.addEventListener(PRODUCT_GUIDE_REPLAY_EVENT, handler);
  return () => window.removeEventListener(PRODUCT_GUIDE_REPLAY_EVENT, handler);
}

export function hasSeenProductGuide(storageKey) {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return true;
  }
}

export function markProductGuideSeen(storageKey) {
  try {
    localStorage.setItem(storageKey, "1");
  } catch {
    /* ignore */
  }
}

export function isProductGuidesEnabled() {
  try {
    return localStorage.getItem(PRODUCT_GUIDES_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setProductGuidesEnabled(enabled) {
  try {
    localStorage.setItem(PRODUCT_GUIDES_ENABLED_KEY, enabled ? "1" : "0");
    if (enabled) {
      Object.values(PRODUCT_GUIDE_KEYS).forEach((key) => localStorage.removeItem(key));
    }
  } catch {
    /* ignore */
  }
}

export function setCanvasGuidePending() {
  try {
    sessionStorage.setItem(CANVAS_GUIDE_PENDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

export async function resolveCanvasGuidePath() {
  setCanvasGuidePending();
  try {
    const { useCanvasStore } = await import("@canvas/stores/canvas/use-canvas-store");
    if (!useCanvasStore.persist.hasHydrated()) {
      await new Promise((resolve) => {
        const unsub = useCanvasStore.persist.onFinishHydration(() => {
          unsub?.();
          resolve();
        });
        window.setTimeout(resolve, 800);
      });
    }
    const latest = [...(useCanvasStore.getState().projects || [])].sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
    )[0];
    if (latest?.id) return `/canvas/${latest.id}?guide=1`;
  } catch {
    /* ignore */
  }
  return "/canvas";
}
