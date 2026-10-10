#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/ycc/Documents/TestCode/startcloudsai"
FFMPEG="$ROOT/artifacts/video-tools/node_modules/ffmpeg-static/ffmpeg"
OUT_DIR="$ROOT/artifacts/promo-scenes"
OUT="$ROOT/artifacts/starclouds-promo-40s.mp4"
FONT="/System/Library/Fonts/Hiragino Sans GB.ttc"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.mp4 "$OUT_DIR/concat.txt" "$OUT"

# Each shot uses a real page capture or a production visual already shipped with
# the site. The left-side copy is kept deliberately short so the UI remains the
# hero of the film.
declare -a IMAGES=(
  "$ROOT/artifacts/promo-stills/home.png"
  "$ROOT/artifacts/promo-stills/studio.png"
  "$ROOT/apps/web-react/public/sucai/studio-cover-t2i.webp"
  "$ROOT/artifacts/promo-stills/ecommerce.png"
  "$ROOT/artifacts/promo-stills/canvas.png"
  "$ROOT/apps/web-react/public/sucai/covers/cover-coloring.webp"
  "$ROOT/apps/web-react/public/sucai/community-gallery-atmosphere.webp"
  "$ROOT/artifacts/promo-stills/home.png"
)
declare -a DURATIONS=(4.5 5.0 5.5 5.5 5.0 5.0 4.5 5.5)
declare -a TITLES=(
  "星空云绘"
  "从一句话开始"
  "文生图 · 参考图 · 连续对话"
  "AI 电商"
  "无限画布"
  "一条创作流"
  "从灵感到成片"
  "以星为墨，以云为纸"
)
declare -a SUBTITLES=(
  "让想象，成为作品。"
  "选择工具，做到成品"
  "边聊边改，直到满意"
  "主图 · 场景 · 细节 · 卖点套图"
  "将灵感串联成完整的创作"
  "插画 · UI · 模型 · 游戏"
  "云端任务 · 历史同步 · 高清交付"
  "落笔生花，绘梦成真"
)
declare -a KICKERS=(
  "AI 图像创作与作品社区"
  "AI 创作 · 连续对话 · 无限画布"
  "输入主体、场景、光线与风格"
  "商品、人物与营销视觉，一处完成"
  "提示词可复用 · 进度可回看 · 结果可迭代"
  "六大创作工作台"
  "一个入口，连接完整创作链"
  "创作，不止于想象。"
)

for i in "${!IMAGES[@]}"; do
  scene=$(printf "%02d" "$((i + 1))")
  dur="${DURATIONS[$i]}"
  fade_out=$(awk -v d="$dur" 'BEGIN { printf "%.2f", d-0.55 }')
  title="${TITLES[$i]}"
  subtitle="${SUBTITLES[$i]}"
  kicker="${KICKERS[$i]}"

  "$FFMPEG" -hide_banner -loglevel error -y \
    -loop 1 -framerate 30 -i "${IMAGES[$i]}" \
    -t "$dur" \
    -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0d0a1d,setsar=1,eq=saturation=1.08:contrast=1.04,drawbox=x=0:y=0:w=660:h=720:color=0x0a0814b8:t=fill,drawbox=x=68:y=188:w=7:h=176:color=0xa18aff:t=fill,drawtext=fontfile=${FONT}:text='${kicker}':fontcolor=0xcfc7ff:fontsize=22:x=96:y=172:enable='between(t,0.35,${fade_out})',drawtext=fontfile=${FONT}:text='${title}':fontcolor=white:fontsize=52:x=96:y=235:enable='between(t,0.25,${fade_out})',drawtext=fontfile=${FONT}:text='${subtitle}':fontcolor=0xf0edff:fontsize=30:x=96:y=320:enable='between(t,0.4,${fade_out})',drawtext=fontfile=${FONT}:text='STAR CLOUDS AI  /  ${scene}':fontcolor=0xb2a8d9:fontsize=16:x=96:y=640:enable='between(t,0.55,${fade_out})',fade=t=in:st=0:d=0.45,fade=t=out:st=${fade_out}:d=0.55" \
    -r 30 -c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium \
    "$OUT_DIR/scene-${scene}.mp4"
  printf "file '%s'\n" "$OUT_DIR/scene-${scene}.mp4" >> "$OUT_DIR/concat.txt"
done

"$FFMPEG" -hide_banner -loglevel error -y \
  -f concat -safe 0 -i "$OUT_DIR/concat.txt" -c copy \
  "$OUT_DIR/video-only.mp4"

# A soft, low-volume four-note pad keeps the cut feeling intentional without
# competing with a future voice-over track. It is generated locally, so the
# deliverable has no licensing dependency.
"$FFMPEG" -hide_banner -loglevel error -y \
  -i "$OUT_DIR/video-only.mp4" \
  -f lavfi -i "sine=frequency=220:sample_rate=44100:duration=40.5" \
  -f lavfi -i "sine=frequency=277.18:sample_rate=44100:duration=40.5" \
  -f lavfi -i "sine=frequency=329.63:sample_rate=44100:duration=40.5" \
  -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=40.5" \
  -filter_complex "[1:a]volume=0.055[a1];[2:a]volume=0.042[a2];[3:a]volume=0.032[a3];[4:a]volume=0.018[a4];[a1][a2][a3][a4]amix=inputs=4:duration=longest:normalize=0,afade=t=in:st=0:d=1.2,afade=t=out:st=39.2:d=1.3[aout]" \
  -map 0:v:0 -map "[aout]" -t 40.5 \
  -c:v copy -c:a aac -b:a 128k -movflags +faststart \
  "$OUT"

echo "Created $OUT"
