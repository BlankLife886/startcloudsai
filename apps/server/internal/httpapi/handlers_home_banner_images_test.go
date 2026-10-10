package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
)

type bannerUploadedOriginal struct {
	Hash          [32]byte
	Size          int64
	ContentLength int64
	ContentType   string
	Width         int
	Height        int
}

func newBannerImageUploadEnv(t *testing.T) (*communityEnv, <-chan bannerUploadedOriginal) {
	t.Helper()
	env := newCommunityEnv(t)
	objectDirectory := t.TempDir()
	uploads := make(chan bannerUploadedOriginal, 8)
	objectServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		objectPath := filepath.Join(objectDirectory, filepath.Base(r.URL.Path))
		if r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/announcement-images/") {
			w.Header().Set("Content-Type", mime.TypeByExtension(filepath.Ext(r.URL.Path)))
			http.ServeFile(w, r, objectPath)
			return
		}
		if r.Method != http.MethodPut || !strings.Contains(r.URL.Path, "/announcement-images/") {
			t.Errorf("unexpected object request: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("X-Amz-Trailer") != "" || strings.Contains(r.Header.Get("Content-Encoding"), "aws-chunked") {
			t.Error("original upload used an unsupported checksum trailer")
		}
		var prefix [64 << 10]byte
		n, err := io.ReadFull(r.Body, prefix[:])
		if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
			t.Error(err)
		}
		hash := sha256.New()
		objectFile, err := os.Create(objectPath)
		if err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		writer := io.MultiWriter(hash, objectFile)
		_, _ = writer.Write(prefix[:n])
		rest, err := io.Copy(writer, r.Body)
		if closeErr := objectFile.Close(); closeErr != nil {
			t.Error(closeErr)
		}
		if err != nil {
			t.Error(err)
		}
		config, _, err := image.DecodeConfig(bytes.NewReader(prefix[:n]))
		if err != nil {
			t.Errorf("uploaded image header: %v", err)
		}
		var sum [32]byte
		copy(sum[:], hash.Sum(nil))
		uploads <- bannerUploadedOriginal{
			Hash: sum, Size: int64(n) + rest, ContentLength: r.ContentLength,
			ContentType: r.Header.Get("Content-Type"), Width: config.Width, Height: config.Height,
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(objectServer.Close)
	env.cfg.ObjectStorageEndpoint = objectServer.URL
	env.cfg.ObjectStoragePublicEndpoint = ""
	env.cfg.ObjectStorageRegion = "ap-northeast-1"
	env.cfg.ObjectStorageAccessKeyID = "test-access-key"
	env.cfg.ObjectStorageSecretAccessKey = "test-secret-key"
	env.cfg.ObjectStorageBucket = "starcloudsai-test"
	env.cfg.ObjectStorageUsePathStyle = true
	env.cfg.ObjectStoragePresignExpireSecs = 900
	env.cfg.UploadMaxBytes = 15 << 20
	objects, err := storage.New(env.cfg)
	if err != nil {
		t.Fatal(err)
	}
	env.engine = (&Server{Cfg: env.cfg, St: env.st, Storage: objects}).Router()
	return env, uploads
}

func uploadBannerImageFixture(t *testing.T, env *communityEnv, path, token, filename string, data []byte) (*httptest.ResponseRecorder, *http.Request) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if token != "" {
		req.AddCookie(&http.Cookie{Name: adminSessionCookieName, Value: token})
	}
	response := httptest.NewRecorder()
	env.engine.ServeHTTP(response, req)
	return response, req
}

