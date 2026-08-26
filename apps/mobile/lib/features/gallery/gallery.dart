import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

class GalleryCategory {
  const GalleryCategory({
    required this.id,
    required this.name,
    required this.sort,
  });

  factory GalleryCategory.fromJson(Map<String, dynamic> json) =>
      GalleryCategory(
        id: json['id']?.toString() ?? '',
        name: json['name']?.toString() ?? '',
        sort: (json['sort'] as num?)?.toInt() ?? 0,
      );

  final String id;
  final String name;
  final int sort;
}

class GallerySubmission {
  const GallerySubmission({
    required this.id,
    required this.taskId,
    required this.title,
    required this.status,
    required this.mediaUrls,
    required this.createdAt,
    this.coverUrl,
    this.categoryId,
    this.rejectReason,
    this.reviewedAt,
  });

  factory GallerySubmission.fromJson(Map<String, dynamic> json) =>
      GallerySubmission(
        id: json['id']?.toString() ?? '',
        taskId: json['taskId']?.toString() ?? '',
        title: json['title']?.toString() ?? '',
        status: json['status']?.toString() ?? 'pending',
        coverUrl:
            json['coverThumbUrl']?.toString() ?? json['coverUrl']?.toString(),
        mediaUrls:
            (json['mediaUrls'] as List?)
                ?.map((item) => item.toString())
                .where((item) => item.isNotEmpty)
                .toList() ??
            const [],
        categoryId: json['categoryId']?.toString(),
        rejectReason: json['rejectReason']?.toString(),
        reviewedAt: _date(json['reviewedAt']),
        createdAt: _date(json['createdAt']),
      );

  final String id;
  final String taskId;
  final String title;
  final String status;
  final String? coverUrl;
  final List<String> mediaUrls;
  final String? categoryId;
  final String? rejectReason;
  final DateTime? reviewedAt;
  final DateTime? createdAt;

  bool get isApproved => status == 'approved';
}

String gallerySubmissionStatusSearchLabel(String status) => switch (status) {
  'pending' => '审核中 待审核',
  'approved' => '已发布 已通过',
  'rejected' => '需处理 未通过 驳回',
  'removed' => '需处理 已下架',
  _ => status,
};

List<GallerySubmission> searchGallerySubmissions(
  Iterable<GallerySubmission> items,
  String query,
) {
  final normalized = query.trim().toLowerCase();
  if (normalized.isEmpty) return items.toList();
  return items.where((item) {
    final searchable = [
      item.title,
      item.rejectReason ?? '',
      gallerySubmissionStatusSearchLabel(item.status),
      item.categoryId ?? '',
    ].join('\n').toLowerCase();
    return searchable.contains(normalized);
  }).toList();
}

class GallerySubmissionPage {
  const GallerySubmissionPage({required this.items, required this.nextCursor});

  factory GallerySubmissionPage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final rawItems = map['items'];
    final items = rawItems is List
        ? rawItems
              .whereType<Map>()
              .map(
                (item) =>
                    GallerySubmission.fromJson(Map<String, dynamic>.from(item)),
              )
              .where((item) => item.id.isNotEmpty && item.taskId.isNotEmpty)
              .toList()
        : const <GallerySubmission>[];
    final cursor = map['nextCursor']?.toString().trim();
    return GallerySubmissionPage(
      items: items,
      nextCursor: cursor?.isEmpty == true ? null : cursor,
    );
  }

  final List<GallerySubmission> items;
  final String? nextCursor;
}

class GallerySubmissionSummary {
  const GallerySubmissionSummary({
    required this.total,
    required this.pending,
    required this.approved,
    required this.needsAttention,
    this.hasMore = false,
  });

  factory GallerySubmissionSummary.fromItems(
    Iterable<GallerySubmission> items, {
    bool hasMore = false,
  }) {
    var total = 0;
    var pending = 0;
    var approved = 0;
    var needsAttention = 0;
    for (final item in items) {
      total++;
      switch (item.status) {
        case 'pending':
          pending++;
          break;
        case 'approved':
          approved++;
          break;
        case 'rejected' || 'removed':
          needsAttention++;
          break;
        default:
          break;
      }
    }
    return GallerySubmissionSummary(
      total: total,
      pending: pending,
      approved: approved,
      needsAttention: needsAttention,
      hasMore: hasMore,
    );
  }

  final int total;
  final int pending;
  final int approved;
  final int needsAttention;
  final bool hasMore;
}

class MyGallerySubmissionsState {
  const MyGallerySubmissionsState({
    required this.items,
    required this.nextCursor,
    this.isLoadingMore = false,
  });

  final List<GallerySubmission> items;
  final String? nextCursor;
  final bool isLoadingMore;

  bool get hasMore => nextCursor != null;
  GallerySubmissionSummary get summary =>
      GallerySubmissionSummary.fromItems(items);

