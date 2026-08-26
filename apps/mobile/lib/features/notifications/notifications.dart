import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

class AppNotification {
  const AppNotification({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    required this.readAt,
    required this.createdAt,
    this.sourceType,
    this.sourceId,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        id: json['id']?.toString() ?? '',
        kind: json['kind']?.toString() ?? 'system',
        title: json['title']?.toString() ?? '系统通知',
        body: json['body']?.toString() ?? '',
        readAt: _date(json['readAt']),
        createdAt: _date(json['createdAt']),
        sourceType: _optional(json['sourceType']),
        sourceId: _optional(json['sourceId']),
      );

  final String id;
  final String kind;
  final String title;
  final String body;
  final DateTime? readAt;
  final DateTime? createdAt;
  final String? sourceType;
  final String? sourceId;

  bool get isRead => readAt != null;

  NotificationDestination? get destination {
    switch (kind) {
      case 'task':
        if (sourceType == 'task' && sourceId != null) {
          return NotificationDestination(
            route: '/works/${Uri.encodeComponent(sourceId!)}',
            label: '查看作品详情',
          );
        }
        return const NotificationDestination(route: '/works', label: '查看作品');
      case 'reward':
        return const NotificationDestination(
          route: '/profile/benefits/growth',
          label: '查看福利',
        );
      case 'trial_access':
        return const NotificationDestination(
          route: '/profile/benefits/trial',
          label: '查看体验权益',
        );
      case 'order':
        if (sourceType == 'order' && sourceId != null) {
          return NotificationDestination(
            route:
                '/profile/purchases/orders?order=${Uri.encodeQueryComponent(sourceId!)}',
            label: '查看订单详情',
          );
        }
        return const NotificationDestination(
          route: '/profile/purchases/orders',
          label: '查看订单',
        );
      case 'gallery':
        return const NotificationDestination(
          route: '/profile/submissions',
          label: '查看投稿',
        );
    }
    if (title.contains('投稿')) {
      return const NotificationDestination(
        route: '/profile/submissions',
        label: '查看投稿',
      );
    }
    if (title.contains('反馈') || title.contains('建议采纳')) {
      return const NotificationDestination(
        route: '/profile/feedback',
        label: '查看反馈',
      );
    }
    if (title.contains('兑换码')) {
      return const NotificationDestination(
        route: '/profile/wallet',
        label: '查看钱包',
      );
    }
    return null;
  }

  AppNotification markRead([DateTime? at]) => AppNotification(
    id: id,
    kind: kind,
    title: title,
    body: body,
    readAt: at ?? DateTime.now(),
    createdAt: createdAt,
    sourceType: sourceType,
    sourceId: sourceId,
  );

  String? get relationLabel => switch ((sourceType, sourceId)) {
    ('task', String value) when value.isNotEmpty => '关联作品',
    ('order', String value) when value.isNotEmpty => '关联订单',
    _ => null,
  };
}

class NotificationDestination {
  const NotificationDestination({required this.route, required this.label});

  final String route;
  final String label;
}

String notificationKindLabel(String kind) => switch (kind) {
  'task' => '创作',
  'reward' => '奖励',
  'trial_access' => '体验资格',
  'order' => '订单',
  'gallery' => '社区',
  _ => '系统',
};

List<AppNotification> searchNotifications(
  Iterable<AppNotification> items,
  String query,
) {
  final normalized = query.trim().toLowerCase();
  if (normalized.isEmpty) return items.toList();
  return items.where((item) {
    final searchable = [
      item.title,
      item.body,
      notificationKindLabel(item.kind),
      item.kind,
    ].join('\n').toLowerCase();
    return searchable.contains(normalized);
  }).toList();
}

DateTime? _date(dynamic value) =>
    DateTime.tryParse(value?.toString() ?? '')?.toLocal();

String? _optional(dynamic value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}

class NotificationPage {
  const NotificationPage({
    required this.items,
    required this.nextCursor,
    required this.unread,
  });

  factory NotificationPage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final rawItems = map['items'];
    final items = rawItems is List
        ? rawItems
              .whereType<Map>()
              .map(
                (item) =>
                    AppNotification.fromJson(Map<String, dynamic>.from(item)),
              )
              .where((item) => item.id.isNotEmpty)
              .toList()
        : const <AppNotification>[];
    final cursor = map['nextCursor']?.toString().trim();
    return NotificationPage(
      items: items,
      nextCursor: cursor?.isEmpty == true ? null : cursor,
      unread: (map['unread'] as num?)?.toInt() ?? 0,
    );
  }

  final List<AppNotification> items;
  final String? nextCursor;
  final int unread;
}

class NotificationCenterState {
  const NotificationCenterState({
    required this.items,
    required this.nextCursor,
    required this.unread,
    this.isLoadingMore = false,
    this.markingIds = const {},
    this.isMarkingAll = false,
    this.isClearing = false,
  });

  final List<AppNotification> items;
  final String? nextCursor;
  final int unread;
  final bool isLoadingMore;
  final Set<String> markingIds;
  final bool isMarkingAll;
  final bool isClearing;

