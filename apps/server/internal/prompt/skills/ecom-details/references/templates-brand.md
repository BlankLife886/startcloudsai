# 品牌调性类模板

原样收录上游 ecom-details-image 的 `references/templates/` 中以下模板（JSON 未改动）。用法：取 `prompt_template` 作骨架，用商品信息替换 `{variables}`；用户指定风格时套 `variants.<name>.overrides`；已知品类时参考 `category_tips`。

## 20-magazine-editorial｜杂志大片/封面

```json
{
  "id": "magazine-editorial",
  "name": "杂志大片/封面",
  "keywords": ["杂志", "封面", "杂志大片", "editorial", "magazine cover", "时尚大片", "Vogue", "时尚摄影", "fashion editorial"],
  "trigger_phrases": ["杂志封面", "杂志大片", "时尚大片", "editorial", "magazine cover", "品牌大片", "时尚杂志", "封面图"],
  "prompt_template": {
    "type": "fashion/beauty magazine cover editorial",
    "subject": "{product_description}",
    "model": "person holding or wearing product in editorial pose",
    "makeup_hair": "polished editorial beauty look",
    "background": "studio backdrop in warm/tonal color",
    "lighting": "beauty dish + rim light, editorial setup",
    "layout": "magazine masthead area at top, barcode space at bottom",
    "quality": "8K, Vogue-quality editorial photography"
  },
  "defaults": {
    "lighting": "beauty dish from front-left, soft rim light on hair",
    "background": "studio backdrop warm peach-nude tone",
    "layout": "masthead area top, issue text bottom-left, barcode bottom-right"
  },
  "variants": {
    "beauty-cover": { "description": "美妆封面", "overrides": { "model": "close-up portrait with glowing skin, holding skincare near face", "makeup_hair": "dewy natural, glossy lips, subtle smoky eye" } },
    "fashion-cover": { "description": "时尚封面", "overrides": { "model": "full or 3/4 body shot wearing fashion product, confident pose", "makeup_hair": "bold editorial makeup, high-fashion styling" } },
    "fragrance-editorial": { "description": "香水大片", "overrides": { "model": "person in contemplative pose with fragrance bottle, atmospheric", "background": "dark moody backdrop with atmospheric haze" } },
    "minimal-editorial": { "description": "极简杂志内页", "overrides": { "background": "clean white studio, no backdrop color", "layout": "no masthead, clean full-bleed editorial image" } }
  },
  "category_tips": {
    "skincare": "dewy skin, product held at chin level, beauty lighting",
    "fragrance": "atmospheric smoke, contemplative mood, bottle prominent",
    "fashion": "confident pose, outfit fully visible, dramatic lighting",
    "jewelry": "close-up on hands/neck, editorial styling, luxury backdrop",
    "haircare": "hair as hero element, movement and texture, beauty lighting",
    "makeup": "bold lip or eye focus, product in hand, editorial beauty"
  },
  "examples": [
    "Beauty magazine cover. Woman with glowing skin holding {product} near face. Beauty dish lighting, soft background. Top area for masthead. Vogue-quality editorial, 8K, 1080x1350px",
    "Fashion editorial magazine cover. Striking woman wearing {product} in contemplative pose. Bold makeup, sleek hair. High-contrast editorial lighting. Magazine layout overlay with border frame. 8K, 1080x1350px"
  ],
  "anti_ai_tips": "For authentic editorial feel: specify actual camera (Phase One IQ4, Canon EOS R5 85mm f/1.2), add visible skin texture, use real beauty lighting terminology",
  "supports_image_reference": true
}
```

## 22-luxury-atmospherics｜奢华氛围渲染

