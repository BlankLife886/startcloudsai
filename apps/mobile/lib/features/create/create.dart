import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../tasks/tasks.dart';
import 'reference_image_service.dart';

class ImageModelOption {
  const ImageModelOption({
    required this.id,
    required this.name,
    required this.description,
    required this.resolutions,
    required this.aspectRatios,
    required this.qualities,
    required this.maxImages,
    required this.maxReferenceImages,
    required this.pricePoints,
    this.transparentBackground = false,
    this.outputFormats = const [],
  });

  factory ImageModelOption.fromJson(Map<String, dynamic> json) =>
      ImageModelOption(
        id: (json['id'] ?? json['publicModelKey'])?.toString() ?? '',
        name: (json['name'] ?? json['label'])?.toString() ?? '图片模型',
        description: json['description']?.toString() ?? '',
        resolutions: _strings(json['resolutions'], fallback: const ['1K']),
        aspectRatios: _strings(
          json['aspectRatios'],
          fallback: const ['auto', '1:1', '3:4', '16:9'],
        ),
        qualities: _strings(json['qualities'], fallback: const ['medium']),
        maxImages: ((json['maxImages'] as num?)?.toInt() ?? 1).clamp(1, 4),
        maxReferenceImages: ((json['maxReferenceImages'] as num?)?.toInt() ?? 0)
            .clamp(0, 15),
        pricePoints:
            ((json['pricePoints'] ?? json['creditCost']) as num?)?.toInt() ?? 0,
        transparentBackground: json['transparentBackground'] == true,
        outputFormats: _strings(json['outputFormats'], fallback: const []),
      );

  static List<String> _strings(
    dynamic value, {
    required List<String> fallback,
  }) {
    final items = (value as List?)
        ?.map((item) => item.toString())
        .where((item) => item.isNotEmpty)
        .toList();
    return items == null || items.isEmpty ? fallback : items;
  }

  final String id;
  final String name;
  final String description;
  final List<String> resolutions;
  final List<String> aspectRatios;
  final List<String> qualities;
  final int maxImages;
  final int maxReferenceImages;
  final int pricePoints;
  final bool transparentBackground;
  final List<String> outputFormats;

  bool get supportsTransparentPng =>
      transparentBackground && outputFormats.contains('png');
}

const maxTaskReferenceImages = 6;
const maxAssistantOptimizationRunes = 12000;

int creationReferenceLimit(ImageModelOption model) =>
    model.maxReferenceImages.clamp(0, maxTaskReferenceImages);

String assistantOptimizationPrompt(String prompt) => [
  '请优化以下文生图提示词，保持主体、事实与关键约束不变，并补全环境、光线、构图和风格细节：',
  prompt.trim(),
].join('\n\n');

String creationPromptAssistantLocation(String prompt) => Uri(
  path: '/assistant',
  queryParameters: {'prompt': assistantOptimizationPrompt(prompt)},
).toString();

List<T> reorderCreationReferences<T>(
  List<T> items,
  int oldIndex,
  int newIndex,
) {
  if (oldIndex < 0 || oldIndex >= items.length) return List<T>.of(items);
  var destination = newIndex;
  if (destination > oldIndex) destination -= 1;
  destination = destination.clamp(0, items.length - 1);
  if (destination == oldIndex) return List<T>.of(items);
  final result = List<T>.of(items);
  final item = result.removeAt(oldIndex);
  result.insert(destination, item);
  return result;
}

({bool sufficient, int remaining, int missing}) creationAffordability(
  int availablePoints,
  int estimatedCost,
) {
  final remaining = availablePoints - estimatedCost;
  return (
    sufficient: remaining >= 0,
    remaining: remaining.clamp(0, availablePoints),
    missing: (-remaining).clamp(0, estimatedCost),
  );
}

String creationDurationLabel(Duration duration) {
  final total = duration.isNegative ? Duration.zero : duration;
  return '${total.inSeconds} 秒';
}

