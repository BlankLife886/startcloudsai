import assert from "node:assert/strict";
import test from "node:test";

/** Mirrors shouldOpenAnchorPopoverAbove in canvas-anchor-popover.tsx */
function shouldOpenAnchorPopoverAbove({ preferTop, spaceAbove, spaceBelow, height, autoFlip }) {
    if (!autoFlip) return preferTop;
    if (preferTop) return spaceAbove >= height || spaceAbove > spaceBelow;
    return spaceBelow < height && spaceAbove > spaceBelow;
}

test("bottom-preferring menus flip up when below cannot fit and above has more room", () => {
    assert.equal(
        shouldOpenAnchorPopoverAbove({ preferTop: false, spaceAbove: 500, spaceBelow: 180, height: 420, autoFlip: true }),
        true,
    );
});

test("bottom-preferring menus stay down when below can fit", () => {
    assert.equal(
        shouldOpenAnchorPopoverAbove({ preferTop: false, spaceAbove: 500, spaceBelow: 480, height: 420, autoFlip: true }),
        false,
    );
});

test("bottom-preferring menus stay down when below is still the larger side", () => {
    assert.equal(
        shouldOpenAnchorPopoverAbove({ preferTop: false, spaceAbove: 200, spaceBelow: 220, height: 420, autoFlip: true }),
        false,
    );
});

test("top-preferring menus flip down when above cannot fit and below has more room", () => {
    assert.equal(
        shouldOpenAnchorPopoverAbove({ preferTop: true, spaceAbove: 120, spaceBelow: 500, height: 420, autoFlip: true }),
        false,
    );
});

test("autoFlip false keeps the preferred side", () => {
    assert.equal(
        shouldOpenAnchorPopoverAbove({ preferTop: false, spaceAbove: 800, spaceBelow: 40, height: 420, autoFlip: false }),
        false,
    );
});
