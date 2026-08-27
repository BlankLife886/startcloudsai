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
