package httpapi

import (
	"context"
	"encoding/base64"
	"log"
	"net/http"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
)

// 电商分析类接口（商品识别、套图 / 详情页 / A+ 策划）的单张商品图读取上限，与 inputKeys 校验一致。
const ecommerceAnalysisImageMaxBytes = 24 << 20

// ecommerceAnalysisImageURLs 读取商品图内容，以 data URL 交给分析模型。
// 预签名链接在本地环境指向 127.0.0.1，远端模型服务取不到图会立即报错；
// 与虚拟试衣服装识别、后台素材自动命名的做法保持一致。
func (s *Server) ecommerceAnalysisImageURLs(ctx context.Context, keys []string) ([]string, error) {
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		data, err := s.Storage.GetBytesLimit(ctx, key, ecommerceAnalysisImageMaxBytes)
		if err != nil || len(data) == 0 {
			log.Printf("ecommerce analysis: read %s: %v", key, err)
			return nil, apperr.E("image_read_failed", "商品图片读取失败，请重新上传", 422)
		}
		contentType := http.DetectContentType(data)
		if !strings.HasPrefix(contentType, "image/") {
			return nil, apperr.E("image_read_failed", "商品图片格式无效，请重新上传", 422)
		}
		out = append(out, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(data))
	}
	return out, nil
}