```json
{
  "id": "luxury-atmospherics",
  "name": "奢华氛围渲染",
  "keywords": ["奢华", "氛围", "烟雾", "高级感", "luxury", "atmospheric", "梦幻", "高端", "premium", "烟雾效果", "金色"],
  "trigger_phrases": ["奢华氛围", "高端渲染", "梦幻效果", "luxury campaign", "氛围渲染", "高端广告", "品牌大片", "premium visual"],
  "prompt_template": {
    "type": "luxury product photography with atmospheric effects",
    "subject": "{product_description}",
    "surface": "polished dark reflective surface",
    "atmosphere": "wisps of smoke, floating petals, light particles",
    "lighting": "dramatic rim light + cool ambient fill",
    "background": "infinite dark void with subtle gradient",
    "quality": "8K, award-winning luxury advertising photography"
  },
  "defaults": {
    "surface": "polished obsidian or black marble platform",
    "atmosphere": "purple-blue smoke wisps + floating elements",
    "lighting": "golden rim light from upper-left, cool blue backlight"
  },
  "variants": {
    "floral-dream": { "description": "花卉梦幻", "overrides": { "atmosphere": "fresh flower petals floating at various heights catching light, scattered gold leaf particles" } },
    "smoke-mystique": { "description": "烟雾神秘", "overrides": { "atmosphere": "multi-layered violet and midnight blue smoke swirling around product" } },
    "golden-luxe": { "description": "金色奢华", "overrides": { "atmosphere": "golden bokeh particles, warm amber glow, scattered gold flakes" } },
    "ice-crystal": { "description": "冰晶冷冽", "overrides": { "atmosphere": "floating ice crystals, frost patterns, diamond-like light refractions", "lighting": "cool platinum spotlight, ice-blue ambient" } }
  },
  "category_tips": {
    "fragrance": "multi-layer smoke + matching botanical elements, amber liquid visible inside",
    "skincare": "ethereal glow around product, subtle condensation, dreamy quality",
    "jewelry": "diamond-like light bokeh, dark background, sparkle and reflection focus",
    "wine": "rich amber or ruby liquid, smoke wisps matching color, candlelight warmth",
    "chocolate": "warm golden particles, cocoa powder dust, rich dark tones",
    "watch": "sharp metallic reflections, precise time visible, ice-blue or golden accent"
  },
  "examples": [
    "Luxury product photography with atmospheric effects. {product} on polished dark surface, surrounded by wisps of purple-blue smoke. Dramatic rim light. Deep black background. 8K, cinematic quality",
    "Premium atmospheric product rendering. {product} on black marble veined with gold. Floating flower petals and gold leaf particles. Multi-point lighting: golden rim light + cool backlight. Dark void background, 8K"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 23-device-mockup｜设备界面模型

```json
{
  "id": "device-mockup",
  "name": "设备界面模型",
  "keywords": ["设备模型", "界面模型", "mockup", "UI展示", "APP截图", "设备展示", "屏幕展示", "device mockup", "SaaS"],
  "trigger_phrases": ["设备模型", "界面展示", "mockup", "APP展示", "网站展示", "SaaS展示", "UI mockup", "产品截图", "屏幕展示"],
  "prompt_template": {
    "type": "product device mockup photography",
    "subject": "{product_description} displayed on device screen",
    "device": "laptop or smartphone on desk",
    "screen_content": "modern clean app/dashboard interface",
    "desk_accessories": "coffee cup, plant, notebook, natural work environment",
    "lighting": "natural window light with warm fill",
    "quality": "8K, tech product photography, screen content tack-sharp"
  },
  "defaults": {
    "device": "latest laptop on clean desk",
    "desk_accessories": "coffee cup, small plant, wireless mouse, notebook",
    "lighting": "soft window light from left, warm overhead fill",
    "background": "modern minimal office environment"
  },
  "variants": {
    "single-laptop": { "description": "单笔记本", "overrides": { "device": "MacBook Pro showing product interface, shallow depth of field on screen" } },
    "multi-device": { "description": "多设备联动", "overrides": { "device": "iPad center + iPhone left + smartwatch right, all showing consistent app UI" } },
    "phone-only": { "description": "手机展示", "overrides": { "device": "iPhone held at slight angle in hand, lifestyle background, screen clearly visible" } },
    "office-lifestyle": { "description": "办公场景", "overrides": { "desk_accessories": "Aesop hand cream, Muji pen holder, latte with art, hardcover notebook, trailing plant on shelf", "background": "Scandinavian home office with white bookshelf" } }
  },
  "category_tips": {
    "saas": "show dashboard with charts, KPI cards, data visualizations",
    "mobile_app": "show app interface on phone, notification visible, clean UI",
    "ecommerce_platform": "show store admin dashboard with product listings and analytics",
    "fintech": "show financial dashboard with graphs, portfolio summary",
    "health_app": "show workout tracker, health metrics, progress charts",
    "ai_product": "show chat interface, AI responses, modern dark or light theme"
  },
  "examples": [
    "Product mockup on laptop. Silver laptop on white desk, screen showing modern dashboard with charts. Coffee cup and small plant nearby. Natural window light. Clean product photography, 8K",
    "Multi-device mockup. iPad with keyboard showing {product} app, iPhone showing notification, Apple Watch showing widget. All screens consistent UI in sage green. Scandinavian desk, 8K, 1536x1024px"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 24-storefront｜店铺门面/空间摄影

```json
{
  "id": "storefront",
  "name": "店铺门面/空间摄影",
  "keywords": ["店铺", "门面", "店面", "storefront", "空间摄影", "室内设计", "零售空间", "咖啡店", "实体店"],
  "trigger_phrases": ["店铺门面", "店面摄影", "空间摄影", "零售空间", "咖啡店外观", "实体店", "storefront", "室内摄影", "店铺设计"],
  "prompt_template": {
    "type": "retail/storefront architectural photography",
    "subject": "{business_description}",
    "exterior": "clean facade with signage and window display",
    "interior": "curated display shelving, consultation area, ambient lighting",
    "lighting": "golden hour exterior or warm ambient interior",
    "quality": "8K, editorial architectural photography, wide-angle sharp"
  },
  "defaults": {
    "exterior": "large glass windows, signage, entrance details, potted plants",
    "lighting": "late afternoon warm golden light, interior already glowing",
    "camera": "wide-angle lens, f/8-f/11 for full sharpness"
  },
  "variants": {
    "exterior": { "description": "门面外观", "overrides": { "exterior": "full storefront view with window display, entrance, street context", "interior": "visible through glass windows only" } },
    "interior": { "description": "室内空间", "overrides": { "interior": "wide-angle interior showing product displays, furniture, lighting design", "exterior": "not visible" } },
    "corner-detail": { "description": "角落细节", "overrides": { "interior": "close-up vignette of a curated corner: consultation table, product samples, single flower" } },
    "aerial-plan": { "description": "俯视平面", "overrides": { "camera": "top-down bird's eye view showing full floor plan layout" } }
  },
  "category_tips": {
    "coffee_shop": "espresso machine visible, warm wood tones, latte art, pastry display",
    "beauty_store": "illuminated niches, marble counter, product wall, consultation area",
    "fashion_boutique": "minimalist racks, curated display, premium flooring, mirror accents",
    "restaurant": "table setting, kitchen pass visible, ambient lighting, menu display",
    "gym_studio": "modern equipment, branded wall, natural light, motivational signage",
    "pop_up": "temporary creative installation, bold graphics, unique display fixtures"
  },
  "examples": [
    "Storefront photography. Modern {business} with glass windows showing warm interior. Entrance with potted plants. Golden hour light. Architectural photography, 8K",
    "Premium interior photography of {business}. Wide-angle shot showing product displays, consultation area, herringbone floor. Warm ambient lighting throughout. Architectural Digest quality, 8K, 1536x1024px"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```
