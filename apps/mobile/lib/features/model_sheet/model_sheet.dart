import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../create/create.dart';
import '../create/reference_image_service.dart';
import '../tasks/tasks.dart';

const modelSheetViewLabels = <String, String>{
  'front': '正面',
  'side': '侧面',
  'back': '背面',
  'three-quarter': '3/4',
  'detail': '细节',
  'material': '材质',
};

class ModelSheetConfig {
  const ModelSheetConfig({required this.enabled, required this.models});

  factory ModelSheetConfig.fromRuntimeConfig(dynamic data) {
    final root = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final features = root['features'] is Map
        ? Map<String, dynamic>.from(root['features'] as Map)
        : const <String, dynamic>{};
    final feature = features['ai.ultraModelSheet'] is Map
        ? Map<String, dynamic>.from(features['ai.ultraModelSheet'] as Map)
        : const <String, dynamic>{};
    final config = feature['config'] is Map
        ? Map<String, dynamic>.from(feature['config'] as Map)
        : const <String, dynamic>{};
    final models = (config['publicModels'] as List? ?? const [])
        .whereType<Map>()
        .map(
          (item) => ImageModelOption.fromJson(Map<String, dynamic>.from(item)),
        )
        .where((model) => model.id.isNotEmpty)
        .toList();
    return ModelSheetConfig(
      enabled: feature['enabled'] != false && models.isNotEmpty,
      models: models,
    );
  }

  final bool enabled;
  final List<ImageModelOption> models;
}

class ModelSheetRequest {
  const ModelSheetRequest({
    required this.prompt,
    required this.model,
    required this.subjectType,
    required this.fidelity,
    required this.views,
    required this.background,
    required this.detail,
    required this.outputMode,
    required this.aspectRatio,
    required this.resolution,
    required this.quality,
    required this.inputKeys,
    required this.count,
    required this.batchSize,
    required this.batchId,
    this.viewId = '',
    this.viewLabel = '',
  });

  final String prompt;
  final ImageModelOption model;
  final String subjectType;
  final String fidelity;
  final List<String> views;
  final String background;
  final int detail;
  final String outputMode;
  final String aspectRatio;
  final String resolution;
  final String quality;
  final List<String> inputKeys;
  final int count;
  final int batchSize;
  final String batchId;
  final String viewId;
  final String viewLabel;
}

String modelSheetPrompt(ModelSheetRequest request) {
  final description = request.prompt.trim();
  final viewLabels = request.views
      .map((view) => modelSheetViewLabels[view] ?? view)
      .join('、');
  final subject = request.subjectType == 'object' ? '物体/产品' : '人物/角色';
  final fidelity = request.fidelity == 'optimized'
      ? '保持主体特征并进行专业生产级优化'
      : '严格忠于参考图，不改变身份、比例和造型';
  final background = switch (request.background) {
    'white' => '纯白背景',
    'transparent' => '透明背景并输出透明 PNG',
    _ => '纯浅灰背景',
  };
  final sourceRule = request.inputKeys.isEmpty
      ? '没有参考图，请完全根据文字描述创建主体，并在全部视图中保持一致。'
      : '严格以参考图为主体来源，保持身份、比例、材质与结构特征。';
  final viewRule = request.outputMode == 'separate'
      ? '本张只输出${request.viewLabel}视图，主体完整居中，不要拼接其他视角。'
      : '在同一张标准设定板中输出 $viewLabels 等视角，各视角比例一致。';
  return [
    description.isEmpty ? '制作可供建模与生产使用的超高清标准模型参考图。' : description,
    sourceRule,
    '主体类型：$subject。',
    viewRule,
    '还原策略：$fidelity。',
    '细节强度：${request.detail.clamp(40, 100)}/100。',
    '制作标准：$background，中性影棚光，无遮挡、边缘清晰、无景深、无文字水印，适合 3D 建模、雕刻和材质拆解。',
  ].join('\n');
}

Map<String, dynamic> modelSheetTaskPayload({
  required ModelSheetRequest request,
  required String idempotencyKey,
}) {
  final prompt = modelSheetPrompt(request);
  final transparent = request.background == 'transparent';
  return {
    'type': 'model_sheet',
    'prompt': prompt,
    'params': {
      'publicModelKey': request.model.id,
      'modelHint': request.model.id,
      'userPrompt': request.prompt.trim(),
      'subjectType': request.subjectType,
      'fidelity': request.fidelity,
      'views': request.views
          .map((view) => modelSheetViewLabels[view] ?? view)
          .join('、'),
      'viewIds': request.views,
      'background': request.background,
      'detail': request.detail.clamp(40, 100),
      'outputMode': request.outputMode,
      'aspectRatio': request.aspectRatio,
      'requestedAspectRatio': request.aspectRatio,
      'resolutionScale': request.resolution,
      'quality': request.quality,
      'sourceMode': request.inputKeys.isEmpty ? 'text' : 'reference',
      'source': 'ultra-model-sheet',
      'batchId': request.batchId,
      'batchSize': request.batchSize,
      if (request.viewId.isNotEmpty) 'viewId': request.viewId,
      if (request.viewLabel.isNotEmpty) 'viewLabel': request.viewLabel,
      if (transparent) ...{
        'transparentPngEnabled': true,
        'transparentBackground': true,
        'outputFormat': 'png',
      },
      '_source': 'flutter_app',
      '_kind': request.inputKeys.isEmpty
          ? 'ultra-reference-generation'
          : 'ultra-reference-edit',
    },
    'inputKeys': request.inputKeys,
    'count': request.count,
    'idempotencyKey': idempotencyKey,
  };
}

class ModelSheetRepository {
  const ModelSheetRepository(this._apiClient, this._creationRepository);

  final ApiClient _apiClient;
  final CreationRepository _creationRepository;
  static const _uuid = Uuid();

  Future<ModelSheetConfig> loadConfig() async =>
      ModelSheetConfig.fromRuntimeConfig(
        await _apiClient.get('/runtime-config'),
      );

  Future<String> upload(ReferenceImageDraft image) =>
      _creationRepository.uploadReference(image);

  Future<TaskItem> create(ModelSheetRequest request) async {
    if (request.views.isEmpty) throw const FormatException('请至少选择一个输出视角');
    if (request.prompt.trim().isEmpty && request.inputKeys.isEmpty) {
      throw const FormatException('请描述主体或添加参考图');
    }
    if (request.background == 'transparent' &&
        !request.model.supportsTransparentPng) {
      throw const FormatException('当前模型不支持透明背景');
    }
    final data = await _apiClient.post(
      '/tasks',
      data: modelSheetTaskPayload(request: request, idempotencyKey: _uuid.v4()),
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

final modelSheetRepositoryProvider = Provider<ModelSheetRepository>(
  (ref) => ModelSheetRepository(
    ref.watch(apiClientProvider),
    ref.watch(creationRepositoryProvider),
  ),
);

final modelSheetConfigProvider = FutureProvider<ModelSheetConfig>(
  (ref) => ref.watch(modelSheetRepositoryProvider).loadConfig(),
);

String newModelSheetBatchId() => const Uuid().v4();
