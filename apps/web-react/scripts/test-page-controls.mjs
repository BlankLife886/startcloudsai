import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGE_STATUS,
  getDefaultPageControls,
  isPageEntryVisible,
  normalizePageControls,
  pageControlForLocation,
  pageKeyForHref,
  pageKeyForLocation,
} from "../src/config/pageControls.js";

test("activity entries are removed by default", () => {
  const controls = getDefaultPageControls();
  for (const key of [
    "activity.checkin",
    "activity.trial",
    "activity.usage",
    "activity.group",
    "activity.suggestion",
    "activity.failure",
  ]) {
    assert.equal(controls[key].status, PAGE_STATUS.REMOVED);
    assert.equal(isPageEntryVisible(controls, key), false);
  }
  assert.equal(isPageEntryVisible(controls, "/incentive-plans"), false);
});

test("developer API is hidden and blocked by default", () => {
  const controls = getDefaultPageControls();
  assert.equal(controls.developer_api.status, PAGE_STATUS.REMOVED);
  assert.equal(pageKeyForLocation("/developer-api"), "developer_api");
  assert.equal(isPageEntryVisible(controls, "/developer-api"), false);
  assert.equal(
    pageControlForLocation(controls, "/developer-api").status,
    PAGE_STATUS.REMOVED,
  );
});

test("ecommerce route resolves each controlled tool independently", () => {
  assert.equal(
    pageKeyForHref("/ecommerce-design?tool=backdrop"),
    "ecommerce.backdrop",
  );
  assert.equal(
    pageKeyForHref("/ecommerce-design"),
    "ecommerce.shoot",
  );
  assert.equal(
    pageKeyForHref("/ecommerce-design?tool=clone"),
    null,
  );
  assert.equal(pageKeyForLocation("/ecommerce-design", "?tool=shoot"), null);
  const controls = normalizePageControls({
    "ecommerce.shoot": { status: "maintenance", reason: "影棚升级" },
  });
  assert.equal(
    pageControlForLocation(
      controls,
      "/ecommerce-design",
      "?tool=shoot",
    ).status,
    PAGE_STATUS.NORMAL,
  );
  assert.equal(
    isPageEntryVisible(controls, "/ecommerce-design?tool=shoot"),
    true,
  );
});

test("stored page controls override defaults without dropping new keys", () => {
  const controls = normalizePageControls({
    studio: { status: "maintenance", reason: "系统升级" },
  });
  assert.deepEqual(controls.studio, {
    status: PAGE_STATUS.MAINTENANCE,
    reason: "系统升级",
  });
  assert.equal(controls["activity.failure"].status, PAGE_STATUS.REMOVED);
  assert.equal(
    pageControlForLocation(controls, "/studio").status,
    PAGE_STATUS.MAINTENANCE,
  );
  assert.equal(
    pageControlForLocation(controls, "/").status,
    PAGE_STATUS.NORMAL,
  );
});

const businessPages = [
  ["holo_card", "/holo-card", "/holo-card/sample"],
  ["psd_decompose", "/psd-decompose"],
  ["skills", "/skills"],
  ["invitation", "/invite"],
  ["developer_api_docs", "/developer-api/docs"],
  ["ai_tools", "/ai-tools"],
  ["prompts", "/prompts"],
  ["share", "/share"],
  ["app_space", "/app-space"],
  ["updates", "/updates"],
  ["feedback", "/feedback"],
  ["background_remove", "/tools/background-remove"],
  ["image_compress", "/tools/image-compress"],
  ["puzzle", "/tools/puzzle", "/ai-puzzle"],
  ["media_tools", "/tools/image-upscale", "/tools/video-generator"],
  ["history", "/history"],
  ["assets", "/assets", "/materials"],
  ["submissions", "/submissions"],
  ["wallet", "/wallet"],
  ["orders", "/orders"],
  ["subscriptions", "/subscriptions", "/incentive-plans/membership"],
  ["notifications", "/notifications"],
  ["profile", "/profile"],
];

