import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

class AppAnnouncement {
  const AppAnnouncement({
    required this.id,
    required this.title,
    required this.body,
    required this.createdAt,
    this.startsAt,
    this.endsAt,
    this.imageUrl,
    this.ctaText,
    this.ctaUrl,
    this.placement = 'modal',
    this.closeText = '稍后查看',
    this.allowClose = true,
    this.frequency = 'session_once',
    this.version = 1,
    this.dismissHours = 24,
    this.latestAppVersion,
    this.minimumSupportedAppVersion,
    this.targetPlatforms = const [],
  });

  factory AppAnnouncement.fromJson(Map<String, dynamic> json) {
    final config = json['config'] is Map
        ? Map<String, dynamic>.from(json['config'] as Map)
        : const <String, dynamic>{};
    final assets = config['assets'] is List
        ? (config['assets'] as List).whereType<Map>().toList()
        : const <Map>[];
    String? optional(dynamic value) {
      final text = value?.toString().trim();
      return text == null || text.isEmpty ? null : text;
    }

    return AppAnnouncement(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString().trim() ?? '',
      body: json['body']?.toString().trim() ?? '',
      startsAt: _date(json['startsAt']),
      endsAt: _date(json['endsAt']),
      createdAt: _date(json['createdAt']),
      imageUrl:
          optional(json['decorImageUrl']) ??
          optional(config['decorImageUrl']) ??
          (assets.isEmpty ? null : optional(assets.first['url'])),
      ctaText: optional(json['ctaText']) ?? optional(config['ctaText']),
      ctaUrl: optional(json['ctaUrl']) ?? optional(config['ctaUrl']),
      placement: _oneOf(config['placement'], const {
        'modal',
        'banner',
      }, 'modal'),
      closeText: optional(config['closeText']) ?? '稍后查看',
      allowClose: config['allowClose'] != false,
      frequency: _oneOf(config['frequency'], const {
        'session_once',
        'every_open',
        'once_per_version',
        'daily',
        'dismiss_hours',
      }, 'session_once'),
      version: _positiveInt(config['version'], 1),
      dismissHours: _positiveInt(config['dismissHours'], 24).clamp(1, 720),
      latestAppVersion:
          optional(json['latestAppVersion']) ??
          optional(config['latestAppVersion']),
      minimumSupportedAppVersion:
          optional(json['minimumSupportedAppVersion']) ??
          optional(config['minimumSupportedAppVersion']),
      targetPlatforms: _platforms(
        json['targetPlatforms'] ?? config['targetPlatforms'],
      ),
    );
  }

  final String id;
  final String title;
  final String body;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final DateTime? createdAt;
  final String? imageUrl;
  final String? ctaText;
  final String? ctaUrl;
  final String placement;
  final String closeText;
  final bool allowClose;
  final String frequency;
  final int version;
  final int dismissHours;
  final String? latestAppVersion;
  final String? minimumSupportedAppVersion;
  final List<String> targetPlatforms;

  bool get hasAction =>
      ctaText?.trim().isNotEmpty == true && ctaUrl?.trim().isNotEmpty == true;
}

List<String> _platforms(dynamic value) {
  if (value is! List) return const [];
  return value
      .map((item) => item.toString().trim().toLowerCase())
      .where((item) => item == 'ios' || item == 'android')
      .toSet()
      .toList();
}

String appAnnouncementPlatformName(TargetPlatform platform) =>
    switch (platform) {
      TargetPlatform.iOS => 'ios',
      TargetPlatform.android => 'android',
      TargetPlatform.macOS ||
      TargetPlatform.windows ||
      TargetPlatform.linux ||
      TargetPlatform.fuchsia => 'unsupported',
    };

int compareAppVersions(String left, String right) {
  List<int> parts(String value) {
    final core = value.trim().split(RegExp(r'[+-]')).first;
    return core.split('.').map((part) {
      final match = RegExp(r'^\d+').firstMatch(part.trim());
      return int.tryParse(match?.group(0) ?? '') ?? 0;
    }).toList();
  }

  final leftParts = parts(left);
  final rightParts = parts(right);
  final length = leftParts.length > rightParts.length
      ? leftParts.length
      : rightParts.length;
  for (var index = 0; index < length; index += 1) {
    final leftPart = index < leftParts.length ? leftParts[index] : 0;
    final rightPart = index < rightParts.length ? rightParts[index] : 0;
    if (leftPart != rightPart) return leftPart.compareTo(rightPart);
  }
  return 0;
}

