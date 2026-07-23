-- +goose Up
-- 来源标签比标题关键词更准确；只纠正带有明确分类标签的同步词条。
UPDATE prompt_library
SET category = CASE
    WHEN lower(tags::text) ~ '(typography|text_render|font|lettering|字体|排版|文字渲染|艺术字|书法)'
        THEN 'typography'
    WHEN lower(tags::text) ~ '(game_ui|gaming|game|游戏素材|游戏美术|游戏截图|像素游戏|关卡|游戏与娱乐)'
        THEN 'game'
    WHEN lower(tags::text) ~ '(social_poster|infographic|poster|logo|ui/ux|ui与界面|界面设计|信息图|海报设计|视觉设计|社交媒体|ui / ux)'
        THEN 'design'
    WHEN lower(tags::text) ~ '(product|ecommerce|commercial|产品展示|产品摄影|电商|商品|包装设计|商业广告)'
        THEN 'product'
    WHEN lower(tags::text) ~ '(illustration|anime|manga|cartoon|插画|动漫|漫画|故事板|绘本|油画|水彩)'
        THEN 'illustration'
    WHEN lower(tags::text) ~ '(landscape|cityscape|architecture|interior|scene|风景|场景|建筑|室内|城市景观)'
        THEN 'scene'
    WHEN lower(tags::text) ~ '(portrait|headshot|profile photo|人像|肖像|头像|人物写真|角色设定|角色设计|人像/角色)'
        THEN 'portrait'
    WHEN lower(tags::text) ~ '(photography|photorealistic|photo-realistic|摄影|照片级|纪实|街拍|抓拍|静物)'
        THEN 'photography'
    ELSE category
END
WHERE source_id <> ''
  AND lower(tags::text) ~ '(typography|text_render|font|lettering|字体|排版|文字渲染|艺术字|书法|game_ui|gaming|game|游戏素材|游戏美术|游戏截图|像素游戏|关卡|游戏与娱乐|social_poster|infographic|poster|logo|ui/ux|ui与界面|界面设计|信息图|海报设计|视觉设计|社交媒体|ui / ux|product|ecommerce|commercial|产品展示|产品摄影|电商|商品|包装设计|商业广告|illustration|anime|manga|cartoon|插画|动漫|漫画|故事板|绘本|油画|水彩|landscape|cityscape|architecture|interior|scene|风景|场景|建筑|室内|城市景观|portrait|headshot|profile photo|人像|肖像|头像|人物写真|角色设定|角色设计|人像/角色|photography|photorealistic|photo-realistic|摄影|照片级|纪实|街拍|抓拍|静物)';

-- +goose Down
-- 分类纠偏不可逆，避免覆盖迁移后管理员的人工调整。
SELECT 1;
