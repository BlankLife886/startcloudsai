import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

class PromptItem {
  const PromptItem({
    required this.id,
    required this.title,
    required this.prompt,
    required this.taskType,
    required this.tags,
    this.category = '',
    this.coverUrl,
    this.coverWidth,
    this.coverHeight,
    this.likeCount = 0,
    this.favoriteCount = 0,
    this.useCount = 0,
    this.liked = false,
    this.favorited = false,
  });

  factory PromptItem.fromJson(Map<String, dynamic> json) => PromptItem(
    id: json['id']?.toString() ?? '',
    title: json['title']?.toString() ?? '提示词',
    prompt: json['prompt']?.toString() ?? '',
    taskType: json['taskType']?.toString() ?? '',
    category: json['category']?.toString().trim() ?? '',
    tags:
        (json['tags'] as List?)?.map((item) => item.toString()).toList() ??
        const [],
    coverUrl: json['coverUrl']?.toString(),
    coverWidth: (json['coverWidth'] as num?)?.toInt(),
    coverHeight: (json['coverHeight'] as num?)?.toInt(),
    likeCount: (json['likeCount'] as num?)?.toInt() ?? 0,
    favoriteCount: (json['favoriteCount'] as num?)?.toInt() ?? 0,
    useCount: (json['useCount'] as num?)?.toInt() ?? 0,
    liked: json['liked'] == true,
    favorited: json['favorited'] == true,
  );

  final String id;
  final String title;
  final String prompt;
  final String taskType;
  final String category;
  final List<String> tags;
  final String? coverUrl;
  final int? coverWidth;
  final int? coverHeight;
  final int likeCount;
  final int favoriteCount;
  final int useCount;
  final bool liked;
  final bool favorited;

  double get aspectRatio {
    if ((coverWidth ?? 0) <= 0 || (coverHeight ?? 0) <= 0) return 4 / 5;
    return coverWidth! / coverHeight!;
  }

  PromptItem copyWith({
    int? likeCount,
    int? favoriteCount,
    int? useCount,
    bool? liked,
    bool? favorited,
  }) => PromptItem(
    id: id,
    title: title,
    prompt: prompt,
    taskType: taskType,
    category: category,
    tags: tags,
    coverUrl: coverUrl,
    coverWidth: coverWidth,
    coverHeight: coverHeight,
    likeCount: likeCount ?? this.likeCount,
    favoriteCount: favoriteCount ?? this.favoriteCount,
    useCount: useCount ?? this.useCount,
    liked: liked ?? this.liked,
    favorited: favorited ?? this.favorited,
  );
}

class PromptEngagement {
  const PromptEngagement({
    required this.action,
    required this.active,
    required this.likeCount,
    required this.favoriteCount,
    required this.useCount,
  });

  factory PromptEngagement.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return PromptEngagement(
      action: map['action']?.toString() ?? '',
      active: map['active'] == true,
      likeCount: (map['likeCount'] as num?)?.toInt() ?? 0,
      favoriteCount: (map['favoriteCount'] as num?)?.toInt() ?? 0,
      useCount: (map['useCount'] as num?)?.toInt() ?? 0,
    );
  }

  final String action;
  final bool active;
  final int likeCount;
  final int favoriteCount;
  final int useCount;
}

class PromptCategory {
  const PromptCategory({
    required this.key,
    required this.label,
    required this.count,
    required this.sort,
  });

  factory PromptCategory.fromJson(Map<String, dynamic> json) => PromptCategory(
    key: json['key']?.toString() ?? '',
    label: json['label']?.toString() ?? '',
    count: (json['count'] as num?)?.toInt() ?? 0,
    sort: (json['sort'] as num?)?.toInt() ?? 0,
  );

  final String key;
  final String label;
  final int count;
  final int sort;
}

class PromptPage {
  const PromptPage({
    required this.items,
    required this.total,
    required this.categoryCounts,
    required this.tags,
    this.nextCursor,
  });

  factory PromptPage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final items = _promptItems(map);
    final rawCounts = map['categoryCounts'];
    return PromptPage(
      items: items,
      total: (map['total'] as num?)?.toInt() ?? items.length,
      categoryCounts: rawCounts is Map
          ? rawCounts.map(
              (key, value) =>
                  MapEntry(key.toString(), value is num ? value.toInt() : 0),
            )
          : const {},
      tags:
          (map['tags'] as List?)
              ?.map((item) => item.toString())
              .where((item) => item.isNotEmpty)
              .toList() ??
          const [],
      nextCursor: _cursor(map['nextCursor']),
    );
  }

  final List<PromptItem> items;
  final int total;
  final Map<String, int> categoryCounts;
  final List<String> tags;
  final String? nextCursor;
}

class GalleryItem {
  const GalleryItem({
    required this.id,
    required this.title,
    required this.authorId,
    required this.authorName,
    required this.featured,
    required this.tags,
    this.authorAvatarUrl,
    this.categoryId,
    this.categoryName,
    this.coverUrl,
    this.coverDisplayUrl,
    this.mediaUrls = const [],
    this.mediaDisplayUrls = const [],
    this.createdAt,
  });