  MyGallerySubmissionsState copyWith({
    List<GallerySubmission>? items,
    String? nextCursor,
    bool clearCursor = false,
    bool? isLoadingMore,
  }) => MyGallerySubmissionsState(
    items: items ?? this.items,
    nextCursor: clearCursor ? null : nextCursor ?? this.nextCursor,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
  );
}

DateTime? _date(dynamic value) =>
    DateTime.tryParse(value?.toString() ?? '')?.toLocal();

class GalleryRepository {
  const GalleryRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<List<GalleryCategory>> categories() async {
    final data = await _apiClient.get('/gallery/categories');
    if (data is! Map || data['items'] is! List) return const [];
    final items = (data['items'] as List)
        .whereType<Map>()
        .map(
          (item) => GalleryCategory.fromJson(Map<String, dynamic>.from(item)),
        )
        .where((item) => item.id.isNotEmpty && item.name.isNotEmpty)
        .toList();
    items.sort((a, b) {
      final bySort = a.sort.compareTo(b.sort);
      return bySort == 0 ? a.name.compareTo(b.name) : bySort;
    });
    return items;
  }

  Future<List<GallerySubmission>> mySubmissions() async {
    return (await mySubmissionsPage(limit: 100)).items;
  }

  Future<GallerySubmissionPage> mySubmissionsPage({
    String? cursor,
    int limit = 30,
  }) async {
    final data = await _apiClient.get(
      '/me/gallery/submissions',
      queryParameters: {
        'limit': limit,
        if (cursor?.isNotEmpty == true) 'cursor': cursor,
      },
    );
    return GallerySubmissionPage.fromJson(data);
  }

  Future<GallerySubmission> submit({
    required String taskId,
    required String title,
    String? categoryId,
  }) async {
    final data = await _apiClient.post(
      '/gallery/submissions',
      data: {
        'taskId': taskId,
        'title': title.trim(),
        if (categoryId?.isNotEmpty == true) 'categoryId': categoryId,
      },
    );
    if (data is! Map) throw const FormatException('投稿响应无效');
    return GallerySubmission.fromJson(Map<String, dynamic>.from(data));
  }

  Future<void> delete(String id) =>
      _apiClient.delete('/me/gallery/submissions/$id');
}

final galleryRepositoryProvider = Provider<GalleryRepository>(
  (ref) => GalleryRepository(ref.watch(apiClientProvider)),
);

final galleryCategoriesProvider = FutureProvider<List<GalleryCategory>>(
  (ref) => ref.watch(galleryRepositoryProvider).categories(),
);

final myGallerySubmissionsProvider = FutureProvider<List<GallerySubmission>>(
  (ref) => ref.watch(galleryRepositoryProvider).mySubmissions(),
);

final gallerySubmissionSummaryProvider =
    FutureProvider<GallerySubmissionSummary>((ref) async {
      final page = await ref
          .watch(galleryRepositoryProvider)
          .mySubmissionsPage(limit: 100);
      return GallerySubmissionSummary.fromItems(
        page.items,
        hasMore: page.nextCursor != null,
      );
    });

final gallerySubmissionForTaskProvider =
    FutureProvider.family<GallerySubmission?, String>((ref, taskId) async {
      final submissions = await ref.watch(myGallerySubmissionsProvider.future);
      for (final submission in submissions) {
        if (submission.taskId == taskId) return submission;
      }
      return null;
    });

class MyGallerySubmissionsController
    extends AsyncNotifier<MyGallerySubmissionsState> {
  int _generation = 0;

  GalleryRepository get _repository => ref.read(galleryRepositoryProvider);

  @override
  Future<MyGallerySubmissionsState> build() => _loadFirstPage();

  Future<MyGallerySubmissionsState> _loadFirstPage() async {
    final page = await _repository.mySubmissionsPage();
    return MyGallerySubmissionsState(
      items: page.items,
      nextCursor: page.nextCursor,
    );
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
      final page = await _repository.mySubmissionsPage(
        cursor: current.nextCursor,
      );
      if (generation != _generation) return;
      final latest = state.asData?.value;
      if (latest == null) return;
      final knownIds = latest.items.map((item) => item.id).toSet();
      final merged = [
        ...latest.items,
        ...page.items.where((item) => knownIds.add(item.id)),
      ];
      state = AsyncData(
        MyGallerySubmissionsState(items: merged, nextCursor: page.nextCursor),
      );
    } catch (error, stackTrace) {
      if (generation != _generation) return;
      final latest = state.asData?.value ?? current;
      state = AsyncData(latest.copyWith(isLoadingMore: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  void removeLocal(String id) {
    final current = state.asData?.value;
    if (current == null) return;
    state = AsyncData(
      current.copyWith(
        items: current.items.where((item) => item.id != id).toList(),
      ),
    );
  }
}

final myGallerySubmissionsControllerProvider =
    AsyncNotifierProvider<
      MyGallerySubmissionsController,
      MyGallerySubmissionsState
    >(MyGallerySubmissionsController.new);
