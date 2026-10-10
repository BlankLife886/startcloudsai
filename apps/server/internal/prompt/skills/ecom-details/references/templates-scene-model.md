# 场景与模特类模板

原样收录上游 ecom-details-image 的 `references/templates/` 中以下模板（JSON 未改动）。用法：取 `prompt_template` 作骨架，用商品信息替换 `{variables}`；用户指定风格时套 `variants.<name>.overrides`；已知品类时参考 `category_tips`。

## 02-lifestyle-scene｜场景化生活图

```json
{
  "id": "lifestyle-scene",
  "name": "场景化生活图",
  "keywords": ["场景图", "生活图", "lifestyle", "使用场景", "生活场景", "场景化", "lifestyle photography"],
  "trigger_phrases": ["场景图", "生活图", "使用场景图", "lifestyle photo", "产品场景", "生活化展示"],
  "prompt_template": {
    "type": "lifestyle product photography",
    "subject": "{product_description}",
    "setting": "{scene_description}",
    "lighting": "natural {time_of_day} light",
    "composition": "{composition_style}",
    "mood": "{mood_description}",
    "quality": "8K, editorial lifestyle photography"
  },
  "defaults": {
    "setting": "modern living space, clean and organized",
    "lighting": "natural morning light through window",
    "composition": "rule of thirds, product as focal point",
    "mood": "warm and inviting"
  },
  "variants": {
    "morning": {
      "description": "早晨清新氛围",
      "overrides": { "setting": "bright room with sunlight streaming through window", "lighting": "soft morning golden light, visible dust particles", "mood": "fresh, clean, new beginning" }
    },
    "cozy": {
      "description": "温馨舒适氛围",
      "overrides": { "setting": "warm cozy interior, soft textiles, candles", "lighting": "warm ambient lighting, soft golden tones", "mood": "comfortable, intimate" }
    },
    "outdoor": {
      "description": "户外自然场景",
      "overrides": { "setting": "outdoor natural setting, organic elements", "lighting": "golden hour natural sunlight", "mood": "natural, free, adventurous" }
    },
    "luxury": {
      "description": "奢华高端场景",
      "overrides": { "setting": "luxury spa/hotel, marble and gold fixtures", "lighting": "cinematic lighting, warm color grading", "mood": "premium, sophisticated" }
    }
  },
  "category_tips": {
    "beauty": "bathroom vanity with botanical elements, skincare ritual feel",
    "electronics": "modern desk setup, minimal aesthetic, tech-forward",
    "food": "kitchen counter or dining table, fresh ingredients, warm tones",
    "fashion": "urban street or boutique fitting room, model wearing the item",
    "home": "styled room interior, product naturally placed"
  },
  "examples": [
    "{product} naturally placed in {scene}, morning sunlight through window, botanical touches, warm atmosphere, professional lifestyle photography, 8K",
    "Cinematic luxury interior with marble walls and gold fixtures. {product} prominently displayed. Morning sunlight through frosted glass. Fresh flowers. Cinematic depth of field, warm color grading, 8K",
    "{product} in cozy setting, warm ambient lighting, soft textiles, golden hour tones, lifestyle photography, authentic atmosphere"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 07-ugc-style｜UGC风格/买家秀

```json
{
  "id": "ugc-style",
  "name": "UGC风格/买家秀",
  "keywords": ["UGC", "买家秀", "用户生成", "真实用户", "user generated", "GRWM", "真实感"],
  "trigger_phrases": ["UGC图", "买家秀", "用户图", "真实买家", "GRWM", "user-generated", "真实分享"],
  "prompt_template": {
    "type": "authentic UGC snapshot",
    "subject": "{product_description}",
    "style": "smartphone front camera selfie, casual snapshot, NOT professional photography",
    "environment": "real lived-in space, slightly messy, NOT styled",
    "lighting": "indoor lighting with warm yellow cast, uneven",
    "imperfection": "visible noise/grain, imperfect framing, off-center, slightly tilted",
    "quality": "raw phone photo with natural imperfections, NOT AI-generated look, NOT studio quality"
  },
  "defaults": {
    "style": "iPhone front camera, candid snapshot",
    "environment": "real bathroom or bedroom, lived-in details",
    "lighting": "warm indoor overhead lighting, slight yellow cast",
    "imperfection": "noise in shadows, not oversharpened, slight highlight overexposure"
  },
  "variants": {
    "mirror-selfie": {
      "description": "浴室镜自拍",
      "overrides": { "style": "iPhone front camera mirror selfie", "environment": "bathroom mirror, slight condensation and fog marks", "imperfection": "phone case at edge, finger smudge on mirror" }
    },
    "ccd-retro": {
      "description": "CCD复古胶片感",
      "overrides": { "style": "vintage 2005 CCD digicam photo, direct flash, cheap camera aesthetic", "lighting": "harsh direct on-camera flash, strong warm yellow-green color shift, blown-out highlights", "imperfection": "heavy film grain, overexposed skin on forehead and nose, flash hotspot, chromatic aberration at edges, red date stamp bottom-right corner" }
    },
    "grwm": {
      "description": "GRWM跟我一起准备",
      "overrides": { "style": "Get Ready With Me video thumbnail, morning routine", "environment": "vanity mirror, slightly messy counter" }
    },
    "unboxing": {
      "description": "开箱分享",
      "overrides": { "style": "casual unboxing photo on bed or desk", "environment": "bed with wrinkled sheets or cluttered desk" }
    }
  },
  "category_tips": {
    "beauty": "product in use on real skin, visible pores, bathroom setting",
    "food": "phone snap on table, casual restaurant or home",
    "fashion": "mirror selfie wearing item, bedroom or fitting room",
    "electronics": "desk setup with product in use, realistic cables",
    "home": "product in actual living space, not perfectly styled"
  },
  "examples": [
    "Bathroom mirror selfie, iPhone front camera. Person with {product}. Mirror has slight condensation. Warm yellowish indoor lighting. {product} label recognizable but not centered. Skin: visible pores, slight redness, NOT flawless. Warm yellow cast, phone noise, natural unposed, NOT AI-generated look, authentic UGC, 1080x1350px",
    "Vintage 2005 CCD digicam photo, harsh direct flash. Heavy film grain, blown-out highlights on face, strong yellow-green color cast, chromatic aberration at edges. Person holding {product} with casual peace sign. Genuine candid expression. Dim bedroom with string lights, unmade bed. Off-center, slightly tilted composition. Red date stamp '06.12.25' in bottom-right corner. Low resolution, NOT sharp, NOT AI-generated look, raw snapshot, 1080x1350px",
    "Authentic GRWM photo. Person in casual setting showing {product}. Natural imperfect lighting, slightly messy background. Phone selfie angle. Genuine expression. Warm tones, candid smartphone photography, NOT AI-generated look, 1080x1620px"
  ],
  "anti_ai_tips": "CRITICAL: (1) Specify phone model (iPhone 14 Pro/15), (2) Add imperfection (pores, noise, warm cast, off-center), (3) Candid language (NOT professional), (4) Real environment (slightly messy), (5) Avoid AI words (no perfect, flawless, stunning), (6) State 'NOT AI-generated look', (7) Reference Kodak Portra 400 tone",
  "supports_image_reference": true
}
```

## 08-model-showcase｜模特展示图

```json
{
  "id": "model-showcase",
  "name": "模特展示图",
  "keywords": ["模特", "model", "人物展示", "模特图", "真人展示", "人物图"],
  "trigger_phrases": ["模特图", "真人展示", "人物图", "model photo", "模特展示", "人物展示图"],
  "prompt_template": {
    "type": "editorial beauty/fashion photography",
    "subject": "{person_description} with {product_description}",
    "camera": "shot with {camera_setup}",
    "lighting": "natural window light creating realistic highlights",
    "skin_detail": "visible pores, natural skin texture, NOT retouched",
    "expression": "{expression_description}",
    "quality": "professional editorial photography, 8K"
  },
  "defaults": {
    "camera": "Canon EOS R5, 85mm f/1.4 lens",
    "lighting": "natural window light from left, realistic highlights",
    "skin_detail": "visible pores, natural under-eye shadows, slight texture unevenness",
    "expression": "authentic relaxed, subtle natural asymmetry"
  },
  "variants": {
    "beauty-closeup": {
      "description": "美妆极致特写",
      "overrides": { "camera": "Canon EOS R5, 100mm f/2.8 macro", "skin_detail": "incredibly detailed: pores, fine lines, freckles, NOT retouched", "expression": "eyes half-closed, peaceful self-care moment" }
    },
    "fashion-full": {
      "description": "时尚全身展示",
      "overrides": { "camera": "Canon EOS R5, 50mm f/1.2", "expression": "confident direct gaze, editorial pose" }
    },
    "candid": {
      "description": "自然抓拍",
      "overrides": { "camera": "iPhone 15 Pro main camera", "expression": "genuine candid, mid-action", "skin_detail": "natural texture, slight blemishes, relatable" }
    }
  },
  "category_tips": {
    "beauty": "extreme close-up on application moment, formula texture on skin, real skin mandatory",
    "fashion": "full outfit showcase, pose highlighting garment, editorial lighting",
    "accessories": "product being worn/used, hand or body detail, lifestyle context",
    "sports": "active pose in appropriate setting, show performance"
  },
  "examples": [
    "Extreme close-up beauty macro, Canon EOS R5 100mm f/2.8 macro. Face filling 80% of frame, {product} being applied on {focus_area}. Skin incredibly detailed: pores, fine lines, natural imperfections, NOT retouched. Formula visible with realistic reflection. Natural side lighting. NOT AI-generated look, 8K, 1080x1350px",
    "Fashion editorial. {person} with {product}, Canon EOS R5 85mm f/1.4. Natural window light, visible pores, natural shadows, authentic expression, soft bokeh, warm golden tones, 1080x1350px",
    "Candid beauty moment. {person} with {product}, iPhone front camera. Natural lighting, visible pores and texture, relaxed candid, NOT AI-generated look, documentary style, 1080x1350px"
  ],
  "anti_ai_tips": "MANDATORY: (1) Real camera (Canon EOS R5 / Sony A7 IV), (2) Visible skin imperfections (pores, uneven tone, blemishes, fine lines), (3) Natural expression asymmetry, (4) 'NOT retouched, NOT AI-generated look', (5) Real lighting (natural window, NOT studio-perfect), (6) Natural hand details (knuckle lines, cuticle texture)",
  "supports_image_reference": true
}
```

## 14-multi-product｜多产品套装/组合展示

```json
{
  "id": "multi-product",
  "name": "多产品套装/组合展示",
  "keywords": ["套装", "组合", "多产品", "bundle", "gift set", "礼盒", "系列展示"],
  "trigger_phrases": ["套装图", "多产品展示", "产品组合", "bundle image", "礼盒展示", "系列图", "gift set"],
  "prompt_template": {
    "type": "multi-product bundle photography",
    "subject": "{product_set_description}",
    "arrangement": "organized composition, all products clearly visible",
    "background": "{background_description}",
    "decorative": "{decorative_elements}",
    "quality": "professional product photography, 8K"
  },
  "defaults": {
    "arrangement": "organized with consistent spacing, all visible, no overlap",
    "background": "clean suitable for showcase",
    "decorative": "luxury elements for gift-ready presentation"
  },
  "variants": {
    "gift-set": {
      "description": "礼盒套装",
      "overrides": { "arrangement": "products in gift box with cards", "decorative": "satin ribbon, gold foil, dried flowers, pearls" }
    },
    "routine-set": {
      "description": "使用程序套装",
      "overrides": { "arrangement": "products in order of use, step indicators" }
    },
    "lineup": {
      "description": "产品线排列",
      "overrides": { "arrangement": "neat row, hero centered and larger", "decorative": "minimal, clean", "background": "white seamless" }
    }
  },
  "category_tips": {
    "beauty": "complete routine (cleanser → toner → serum → cream), gift-ready",
    "food": "product range, variety pack, flavor assortment",
    "fashion": "outfit coordination pieces, colorway options",
    "home": "collection of coordinating items"
  },
  "examples": [
    "Luxury {category} gift set on premium surface: {product_list}. Organized composition with product cards. Scattered: gold foil, pearls, dried flowers, velvet ribbon. Bottom left: set description. Bottom right: price with original crossed out. Soft directional lighting, premium photography, 8K",
    "Premium {category} routine set. Main product centered, lid open showing texture. Surrounding: routine products arranged naturally. Soft background, decorative elements. Warm studio lighting, gift-ready, 2000x2000px",
    "{category} gift set display. {n} products neat row, consistent spacing. Clean photography, soft shadows, professional bundle image, no text, 2000x2000px"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```

## 16-try-on-virtual｜虚拟试穿/产品融入场景

```json
{
  "id": "try-on-virtual",
  "name": "虚拟试穿/产品融入场景",
  "keywords": ["试穿", "融入", "虚拟试穿", "try on", "场景融合", "产品融入", "product placement"],
  "trigger_phrases": ["虚拟试穿", "产品融入场景", "try on", "场景融合", "产品植入", "场景化融入"],
  "prompt_template": {
    "type": "product integration / virtual try-on",
    "subject": "{product_description} naturally integrated into {scene_type}",
    "setting": "{detailed_scene}",
    "atmosphere": "{mood_and_lighting}",
    "integration": "product prominently displayed, naturally belonging in scene",
    "quality": "cinematic lifestyle photography, 8K"
  },
  "defaults": {
    "setting": "luxury interior or lifestyle environment matching product",
    "atmosphere": "warm, inviting, aspirational",
    "integration": "product as natural focal point"
  },
  "variants": {
    "interior-luxury": {
      "description": "奢华室内场景",
      "overrides": { "setting": "high-end spa/hotel/luxury home, marble, gold fixtures", "atmosphere": "cinematic depth, warm grading, premium" }
    },
    "outdoor-natural": {
      "description": "户外自然场景",
      "overrides": { "setting": "natural outdoor, organic elements", "atmosphere": "golden hour sunlight, natural and free" }
    },
    "studio-editorial": {
      "description": "棚拍编辑风格",
      "overrides": { "setting": "professional studio with styled backdrop", "atmosphere": "controlled studio lighting, editorial quality" }
    }
  },
  "category_tips": {
    "beauty": "spa bathroom, vanity mirror, botanical elements, skincare ritual",
    "fashion": "model wearing item in appropriate setting, natural styling",
    "furniture": "product in complete room setting, complementary decor",
    "electronics": "modern desk setup, in-use context, tech-forward"
  },
  "examples": [
    "Cinematic luxury {category} integration. High-end {interior} with {materials}. {product} prominently displayed. Morning sunlight through frosted glass, ethereal light rays. Fresh flowers, botanical elements. Product label visible, ingredient card beside it. Decorative: tray, pearls, gold foil. Color: {colors}. Cinematic depth, warm grading, premium, 8K, 1080x1620px",
    "{product} naturally in {scene}, morning sunlight, soft shadows, botanical touches, warm atmosphere, professional lifestyle photography, 8K, 1080x1350px",
    "{product} integrated into complete {category} lifestyle scene. {person} at {location}, products arranged naturally, natural light, warm atmosphere. Professional lifestyle, 1080x1350px"
  ],
  "anti_ai_tips": "",
  "supports_image_reference": true
}
```