bool announcementTargetsInstalledApp(
  AppAnnouncement announcement, {
  required String? installedVersion,
  required TargetPlatform platform,
}) {
  if (announcement.targetPlatforms.isNotEmpty &&
      !announcement.targetPlatforms.contains(
        appAnnouncementPlatformName(platform),
      )) {
    return false;
  }
  final latest = announcement.latestAppVersion?.trim();
  final minimum = announcement.minimumSupportedAppVersion?.trim();
  final targetVersion = latest?.isNotEmpty == true ? latest : minimum;
  if (targetVersion == null || targetVersion.isEmpty) return true;
  final current = installedVersion?.trim();
  if (current == null || current.isEmpty) return false;
  return compareAppVersions(current, targetVersion) < 0;
}

bool announcementRequiresUpdate(
  AppAnnouncement announcement, {
  required String? installedVersion,
  required TargetPlatform platform,
}) {
  if (!announcementTargetsInstalledApp(
    announcement,
    installedVersion: installedVersion,
    platform: platform,
  )) {
    return false;
  }
  final minimum = announcement.minimumSupportedAppVersion?.trim();
  final current = installedVersion?.trim();
  return announcement.hasAction &&
      minimum?.isNotEmpty == true &&
      current?.isNotEmpty == true &&
      compareAppVersions(current!, minimum!) < 0;
}

class AppUpdateAvailability {
  const AppUpdateAvailability({
    required this.announcement,
    required this.latestVersion,
    required this.required,
  });

  final AppAnnouncement announcement;
  final String latestVersion;
  final bool required;
}

AppUpdateAvailability? findAvailableAppUpdate(
  Iterable<AppAnnouncement> announcements, {
  required String installedVersion,
  required TargetPlatform platform,
}) {
  AppUpdateAvailability? selected;
  for (final announcement in announcements) {
    final latest = announcement.latestAppVersion?.trim().isNotEmpty == true
        ? announcement.latestAppVersion!.trim()
        : announcement.minimumSupportedAppVersion?.trim() ?? '';
    if (latest.isEmpty ||
        !announcementTargetsInstalledApp(
          announcement,
          installedVersion: installedVersion,
          platform: platform,
        )) {
      continue;
    }
    final candidate = AppUpdateAvailability(
      announcement: announcement,
      latestVersion: latest,
      required: announcementRequiresUpdate(
        announcement,
        installedVersion: installedVersion,
        platform: platform,
      ),
    );
    if (selected == null ||
        compareAppVersions(candidate.latestVersion, selected.latestVersion) >
            0) {
      selected = candidate;
    }
  }
  return selected;
}

String _oneOf(dynamic value, Set<String> allowed, String fallback) {
  final normalized = value?.toString().trim().toLowerCase() ?? '';
  return allowed.contains(normalized) ? normalized : fallback;
}

int _positiveInt(dynamic value, int fallback) {
  final parsed = value is num ? value.toInt() : int.tryParse('$value');
  return parsed != null && parsed > 0 ? parsed : fallback;
}

class ChangelogEntry {
  const ChangelogEntry({
    required this.id,
    required this.version,
    required this.date,
    required this.tag,
    required this.title,
    required this.summary,
    required this.items,
    required this.highlight,
  });

  factory ChangelogEntry.fromJson(Map<String, dynamic> json) => ChangelogEntry(
    id: json['id']?.toString() ?? '',
    version: json['version']?.toString().trim() ?? '',
    date: DateTime.tryParse(json['date']?.toString() ?? ''),
    tag: json['tag']?.toString().trim() ?? 'experience',
    title: json['title']?.toString().trim() ?? '',
    summary: json['summary']?.toString().trim() ?? '',
    items:
        (json['items'] as List?)
            ?.map((item) => item.toString().trim())
            .where((item) => item.isNotEmpty)
            .toList() ??
        const [],
    highlight: json['highlight'] == true,
  );

  final String id;
  final String version;
  final DateTime? date;
  final String tag;
  final String title;
  final String summary;
  final List<String> items;
  final bool highlight;
}

class MetaFeed {
  const MetaFeed({
    required this.announcements,
    required this.changelog,
    this.announcementsUnavailable = false,
    this.changelogUnavailable = false,
  });

  final List<AppAnnouncement> announcements;
  final List<ChangelogEntry> changelog;
  final bool announcementsUnavailable;
  final bool changelogUnavailable;

