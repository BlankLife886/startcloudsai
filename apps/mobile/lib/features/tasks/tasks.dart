import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

class TaskItem {
  const TaskItem({
    required this.id,
    required this.type,
    required this.model,
    required this.status,
    required this.prompt,
    required this.params,
    required this.inputKeys,
    required this.costPoints,
    required this.createdAt,
    required this.startedAt,
    required this.finishedAt,
    required this.thumbnailUrls,
    required this.displayUrls,
    required this.originalUrls,
    required this.errorCode,
    required this.errorMessage,
    this.outputKeys = const [],
    this.deletedAt,
    this.deletionActor,
    this.deletedOutputCount = 0,
    this.count = 1,
  });

  factory TaskItem.fromJson(Map<String, dynamic> json) {
    final outputUrls = _stringList(json['outputUrls']);
    var thumbnails = _stringList(json['thumbnailUrls']);
    if (thumbnails.isEmpty) thumbnails = outputUrls;
    var originals = _stringList(json['originalUrls']);
    if (originals.isEmpty) originals = outputUrls;
    return TaskItem(
      id: json['id']?.toString() ?? '',
      type: json['type']?.toString() ?? '',
      model: json['model']?.toString() ?? '',
      status: json['status']?.toString() ?? 'queued',
      prompt:
          (json['params'] is Map ? (json['params'] as Map)['userPrompt'] : null)
              ?.toString() ??
          json['prompt']?.toString() ??
          '',
      params: json['params'] is Map
          ? Map<String, dynamic>.from(json['params'] as Map)
          : const {},
      inputKeys: _stringList(json['inputKeys']),
      costPoints:
          ((json['costPoints'] ?? json['costCents']) as num?)?.toInt() ?? 0,
      createdAt: _date(json['createdAt']),
      startedAt: _date(json['startedAt']),
      finishedAt: _date(json['finishedAt']),
      thumbnailUrls: thumbnails,
      displayUrls: _stringList(json['displayUrls']),
      originalUrls: originals,
      outputKeys: _stringList(json['outputKeys']),
      errorCode: json['errorCode']?.toString(),
      errorMessage: json['errorMessage']?.toString(),
      deletedAt: _date(json['deletedAt']),
      deletionActor: _nullableText(json['deletionActor']),
      deletedOutputCount:
          (json['deletedOutputCount'] as num?)?.toInt().clamp(0, 1000000) ?? 0,
      count: ((json['count'] as num?)?.toInt() ?? 1).clamp(1, 4),
    );
  }

  final String id;
  final String type;
  final String model;
  final String status;
  final String prompt;

  /// 用户输入的原始提示词。部分任务类型会把完整的服务端提示词放在 [prompt]，
  /// 原始输入保留在 params.userPrompt 中，展示时应优先使用用户自己的输入。
  String get displayPrompt {
    if (prompt.trim().isNotEmpty) return prompt;
    final raw = params['userPrompt']?.toString().trim();
    if (raw == null || raw.isEmpty) return '';
    return raw;
  }

  final Map<String, dynamic> params;
  final List<String> inputKeys;
  final int costPoints;
  final DateTime? createdAt;
  final DateTime? startedAt;
  final DateTime? finishedAt;
  final List<String> thumbnailUrls;
  final List<String> displayUrls;
  final List<String> originalUrls;
  final List<String> outputKeys;
  final String? errorCode;
  final String? errorMessage;
  final DateTime? deletedAt;
  final String? deletionActor;
  final int deletedOutputCount;
  final int count;

  String? get thumbnailUrl => thumbnailUrls.firstOrNull;
  String? get originalUrl => originalUrls.firstOrNull;
  List<String> get previewUrls => displayUrls.isNotEmpty
      ? displayUrls
      : originalUrls.isNotEmpty
      ? originalUrls
      : thumbnailUrls;
  bool get isActive => status == 'queued' || status == 'running';
  bool get isSucceeded => status == 'succeeded';
  bool get hasDeletedOutputs =>
      deletedAt != null ||
      deletedOutputCount > 0 ||
      deletionActor?.isNotEmpty == true;
  bool get canCancel => isActive;
  bool get canDelete =>
      status == 'succeeded' || status == 'failed' || status == 'canceled';
  bool get isTextToImage {
    final normalized = type.toLowerCase().replaceAll('_', '-');
    return normalized == 't2i' ||
        normalized == 'text2image' ||
        normalized == 'text-to-image';
  }

  String get batchId => params['batchId']?.toString().trim() ?? '';

  int get batchIndex {
    final raw = params['batchIndex'];
    if (raw is num) return raw.toInt();
    return int.tryParse(raw?.toString() ?? '') ?? 0;
  }

  int get batchSize {
    final raw = params['batchSize'];
    if (raw is num) return raw.toInt().clamp(1, 4);
    return (int.tryParse(raw?.toString() ?? '') ?? count).clamp(1, 4);
  }

  String get groupKey => batchId.isEmpty ? id : batchId;

