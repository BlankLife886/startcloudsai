import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../../core/storage/user_storage_namespace.dart';
import '../auth/auth.dart';

enum FeedbackCategory { bug, generation, account, billing, suggestion, other }

extension FeedbackCategoryPresentation on FeedbackCategory {
  String get apiValue => name;

  String get label => switch (this) {
    FeedbackCategory.bug => '功能问题',
    FeedbackCategory.generation => '生成效果',
    FeedbackCategory.account => '账号资料',
    FeedbackCategory.billing => '积分账单',
    FeedbackCategory.suggestion => '产品建议',
    FeedbackCategory.other => '其他反馈',
  };
}

FeedbackCategory feedbackCategoryFrom(String value) =>
    FeedbackCategory.values.firstWhere(
      (item) => item.apiValue == value,
      orElse: () => FeedbackCategory.other,
    );

enum FeedbackStatus { open, inProgress, resolved, closed }

FeedbackStatus feedbackStatusFrom(String value) => switch (value) {
  'in_progress' => FeedbackStatus.inProgress,
  'resolved' => FeedbackStatus.resolved,
  'closed' => FeedbackStatus.closed,
  _ => FeedbackStatus.open,
};

String feedbackStatusSearchLabel(FeedbackStatus status) => switch (status) {
  FeedbackStatus.open => '待处理',
  FeedbackStatus.inProgress => '处理中',
  FeedbackStatus.resolved => '已解决 已完成',
  FeedbackStatus.closed => '已关闭 已完成',
};

class UserFeedbackItem {
  const UserFeedbackItem({
    required this.id,
    required this.category,
    required this.title,
    required this.content,
    required this.status,
    required this.adminReply,
    required this.adopted,
    required this.rewardPoints,
    required this.rewardedAt,
    required this.handledAt,
    required this.createdAt,
    required this.updatedAt,
    this.pageUrl,
  });

  factory UserFeedbackItem.fromJson(Map<String, dynamic> json) =>
      UserFeedbackItem(
        id: json['id']?.toString() ?? '',
        category: feedbackCategoryFrom(json['category']?.toString() ?? ''),
        title: json['title']?.toString() ?? '',
        content: json['content']?.toString() ?? '',
        pageUrl: json['pageUrl']?.toString(),
        status: feedbackStatusFrom(json['status']?.toString() ?? ''),
        adminReply: json['adminReply']?.toString(),
        adopted: json['adopted'] == true,
        rewardPoints: (json['rewardCents'] as num?)?.toInt() ?? 0,
        rewardedAt: _date(json['rewardedAt']),
        handledAt: _date(json['handledAt']),
        createdAt: _date(json['createdAt']),
        updatedAt: _date(json['updatedAt']),
      );

  final String id;
  final FeedbackCategory category;
  final String title;
  final String content;
  final String? pageUrl;
  final FeedbackStatus status;
  final String? adminReply;
  final bool adopted;
  final int rewardPoints;
  final DateTime? rewardedAt;
  final DateTime? handledAt;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  bool get isFinished =>
      status == FeedbackStatus.resolved || status == FeedbackStatus.closed;
}

List<UserFeedbackItem> searchFeedbackItems(
  Iterable<UserFeedbackItem> items,
  String query,
) {
  final normalized = query.trim().toLowerCase();
  if (normalized.isEmpty) return items.toList();
  return items.where((item) {
    final searchable = [
      item.title,
      item.content,
      item.category.label,
      feedbackStatusSearchLabel(item.status),
      item.adminReply ?? '',
    ].join('\n').toLowerCase();
    return searchable.contains(normalized);
  }).toList();
}

DateTime? _date(dynamic value) =>
    DateTime.tryParse(value?.toString() ?? '')?.toLocal();

class FeedbackPage {
  const FeedbackPage({required this.items, required this.nextCursor});