  factory GalleryItem.fromJson(Map<String, dynamic> json) {
    final author = json['author'] is Map
        ? Map<String, dynamic>.from(json['author'] as Map)
        : const <String, dynamic>{};
    final mediaThumbs = (json['mediaThumbUrls'] as List?) ?? const [];
    final media = (json['mediaUrls'] as List?) ?? const [];
    final category = json['category'] is Map
        ? Map<String, dynamic>.from(json['category'] as Map)
        : const <String, dynamic>{};
    final authorName = author['username']?.toString().trim() ?? '';
    return GalleryItem(
      id: json['id']?.toString() ?? '',
      title: _fallbackText(json['title'], '社区作品'),
      authorId: author['id']?.toString() ?? '',
      authorName: authorName.isEmpty ? '星空创作者' : authorName,
      authorAvatarUrl: _optionalText(author['avatarUrl']),
      featured: json['featured'] == true,
      tags:
          (json['tags'] as List?)?.map((item) => item.toString()).toList() ??
          const [],
      categoryId: _optionalText(category['id']),
      categoryName: _optionalText(category['name']),
      coverUrl:
          json['coverThumbUrl']?.toString() ??
          json['coverUrl']?.toString() ??
          (mediaThumbs.isNotEmpty ? mediaThumbs.first.toString() : null) ??
          (media.isNotEmpty ? media.first.toString() : null),
      coverDisplayUrl:
          _optionalText(json['coverDisplayUrl']) ??
          _optionalText(json['coverUrl']),
      mediaUrls: _stringList(json['mediaUrls']),
      mediaDisplayUrls: _stringList(json['mediaDisplayUrls']),
      createdAt: DateTime.tryParse(
        json['createdAt']?.toString() ?? '',
      )?.toLocal(),
    );
  }

  final String id;
  final String title;
  final String authorId;
  final String authorName;
  final String? authorAvatarUrl;
  final bool featured;
  final List<String> tags;
  final String? categoryId;
  final String? categoryName;
  final String? coverUrl;
  final String? coverDisplayUrl;
  final List<String> mediaUrls;
  final List<String> mediaDisplayUrls;
  final DateTime? createdAt;

  List<String> get previewUrls {
    if (mediaDisplayUrls.isNotEmpty) return mediaDisplayUrls;
    if (mediaUrls.isNotEmpty) return mediaUrls;
    final cover = coverDisplayUrl ?? coverUrl;
    return cover == null || cover.isEmpty ? const [] : [cover];
  }
}

class GalleryPage {
  const GalleryPage({required this.items, this.nextCursor});

  factory GalleryPage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return GalleryPage(
      items: _galleryItems(map),
      nextCursor: _cursor(map['nextCursor']),
    );
  }

  final List<GalleryItem> items;
  final String? nextCursor;
}

@immutable
class PromptQuery {
  const PromptQuery({
    this.search = '',
    this.category,
    this.favoritesOnly = false,
    this.sort = 'recommended',
    this.limit = 20,
  });

  final String search;
  final String? category;
  final bool favoritesOnly;
  final String sort;
  final int limit;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PromptQuery &&
          search == other.search &&
          category == other.category &&
          favoritesOnly == other.favoritesOnly &&
          sort == other.sort &&
          limit == other.limit;

  @override
  int get hashCode => Object.hash(search, category, favoritesOnly, sort, limit);
}

@immutable
class GalleryQuery {
  const GalleryQuery({this.category});

  final String? category;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is GalleryQuery && category == other.category;

  @override
  int get hashCode => category.hashCode;
}

@immutable
class PromptPageRequest {
  const PromptPageRequest({required this.query, this.cursor});

  final PromptQuery query;
  final String? cursor;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PromptPageRequest &&
          query == other.query &&
          cursor == other.cursor;

  @override
  int get hashCode => Object.hash(query, cursor);
}

@immutable
class GalleryPageRequest {
  const GalleryPageRequest({required this.query, this.cursor});

  final GalleryQuery query;
  final String? cursor;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is GalleryPageRequest &&
          query == other.query &&
          cursor == other.cursor;

  @override
  int get hashCode => Object.hash(query, cursor);
}

class DiscoverFeed {
  const DiscoverFeed({required this.prompts, required this.gallery});

  final List<PromptItem> prompts;
  final List<GalleryItem> gallery;
}

class DiscoverRepository {
  const DiscoverRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<PromptPage> prompts({
    String search = '',
    String? category,
    bool favoritesOnly = false,
    String? cursor,
    int limit = 20,
    String sort = 'recommended',
  }) async {
    final normalizedSearch = search.trim();
    final data = await _apiClient.get(
      '/prompts',
      queryParameters: {
        'type': 't2i',
        'limit': limit,
        'sort': sort,
        if (normalizedSearch.isNotEmpty) 'search': normalizedSearch,
        if (category?.isNotEmpty == true) 'category': category,
        if (favoritesOnly) 'scope': 'favorites',
        if (cursor?.isNotEmpty == true) 'cursor': cursor,
      },
    );
    return PromptPage.fromJson(data);
  }