  String? outputKeyAt(int index) {
    if (index >= 0 && index < outputKeys.length) {
      final key = outputKeys[index].trim();
      if (key.isNotEmpty) return key;
    }
    final urls = <String>[
      if (index >= 0 && index < originalUrls.length) originalUrls[index],
      if (index >= 0 && index < displayUrls.length) displayUrls[index],
      if (index >= 0 && index < thumbnailUrls.length) thumbnailUrls[index],
    ];
    for (final url in urls) {
      final key = authenticatedFileKey(url);
      if (key != null) return key;
    }
    return null;
  }

  Duration? get duration {
    final start = startedAt ?? createdAt;
    final end = finishedAt;
    if (start == null || end == null) return null;
    return end.difference(start);
  }
}

List<List<TaskItem>> groupCreationTurns(Iterable<TaskItem> items) {
  final groups = <String, List<TaskItem>>{};
  final order = <String>[];
  for (final task in items) {
    if (!task.isTextToImage) continue;
    final key = task.groupKey;
    final bucket = groups.putIfAbsent(key, () {
      order.add(key);
      return <TaskItem>[];
    });
    bucket.add(task);
  }
  return [
    for (final key in order)
      (List<TaskItem>.from(groups[key]!)
        ..sort((left, right) => left.batchIndex.compareTo(right.batchIndex))),
  ];
}

String? authenticatedFileKey(String url) {
  final raw = url.trim();
  if (raw.isEmpty) return null;
  if (!raw.contains('://') && !raw.startsWith('/')) return raw;
  const marker = '/api/v1/files/';
  final path = Uri.tryParse(raw)?.path ?? raw;
  final index = path.indexOf(marker);
  if (index < 0) return null;
  final key = Uri.decodeComponent(path.substring(index + marker.length)).trim();
  return key.isEmpty ? null : key;
}

List<String> _stringList(dynamic value) =>
    (value as List?)
        ?.map((item) => item.toString())
        .where((item) => item.isNotEmpty)
        .toList() ??
    const [];

DateTime? _date(dynamic value) =>
    DateTime.tryParse(value?.toString() ?? '')?.toLocal();

String? _nullableText(dynamic value) {
  final text = value?.toString().trim();
  return text?.isNotEmpty == true ? text : null;
}

class TaskRepository {
  const TaskRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<List<TaskItem>> list() async => (await page(limit: 40)).items;

  Future<TaskPage> page({String? cursor, int limit = 24}) async {
    final data = await _apiClient.get(
      '/tasks',
      queryParameters: {
        'limit': limit.clamp(1, 100),
        if (cursor?.trim().isNotEmpty == true) 'cursor': cursor!.trim(),
      },
    );
    return TaskPage.fromJson(data);
  }

  Future<TaskItem> get(String id) async {
    final data = await _apiClient.get('/tasks/$id');
    if (data is! Map) throw const FormatException('任务详情响应无效');
    return TaskItem.fromJson(Map<String, dynamic>.from(data));
  }

  Future<List<TaskItem>> getBatch(Iterable<String> ids) async {
    final unique = ids
        .map((id) => id.trim())
        .where((id) => id.isNotEmpty)
        .toSet();
    if (unique.isEmpty) return const [];
    final data = await _apiClient.get(
      '/tasks',
      queryParameters: {'ids': unique.take(100).join(',')},
    );
    if (data is! Map || data['items'] is! List) return const [];
    return (data['items'] as List)
        .whereType<Map>()
        .map((item) => TaskItem.fromJson(Map<String, dynamic>.from(item)))
        .where((item) => item.id.isNotEmpty)
        .toList();
  }

  Future<TaskItem> cancel(String id) async {
    final data = await _apiClient.patch(
      '/tasks/$id',
      data: const {'status': 'canceled'},
    );
    if (data is! Map) throw const FormatException('任务取消响应无效');
    return TaskItem.fromJson(Map<String, dynamic>.from(data));
  }

  Future<TaskDeletionResult> deleteTask(
    String id, {
    bool cascade = false,
  }) async {
    final data = await _apiClient.delete(
      '/tasks/$id',
      queryParameters: cascade ? const {'cascade': 'true'} : null,
    );
    return TaskDeletionResult.fromJson(data, fallbackId: id);
  }

  Future<TaskOutputDeletionResult> deleteTaskOutput(
    String id,
    int index,
  ) async {
    final data = await _apiClient.delete('/tasks/$id/outputs/$index');
    return TaskOutputDeletionResult.fromJson(data, fallbackId: id);
  }

  Future<File> downloadOriginal(TaskItem task, int index) async {
    if (index < 0 || index >= task.originalUrls.length) {
      throw const FormatException('作品原图不存在');
    }
    final url = task.originalUrls[index];
    final bytes = await _apiClient.getBytes(url);
    final directory = await getTemporaryDirectory();
    final extension = _fileExtension(url);
    final file = File(
      '${directory.path}/starclouds-${task.id}-${index + 1}.$extension',
    );
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }
}

class TaskPage {
  const TaskPage({required this.items, this.nextCursor});