  factory FeedbackPage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final rawItems = map['items'];
    final cursor = map['nextCursor']?.toString().trim();
    return FeedbackPage(
      items: rawItems is List
          ? rawItems
                .whereType<Map>()
                .map(
                  (item) => UserFeedbackItem.fromJson(
                    Map<String, dynamic>.from(item),
                  ),
                )
                .where((item) => item.id.isNotEmpty)
                .toList()
          : const [],
      nextCursor: cursor?.isNotEmpty == true ? cursor : null,
    );
  }

  final List<UserFeedbackItem> items;
  final String? nextCursor;
}

String? validateFeedbackTitle(String? value) {
  final length = value?.trim().runes.length ?? 0;
  if (length < 5) return '标题至少需要 5 个字符';
  if (length > 120) return '标题不能超过 120 个字符';
  return null;
}

String? validateFeedbackContent(String? value) {
  final length = value?.trim().runes.length ?? 0;
  if (length < 10) return '问题描述至少需要 10 个字符';
  if (length > 3000) return '问题描述不能超过 3000 个字符';
  return null;
}

class FeedbackDraft {
  const FeedbackDraft({
    required this.category,
    required this.title,
    required this.content,
    required this.updatedAt,
  });

  factory FeedbackDraft.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return FeedbackDraft(
      category: feedbackCategoryFrom(map['category']?.toString() ?? ''),
      title: _limited(map['title'], 120),
      content: _limited(map['content'], 3000),
      updatedAt:
          DateTime.tryParse(map['updatedAt']?.toString() ?? '')?.toLocal() ??
          DateTime.now(),
    );
  }

  final FeedbackCategory category;
  final String title;
  final String content;
  final DateTime updatedAt;

  bool get isEmpty => title.trim().isEmpty && content.trim().isEmpty;

  Map<String, dynamic> toJson() => {
    'category': category.apiValue,
    'title': title,
    'content': content,
    'updatedAt': updatedAt.toUtc().toIso8601String(),
  };
}

String _limited(dynamic value, int limit) {
  final text = value?.toString() ?? '';
  return text.runes.length <= limit
      ? text
      : String.fromCharCodes(text.runes.take(limit));
}

abstract interface class FeedbackDraftStore {
  Future<FeedbackDraft?> read();
  Future<void> write(FeedbackDraft draft);
  Future<void> clear();
}

class SecureFeedbackDraftStore implements FeedbackDraftStore {
  SecureFeedbackDraftStore({
    required String namespace,
    String? legacyNamespace,
    FlutterSecureStorage? storage,
  }) : _storage = storage ?? const FlutterSecureStorage(),
       _key = keyFor(namespace),
       _legacyKey = legacyNamespace == null ? null : keyFor(legacyNamespace);

  final FlutterSecureStorage _storage;
  final String _key;
  final String? _legacyKey;

  static String keyFor(String namespace) {
    final normalized = namespace.trim().toLowerCase();
    return 'starclouds.feedback_draft.${normalized.isEmpty ? 'production' : normalized}';
  }

  @override
  Future<FeedbackDraft?> read() async {
    var raw = await _storage.read(key: _key);
    var migrated = false;
    if ((raw == null || raw.trim().isEmpty) && _legacyKey != null) {
      raw = await _storage.read(key: _legacyKey);
      migrated = raw?.trim().isNotEmpty == true;
    }
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final draft = FeedbackDraft.fromJson(jsonDecode(raw));
      if (draft.isEmpty) {
        await clear();
        return null;
      }
      if (migrated) await write(draft);
      return draft;
    } catch (_) {
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(FeedbackDraft draft) async {
    if (draft.isEmpty) {
      await clear();
      return;
    }
    await _storage.write(key: _key, value: jsonEncode(draft.toJson()));
    if (_legacyKey != null && _legacyKey != _key) {
      await _storage.delete(key: _legacyKey);
    }
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _key);
    if (_legacyKey != null && _legacyKey != _key) {
      await _storage.delete(key: _legacyKey);
    }
  }
}

final feedbackDraftStoreProvider = Provider<FeedbackDraftStore>((ref) {
  final environment = ref.watch(appEnvironmentProvider).name.name;
  final session = ref.watch(sessionControllerProvider);
  final userId = session.valueOrNull?.user?.id;
  return SecureFeedbackDraftStore(
    namespace: userStorageNamespace(environment: environment, userId: userId),
    legacyNamespace: session.hasValue ? environment : null,
  );
});

