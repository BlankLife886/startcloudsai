package config

import "testing"

func clearObjectStorageEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"OBJECT_STORAGE_ENDPOINT",
		"OBJECT_STORAGE_PUBLIC_ENDPOINT",
		"OBJECT_STORAGE_REGION",
		"OBJECT_STORAGE_ACCESS_KEY_ID",
		"OBJECT_STORAGE_SECRET_ACCESS_KEY",
		"OBJECT_STORAGE_BUCKET",
		"OBJECT_STORAGE_USE_PATH_STYLE",
		"OBJECT_STORAGE_PRESIGN_EXPIRE_SECS",
		"OBJECT_STORAGE_CDN_BASE_URL",
		"R2_ENDPOINT",
		"R2_REGION",
		"R2_ACCESS_KEY_ID",
		"R2_SECRET_ACCESS_KEY",
		"R2_BUCKET",
		"R2_USE_PATH_STYLE",
		"R2_PRESIGN_EXPIRE_SECS",
	} {
		t.Setenv(key, "")
	}
}

func TestLoadObjectStoragePrefersProviderNeutralVariables(t *testing.T) {
	clearObjectStorageEnv(t)
	t.Setenv("APP_ENV", "test")
	t.Setenv("OBJECT_STORAGE_ENDPOINT", "https://s3.oss-cn-hongkong.aliyuncs.com")
	t.Setenv("OBJECT_STORAGE_PUBLIC_ENDPOINT", "https://s3-public.oss-cn-hongkong.aliyuncs.com/")
	t.Setenv("OBJECT_STORAGE_REGION", "cn-hongkong")
	t.Setenv("OBJECT_STORAGE_ACCESS_KEY_ID", "oss-key")
	t.Setenv("OBJECT_STORAGE_SECRET_ACCESS_KEY", "oss-secret")
	t.Setenv("OBJECT_STORAGE_BUCKET", "oss-bucket")
	t.Setenv("OBJECT_STORAGE_USE_PATH_STYLE", "false")
	t.Setenv("OBJECT_STORAGE_PRESIGN_EXPIRE_SECS", "900")
	t.Setenv("OBJECT_STORAGE_CDN_BASE_URL", "https://media.example.com/")
	t.Setenv("R2_ENDPOINT", "https://legacy.invalid")

	cfg := Load()
	if cfg.ObjectStorageEndpoint != "https://s3.oss-cn-hongkong.aliyuncs.com" ||
		cfg.ObjectStoragePublicEndpoint != "https://s3-public.oss-cn-hongkong.aliyuncs.com" ||
		cfg.ObjectStorageRegion != "cn-hongkong" || cfg.ObjectStorageAccessKeyID != "oss-key" ||
		cfg.ObjectStorageSecretAccessKey != "oss-secret" || cfg.ObjectStorageBucket != "oss-bucket" ||
		cfg.ObjectStorageUsePathStyle || cfg.ObjectStoragePresignExpireSecs != 900 ||
		cfg.ObjectStorageCDNBaseURL != "https://media.example.com" {
		t.Fatalf("unexpected object storage config: %+v", cfg)
	}
}

func TestLoadObjectStorageSupportsLegacyR2Variables(t *testing.T) {
	clearObjectStorageEnv(t)
	t.Setenv("APP_ENV", "test")
	t.Setenv("R2_ENDPOINT", "https://account.r2.cloudflarestorage.com")
	t.Setenv("R2_ACCESS_KEY_ID", "legacy-key")
	t.Setenv("R2_SECRET_ACCESS_KEY", "legacy-secret")
	t.Setenv("R2_BUCKET", "legacy-bucket")
	t.Setenv("R2_PRESIGN_EXPIRE_SECS", "1200")

	cfg := Load()
	if cfg.ObjectStorageEndpoint != "https://account.r2.cloudflarestorage.com" ||
		cfg.ObjectStorageAccessKeyID != "legacy-key" || cfg.ObjectStorageSecretAccessKey != "legacy-secret" ||
		cfg.ObjectStorageBucket != "legacy-bucket" || !cfg.ObjectStorageUsePathStyle ||
		cfg.ObjectStoragePresignExpireSecs != 1200 {
		t.Fatalf("legacy R2 variables were not mapped: %+v", cfg)
	}
}