Duration? creationElapsedDuration({
  required bool active,
  DateTime? startedAt,
  DateTime? finishedAt,
  DateTime? createdAt,
  DateTime? submittedAt,
  DateTime? now,
}) {
  final clock = now ?? DateTime.now();
  if (!active) {
    final start = startedAt ?? createdAt;
    if (start == null || finishedAt == null) return null;
    return finishedAt.difference(start);
  }
  final start = startedAt ?? createdAt ?? submittedAt;
  if (start == null) return null;
  final elapsed = clock.difference(start);
  return elapsed.isNegative ? Duration.zero : elapsed;
}

Duration? creationGroupElapsedDuration({
  required Iterable<TaskItem> tasks,
  required bool active,
  DateTime? submittedAt,
  DateTime? now,
}) {
  final items = tasks.toList();
  if (items.isEmpty) return null;
  DateTime? start;
  for (final task in items) {
    final candidate = task.startedAt ?? task.createdAt ?? submittedAt;
    if (candidate == null) continue;
    if (start == null || candidate.isBefore(start)) start = candidate;
  }
  if (start == null) return null;
  if (active || items.any((task) => task.isActive)) {
    return creationElapsedDuration(active: true, startedAt: start, now: now);
  }
  DateTime? end;
  for (final task in items) {
    final candidate = task.finishedAt;
    if (candidate == null) continue;
    if (end == null || candidate.isAfter(end)) end = candidate;
  }
  if (end == null) return null;
  final elapsed = end.difference(start);
  return elapsed.isNegative ? Duration.zero : elapsed;
}

class TextToImageBatch {
  const TextToImageBatch({required this.taskIds, this.batchId = ''});

  final List<String> taskIds;
  final String batchId;
}

class RuntimeCreationConfig {
  const RuntimeCreationConfig({required this.enabled, required this.models});

  final bool enabled;
  final List<ImageModelOption> models;
}

class CreationPreset {
  const CreationPreset({
    required this.originTaskId,
    required this.prompt,
    required this.count,
    this.modelId,
    this.aspectRatio,
    this.resolution,
    this.quality,
  });

  static CreationPreset? fromQuery(Map<String, String> query) {
    final taskId = _optionalQuery(query['sourceTask']);
    if (taskId == null) return null;
    return CreationPreset(
      originTaskId: taskId,
      prompt: query['prompt'] ?? '',
      modelId: _optionalQuery(query['model']),
      aspectRatio: _optionalQuery(query['aspectRatio']),
      resolution: _optionalQuery(query['resolution']),
      quality: _optionalQuery(query['quality']),
      count: (int.tryParse(query['count'] ?? '') ?? 1).clamp(1, 4),
    );
  }

  final String originTaskId;
  final String prompt;
  final String? modelId;
  final String? aspectRatio;
  final String? resolution;
  final String? quality;
  final int count;

  Map<String, String> toQueryParameters() => {
    'sourceTask': originTaskId,
    'prompt': prompt,
    'model': ?modelId,
    'aspectRatio': ?aspectRatio,
    'resolution': ?resolution,
    'quality': ?quality,
    'count': '$count',
  };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CreationPreset &&
          other.originTaskId == originTaskId &&
          other.prompt == prompt &&
          other.modelId == modelId &&
          other.aspectRatio == aspectRatio &&
          other.resolution == resolution &&
          other.quality == quality &&
          other.count == count;

  @override
  int get hashCode => Object.hash(
    originTaskId,
    prompt,
    modelId,
    aspectRatio,
    resolution,
    quality,
    count,
  );
}

String? _optionalQuery(String? value) {
  final text = value?.trim();
  return text == null || text.isEmpty ? null : text;
}

class CreationRepository {
  const CreationRepository(this._apiClient);

  final ApiClient _apiClient;
  static const _uuid = Uuid();