  bool get hasMore => nextCursor != null;
  bool get isBusy => isMarkingAll || isClearing;

  NotificationCenterState copyWith({
    List<AppNotification>? items,
    String? nextCursor,
    bool clearCursor = false,
    int? unread,
    bool? isLoadingMore,
    Set<String>? markingIds,
    bool? isMarkingAll,
    bool? isClearing,
  }) => NotificationCenterState(
    items: items ?? this.items,
    nextCursor: clearCursor ? null : nextCursor ?? this.nextCursor,
    unread: unread ?? this.unread,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    markingIds: markingIds ?? this.markingIds,
    isMarkingAll: isMarkingAll ?? this.isMarkingAll,
    isClearing: isClearing ?? this.isClearing,
  );
}

class NotificationRepository {
  const NotificationRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<NotificationPage> list({String? cursor, int limit = 30}) async {
    final data = await _apiClient.get(
      '/me/notifications',
      queryParameters: {
        'limit': limit,
        if (cursor?.isNotEmpty == true) 'cursor': cursor,
      },
    );
    return NotificationPage.fromJson(data);
  }

  Future<void> markRead([List<String> ids = const []]) =>
      _apiClient.patch('/me/notifications', data: {'ids': ids});

  Future<void> clear() => _apiClient.delete('/me/notifications');
}

final notificationRepositoryProvider = Provider<NotificationRepository>(
  (ref) => NotificationRepository(ref.watch(apiClientProvider)),
);

final notificationSummaryProvider = FutureProvider<int>(
  (ref) async =>
      (await ref.watch(notificationRepositoryProvider).list(limit: 1)).unread,
);

class NotificationCenterController
    extends AsyncNotifier<NotificationCenterState> {
  NotificationRepository get _repository =>
      ref.read(notificationRepositoryProvider);

  @override
  Future<NotificationCenterState> build() => _loadFirstPage();

  Future<NotificationCenterState> _loadFirstPage() async {
    final page = await _repository.list();
    return NotificationCenterState(
      items: page.items,
      nextCursor: page.nextCursor,
      unread: page.unread,
    );
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_loadFirstPage);
    ref.invalidate(notificationSummaryProvider);
  }

  Future<void> loadMore() async {
    final current = state.asData?.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final page = await _repository.list(cursor: current.nextCursor);
      final knownIds = current.items.map((item) => item.id).toSet();
      final merged = [
        ...current.items,
        ...page.items.where((item) => knownIds.add(item.id)),
      ];
      state = AsyncData(
        NotificationCenterState(
          items: merged,
          nextCursor: page.nextCursor,
          unread: page.unread,
        ),
      );
    } catch (error, stackTrace) {
      state = AsyncData(current.copyWith(isLoadingMore: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<void> markRead(String id) async {
    final current = state.asData?.value;
    final target = current?.items.where((item) => item.id == id).firstOrNull;
    if (current == null || target == null || target.isRead) return;
    state = AsyncData(
      current.copyWith(markingIds: {...current.markingIds, id}),
    );
    try {
      await _repository.markRead([id]);
      final latest = state.asData?.value ?? current;
      state = AsyncData(
        latest.copyWith(
          items: latest.items
              .map((item) => item.id == id ? item.markRead() : item)
              .toList(),
          unread: latest.unread > 0 ? latest.unread - 1 : 0,
          markingIds: {...latest.markingIds}..remove(id),
        ),
      );
      ref.invalidate(notificationSummaryProvider);
    } catch (error, stackTrace) {
      final latest = state.asData?.value ?? current;
      state = AsyncData(
        latest.copyWith(markingIds: {...latest.markingIds}..remove(id)),
      );
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<void> markAllRead() async {
    final current = state.asData?.value;
    if (current == null || current.unread == 0 || current.isBusy) return;
    state = AsyncData(current.copyWith(isMarkingAll: true));
    try {
      await _repository.markRead();
      final latest = state.asData?.value ?? current;
      state = AsyncData(
        latest.copyWith(
          items: latest.items.map((item) => item.markRead()).toList(),
          unread: 0,
          isMarkingAll: false,
        ),
      );
      ref.invalidate(notificationSummaryProvider);
    } catch (error, stackTrace) {
      state = AsyncData(current.copyWith(isMarkingAll: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<void> clearAll() async {
    final current = state.asData?.value;
    if (current == null || current.items.isEmpty || current.isBusy) return;
    state = AsyncData(current.copyWith(isClearing: true));
    try {
      await _repository.clear();
      state = const AsyncData(
        NotificationCenterState(items: [], nextCursor: null, unread: 0),
      );
      ref.invalidate(notificationSummaryProvider);
    } catch (error, stackTrace) {
      state = AsyncData(current.copyWith(isClearing: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }
}

final notificationCenterControllerProvider =
    AsyncNotifierProvider<
      NotificationCenterController,
      NotificationCenterState
    >(NotificationCenterController.new);