  Future<PromptEngagement> recordPromptEngagement(
    String promptId,
    String action, {
    bool active = true,
  }) async => PromptEngagement.fromJson(
    await _apiClient.post(
      '/prompts/$promptId/engagements',
      data: {'action': action, 'active': active},
    ),
  );

  Future<List<PromptCategory>> promptCategories() async {
    final data = await _apiClient.get(
      '/prompts/categories',
      queryParameters: const {'type': 't2i'},
    );
    if (data is! Map || data['items'] is! List) return const [];
    final items = (data['items'] as List)
        .whereType<Map>()
        .map((item) => PromptCategory.fromJson(Map<String, dynamic>.from(item)))
        .where((item) => item.key.isNotEmpty && item.label.isNotEmpty)
        .toList();
    items.sort((a, b) {
      final bySort = a.sort.compareTo(b.sort);
      return bySort == 0 ? a.label.compareTo(b.label) : bySort;
    });
    return items;
  }

  Future<GalleryPage> gallery({
    String? category,
    String? cursor,
    int limit = 20,
  }) async {
    final data = await _apiClient.get(
      '/gallery/submissions',
      queryParameters: {
        'limit': limit,
        if (category?.isNotEmpty == true) 'category': category,
        if (cursor?.isNotEmpty == true) 'cursor': cursor,
      },
    );
    return GalleryPage.fromJson(data);
  }

  Future<DiscoverFeed> load() async {
    final results = await Future.wait([prompts(limit: 12), gallery(limit: 10)]);
    return DiscoverFeed(
      prompts: (results[0] as PromptPage).items,
      gallery: (results[1] as GalleryPage).items,
    );
  }
}

List<PromptItem> _promptItems(Map<String, dynamic> data) {
  if (data['items'] is! List) return const [];
  return (data['items'] as List)
      .whereType<Map>()
      .map((item) => PromptItem.fromJson(Map<String, dynamic>.from(item)))
      .where((item) => item.id.isNotEmpty && item.prompt.isNotEmpty)
      .toList();
}

List<GalleryItem> _galleryItems(Map<String, dynamic> data) {
  if (data['items'] is! List) return const [];
  return (data['items'] as List)
      .whereType<Map>()
      .map((item) => GalleryItem.fromJson(Map<String, dynamic>.from(item)))
      .where((item) => item.id.isNotEmpty)
      .toList();
}

String? _cursor(dynamic value) {
  final cursor = value?.toString().trim();
  return cursor == null || cursor.isEmpty ? null : cursor;
}

List<String> _stringList(dynamic value) => value is List
    ? value
          .map((item) => item.toString().trim())
          .where((item) => item.isNotEmpty)
          .toList()
    : const [];

String? _optionalText(dynamic value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}

String _fallbackText(dynamic value, String fallback) =>
    _optionalText(value) ?? fallback;

final discoverRepositoryProvider = Provider<DiscoverRepository>(
  (ref) => DiscoverRepository(ref.watch(apiClientProvider)),
);

final discoverPromptCategoriesProvider = FutureProvider<List<PromptCategory>>(
  (ref) => ref.watch(discoverRepositoryProvider).promptCategories(),
);

final discoverPromptPageRequestProvider =
    FutureProvider.family<PromptPage, PromptPageRequest>(
      (ref, request) => ref
          .watch(discoverRepositoryProvider)
          .prompts(
            search: request.query.search,
            category: request.query.category,
            favoritesOnly: request.query.favoritesOnly,
            sort: request.query.sort,
            limit: request.query.limit,
            cursor: request.cursor,
          ),
    );

final discoverPromptPageProvider =
    FutureProvider.family<PromptPage, PromptQuery>(
      (ref, query) => ref.watch(
        discoverPromptPageRequestProvider(
          PromptPageRequest(query: query),
        ).future,
      ),
    );

final discoverGalleryPageRequestProvider =
    FutureProvider.family<GalleryPage, GalleryPageRequest>(
      (ref, request) => ref
          .watch(discoverRepositoryProvider)
          .gallery(category: request.query.category, cursor: request.cursor),
    );

final discoverGalleryPageProvider =
    FutureProvider.family<GalleryPage, GalleryQuery>(
      (ref, query) => ref.watch(
        discoverGalleryPageRequestProvider(
          GalleryPageRequest(query: query),
        ).future,
      ),
    );

// Kept as a shared invalidation point for existing task and submission flows.
final discoverFeedProvider = FutureProvider<DiscoverFeed>(
  (ref) => ref.watch(discoverRepositoryProvider).load(),
);