class FeedbackRepository {
  const FeedbackRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<FeedbackPage> list({String? cursor, int limit = 24}) async =>
      FeedbackPage.fromJson(
        await _apiClient.get(
          '/me/feedback',
          queryParameters: {
            'limit': limit,
            if (cursor?.isNotEmpty == true) 'cursor': cursor,
          },
        ),
      );

  Future<UserFeedbackItem> submit({
    required FeedbackCategory category,
    required String title,
    required String content,
  }) async {
    final data = await _apiClient.post(
      '/me/feedback',
      data: {
        'category': category.apiValue,
        'title': title.trim(),
        'content': content.trim(),
        'pageUrl': '/mobile/profile/feedback',
      },
    );
    if (data is! Map) throw const FormatException('反馈提交响应无效');
    return UserFeedbackItem.fromJson(Map<String, dynamic>.from(data));
  }
}

final feedbackRepositoryProvider = Provider<FeedbackRepository>(
  (ref) => FeedbackRepository(ref.watch(apiClientProvider)),
);

class FeedbackCenterState {
  const FeedbackCenterState({
    required this.items,
    required this.nextCursor,
    this.isLoadingMore = false,
  });

  final List<UserFeedbackItem> items;
  final String? nextCursor;
  final bool isLoadingMore;

  bool get hasMore => nextCursor != null;
  int get openCount => items
      .where(
        (item) =>
            item.status == FeedbackStatus.open ||
            item.status == FeedbackStatus.inProgress,
      )
      .length;
  int get finishedCount => items.where((item) => item.isFinished).length;
  int get adoptedCount => items.where((item) => item.adopted).length;

  FeedbackCenterState copyWith({
    List<UserFeedbackItem>? items,
    String? nextCursor,
    bool clearCursor = false,
    bool? isLoadingMore,
  }) => FeedbackCenterState(
    items: items ?? this.items,
    nextCursor: clearCursor ? null : nextCursor ?? this.nextCursor,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
  );
}

class FeedbackCenterController extends AsyncNotifier<FeedbackCenterState> {
  int _generation = 0;

  FeedbackRepository get _repository => ref.read(feedbackRepositoryProvider);

  @override
  Future<FeedbackCenterState> build() => _loadFirstPage();

  Future<FeedbackCenterState> _loadFirstPage() async {
    final page = await _repository.list();
    return FeedbackCenterState(items: page.items, nextCursor: page.nextCursor);
  }

  Future<void> refresh() async {
    final generation = ++_generation;
    state = const AsyncLoading();
    final refreshed = await AsyncValue.guard(_loadFirstPage);
    if (generation == _generation) state = refreshed;
  }

  Future<void> loadMore() async {
    final current = state.asData?.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    final generation = _generation;
    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final page = await _repository.list(cursor: current.nextCursor);
      if (generation != _generation) return;
      final latest = state.asData?.value;
      if (latest == null) return;
      final knownIds = latest.items.map((item) => item.id).toSet();
      state = AsyncData(
        latest.copyWith(
          items: [
            ...latest.items,
            ...page.items.where((item) => knownIds.add(item.id)),
          ],
          nextCursor: page.nextCursor,
          clearCursor: page.nextCursor == null,
          isLoadingMore: false,
        ),
      );
    } catch (error, stackTrace) {
      if (generation != _generation) return;
      final latest = state.asData?.value ?? current;
      state = AsyncData(latest.copyWith(isLoadingMore: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<UserFeedbackItem> submit({
    required FeedbackCategory category,
    required String title,
    required String content,
  }) async {
    final item = await _repository.submit(
      category: category,
      title: title,
      content: content,
    );
    final current = state.asData?.value;
    state = AsyncData(
      FeedbackCenterState(
        items: [item, ...?current?.items],
        nextCursor: current?.nextCursor,
      ),
    );
    return item;
  }
}

final feedbackCenterControllerProvider =
    AsyncNotifierProvider<FeedbackCenterController, FeedbackCenterState>(
      FeedbackCenterController.new,
    );
