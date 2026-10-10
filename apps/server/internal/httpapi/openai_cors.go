package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// openAICORSMiddleware lets web pages on other sites call the OpenAI-compatible
// API from the browser. Auth is a Bearer API key, never a cookie, so any origin
// may call without credentials; the session API under /api is not affected.
func openAICORSMiddleware(c *gin.Context) {
	if !isOpenAICompatPath(c.Request.URL.Path) {
		c.Next()
		return
	}
	header := c.Writer.Header()
	header.Set("Access-Control-Allow-Origin", "*")
	header.Set("Access-Control-Expose-Headers", "X-Request-ID, X-Should-Retry, Retry-After")
	header.Add("Vary", "Origin")
	if c.Request.Method == http.MethodOptions && c.GetHeader("Access-Control-Request-Method") != "" {
		header.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		// SDKs add their own headers (x-stainless-*, OpenAI-Organization …);
		// echoing them is safe because no credentials are allowed.
		if requested := c.GetHeader("Access-Control-Request-Headers"); requested != "" {
			header.Set("Access-Control-Allow-Headers", requested)
		} else {
			header.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		}
		header.Set("Access-Control-Max-Age", "86400")
		c.AbortWithStatus(http.StatusNoContent)
		return
	}
	c.Next()
}
