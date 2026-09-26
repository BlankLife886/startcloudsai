import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../create/create.dart';
import '../create/reference_image_service.dart';
import '../tasks/tasks.dart';

class BackgroundRemovalModel {
  const BackgroundRemovalModel({
    required this.id,
    required this.label,
    required this.pricePoints,
    required this.isDefault,
  });

  factory BackgroundRemovalModel.fromJson(Map<String, dynamic> json) =>
      BackgroundRemovalModel(
        id: (json['id'] ?? json['publicModelKey'])?.toString().trim() ?? '',
        label: (json['label'] ?? json['name'])?.toString().trim() ?? '智能去背景',
        pricePoints:
            ((json['pricePoints'] ?? json['creditCost']) as num?)?.toInt() ?? 0,
        isDefault: json['default'] == true,
      );

  final String id;
  final String label;
  final int pricePoints;
  final bool isDefault;
}

class BackgroundRemovalConfig {
  const BackgroundRemovalConfig({required this.enabled, required this.models});

  factory BackgroundRemovalConfig.fromRuntimeConfig(dynamic data) {
    final root = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final features = root['features'] is Map
        ? Map<String, dynamic>.from(root['features'] as Map)
        : const <String, dynamic>{};
    final feature = features['ai.imageTools'] is Map
        ? Map<String, dynamic>.from(features['ai.imageTools'] as Map)
        : const <String, dynamic>{};
    final config = feature['config'] is Map
        ? Map<String, dynamic>.from(feature['config'] as Map)
        : const <String, dynamic>{};
    final models = (config['backgroundRemovalModels'] as List? ?? const [])
        .whereType<Map>()
        .map(
          (item) =>
              BackgroundRemovalModel.fromJson(Map<String, dynamic>.from(item)),
        )
        .where((model) => model.id.isNotEmpty)
        .toList();
    return BackgroundRemovalConfig(
      enabled: feature['enabled'] != false && models.isNotEmpty,
      models: models,
    );
  }

  final bool enabled;
  final List<BackgroundRemovalModel> models;

  BackgroundRemovalModel? get defaultModel {
    for (final model in models) {
      if (model.isDefault) return model;
    }
    return models.firstOrNull;
  }
}

Map<String, dynamic> backgroundRemovalTaskPayload({
  required String inputKey,
  required BackgroundRemovalModel model,
  required String idempotencyKey,
}) => {
  'type': 'background_remove',
  'prompt': '移除图片背景',
  'params': {
    'publicModelKey': model.id,
    '_source': 'flutter_app',
    '_kind': 'image-tool-background-remove',
  },
  'inputKeys': [inputKey],
  'count': 1,
  'idempotencyKey': idempotencyKey,
};

class BackgroundRemovalRepository {
  const BackgroundRemovalRepository(this._apiClient, this._creationRepository);

  final ApiClient _apiClient;
  final CreationRepository _creationRepository;
  static const _uuid = Uuid();

  Future<BackgroundRemovalConfig> loadConfig() async =>
      BackgroundRemovalConfig.fromRuntimeConfig(
        await _apiClient.get('/runtime-config'),
      );

  Future<String> upload(ReferenceImageDraft image) =>
      _creationRepository.uploadReference(image);

  Future<TaskItem> create({
    required String inputKey,
    required BackgroundRemovalModel model,
  }) async {
    final data = await _apiClient.post(
      '/tasks',
      data: backgroundRemovalTaskPayload(
        inputKey: inputKey,
        model: model,
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

final backgroundRemovalRepositoryProvider =
    Provider<BackgroundRemovalRepository>(
      (ref) => BackgroundRemovalRepository(
        ref.watch(apiClientProvider),
        ref.watch(creationRepositoryProvider),
      ),
    );

final backgroundRemovalConfigProvider = FutureProvider<BackgroundRemovalConfig>(
  (ref) => ref.watch(backgroundRemovalRepositoryProvider).loadConfig(),
);
