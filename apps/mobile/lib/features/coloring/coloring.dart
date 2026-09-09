import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../create/create.dart';
import '../create/reference_image_service.dart';
import '../tasks/tasks.dart';

class ColoringConfig {
  const ColoringConfig({required this.enabled, required this.models});

  factory ColoringConfig.fromRuntimeConfig(dynamic data) {
    final root = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final features = root['features'] is Map
        ? Map<String, dynamic>.from(root['features'] as Map)
        : const <String, dynamic>{};
    final feature = features['ai.illustrationColoring'] is Map
        ? Map<String, dynamic>.from(features['ai.illustrationColoring'] as Map)
        : const <String, dynamic>{};
    final config = feature['config'] is Map
        ? Map<String, dynamic>.from(feature['config'] as Map)
        : const <String, dynamic>{};
    final models = (config['publicModels'] as List? ?? const [])
        .whereType<Map>()
        .map(
          (item) => ImageModelOption.fromJson(Map<String, dynamic>.from(item)),
        )
        .where((model) => model.id.isNotEmpty && model.maxReferenceImages > 0)
        .toList();
    return ColoringConfig(
      enabled: feature['enabled'] != false && models.isNotEmpty,
      models: models,
    );
  }

  final bool enabled;
  final List<ImageModelOption> models;
}

String normalizedColoringPrompt(String value) {
  final prompt = value.trim();
  return prompt.isEmpty ? '使用协调的专业配色，保持线稿清晰' : prompt;
}

Map<String, dynamic> coloringTaskPayload({
  required String prompt,
  required String title,
  required ImageModelOption model,
  required String aspectRatio,
  required String resolution,
  required String quality,
  required int count,
  required List<String> inputKeys,
  required String idempotencyKey,
}) {
  final userPrompt = normalizedColoringPrompt(prompt);
  return {
    'type': 'coloring',
    'prompt': userPrompt,
    'params': {
      'publicModelKey': model.id,
      'modelHint': model.id,
      'userPrompt': userPrompt,
      'title': title.trim().isEmpty ? '插画染色' : title.trim(),
      'styleId': 'coloring',
      'styleLabel': '插画染色',
      'customPrompt': prompt.trim(),
      'aspectRatio': aspectRatio,
      'requestedAspectRatio': aspectRatio,
      'resolutionScale': resolution,
      'quality': quality,
      'sourceMode': 'reference',
      '_source': 'flutter_app',
      '_kind': 'illustration-coloring',
    },
    'inputKeys': inputKeys,
    'count': count,
    'idempotencyKey': idempotencyKey,
  };
}

class ColoringRepository {
  const ColoringRepository(this._apiClient, this._creationRepository);

  final ApiClient _apiClient;
  final CreationRepository _creationRepository;
  static const _uuid = Uuid();

  Future<ColoringConfig> loadConfig() async =>
      ColoringConfig.fromRuntimeConfig(await _apiClient.get('/runtime-config'));

  Future<String> upload(ReferenceImageDraft image) =>
      _creationRepository.uploadReference(image);

  Future<TaskItem> create({
    required String prompt,
    required String title,
    required ImageModelOption model,
    required String aspectRatio,
    required String resolution,
    required String quality,
    required int count,
    required List<String> inputKeys,
  }) async {
    if (inputKeys.isEmpty) throw const FormatException('请先选择线稿');
    final safeCount = count.clamp(1, model.maxImages);
    final data = await _apiClient.post(
      '/tasks',
      data: coloringTaskPayload(
        prompt: prompt,
        title: title,
        model: model,
        aspectRatio: aspectRatio,
        resolution: resolution,
        quality: quality,
        count: safeCount,
        inputKeys: inputKeys.take(model.maxReferenceImages).toList(),
        idempotencyKey: _uuid.v4(),
      ),
    );
    final root = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final rawTask = root['task'] is Map
        ? Map<String, dynamic>.from(root['task'] as Map)
        : root;
    final task = TaskItem.fromJson(rawTask);
    if (task.id.isEmpty) throw const FormatException('任务响应缺少 ID');
    return task;
  }
}

final coloringRepositoryProvider = Provider<ColoringRepository>(
  (ref) => ColoringRepository(
    ref.watch(apiClientProvider),
    ref.watch(creationRepositoryProvider),
  ),
);

final coloringConfigProvider = FutureProvider<ColoringConfig>(
  (ref) => ref.watch(coloringRepositoryProvider).loadConfig(),
);
