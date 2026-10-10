package c2a

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"
)

// Reference-image request formats for standard-image vendors whose edit API
// is not OpenAI multipart. The admin picks one per model; nothing is guessed.
const (
	// ImageEditMultipart is the OpenAI multipart POST /images/edits (default).
	ImageEditMultipart = ""
	// ImageEditJSONImageURL posts JSON to /images/edits with
	// image: {type: "image_url", url} or, for several, images: [...] (xAI).
	ImageEditJSONImageURL = "json_image_url"
	// ImageEditJSONGenerations posts JSON to /images/generations with
	// image: "<data URI>" or an array of them (Volcengine Seedream).
	ImageEditJSONGenerations = "json_generations"
)

// WithImageEditFormat selects how reference images are sent.
func (c *Client) WithImageEditFormat(format string) *Client {
	if c == nil {
		return c
	}
	clone := *c
	clone.imageEditFormat = strings.TrimSpace(format)
	return &clone
}

// editImagesJSONResponse sends an edit as JSON in the configured format.
func (c *Client) editImagesJSONResponse(ctx context.Context, prompt, model string, n int, inputImagesB64 []string, size string, options ImageOptions) (StandardImageResponse, error) {
	uris := make([]string, 0, len(inputImagesB64))
	for _, input := range inputImagesB64 {
		uri, err := imageDataURI(input)
		if err != nil {
			return StandardImageResponse{}, err
		}
		uris = append(uris, uri)
	}
	payload := standardImageGenerationPayload(prompt, model, n, size, options)
	responseFormat := strings.ToLower(strings.TrimSpace(options.ResponseFormat))
	if responseFormat != "url" {
		responseFormat = "b64_json"
	}
	payload["response_format"] = responseFormat
	endpoint := "/v1/images/edits"
	switch c.imageEditFormat {
	case ImageEditJSONGenerations:
		endpoint = "/v1/images/generations"
		if len(uris) == 1 {
			payload["image"] = uris[0]
		} else {
			payload["image"] = uris
		}
	default: // ImageEditJSONImageURL
		if len(uris) == 1 {
			payload["image"] = map[string]string{"type": "image_url", "url": uris[0]}
		} else {
			items := make([]map[string]string, 0, len(uris))
			for _, uri := range uris {
				items = append(items, map[string]string{"type": "image_url", "url": uri})
			}
			payload["images"] = items
		}
	}
	body, err := c.doRequest(ctx, http.MethodPost, endpoint, payload, c.Timeout)
	if err != nil {
		return StandardImageResponse{}, err
	}
	return parseStandardImageResponse(body)
}

// imageDataURI turns base64 (or an existing data URI) into a data URI.
func imageDataURI(input string) (string, error) {
	value := strings.TrimSpace(input)
	if strings.HasPrefix(strings.ToLower(value), "data:image/") {
		return value, nil
	}
	raw := imageBase64Value(value)
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return "", &UpstreamError{Message: "参考图 Base64 数据无效"}
	}
	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		return "", &UpstreamError{Message: "参考图格式无效"}
	}
	return "data:" + contentType + ";base64," + raw, nil
}
