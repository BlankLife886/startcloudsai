# DESIGN.md

更新时间：2026-06-03

适用范围：本文描述的是用户端默认首页/产品叙事视觉方向，主要对应 `apps/web/src/components/themes/DefaultHomeLayout.vue` 及其拆分样式。搜索、壁纸详情、全屏预览、设置、用户中心和 AI 工作台优先遵循各自业务页面的可用性需求，不需要强行套用首页 landing 风格。

## 1. Visual Theme & Atmosphere

- Direction: warm, precise, product-led SaaS landing page inspired by Linear and Stripe's calm dark UI, timeline surfaces, and product-panel storytelling
- Keywords: focused, premium, warm graphite, amber glow, operational clarity, quiet confidence
- One-line framing: make the homepage feel like a high-velocity product system presented through layered product surfaces, timeline cues, and calm execution rather than hype
- Interaction tier: L3
- Experience target: strong first-screen presence, cinematic scroll-story, layered signature moments, still no heavy scroll-jacking

## 2. Color Palette & Roles

```css
:root {
  --lp-bg: #0f0d0c;
  --lp-bg-rgb: 15, 13, 12;
  --lp-bg-elevated: #171312;
  --lp-bg-elevated-rgb: 23, 19, 18;
  --lp-panel: #1d1816;
  --lp-panel-rgb: 29, 24, 22;
  --lp-panel-strong: #241d1a;
  --lp-panel-strong-rgb: 36, 29, 26;
  --lp-line: rgba(255, 240, 232, 0.10);
  --lp-line-strong: rgba(255, 240, 232, 0.18);
  --lp-text: #f6efe8;
  --lp-text-rgb: 246, 239, 232;
  --lp-text-muted: rgba(246, 239, 232, 0.68);
  --lp-text-soft: rgba(246, 239, 232, 0.52);
  --lp-accent: #ffb36b;
  --lp-accent-rgb: 255, 179, 107;
  --lp-accent-strong: #ff8f57;
  --lp-accent-strong-rgb: 255, 143, 87;
  --lp-accent-wash: rgba(255, 179, 107, 0.16);
  --lp-success: #f2c078;
  --lp-success-rgb: 242, 192, 120;
}
```

- Base background uses warm charcoal instead of neutral black
- Accent stays amber-to-coral, used sparingly on CTA, graph focus, and highlight chips
- Borders stay low-contrast to preserve Linear-like calm density

## 3. Typography Rules

- Font import: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');`
- Primary family: `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Hero title: `clamp(3rem, 7vw, 6rem)`, weight `800`, letter-spacing `-0.05em`, line-height `0.96`
- Section title: `clamp(2rem, 4vw, 3.25rem)`, weight `700`, letter-spacing `-0.04em`
- Body: `16px`, line-height `1.75`, muted tone by default
- Eyebrow / labels: `12px-13px`, uppercase, letter-spacing `0.16em`
- Forbidden fonts: techno display fonts, geometric novelty fonts, monospace for long body copy

## 4. Component Stylings

- Header shell: translucent warm panel, `14px` blur max, thin border
- Primary button:
  - default: amber gradient fill, dark text
  - hover: slight lift and stronger glow
  - active: reduce lift, tighten shadow
  - focus: visible `2px` accent ring
  - disabled: lower opacity and no shadow
- Secondary button:
  - default: dark panel with subtle border
  - hover: brighter border and lighter fill
  - active: darker fill
  - focus: same accent ring
  - disabled: muted text and border
- Cards:
  - default: elevated panel, 24px radius, quiet border
  - hover: translateY(-4px), slightly warmer highlight border
  - active: reset translate, preserve border
  - focus-within: accent ring for linked cards
  - disabled: not used
- Timeline nodes:
  - default: compact, low-contrast product surface
  - active: stronger text and accent progress emphasis
- Story panels:
  - default: pinned narrative card + switching detail card
  - active: progress rail fills and detail surfaces brighten slightly
- Stat pills and chips: rounded full, low contrast fill, accent only on highlight state
- Hero stage panel: layered cards and chart surface, no heavy glassmorphism

## 5. Layout Principles

- Max content width: `1200px`
- Section spacing: `96px` desktop, `72px` tablet, `56px` mobile
- Hero grid: `1.05fr / 0.95fr`
- Repeating content grids: 3-column for feature cards, 2-column for proof/value blocks, collapse to 1-column on tablet
- Keep long copy within `18-24` words per line on desktop

## 6. Depth & Elevation

- Base surface shadow: `0 24px 60px rgba(0, 0, 0, 0.28)`
- CTA glow: `0 16px 32px rgba(255, 179, 107, 0.18)`
- Strong panel shadow: `0 30px 80px rgba(0, 0, 0, 0.34)`
- Avoid broad blur fields or frosted mega-panels

## 7. Animation & Interaction

- Tier: L3
- Signature moments:
  - hero pointer glow that follows cursor and softly tilts the right-side product stage
  - sticky scroll-story section with left pinned narrative and right-side step replacement
  - product timeline strip and small operational surfaces inside the hero stage
  - asymmetrical card constellation block that feels like multiple signals converging
- Entrance: soft fade-up on hero blocks and major sections
- Hover: cards lift 4px, borders warm slightly, buttons gain subtle glow
- Scroll behavior: native scrolling only, but with sticky stage and intersection-driven active state changes
- Reduced motion: disable tilt, pointer glow, and transform-based hover; keep layout and content intact

## 8. Do's and Don'ts

- Do keep the page dark, calm, and operational
- Do use warm accents only to guide action and hierarchy
- Do keep section copy concise and product-specific
- Do make product surfaces look executable, not decorative
- Do make the first screen communicate product + value + trust immediately
- Do keep panels consistent in radius, border, and elevation
- Do preserve strong mobile readability with large tap targets
- Do keep CTA labels direct and product-oriented
- Do let whitespace create rhythm between dense sections
- Do use sticky and intersection-based storytelling for the middle narrative section
- Do keep cinematic moments limited to 3-4 strong beats instead of many small effects
- Don't use neon greens, cold blues, or rainbow gradients on the default homepage
- Don't overfill the hero with decorative particles or fake dashboards
- Don't use generic dashboard clutter without a readable information hierarchy
- Don't hardcode random colors outside the defined palette
- Don't use emoji, sticker-like icons, or playful illustrations
- Don't make every section a glass card inside another glass card
- Don't make hover states jumpy or overly animated
- Don't use filter-heavy moving layers or permanent full-screen blur effects
- Don't add more than one pinned storytelling section on this page

## 9. Responsive Behavior

- Breakpoints: `1200px`, `992px`, `768px`, `576px`
- Header nav may wrap/collapse per existing app behavior, but hero actions stay usable on small screens
- Hero becomes single-column below `1200px`
- Card grids collapse to one column below `992px`
- Minimum touch target: `44x44px`
- No horizontal overflow below `600px`
- Hero stage becomes stacked and simplified on mobile