  factory TaskPage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final cursor = map['nextCursor']?.toString().trim();
    return TaskPage(
      items: map['items'] is List
          ? (map['items'] as List)
                .whereType<Map>()
                .map(
                  (item) => TaskItem.fromJson(Map<String, dynamic>.from(item)),
                )
                .where((item) => item.id.isNotEmpty)
                .toList()
          : const [],
      nextCursor: cursor?.isNotEmpty == true ? cursor : null,
    );
  }

  final List<TaskItem> items;
  final String? nextCursor;
}

class TaskCenterState {
  const TaskCenterState({
    required this.items,
    this.nextCursor,
    this.isLoadingMore = false,
  });

  final List<TaskItem> items;
  final String? nextCursor;
  final bool isLoadingMore;

  bool get hasMore => nextCursor != null;

  TaskCenterState copyWith({
    List<TaskItem>? items,
    String? nextCursor,
    bool clearCursor = false,
    bool? isLoadingMore,
  }) => TaskCenterState(
    items: items ?? this.items,
    nextCursor: clearCursor ? null : nextCursor ?? this.nextCursor,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
  );
}

TaskItem _preferRicherTask(TaskItem current, TaskItem incoming) {
  if (incoming.previewUrls.isNotEmpty) return incoming;
  if (current.previewUrls.isEmpty) return incoming;
  if (incoming.status == 'failed' || incoming.status == 'canceled') {
    return incoming;
  }
  return current;
}

class TaskCenterController extends AutoDisposeAsyncNotifier<TaskCenterState> {
  int _generation = 0;

  TaskRepository get _repository => ref.read(taskRepositoryProvider);

  @override
  Future<TaskCenterState> build() => _loadFirstPage();

  Future<TaskCenterState> _loadFirstPage() async {
    final page = await _repository.page();
    final kept = state.asData?.value.items ?? const <TaskItem>[];
    if (kept.isEmpty) {
      return TaskCenterState(items: page.items, nextCursor: page.nextCursor);
    }
    final items = [...page.items];
    final known = items.map((item) => item.id).toSet();
    for (final item in kept.reversed) {
      if (known.add(item.id)) {
        items.insert(0, item);
      }
    }
    return TaskCenterState(items: items, nextCursor: page.nextCursor);
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
      final page = await _repository.page(cursor: current.nextCursor);
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

  void upsert(TaskItem task) {
    if (task.id.isEmpty) return;
    final current = state.asData?.value;
    if (current == null) {
      state = AsyncData(TaskCenterState(items: [task]));
      return;
    }
    final index = current.items.indexWhere((item) => item.id == task.id);
    final items = [...current.items];
    if (index < 0) {
      items.insert(0, task);
    } else {
      items[index] = _preferRicherTask(items[index], task);
    }
    state = AsyncData(current.copyWith(items: items));
  }

  void removeIds(Iterable<String> ids) {
    final current = state.asData?.value;
    if (current == null) return;
    final removed = ids.toSet();
    if (removed.isEmpty) return;
    state = AsyncData(
      current.copyWith(
        items: current.items
            .where((item) => !removed.contains(item.id))
            .toList(),
      ),
    );
  }
}

class TaskOutputDeletionResult {
  const TaskOutputDeletionResult({this.task, this.deletedTaskIds = const []});

  factory TaskOutputDeletionResult.fromJson(
    dynamic data, {
    required String fallbackId,
  }) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    if (map['id'] != null || map['originalUrls'] is List) {
      return TaskOutputDeletionResult(task: TaskItem.fromJson(map));
    }
    return TaskOutputDeletionResult(
      deletedTaskIds: TaskDeletionResult.fromJson(
        map,
        fallbackId: fallbackId,
      ).deletedTaskIds,
    );
  }

  final TaskItem? task;
  final List<String> deletedTaskIds;
}

class TaskDeletionResult {
  const TaskDeletionResult({required this.deletedTaskIds});

  factory TaskDeletionResult.fromJson(
    dynamic data, {
    required String fallbackId,
  }) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final rawIds = map['deletedTaskIds'];
    final ids = rawIds is List
        ? rawIds
              .map((item) => item.toString().trim())
              .where((item) => item.isNotEmpty)
              .toSet()
              .toList()
        : <String>[];
    if (ids.isEmpty && fallbackId.trim().isNotEmpty) ids.add(fallbackId.trim());
    return TaskDeletionResult(deletedTaskIds: ids);
  }

  final List<String> deletedTaskIds;
}

String _fileExtension(String url) {
  final path = Uri.tryParse(url)?.path.toLowerCase() ?? '';
  for (final extension in const ['png', 'jpg', 'jpeg', 'webp']) {
    if (path.endsWith('.$extension')) return extension;
  }
  return 'png';
}

final taskRepositoryProvider = Provider<TaskRepository>(
  (ref) => TaskRepository(ref.watch(apiClientProvider)),
);

final taskListProvider = FutureProvider<List<TaskItem>>(
  (ref) => ref.watch(taskRepositoryProvider).list(),
);

final taskCenterControllerProvider =
    AutoDisposeAsyncNotifierProvider<TaskCenterController, TaskCenterState>(
      TaskCenterController.new,
    );

final taskDetailProvider = FutureProvider.autoDispose.family<TaskItem, String>(
  (ref, id) => ref.watch(taskRepositoryProvider).get(id),
);