func bannerPNGFixture(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	var data bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.NoCompression}
	if err := encoder.Encode(&data, img); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestAdminHomeBannerImagesPreserveOriginalFormatsAndPixels(t *testing.T) {
	env, uploads := newBannerImageUploadEnv(t)
	_, token := env.newUserSession(t, "admin")
	const width, height = 1601, 901
	pngData := bannerPNGFixture(t, width, height)
	var jpgData bytes.Buffer
	if err := jpeg.Encode(&jpgData, image.NewNRGBA(image.Rect(0, 0, width, height)), &jpeg.Options{Quality: 93}); err != nil {
		t.Fatal(err)
	}
	webpData, err := media.EncodeVariant(pngData, media.VariantOptions{Format: "webp", Lossless: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct {
		Name, ContentType string
		Data              []byte
	}{
		{Name: "png", ContentType: "image/png", Data: pngData},
		{Name: "jpg", ContentType: "image/jpeg", Data: jpgData.Bytes()},
		{Name: "webp", ContentType: "image/webp", Data: webpData.Data},
	} {
		t.Run(fixture.Name, func(t *testing.T) {
			response, _ := uploadBannerImageFixture(t, env, "/api/v1/admin/home-banners/images", token, "banner."+fixture.Name, fixture.Data)
			if response.Code != http.StatusCreated {
				t.Fatalf("upload status=%d body=%s", response.Code, response.Body.String())
			}
			stored := <-uploads
			if stored.Hash != sha256.Sum256(fixture.Data) || stored.Size != int64(len(fixture.Data)) || stored.ContentLength != stored.Size {
				t.Fatalf("original bytes changed: %#v", stored)
			}
			if stored.ContentType != fixture.ContentType || stored.Width != width || stored.Height != height {
				t.Fatalf("original format or pixels changed: %#v", stored)
			}
			var result struct {
				Data struct{ Key, URL string } `json:"data"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if !strings.HasSuffix(result.Data.Key, "."+fixture.Name) || result.Data.URL != "/api/v1/files/"+result.Data.Key || !strings.HasPrefix(result.Data.Key, homeBannerOriginalPrefix) {
				t.Fatalf("public original location = %#v", result)
			}
		})
	}
}

func TestAdminHomeBannerImageExceedsFormerUploadLimits(t *testing.T) {
	env, uploads := newBannerImageUploadEnv(t)
	_, token := env.newUserSession(t, "admin")
	data := bannerPNGFixture(t, 3200, 2688)
	if len(data) <= 32<<20 {
		t.Fatalf("fixture must exceed 8MiB, 15MiB and 32MiB: %d bytes", len(data))
	}
	response, _ := uploadBannerImageFixture(t, env, "/api/v1/admin/home-banners/images", token, "large-original.png", data)
	if response.Code != http.StatusCreated {
		t.Fatalf("large upload status=%d body=%s", response.Code, response.Body.String())
	}
	stored := <-uploads
	if stored.Hash != sha256.Sum256(data) || stored.Size != int64(len(data)) || stored.Width != 3200 || stored.Height != 2688 {
		t.Fatalf("large original changed: %#v", stored)
	}
	var result struct {
		Data struct{ URL string } `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	publicServer := httptest.NewServer(env.engine)
	defer publicServer.Close()
	download, err := publicServer.Client().Get(publicServer.URL + result.Data.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer download.Body.Close()
	if download.StatusCode != http.StatusOK {
		t.Fatalf("anonymous original download status=%d", download.StatusCode)
	}
	hash := sha256.New()
	length, err := io.Copy(hash, download.Body)
	if err != nil || length != int64(len(data)) || !bytes.Equal(hash.Sum(nil), stored.Hash[:]) {
		t.Fatalf("anonymous original download changed: bytes=%d err=%v", length, err)
	}
	legacyURL := strings.Replace(result.Data.URL, homeBannerOriginalPrefix, "announcement-images/", 1)
	legacy, err := publicServer.Client().Get(publicServer.URL + legacyURL)
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.Body.Close()
	if legacy.StatusCode != http.StatusInternalServerError {
		t.Fatalf("ordinary announcement object unexpectedly bypassed its read limit: status=%d", legacy.StatusCode)
	}
}

func TestAdminHomeBannerImageRequiresAdminAndValidFormat(t *testing.T) {
	env, _ := newBannerImageUploadEnv(t)
	_, token := env.newUserSession(t, "admin")
	response, _ := uploadBannerImageFixture(t, env, "/api/v1/admin/home-banners/images", "", "banner.png", []byte("not an image"))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated upload status=%d", response.Code)
	}
	response, _ = uploadBannerImageFixture(t, env, "/api/v1/admin/home-banners/images", token, "banner.png", []byte("not an image"))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unsupported upload status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAnnouncementImageUploadKeepsExistingCompression(t *testing.T) {
	env, uploads := newBannerImageUploadEnv(t)
	_, token := env.newUserSession(t, "admin")
	if err := settings.Set(context.Background(), env.st.Pool, "image_variant_format", json.RawMessage(`"png"`)); err != nil {
		t.Fatal(err)
	}
	data := bannerPNGFixture(t, 1601, 901)
	response, _ := uploadBannerImageFixture(t, env, "/api/v1/admin/announcements/images", token, "announcement.png", data)
	if response.Code != http.StatusCreated {
		t.Fatalf("announcement upload status=%d body=%s", response.Code, response.Body.String())
	}
	stored := <-uploads
	if stored.Width != 1280 || stored.Height != 901*1280/1601 || stored.Hash == sha256.Sum256(data) {
		t.Fatalf("announcement compression changed: %#v", stored)
	}
}
