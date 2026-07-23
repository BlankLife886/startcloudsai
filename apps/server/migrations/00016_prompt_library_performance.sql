-- +goose Up
-- 只回填仍处于 other 的同步词条，保留管理员手动设置的分类。
UPDATE prompt_library
SET category = CASE
    WHEN lower(tags::text || ' ' || title) ~ '(typography|text_render|font|lettering|字体|排版|文字渲染|艺术字|书法)'
        THEN 'typography'
    WHEN lower(tags::text || ' ' || title) ~ '(game_ui|gaming|game|游戏素材|游戏美术|游戏截图|像素游戏|关卡)'
        THEN 'game'
    WHEN lower(tags::text || ' ' || title) ~ '(product|ecommerce|commercial|产品展示|产品摄影|电商|商品|包装设计|商业广告)'
        THEN 'product'
    WHEN lower(tags::text || ' ' || title) ~ '(social_poster|infographic|poster|logo|ui/ux|ui与界面|界面设计|信息图|海报设计|视觉设计|社交媒体)'
        THEN 'design'
    WHEN lower(tags::text || ' ' || title) ~ '(illustration|anime|manga|cartoon|插画|动漫|漫画|故事板|绘本|油画|水彩)'
        THEN 'illustration'
    WHEN lower(tags::text || ' ' || title) ~ '(landscape|cityscape|architecture|interior|scene|风景|场景|建筑|室内|城市景观)'
        THEN 'scene'
    WHEN lower(tags::text || ' ' || title) ~ '(portrait|headshot|profile photo|人像|肖像|头像|人物写真|角色设定|角色设计)'
        THEN 'portrait'
    WHEN lower(tags::text || ' ' || title) ~ '(photography|photorealistic|photo-realistic|摄影|照片级|纪实|街拍|抓拍|静物)'
        THEN 'photography'
    ELSE 'other'
END
WHERE source_id <> '' AND COALESCE(NULLIF(category, ''), 'other') = 'other';

CREATE INDEX ix_prompt_library_filter_sort
    ON prompt_library (active, task_type, category, sort ASC, created_at DESC, id DESC);

-- +goose Down
DROP INDEX IF EXISTS ix_prompt_library_filter_sort;
