import 'package:flutter/foundation.dart';

enum AppEnvironmentName { development, staging, production }

class AppEnvironment {
  const AppEnvironment({
    required this.name,
    required this.origin,
    required this.apiBaseUrl,
  });

  factory AppEnvironment.fromDefines({
    bool isReleaseMode = kReleaseMode,
    String rawName = const String.fromEnvironment('APP_ENV'),
    String configuredUrl = const String.fromEnvironment('API_BASE_URL'),
    bool allowProductionApiInDebug = const bool.fromEnvironment(
      'ALLOW_PRODUCTION_API_IN_DEBUG',
    ),
  }) {
    final requestedName = rawName.trim().isEmpty
        ? (isReleaseMode ? 'production' : 'development')
        : rawName.trim().toLowerCase();
    var name = switch (requestedName) {
      'development' || 'dev' => AppEnvironmentName.development,
      'staging' || 'stage' => AppEnvironmentName.staging,
      _ => AppEnvironmentName.production,
    };
    var normalizedConfiguredUrl = configuredUrl.trim();

    // A stale Generated.xcconfig must never send a Debug build to production.
    if (!isReleaseMode && !allowProductionApiInDebug) {
      final configuredHost = Uri.tryParse(normalizedConfiguredUrl)?.host;
      if (name == AppEnvironmentName.production ||
          configuredHost == 'starcloudisai.com' ||
          configuredHost == 'www.starcloudisai.com') {
        name = AppEnvironmentName.development;
        normalizedConfiguredUrl = '';
      }
    }
    final fallback = name == AppEnvironmentName.development
        ? 'http://localhost:8000'
        : 'https://starcloudisai.com';
    return AppEnvironment.create(
      name: name,
      baseUrl: normalizedConfiguredUrl.isEmpty
          ? fallback
          : normalizedConfiguredUrl,
    );
  }

  factory AppEnvironment.create({
    required AppEnvironmentName name,
    required String baseUrl,
  }) {
    var normalized = baseUrl.trim().replaceFirst(RegExp(r'/+$'), '');
    if (normalized.endsWith('/api/v1')) {
      normalized = normalized.substring(
        0,
        normalized.length - '/api/v1'.length,
      );
    }
    return AppEnvironment(
      name: name,
      origin: normalized,
      apiBaseUrl: '$normalized/api/v1',
    );
  }

  final AppEnvironmentName name;
  final String origin;
  final String apiBaseUrl;

  String get label => switch (name) {
    AppEnvironmentName.development => '开发环境',
    AppEnvironmentName.staging => '预发布环境',
    AppEnvironmentName.production => '正式环境',
  };
}
