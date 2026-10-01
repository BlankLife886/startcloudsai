import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/config/app_environment.dart';

final appPackageInfoProvider = FutureProvider<PackageInfo>(
  (ref) => PackageInfo.fromPlatform(),
);

String installedVersionLabel(PackageInfo info, String environmentLabel) {
  final version = info.version.trim();
  final build = info.buildNumber.trim();
  if (version.isEmpty) return '版本信息不可用';
  final base = build.isEmpty ? 'v$version' : 'v$version ($build)';
  return environmentLabel == '正式环境' ? base : '$base · $environmentLabel';
}

String supportDiagnosticText(
  PackageInfo info,
  AppEnvironment environment,
  TargetPlatform platform,
) {
  final version = info.version.trim().isEmpty ? '未知' : info.version.trim();
  final build = info.buildNumber.trim();
  final versionLabel = build.isEmpty ? version : '$version ($build)';
  final platformLabel = switch (platform) {
    TargetPlatform.android => 'Android',
    TargetPlatform.iOS => 'iOS',
    TargetPlatform.macOS => 'macOS',
    TargetPlatform.windows => 'Windows',
    TargetPlatform.linux => 'Linux',
    TargetPlatform.fuchsia => 'Fuchsia',
  };
  return [
    info.appName.trim().isEmpty ? '星空云绘' : info.appName.trim(),
    '版本：$versionLabel',
    '应用标识：${info.packageName}',
    '平台：$platformLabel',
    '运行环境：${environment.label}',
    '服务地址：${environment.origin}',
  ].join('\n');
}
