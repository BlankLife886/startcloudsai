import 'package:flutter_riverpod/flutter_riverpod.dart';

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