  Future<RuntimeCreationConfig> loadConfig() async {
    final data = await _apiClient.get('/runtime-config');
    final root = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final features = root['features'] is Map
        ? Map<String, dynamic>.from(root['features'] as Map)
        : const <String, dynamic>{};
    final rawFeature =
        features['ai.wallpaperGeneration'] ?? features['wallpaper'];
    final feature = rawFeature is Map
        ? Map<String, dynamic>.from(rawFeature)
        : const <String, dynamic>{};
    final config = feature['config'] is Map
        ? Map<String, dynamic>.from(feature['config'] as Map)
        : const <String, dynamic>{};
    final rawModels = config['publicModels'] is List
        ? config['publicModels'] as List
        : const [];
    final models = rawModels
        .whereType<Map>()
        .map(
          (item) => ImageModelOption.fromJson(Map<String, dynamic>.from(item)),
        )
        .where((model) => model.id.isNotEmpty)
        .toList();
    return RuntimeCreationConfig(
      enabled: feature['enabled'] != false && models.isNotEmpty,
      models: models,
    );
  }

  Future<TextToImageBatch> createTextToImage({
    required String prompt,
    required ImageModelOption model,
    required String aspectRatio,
    required String resolution,
    required String quality,
    required int count,
    List<String> inputKeys = const [],
  }) async {
    if (inputKeys.length > maxTaskReferenceImages) {
      throw const FormatException('文生图任务最多支持 6 张参考图');
    }
    final batchSize = count.clamp(1, 4);
    final batchId = batchSize > 1
        ? 'batch-${DateTime.now().millisecondsSinceEpoch}'
        : '';
    final batchCreatedAt = DateTime.now().toUtc().toIso8601String();
    final ids = <String>[];
    for (var index = 0; index < batchSize; index++) {
      ids.add(
        await _createTextToImageTask(
          prompt: prompt,
          model: model,
          aspectRatio: aspectRatio,
          resolution: resolution,
          quality: quality,
          inputKeys: inputKeys,
          batchId: batchId,
          batchIndex: index,
          batchSize: batchSize,
          batchCreatedAt: batchCreatedAt,
        ),
      );
    }
    return TextToImageBatch(taskIds: ids, batchId: batchId);
  }

  Future<String> _createTextToImageTask({
    required String prompt,
    required ImageModelOption model,
    required String aspectRatio,
    required String resolution,
    required String quality,
    required List<String> inputKeys,
    required String batchId,
    required int batchIndex,
    required int batchSize,
    required String batchCreatedAt,
  }) async {
    final data = await _apiClient.post(
      '/tasks',
      data: {
        'type': 't2i',
        'prompt': prompt.trim(),
        'params': {
          'publicModelKey': model.id,
          'modelHint': model.id,
          'userPrompt': prompt.trim(),
          'aspectRatio': aspectRatio,
          'requestedAspectRatio': aspectRatio,
          'resolutionScale': resolution,
          'quality': quality,
          'count': 1,
          'n': 1,
          'sourceMode': inputKeys.isEmpty ? 'text' : 'reference',
          '_source': 'flutter_app',
          '_kind': 'wallpaper-image-generation',
          if (batchId.isNotEmpty) ...{
            'batchId': batchId,
            'batchIndex': batchIndex,
            'batchSize': batchSize,
            'batchCreatedAt': batchCreatedAt,
          },
        },
        'inputKeys': inputKeys,
        'count': 1,
        'idempotencyKey': _uuid.v4(),
      },
    );
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final task = map['task'] is Map
        ? Map<String, dynamic>.from(map['task'] as Map)
        : map;
    final id = task['id']?.toString() ?? '';
    if (id.isEmpty) throw const FormatException('任务响应缺少 ID');
    return id;
  }

  Future<String> uploadReference(ReferenceImageDraft image) async {
    final data = await _apiClient.post(
      '/uploads',
      data: FormData.fromMap({
        'file': await MultipartFile.fromFile(
          image.localPath,
          filename: image.filename,
        ),
      }),
    );
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final key = map['key']?.toString() ?? '';
    if (key.isEmpty) throw const FormatException('参考图上传响应缺少文件标识');
    return key;
  }
}

final creationRepositoryProvider = Provider<CreationRepository>(
  (ref) => CreationRepository(ref.watch(apiClientProvider)),
);

final runtimeCreationConfigProvider = FutureProvider<RuntimeCreationConfig>(
  (ref) => ref.watch(creationRepositoryProvider).loadConfig(),
);
