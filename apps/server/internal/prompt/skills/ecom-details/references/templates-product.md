# 产品展示类模板

原样收录上游 ecom-details-image 的 `references/templates/` 中以下模板（JSON 未改动）。用法：取 `prompt_template` 作骨架，用商品信息替换 `{variables}`；用户指定风格时套 `variants.<name>.overrides`；已知品类时参考 `category_tips`。

## 01-hero-image｜白底/纯色底产品主图

```json
{
  "id": "hero-image",
  "name": "白底/纯色底产品主图",
  "keywords": ["白底图", "主图", "hero image", "白背景", "product shot", "packshot", "产品照", "商品主图"],
  "trigger_phrases": ["产品主图", "白底图", "白背景产品", "hero image", "电商主图", "纯色背景"],
  "prompt_template": {
    "type": "product photography",
    "subject": "{product_description}",
    "background": "clean white background",
    "lighting": "soft diffused studio lighting, even illumination",
    "composition": "centered, front view",
    "quality": "8K, commercial e-commerce photography"
  },
  "defaults": {
    "background": "clean white background",
    "lighting": "soft diffused studio lighting",
    "composition": "centered, front view"
  },
  "variants": {
    "luxury": {
      "description": "高端奢侈品风格",
      "overrides": { "lighting": "Rembrandt lighting, subtle rim light", "background": "gradient from dark to light, premium feel" }
    },
    "fresh": {
      "description": "清新自然风格",
      "overrides": { "lighting": "bright natural light", "background": "light pastel tones" }
    },
    "tech": {
      "description": "科技感风格",
      "overrides": { "lighting": "dramatic side lighting", "background": "dark minimalist" }
    },
    "color": {
      "description": "彩色背景风格",
      "overrides": { "background": "{color} gradient background" }
    }
  },
  "category_tips": {
    "beauty": "emphasize texture and glow, show formula details",
    "electronics": "highlight metallic finish, screen details, port precision",
    "food": "vibrant colors, fresh appearance, show texture",
    "fashion": "show fabric texture, drape quality, stitching details",
    "home": "show material quality, craftsmanship, lifestyle appeal",
    "jewelry": "macro detail, sparkle and cut quality, luxurious lighting"
  },
  "examples": [
    "{product}, professional product photography on clean white background, soft diffused studio lighting, centered, 8K, commercial e-commerce photography, no shadows, no props",
    "{product} on pure white seamless background, bright commercial studio lighting, centered, 3/4 profile, high resolution, marketplace ready, {material_description}",
    "{product} floating slightly above white surface, softbox overhead, sharp rim light on edges, professional packshot, 8K, ultra-detailed textures"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 03-flat-lay｜平铺图

```json
{
  "id": "flat-lay",
  "name": "平铺图",
  "keywords": ["平铺图", "flat lay", "俯拍", "top-down", "flatlay", "俯视图"],
  "trigger_phrases": ["平铺图", "flat lay", "俯拍", "top-down view", "产品平铺"],
  "prompt_template": {
    "type": "flat lay photography, top-down view",
    "subject": "{product_description} as hero at bottom center",
    "props": "{prop_list}",
    "background": "{background_material}",
    "color_palette": "{color_scheme}",
    "lighting": "soft natural window light from top-left at 45 degrees",
    "quality": "8K, editorial photography, no text, no watermark"
  },
  "defaults": {
    "props": "carefully curated complementary objects",
    "background": "ivory linen texture",
    "color_palette": "ivory, blush, champagne gold, sage green"
  },
  "variants": {
    "luxury": {
      "description": "奢华仪式感",
      "overrides": { "props": "gold foil flakes, pearl beads, dried flowers, silk ribbon, leather journal", "background": "ivory linen with subtle shadow from sheer curtains", "color_palette": "ivory, blush pink, champagne gold, soft cream" }
    },
    "minimal": {
      "description": "极简风格",
      "overrides": { "props": "only 2-3 essential items, clean lines", "background": "clean white surface", "color_palette": "white, gray, one accent color" }
    },
    "seasonal": {
      "description": "季节主题",
      "overrides": { "props": "seasonal elements matching theme", "color_palette": "season-appropriate color scheme" }
    }
  },
  "category_tips": {
    "beauty": "skincare ritual flat lay, open product showing formula, botanical elements",
    "food": "ingredients spread, fresh produce, kitchen tools",
    "fashion": "clothing + accessories + shoes arranged aesthetically, fabric textures",
    "home": "decor items, textures, materials spread showing lifestyle"
  },
  "examples": [
    "Luxurious {category} ritual flat lay, top-down photography. {product} with lid open showing texture as hero at bottom center. Surrounding: gold-tone palette, crystal bottle, dried lavender with silk ribbon, gold foil flakes, pearl beads. Background: ivory linen. Color: ivory, blush, champagne gold. Soft window light top-left at 45 degrees. 8K, no text, no watermark",
    "{product} flat lay top-down as hero. Surrounding: {props}. {background} background. Color: {colors}. Soft window light top-left. Clean aesthetic, 8K",
    "Professional {category} flat lay, top-down editorial. {product} centered with curated objects. {background} background. Strict color control. 8K, magazine quality, no text"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 04-detail-macro｜细节微距图

```json
{
  "id": "detail-macro",
  "name": "细节微距图",
  "keywords": ["细节图", "微距", "macro", "特写", "close-up", "detail shot", "细节展示"],
  "trigger_phrases": ["细节图", "微距图", "产品特写", "材质特写", "detail shot", "macro photography"],
  "prompt_template": {
    "type": "macro product photography",
    "subject": "{product_description}, extreme close-up on {focus_area}",
    "detail": "visible {texture_description}",
    "lighting": "{lighting_style}",
    "camera": "shot with {camera_setup}",
    "quality": "ultra macro detail, 8K, professional product photography"
  },
  "defaults": {
    "focus_area": "texture and material quality",
    "detail": "fine texture, material grain, surface quality",
    "lighting": "soft directional lighting highlighting texture",
    "camera": "dedicated macro lens setup"
  },
  "variants": {
    "texture": {
      "description": "材质纹理展示",
      "overrides": { "focus_area": "material surface showing grain and quality" }
    },
    "formula": {
      "description": "产品配方展示",
      "overrides": { "focus_area": "product formula showing cream/liquid texture", "detail": "formula consistency, light reflection" }
    },
    "craftsmanship": {
      "description": "工艺细节展示",
      "overrides": { "focus_area": "stitching, joints, edges, manufacturing precision" }
    }
  },
  "category_tips": {
    "beauty": "show cream formula texture, shimmer particles, light reflection",
    "electronics": "show port precision, material finish, button detail",
    "food": "show ingredient texture, cross-section, freshness",
    "fashion": "show fabric weave, stitching quality, hardware detail",
    "jewelry": "show gemstone cut, metal finish, clasp detail"
  },
  "examples": [
    "Extreme close-up beauty macro, Canon EOS R5 100mm f/2.8 macro. {product} filling 80% of frame, focusing on {focus_area}. Visible pores, fine lines, natural imperfections, NOT retouched. Formula visible with realistic light reflection. Natural side lighting. 8K",
    "Cinematic {category} close-up. {product} detail showing {texture_description}. Formula/texture visible between fingertips with subtle light reflection. Soft blur background. Dramatic side lighting, warm tones, 8K",
    "Macro detail of {product}, Sony A7R V 90mm macro, focus stacking. Extreme detail showing {focus_area}. Professional product photography, 8K"
  ],
  "anti_ai_tips": "For hand shots: specify real skin (visible knuckle lines, slight dryness on cuticles, natural warm tone). NOT retouched or smoothed.",
  "supports_image_reference": true
}
```

## 09-before-after｜使用前后对比图

```json
{
  "id": "before-after",
  "name": "使用前后对比图",
  "keywords": ["对比", "before after", "前后", "效果对比", "transformation", "变化图"],
  "trigger_phrases": ["对比图", "前后对比", "before after", "效果展示", "使用效果", "transformation"],
  "prompt_template": {
    "type": "before/after comparison visualization",
    "subject": "{product_description}",
    "before_state": "{before_description}",
    "after_state": "{after_description}",
    "metrics": "{data_points}",
    "divider": "elegant center divider",
    "quality": "professional campaign photography"
  },
  "defaults": {
    "before_state": "dull, dry, uneven appearance",
    "after_state": "radiant, smooth, healthy appearance",
    "metrics": "improvement percentage",
    "divider": "elegant gold line with arrow"
  },
  "variants": {
    "clinical": {
      "description": "临床数据风格",
      "overrides": { "metrics": "detailed data grid with 4+ metrics and percentage arrows" }
    },
    "cinematic": {
      "description": "电影感蜕变",
      "overrides": { "before_state": "moody dramatic, cool tone", "after_state": "bright warm golden hour, warm tone", "divider": "decorative vintage frame with product" }
    },
    "simple": {
      "description": "简洁信息图",
      "overrides": { "metrics": "simple progress bar with key metric" }
    }
  },
  "category_tips": {
    "beauty": "show skin texture change, include moisture/radiance percentage data",
    "fitness": "body transformation, consistent pose and lighting",
    "home": "room before/after renovation or cleaning",
    "automotive": "vehicle before/after detailing"
  },
  "examples": [
    "Cinematic before/after {category} transformation. Left: moody lighting showing {before}, cool tone. Right: bright golden hour showing {after}, warm tone. Center: decorative frame with product. Bottom: comparison data grid. Premium campaign layout, 8K, 1080x1620px",
    "Premium before/after comparison. Left: {before_state}, caption 'Before'. Right: {after_state}, caption 'After'. Gold divider with arrow. Bottom: progress metrics {data}. Product thumbnail. Clean clinical aesthetic, 1080x1080px",
    "{category} comparison visualization. Split: {before_state} left, {after_state} right. Key metrics below. White background, professional style, 1080x1080px"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 10-packaging｜包装设计展示

```json
{
  "id": "packaging",
  "name": "包装设计展示",
  "keywords": ["包装", "packaging", "礼盒", "gift box", "包装设计", "unboxing", "开箱"],
  "trigger_phrases": ["包装设计", "包装展示", "礼盒图", "packaging design", "开箱图", "gift box"],
  "prompt_template": {
    "type": "packaging design visualization",
    "subject": "{product_description}",
    "display": "{packaging_components}",
    "surface": "premium marble surface",
    "decorative": "scattered luxury elements",
    "lighting": "soft directional with metallic reflections",
    "quality": "premium design presentation, 8K"
  },
  "defaults": {
    "display": "full spread: product, outer box, tissue, ribbon, brand card",
    "decorative": "gold foil, pearls, dried petals, silk fabric"
  },
  "variants": {
    "luxury-gift": {
      "description": "奢华礼盒",
      "overrides": { "display": "gift box opened: outer box, inner tray, product, ribbon, brand card", "decorative": "gold foil, pearls, dried roses, silk scarf" }
    },
    "minimal-eco": {
      "description": "极简环保",
      "overrides": { "display": "sustainable packaging: recycled paper, soy ink, simple label", "decorative": "natural elements, dried leaves, twine" }
    },
    "unboxing": {
      "description": "开箱体验",
      "overrides": { "display": "unboxing sequence: box opening, tissue reveal, product discovery" }
    }
  },
  "category_tips": {
    "beauty": "label design, ingredient preview, formula through transparent elements",
    "food": "nutritional info area, ingredient imagery, freshness seals",
    "fashion": "branded tissue, garment tag, care instructions, shopping bag",
    "electronics": "box design, inner foam, cable organization, quick-start guide"
  },
  "examples": [
    "Luxury {category} packaging concept. Full spread: (1) product with lid, label visible, (2) outer gift box: embossed pattern, gold logo, magnetic closure, (3) tissue with subtle watermark, (4) satin ribbon with monogram, (5) brand card gold foil, (6) sustainable fill. On marble with gold foil, pearls, dried petals. Soft directional lighting, metallic reflections. Premium presentation, 8K, 1080x1620px",
    "Premium packaging showcase. {product} in gift box open, tissue, ribbon, brand card, luxury unboxing. Professional photography, 1080x1080px",
    "{category} packaging concept on white. Multiple angles, clean presentation, design mockup, 1080x1080px"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 13-size-spec｜尺寸规格+使用步骤图

```json
{
  "id": "size-spec",
  "name": "尺寸规格+使用步骤图",
  "keywords": ["尺寸", "规格", "尺寸图", "使用步骤", "规格图", "dimension", "how to use", "使用指南"],
  "trigger_phrases": ["尺寸图", "规格图", "使用步骤图", "尺寸标注", "how to use", "使用指南", "产品规格"],
  "prompt_template": {
    "type": "product specification and usage guide infographic",
    "subject": "{product_description}",
    "dimensions": "{size_annotations}",
    "steps": "{usage_steps}",
    "extras": "{additional_info}",
    "style": "clean professional layout",
    "quality": "professional e-commerce infographic"
  },
  "defaults": {
    "dimensions": "height, width with measurement lines and arrows",
    "steps": "3-4 step numbered usage guide with icons",
    "extras": "ingredient highlights or feature badges",
    "style": "clean white, professional typography"
  },
  "variants": {
    "premium-editorial": {
      "description": "高端杂志风格",
      "overrides": { "style": "luxury editorial with decorative elements, gold accents, premium typography" }
    },
    "technical": {
      "description": "技术规格风格",
      "overrides": { "dimensions": "detailed specs with reference objects for scale", "extras": "comparison charts, certification badges, data grids" }
    },
    "ritual-guide": {
      "description": "使用仪式指南",
      "overrides": { "steps": "decorative numbered ritual guide with small illustrations" }
    }
  },
  "category_tips": {
    "beauty": "dimension callout badge, usage ritual steps, ingredient percentages",
    "electronics": "precise dimensions with comparison objects, port specs",
    "food": "serving size, preparation steps, nutritional highlights",
    "fashion": "size chart with body measurements, care instructions"
  },
  "examples": [
    "Premium {category} specification and ritual guide, luxury editorial. White background, subtle border. Top: {product} centered with dimension badge. Left: 4-step usage guide with decorative icons. Right: highlights with colored pills. Bottom: {data}. Decorative corner accents. Magazine-quality, 2000x2800px",
    "Product detail card. Left: {product} with dimension annotations {measurements}, arrows and lines. Right: {n}-step usage guide with icons. White background, minimal, professional, 2000x1500px",
    "{category} specification card. {product} with detailed dimensions and reference object. Usage steps with icons. Key features. Clean layout, mobile-friendly, 2000x2000px"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 17-exploded-view｜技术拆解/爆炸图

```json
{
  "id": "exploded-view",
  "name": "技术拆解/爆炸图",
  "keywords": ["拆解图", "爆炸图", "exploded view", "技术图", "结构图", "内部结构", "拆机", "teardown", "cross-section"],
  "trigger_phrases": ["产品拆解", "爆炸图", "内部结构", "技术拆解", "exploded view", "产品组件", "零件展示"],
  "prompt_template": {
    "type": "technical product exploded view",
    "subject": "{product_description}",
    "components": "{component_list}",
    "arrangement": "vertical stack with increasing spacing",
    "background": "clean light gray or white",
    "labels": "thin leader lines to callout labels with name and key spec",
    "quality": "8K, technical illustration, precise component rendering"
  },
  "defaults": {
    "arrangement": "vertical exploded stack",
    "background": "clean light gray",
    "labels": "component name + material + core spec"
  },
  "variants": {
    "blueprint": { "description": "蓝图风格", "overrides": { "background": "dark charcoal with cyan grid lines", "labels": "white and gold typography, blueprint aesthetic" } },
    "minimal": { "description": "极简白底", "overrides": { "background": "pure white, no grid", "labels": "minimal black text, thin gray leader lines" } },
    "apple-style": { "description": "Apple产品拆解风格", "overrides": { "arrangement": "isometric floating with precise spacing", "background": "deep gradient from charcoal to black", "labels": "elegant sans-serif, golden accent lines" } },
    "editorial": { "description": "杂志编辑风格", "overrides": { "background": "warm off-white with subtle texture", "labels": "serif font callouts, hand-drawn arrow style" } }
  },
  "category_tips": {
    "electronics": "highlight circuit boards, chips, battery modules with spec labels",
    "audio": "show speaker drivers, diaphragms, ANC modules, battery size",
    "wearables": "include sensors, display panel, waterproof seals, strap mechanism",
    "home_appliance": "show motor, filter system, internal wiring, control board",
    "phone_accessories": "highlight charging coils, magnet arrays, protective layers",
    "camera": "show lens elements, sensor, image processor, stabilization unit"
  },
  "examples": [
    "Product exploded view. {product} disassembled into 5 components floating in mid-air with spacing, arranged vertically. Clean light gray background. Soft shadows beneath each part. Technical illustration style, 8K, no text",
    "{product} technical exploded view infographic. Components floating in isometric arrangement with thin connecting lines. Each component labeled with name and key spec. Clean white background, blueprint-inspired accent lines, 8K"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 18-ghost-mannequin｜隐形模特

```json
{
  "id": "ghost-mannequin",
  "name": "隐形模特",
  "keywords": ["隐形模特", "ghost mannequin", "invisible model", "3D服装", "服装展示", "无人模特", "中空模特", "flat mannequin"],
  "trigger_phrases": ["隐形模特", "ghost mannequin", "3D服装展示", "无人穿着展示", "服装立体展示", "invisible mannequin"],
  "prompt_template": {
    "type": "ghost mannequin product photography",
    "subject": "{product_description}",
    "form": "invisible mannequin creating natural 3D body shape",
    "details": "natural shoulder slope, bust/chest contour, waist curve visible",
    "background": "clean white or soft gray gradient",
    "lighting": "three-point studio setup, gentle dimension",
    "quality": "8K, fashion e-commerce standard photography"
  },
  "defaults": {
    "form": "natural body contours - shoulders, bust, waist",
    "background": "soft warm gray gradient",
    "lighting": "three-point studio setup creating gentle dimension"
  },
  "variants": {
    "white-clean": { "description": "纯白干净", "overrides": { "background": "pure white seamless", "lighting": "bright even commercial lighting" } },
    "editorial": { "description": "杂志风格", "overrides": { "background": "moody dark gradient from charcoal to deep gray", "lighting": "spotlight from above creating dramatic highlight on shoulders" } },
    "editorial-detail": { "description": "展示内衬细节", "overrides": { "details": "garment partially open revealing inner lining tag, rolled sleeves showing lining contrast" } },
    "lifestyle": { "description": "带环境道具", "overrides": { "background": "minimal studio with subtle editorial prop - single branch or flower in corner" } }
  },
  "category_tips": {
    "shirts": "collar standing naturally, top buttons detail, cuff visibility",
    "dresses": "natural waist cinch, skirt drape showing fabric weight, back zipper detail",
    "coats": "architectural shoulder structure, fabric texture visible, button and pocket details",
    "knitwear": "visible knit pattern and texture, natural stretch around body contours",
    "tshirts": "casual relaxed drape, crew or v-neck sitting naturally, sleeve length proportion",
    "activewear": "compression fit showing body contour, moisture-wicking fabric texture, logo placement"
  },
  "examples": [
    "Ghost mannequin photography. {product} on invisible mannequin, natural body contours visible. Fabric drapes naturally showing material weight. Pure white background. Soft studio lighting, 8K, fashion e-commerce standard",
    "Premium ghost mannequin photography. {product} on invisible mannequin, garment partially open revealing inner lining. Background: soft warm gray gradient. Three-point studio lighting, Phase One quality, 8K"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 19-multi-angle-grid｜产品多角度网格

```json
{
  "id": "multi-angle-grid",
  "name": "产品多角度网格",
  "keywords": ["多角度", "网格", "grid", "多面", "颜色展示", "colorway", "产品角度", "catalog grid", "产品目录"],
  "trigger_phrases": ["多角度展示", "产品网格", "多面展示", "颜色对比", "multi-angle", "grid layout", "产品目录图", "多色展示"],
  "prompt_template": {
    "type": "product photography grid layout",
    "subject": "{product_description}",
    "grid": "2x2 or 3x3 equal squares",
    "variation": "different angles or colorways",
    "background": "clean white in each cell",
    "separators": "thin white borders between cells",
    "quality": "8K, catalog photography, uniform lighting across all cells"
  },
  "defaults": {
    "grid": "2x2 grid, 4 views",
    "variation": "front, side, back, top-down angles",
    "background": "clean white per cell",
    "separators": "thin white borders"
  },
  "variants": {
    "angle-view": { "description": "多角度视角", "overrides": { "variation": "front, side, back, top-down, 3/4 angle views", "grid": "2x2 or 3x3" } },
    "colorway": { "description": "多配色展示", "overrides": { "variation": "same product in different colors, consistent 3/4 angle", "grid": "3x3 for 9 colors or 2x3 for 6 colors" } },
    "feature-grid": { "description": "带功能标注网格", "overrides": { "variation": "each cell shows different product feature with label and icon", "grid": "hero image left + 4 smaller shots right column" } },
    "comparison": { "description": "对比网格", "overrides": { "variation": "before/after or product vs competitor in side-by-side grid" } }
  },
  "category_tips": {
    "beauty": "show bottle angle, cap detail, texture close-up, and open product",
    "electronics": "show front face, side ports, back panel, and included accessories",
    "fashion": "show front view, back view, detail close-up, and fabric texture",
    "food": "show packaging front, back nutrition, open product, and serving suggestion",
    "home": "show full product, detail angle, material texture, and in-context shot",
    "sports": "show product front, side profile, sole/bottom, and action usage shot"
  },
  "examples": [
    "2x2 product grid. {product} shown from 4 angles: front, side, back, top-down. Clean white background per cell. Thin borders. Uniform studio lighting, 8K, 2000x2000px",
    "3x3 color variation grid. Same {product} in 9 different colors, identical 3/4 angle. Clean white cells, subtle drop shadow. Professional catalog, 8K, 2000x2000px"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```
