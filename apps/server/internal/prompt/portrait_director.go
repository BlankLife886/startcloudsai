package prompt

import "strings"

const femalePortraitDirectorSkillID = "female-portrait-director"

// This runtime contract is adapted from female-portrait-director V1.6.
const femalePortraitDirectorPrompt = `[人像导演 Skill / FEMALE-PORTRAIT-DIRECTOR-V1.6]
将用户需求导演为一张完整、可信、可拍摄的成年女性人像。以下规则是执行约束，不要把规则、Route 名称、分析过程或字段列表渲染到图片中。

一、参数与尺寸
- 锁定用户明确提出的人物、成年年龄、风格、场景、服装、配色、华丽度、五官、身形、姿势、镜头、光线、滤镜和平台用途；只能细化与稳定化，不得擅自替换。
- 任务参数中的画幅比例、outputSize/size、分辨率和方向具有最高优先级。严格按这些参数构图，不得改成其他比例，不得依靠裁剪伪造比例，也不得自行虚构像素尺寸。
- 用户未指定人物年龄时，使用 24-28 岁、成年气质明确的虚构东方女性，避免幼态化和年龄模糊。

二、唯一主风格路由
只选择一个最匹配的主风格，不得混合多个主 Route：清纯生活照、纯欲曲线生活照、都市时尚写真、古风仙侠美人图、电商服装模特图、复古港风写真、法式慵懒写真、新中式东方写真、活力运动写真、旅行假日写真、影楼精修写真、东方丰腴写真、清冷仙气古风、明媚华贵古风、超近景真实人脸、古风贵女水光妆、低调电影感摄影、黑珍珠墨金 CCD、元气丰腴柔光 CCD、冷白清透 CCD。
可按用户明确气质增加一个兼容方向：明艳女主、清冷女主、冷艳御姐、温柔姐姐、知性、高级轻熟都市或甜酷。气质增强不得覆盖主风格的构图、配色、光线机制和商业目标。

三、导演式画面
- 设计一个明确时间切片、一个轻微主事件和一条自然动作链。动作链包含身体重心、肩颈、双手、衣料动态、头部方向与视线落点，避免同时堆叠多个互相冲突的动作。
- 把人物与成年特征、具体五官与妆容、身形与仪态、服装颜色/材质/版型、场景层次、镜头景别与机位、景深、光源方向与落点、阴影、滤镜色彩和真实质感融合成同一个瞬间。
- 场景只选择 2-3 个有效环境细节，明确前中后景关系；背景服务主体，不堆砌无关物件。
- 保持自然皮肤与材质细节，避免塑料皮肤、过度磨皮、肢体畸形、手指错误、重复人物、随机文字、Logo、水印、脏点、糊边和伪细节。

四、参考图
- 参考图的存在不等于身份复刻。只有用户明确要求保留本人或已授权成年人物时，才锁定脸型、眉眼、鼻唇和稳定可识别特征。
- 用户明确要求保留服装或产品时，锁定品类、轮廓、主色、材质、图案与关键结构，避免遮挡、裁切、变形和色差。
- 仅作为风格参考时，只提取构图、光线、色彩和质感，不复制参考人物身份。用户要求编辑原图时，保留未要求改变的主体和构图关系。

五、安全边界
- 允许明确成年女性的时尚写真、曲线、泳装、内衣风完整穿搭和适度露肤；禁止未成年人或幼态性化、重点部位裸露、透明服装误读、露骨性行为和非自愿情境。
- 不生成未获授权真实人物、明星、公众人物或第三方人物的欺骗性身份复刻，不用于侵犯隐私、骚扰、诽谤、仿冒或虚假宣传。

最终只执行融合后的画面描述与必要负面约束，保持用户原始创作目标。`

func hasSkillID(params map[string]any, expected string) bool {
	if params == nil {
		return false
	}
	switch values := params["skillIds"].(type) {
	case []string:
		for _, value := range values {
			if strings.TrimSpace(value) == expected {
				return true
			}
		}
	case []any:
		for _, value := range values {
			if text, ok := value.(string); ok && strings.TrimSpace(text) == expected {
				return true
			}
		}
	case string:
		return strings.TrimSpace(values) == expected
	}
	return false
}

func applyT2ISkills(compiled string, params map[string]any) string {
	if !hasSkillID(params, femalePortraitDirectorSkillID) {
		return compiled
	}
	return strings.TrimSpace(compiled + "\n\n" + femalePortraitDirectorPrompt)
}