test("new business pages remain open when loading an older settings value", () => {
  const controls = normalizePageControls({ studio: { status: "maintenance", reason: "升级" } });
  for (const [key, ...paths] of businessPages) {
    assert.deepEqual(controls[key], { status: PAGE_STATUS.NORMAL, reason: "" });
    for (const path of paths) {
      assert.equal(pageKeyForLocation(path), key, path);
      assert.equal(pageControlForLocation(controls, path).status, PAGE_STATUS.NORMAL, path);
      assert.equal(isPageEntryVisible(controls, path), true, path);
    }
  }
});

test("removed business pages hide entries and block direct links and route aliases", () => {
  const controls = normalizePageControls(Object.fromEntries(businessPages.map(([key]) => [
    key, { status: "removed", reason: ` ${key} 已下架 ` },
  ])));
  for (const [key, ...paths] of businessPages) {
    for (const path of paths) {
      assert.equal(isPageEntryVisible(controls, `${path}/?view=detail#content`), false, path);
      assert.equal(pageKeyForHref(`${path}/?view=detail#content`), key, path);
      assert.deepEqual(pageControlForLocation(controls, `${path}/`, "?view=detail"), {
        status: PAGE_STATUS.REMOVED,
        reason: `${key} 已下架`,
        key,
        label: pageControlForLocation(controls, path).label,
      });
      assert.notEqual(pageControlForLocation(controls, path).label, "当前页面", path);
    }
  }
});

test("maintenance and developing pages keep entries and display their configured reason", () => {
  for (const status of [PAGE_STATUS.MAINTENANCE, PAGE_STATUS.DEVELOPING]) {
    for (const [key, path] of businessPages) {
      const controls = normalizePageControls({ [key]: { status, reason: "服务升级，请稍后再试。" } });
      assert.equal(isPageEntryVisible(controls, path), true, path);
      assert.equal(pageControlForLocation(controls, path).status, status, path);
      assert.equal(pageControlForLocation(controls, path).reason, "服务升级，请稍后再试。", path);
    }
  }
});

test("API documentation can be published independently of the developer console", () => {
  const defaults = getDefaultPageControls();
  assert.equal(isPageEntryVisible(defaults, "/developer-api"), false);
  assert.equal(isPageEntryVisible(defaults, "/developer-api/docs#authentication"), true);
  const controls = normalizePageControls({ developer_api_docs: { status: "removed", reason: "文档整理中" } });
  assert.equal(pageControlForLocation(controls, "/developer-api/docs").reason, "文档整理中");
});

test("home, sign-in, account settings and legal access remain available", () => {
  const controls = normalizePageControls(Object.fromEntries(businessPages.map(([key]) => [
    key, { status: "removed", reason: "已下架" },
  ])));
  for (const path of ["/", "/auth", "/auth/login", "/auth/register", "/account", "/privacy", "/terms", "/support"]) {
    assert.equal(pageKeyForLocation(path), null, path);
    assert.equal(pageControlForLocation(controls, path).status, PAGE_STATUS.NORMAL, path);
    assert.equal(isPageEntryVisible(controls, path), true, path);
  }
});

test("media tools do not override separately controlled local tools", () => {
  const controls = normalizePageControls({ media_tools: { status: "removed", reason: "媒体工具升级" } });
  assert.equal(isPageEntryVisible(controls, "/tools/image-upscale"), false);
  for (const path of ["/tools/background-remove", "/tools/image-compress", "/tools/puzzle"]) {
    assert.equal(isPageEntryVisible(controls, path), true, path);
  }
});

test("route casing and URL encoding cannot bypass a removed page", () => {
  const controls = normalizePageControls({ skills: { status: "removed", reason: "暂时下架" } });
  for (const path of ["/SKILLS", "/Skills/", "/%73kills", "/%53KILLS/"]) {
    assert.equal(pageKeyForLocation(path), "skills", path);
    assert.equal(isPageEntryVisible(controls, `${path}?mode=preview#content`), false, path);
    assert.equal(pageControlForLocation(controls, path).status, PAGE_STATUS.REMOVED, path);
  }
  assert.equal(pageKeyForLocation("/skills%2Fsample"), null);
  assert.equal(pageKeyForLocation("/%2573kills"), null);
});