  ChangelogEntry? get latest => changelog.firstOrNull;
}

class MetaRepository {
  const MetaRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<List<AppAnnouncement>> announcements() async {
    final data = await _apiClient.get('/announcements');
    if (data is! Map || data['items'] is! List) return const [];
    return (data['items'] as List)
        .whereType<Map>()
        .map(
          (item) => AppAnnouncement.fromJson(Map<String, dynamic>.from(item)),
        )
        .where((item) => item.id.isNotEmpty && item.title.isNotEmpty)
        .toList();
  }

  Future<List<ChangelogEntry>> changelog() async {
    final data = await _apiClient.get('/changelog');
    if (data is! Map || data['items'] is! List) return const [];
    return (data['items'] as List)
        .whereType<Map>()
        .map((item) => ChangelogEntry.fromJson(Map<String, dynamic>.from(item)))
        .where(
          (item) =>
              item.id.isNotEmpty &&
              item.version.isNotEmpty &&
              item.title.isNotEmpty,
        )
        .toList();
  }

  Future<ChangelogEntry?> latestChangelog() async {
    final data = await _apiClient.get('/changelog/latest');
    if (data is! Map) return null;
    final item = ChangelogEntry.fromJson(Map<String, dynamic>.from(data));
    return item.id.isEmpty || item.version.isEmpty || item.title.isEmpty
        ? null
        : item;
  }

  Future<MetaFeed> load() async {
    final announcementsRequest = _settle(announcements());
    final changelogRequest = _settle(changelog());
    final announcementsResult = await announcementsRequest;
    final changelogResult = await changelogRequest;
    if (announcementsResult.error != null && changelogResult.error != null) {
      Error.throwWithStackTrace(
        announcementsResult.error!,
        announcementsResult.stackTrace!,
      );
    }
    return MetaFeed(
      announcements: announcementsResult.items ?? const [],
      changelog: changelogResult.items ?? const [],
      announcementsUnavailable: announcementsResult.error != null,
      changelogUnavailable: changelogResult.error != null,
    );
  }
}

class _MetaLoadResult<T> {
  const _MetaLoadResult.success(this.items) : error = null, stackTrace = null;

  const _MetaLoadResult.failure(this.error, this.stackTrace) : items = null;

  final List<T>? items;
  final Object? error;
  final StackTrace? stackTrace;
}

Future<_MetaLoadResult<T>> _settle<T>(Future<List<T>> request) async {
  try {
    return _MetaLoadResult.success(await request);
  } catch (error, stackTrace) {
    return _MetaLoadResult.failure(error, stackTrace);
  }
}

DateTime? _date(dynamic value) =>
    DateTime.tryParse(value?.toString() ?? '')?.toLocal();

final metaRepositoryProvider = Provider<MetaRepository>(
  (ref) => MetaRepository(ref.watch(apiClientProvider)),
);

final metaFeedProvider = FutureProvider<MetaFeed>(
  (ref) => ref.watch(metaRepositoryProvider).load(),
);

final latestChangelogProvider = FutureProvider<ChangelogEntry?>(
  (ref) => ref.watch(metaRepositoryProvider).latestChangelog(),
);

final startupAnnouncementsProvider = FutureProvider<List<AppAnnouncement>>(
  (ref) => ref.watch(metaRepositoryProvider).announcements(),
);

abstract interface class AnnouncementReceiptStore {
  Future<DateTime?> lastShown(AppAnnouncement announcement);

  Future<void> recordShown(AppAnnouncement announcement, DateTime shownAt);
}

class SharedPreferencesAnnouncementReceiptStore
    implements AnnouncementReceiptStore {
  const SharedPreferencesAnnouncementReceiptStore();

  String _key(AppAnnouncement announcement) =>
      'startup_announcement.${announcement.id}.v${announcement.version}';

  @override
  Future<DateTime?> lastShown(AppAnnouncement announcement) async {
    final value = (await SharedPreferences.getInstance()).getString(
      _key(announcement),
    );
    return DateTime.tryParse(value ?? '')?.toLocal();
  }

  @override
  Future<void> recordShown(
    AppAnnouncement announcement,
    DateTime shownAt,
  ) async {
    await (await SharedPreferences.getInstance()).setString(
      _key(announcement),
      shownAt.toUtc().toIso8601String(),
    );
  }
}

final announcementReceiptStoreProvider = Provider<AnnouncementReceiptStore>(
  (ref) => const SharedPreferencesAnnouncementReceiptStore(),
);
