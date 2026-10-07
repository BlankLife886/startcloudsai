# 营销与社媒类模板

原样收录上游 ecom-details-image 的 `references/templates/` 中以下模板（JSON 未改动）。用法：取 `prompt_template` 作骨架，用商品信息替换 `{variables}`；用户指定风格时套 `variants.<name>.overrides`；已知品类时参考 `category_tips`。

## 05-poster-banner｜促销海报/Banner

```json
{
  "id": "poster-banner",
  "name": "促销海报/Banner",
  "keywords": ["海报", "poster", "banner", "促销", "广告图", "活动图", "promotion", "sale"],
  "trigger_phrases": ["促销海报", "banner", "广告图", "活动海报", "促销图", "campaign poster", "sale banner"],
  "prompt_template": {
    "type": "promotional poster design",
    "subject": "{product_description}",
    "background": "{background_description}",
    "headline": "{headline_text}",
    "subtitle": "{subtitle_text}",
    "price": "{price_info}",
    "cta": "{cta_text}",
    "style": "{visual_style}",
    "quality": "high-resolution professional marketing design"
  },
  "defaults": {
    "background": "gradient matching brand aesthetic",
    "headline": "headline text",
    "subtitle": "subtitle or description",
    "price": "",
    "cta": "Shop Now",
    "style": "clean minimalist with accent colors"
  },
  "variants": {
    "luxury": {
      "description": "高端奢华风格",
      "overrides": { "background": "full-bleed rich gradient, gold accents", "style": "luxury magazine editorial, gold foil, pearl embellishments" }
    },
    "minimal": {
      "description": "极简现代风格",
      "overrides": { "background": "clean white or light gradient", "style": "minimalist modern typography, generous white space" }
    },
    "festive": {
      "description": "节日主题风格",
      "overrides": { "background": "festive themed gradient with decorative elements", "style": "festive, cultural elements, seasonal motifs" }
    },
    "flash-sale": {
      "description": "限时折扣风格",
      "overrides": { "style": "bold attention-grabbing, high contrast, urgency elements" }
    }
  },
  "category_tips": {
    "beauty": "rose gold accents, elegant serif fonts, luxury gift aesthetic",
    "electronics": "dark backgrounds, neon accents, futuristic typography",
    "food": "warm colors, dynamic food elements, freshness cues",
    "fashion": "editorial style, model inclusion, aspirational lifestyle"
  },
  "examples": [
    "Luxury {category} campaign poster. Full-bleed gradient ivory to rose. Top: {headline} elegant serif. Center: {product} with decorative elements. {subtitle}. Bottom left: price {price} original crossed out. Bottom right: brand logo and {cta}. Gold foil accents, premium aesthetic, 2000x3000px",
    "{category} promotional poster. {product} centered on {background}. Bold {headline} at top, price {price}, {cta} button. Clean minimalist, accent colors, professional layout, 2000x2000px",
    "Holiday {category} gift campaign. {background} with decorative elements. Center: {product} with gift wrapping. Headline {headline} modern script. Price tag {price} decorative frame. Festive sophisticated, warm cinematic lighting, 1080x1350px"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 06-social-media｜社交媒体素材

```json
{
  "id": "social-media",
  "name": "社交媒体素材",
  "keywords": ["社交媒体", "小红书", "instagram", "tiktok", "种草", "社媒", "social media"],
  "trigger_phrases": ["社交媒体图", "小红书图", "Instagram", "TikTok", "种草图", "社媒素材", "social media post"],
  "prompt_template": {
    "type": "social media content",
    "subject": "{product_description}",
    "platform": "{platform_style}",
    "composition": "phone camera perspective, slightly off-center",
    "lighting": "natural indoor lighting",
    "overlay": "{overlay_elements}",
    "quality": "authentic smartphone photography aesthetic"
  },
  "defaults": {
    "platform": "Instagram post style",
    "composition": "casual phone framing, slightly imperfect",
    "lighting": "natural window light, warm color tone",
    "overlay": "minimal stickers and text badges"
  },
  "variants": {
    "xiaohongshu": {
      "description": "小红书种草风格",
      "overrides": { "platform": "Xiaohongshu RED app lifestyle photo, iPhone shot", "composition": "slightly tilted like quick grab shot", "lighting": "iPhone warm auto-white-balance, Kodak Portra 400 color feel", "overlay": "Xiaohongshu sticker, casual text, star rating" }
    },
    "instagram": {
      "description": "Instagram帖子风格",
      "overrides": { "platform": "Instagram post premium aesthetic", "composition": "clean framing with visual hierarchy", "overlay": "engagement badges, hashtag elements" }
    },
    "tiktok": {
      "description": "TikTok/Reels封面风格",
      "overrides": { "platform": "TikTok/Reels thumbnail, vertical format", "overlay": "trending audio icon, duet prompt, engagement metrics" }
    }
  },
  "category_tips": {
    "beauty": "show product in use on skin, texture close-up, real results",
    "food": "overhead dish/drink shot, appetizing colors, 45-degree angle",
    "fashion": "mirror selfie or outfit grid, casual styling, real-person aesthetic",
    "home": "corner shot in styled room, cozy atmosphere, warm tones"
  },
  "examples": [
    "Ultra-realistic Xiaohongshu RED product lifestyle photo, iPhone 15 Pro, NOT professional photographer. Slightly tilted angle, {product} on {surface}, lid off showing texture. Environmental details: slight water stain, natural shadows, lived-in feel. iPhone warm auto-white-balance, natural noise, NOT sharpened, Kodak Portra 400 feel, NOT AI-generated look, 8K, 1080x1350px",
    "Instagram post format. {product} with overlay text, clean aesthetic. Feature cards showing benefits. Engagement icons. Hashtag tags. Square format, lifestyle aesthetic, 1080x1080px",
    "Premium social media content, TikTok thumbnail. {product} in lifestyle setting. Timestamp badge, engagement metrics, product card. Trending audio icon. Color gradient frame. Viral-worthy composition, 1080x1920px"
  ],
  "anti_ai_tips": "Specify phone model. Add imperfection: noise, warm cast, not centered, slight blur. Use 'NOT AI-generated look'. Reference Kodak Portra 400 tone. Show lived-in environment.",
  "supports_image_reference": true
}
```

## 11-infographic｜信息图/A+Content

```json
{
  "id": "infographic",
  "name": "信息图/A+Content",
  "keywords": ["信息图", "infographic", "A+", "详情页", "卖点图", "产品信息图", "产品详情"],
  "trigger_phrases": ["信息图", "产品信息图", "详情页图", "A+Content", "卖点图", "infographic"],
  "prompt_template": {
    "type": "e-commerce product infographic",
    "subject": "{product_description}",
    "features": "{feature_list}",
    "layout": "structured sections with clear hierarchy",
    "data_vis": "{data_elements}",
    "color_scheme": "{brand_colors}",
    "quality": "professional e-commerce design, mobile-friendly"
  },
  "defaults": {
    "features": "4-6 key features with icons and descriptions",
    "layout": "clean grid, product as focal point",
    "data_vis": "simple charts or comparison tables",
    "color_scheme": "brand-consistent palette"
  },
  "variants": {
    "amazon-a-plus": {
      "description": "亚马逊A+风格",
      "overrides": { "layout": "4-quadrant module with banner, feature blocks, comparison, badges", "data_vis": "comparison table, ingredient chart, certification badges" }
    },
    "feature-grid": {
      "description": "卖点网格",
      "overrides": { "layout": "product centered with callout lines to feature blocks" }
    },
    "story-flow": {
      "description": "故事线信息流",
      "overrides": { "layout": "vertical story: problem → solution → features → results" }
    }
  },
  "category_tips": {
    "beauty": "ingredient breakdown with %, before/after data, dermatologist badges",
    "electronics": "spec comparison, performance metrics, compatibility icons",
    "food": "nutritional visualization, ingredient sourcing, recipe flow",
    "fashion": "size guide, material composition, care instructions"
  },
  "examples": [
    "Complex Amazon A+ Content module. Top banner with brand and tagline. Main: 4 quadrants each showing product detail with labeled feature: (1) {f1}, (2) {f2}, (3) {f3}, (4) {f4}. Below: comparison table. Bottom: spec chart and certification badges. {color} palette. Mobile-first, professional e-commerce, 2000x2500px",
    "Product infographic. Left: {product} on gradient. Right: {n} feature blocks with icons vertically, callout lines connecting to product. Clean modern, {color} accents, 2000x2000px",
    "{category} specification guide. Product centered with dimension callouts. Feature highlights with icons. Data visualization. Clean typography, mobile-friendly, 2000x2000px"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 12-creative-concept｜创意概念广告图

```json
{
  "id": "creative-concept",
  "name": "创意概念广告图",
  "keywords": ["创意图", "概念图", "creative", "概念广告", "品牌广告", "创意广告", "concept art"],
  "trigger_phrases": ["创意广告", "概念图", "品牌广告", "创意素材", "品牌宣传", "creative concept"],
  "prompt_template": {
    "type": "creative advertising photography",
    "subject": "{product_description}",
    "concept": "{creative_concept}",
    "effects": "{special_effects}",
    "color_palette": "{bold_palette}",
    "art_direction": "{art_style}",
    "quality": "award-winning advertising photography, ultra-detailed, cinematic"
  },
  "defaults": {
    "concept": "dynamic product with unexpected visual elements",
    "effects": "dramatic visual impact",
    "color_palette": "bold unusual combinations",
    "art_direction": "strong visual narrative"
  },
  "variants": {
    "splash-dynamic": {
      "description": "飞溅动态效果",
      "overrides": { "effects": "water splash / powder explosion frozen in motion, high-speed photography", "art_direction": "dramatic, vivid, commercial style" }
    },
    "surreal": {
      "description": "超现实概念",
      "overrides": { "concept": "product in unexpected surreal environment", "effects": "gravity-defying, impossible geometry" }
    },
    "minimal-art": {
      "description": "极简艺术风格",
      "overrides": { "concept": "product as art object in minimalist composition", "color_palette": "monochromatic or two-tone" }
    }
  },
  "category_tips": {
    "beauty": "floating product with splash, ethereal lighting, formula particles",
    "electronics": "holographic interfaces, data visualization, futuristic",
    "food": "ingredient explosion, dynamic pour/splash, steam and fire",
    "fashion": "editorial art direction, dramatic poses, fabric in motion"
  },
  "examples": [
    "{product} floating in {dramatic_environment}, {effects: splash/particles/smoke}, {bold colors}, art direction: {style}, ultra-detailed, cinematic lighting, award-winning advertising, 8K",
    "{product} with dynamic elements frozen in motion, high-speed photography, dramatic lighting, vivid colors, commercial {category}. Bold concept, 8K",
    "Creative advertising. {product} in {artistic setting}. {colors} palette. Dramatic lighting with {effects}. Art direction: {style}. Award-winning, cinematic, 8K"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 15-livestream｜电商直播间场景

```json
{
  "id": "livestream",
  "name": "电商直播间场景",
  "keywords": ["直播", "livestream", "直播间", "电商直播", "直播截图", "抖音直播", "带货"],
  "trigger_phrases": ["直播图", "直播间截图", "电商直播", "livestream", "抖音直播", "带货图", "live commerce"],
  "prompt_template": {
    "type": "e-commerce livestream screenshot",
    "host": "{host_description}",
    "product_action": "{product_demonstration}",
    "background": "real home-style livestream setup",
    "ui_overlay": "live commerce UI elements",
    "lighting": "ring light from front, warm indoor overhead mixing in",
    "quality": "authentic phone screen capture, NOT AI-generated look"
  },
  "defaults": {
    "host": "friendly person, natural expression, visible skin texture, NOT retouched",
    "product_action": "holding product close to camera showing details",
    "background": "organized but real product shelf, LED strip, small plants",
    "ui_overlay": "viewer count, LIVE badge, comments, product card, buy button",
    "lighting": "ring light circular catchlight in eyes, warm indoor overhead"
  },
  "variants": {
    "douyin": {
      "description": "抖音直播风格",
      "overrides": { "ui_overlay": "Douyin UI: LIVE badge, viewer count, scrolling comments, product card with price and buy button, gift icons, shopping cart" }
    },
    "taobao": {
      "description": "淘宝直播风格",
      "overrides": { "ui_overlay": "Taobao Live UI: product listing, coupon badges, viewer count, chat" }
    },
    "setup": {
      "description": "直播间布景展示",
      "overrides": { "ui_overlay": "no UI overlay, showing physical setup", "background": "full view of studio with lighting, backdrop, shelves" }
    }
  },
  "category_tips": {
    "beauty": "host demonstrating application, showing texture, real-time swatching",
    "fashion": "host wearing/showing clothing, fit demo, fabric close-up",
    "food": "host tasting/preparing, showing freshness, unboxing",
    "electronics": "host demonstrating features, hands-on product demo"
  },
  "examples": [
    "Ultra-realistic Douyin livestream screenshot, phone screen capture. Host in casual {outfit}, minimal makeup, visible pores and skin texture, NOT retouched. Demonstrating {product}, showing details, other hand gesturing. Ring light natural shine, NOT plastic AI look. Background: real home setup - product shelf, whiteboard with prices, string lights, coffee mug. Phone UI: LIVE badge, viewer count, scrolling comments, product card with price, yellow buy button. Warm cast, slight noise, Kodak Portra 400 tone, NOT AI-generated look, 1080x1920px",
    "Phone screenshot of livestream. Host holding {product}. Ring light catchlight. Product shelf behind. Phone noise, warm indoor, NOT professional, real livestream feel, 1080x1920px",
    "Livestream scene. Host with {product} in home studio. Ring light, visible skin texture. Product display. Live UI elements. Authentic phone capture, 1080x1920px"
  ],
  "anti_ai_tips": "CRITICAL: (1) Phone screen capture style, (2) Ring light: circular catchlight in eyes, (3) Real skin: pores, undereye darkness, NOT smoothed, (4) Real environment: slightly messy, real objects, (5) Warm yellowish cast, (6) Slight noise, (7) 'NOT AI-generated look, NOT plastic smooth', (8) Kodak Portra 400 tone, (9) Realistic UI overlay",
  "supports_image_reference": true
}
```

## 21-seasonal-campaign｜季节主题网格

```json
{
  "id": "seasonal-campaign",
  "name": "季节主题网格",
  "keywords": ["季节", "四季", "campaign", "季节主题", "seasonal", "春夏秋冬", "年度campaign", "品牌campaign", "季节变体"],
  "trigger_phrases": ["季节主题", "四季展示", "seasonal campaign", "年度campaign", "春夏秋冬", "季节变体", "品牌年度", "四季网格"],
  "prompt_template": {
    "type": "seasonal product campaign grid",
    "subject": "{product_description}",
    "layout": "2x2 grid, one product in four seasonal settings",
    "spring": "pastel tones, blossoms, morning dew, soft light",
    "summer": "bright warm tones, tropical elements, golden light",
    "autumn": "warm amber, dried leaves, cinnamon, window light",
    "winter": "cool blues, pine branches, frost, moonlight",
    "quality": "8K, brand campaign photography, consistent product placement"
  },
  "defaults": {
    "layout": "2x2 grid with thin white or gold borders",
    "consistency": "same product angle and size across all four quadrants"
  },
  "variants": {
    "four-seasons": { "description": "经典四季", "overrides": { "layout": "2x2, each quadrant a full seasonal scene" } },
    "holiday-series": { "description": "节日系列", "overrides": { "layout": "2x3 or 3x2 grid, each cell a different holiday theme (Valentine's, Easter, Summer, Halloween, Thanksgiving, Christmas)" } },
    "day-to-night": { "description": "日夜变体", "overrides": { "layout": "2x2 grid, same scene at dawn, morning, afternoon, night" } },
    "travel-series": { "description": "旅行主题", "overrides": { "layout": "2x2 grid, product in 4 travel destinations with local elements" } }
  },
  "category_tips": {
    "skincare": "spring=blossoms+dew, summer=sun+kisses, autumn=cozy+cream, winter=frost+glow",
    "fragrance": "each season with matching botanical elements and color palette",
    "fashion": "season-appropriate styling visible in each quadrant",
    "food": "seasonal ingredients and color palette matching product",
    "home": "seasonal decor elements and lighting mood",
    "candles": "seasonal scents visualized through corresponding natural elements"
  },
  "examples": [
    "2x2 seasonal grid. Same {product} in four settings: Spring with cherry blossoms, Summer with citrus and sunshine, Autumn with maple leaves, Winter with pine and snow. Consistent product angle, 8K, 2000x2000px",
    "Brand seasonal campaign 2x2 grid. {product} in four seasonal worlds: Spring=pastel marble+dew, Summer=tropical leaves+sunset, Autumn=walnut wood+cinnamon, Winter=frosted glass+pine. Season labels in serif font, 8K"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 25-sports-campaign｜运动/健身广告

```json
{
  "id": "sports-campaign",
  "name": "运动/健身广告",
  "keywords": ["运动", "健身", "广告", "sports", "fitness", "campaign", "运动鞋", "运动服", "篮球", "跑步", "健身器材"],
  "trigger_phrases": ["运动广告", "健身广告", "sports campaign", "运动品牌", "运动大片", "健身推广", "运动产品广告", "运动海报"],
  "prompt_template": {
    "type": "sports/fitness advertising campaign photography",
    "subject": "{product_description}",
    "athlete": "athletic model in dynamic pose with product",
    "props": "sports equipment as visual anchor, exaggerated scale",
    "background": "minimal dark studio with reflective floor",
    "typography": "bold condensed headline + subtitle",
    "quality": "8K, Nike/Under Armour campaign quality"
  },
  "defaults": {
    "background": "dark studio, reflective black floor",
    "typography": "bold condensed font, brand color accent",
    "lighting": "spotlight from above, dramatic body highlights"
  },
  "variants": {
    "product-hero": { "description": "产品主视觉", "overrides": { "athlete": "no model, product floating at dynamic angle", "props": "motion lines and speed effects around product" } },
    "athlete-action": { "description": "运动员动态", "overrides": { "athlete": "athlete mid-action wearing product, stadium lights, lens flare" } },
    "triptych": { "description": "三联画", "overrides": { "layout": "three vertical panels: close-up detail + action shot + product hero, unified bottom strip with branding" } },
    "gym-power": { "description": "健身力量感", "overrides": { "athlete": "muscular athlete seated on oversized dumbbell or equipment", "props": "exaggerated fitness equipment placed diagonally" } }
  },
  "category_tips": {
    "running_shoes": "dynamic forward motion, speed lines, track or road surface context",
    "basketball": "mid-dunk or crossover pose, stadium lighting, court texture",
    "fitness_equipment": "athlete using product, sweat detail, gym environment",
    "sportswear": "compression fit visible, fabric technology highlighted, movement pose",
    "protein_supplements": "product with athlete post-workout, muscular definition, energy mood",
    "sports_drink": "splash effects, condensation, vibrant energy colors, hydration theme"
  },
  "examples": [
    "Sports advertising photo. {product} placed diagonally on reflective dark surface. Dramatic side lighting, speed lines around product. Bold headline text. Dynamic and energetic, 8K, 1080x1350px",
    "Fitness brand campaign. Athletic model wearing {product}, seated on large dumbbell. Dark studio with reflective floor. Spotlight from above. 'STRENGTH' bold headline. Nike campaign quality, 8K"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```
