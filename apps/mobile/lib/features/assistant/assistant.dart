import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../../core/network/sse.dart';
import '../../core/providers.dart';
import '../../core/storage/user_storage_namespace.dart';
import '../auth/auth.dart';

enum AssistantMode {
  chat('chat'),
  agent('agent'),
  image('image');

  const AssistantMode(this.wireValue);

  final String wireValue;

  static AssistantMode fromWire(String? value) => switch (value) {
    'agent' => AssistantMode.agent,
    'image' => AssistantMode.image,
    _ => AssistantMode.chat,
  };
}

class AssistantModelOption {
  const AssistantModelOption({
    required this.id,
    required this.label,
    required this.description,
    required this.pricePoints,
    required this.standardPricePoints,
    required this.reasoningEfforts,
    required this.defaultReasoningEffort,
    required this.isDefault,
    this.reasoningPricePoints = const {},
    this.reasoningStandardPricePoints = const {},
    this.maxReferenceImages = 4,
    this.resolutions = const [],
    this.aspectRatios = const [],
    this.aspectRatiosByResolution = const {},
    this.qualities = const [],
    this.maxImages = 1,
  });

  factory AssistantModelOption.fromJson(Map<String, dynamic> json) {
    final id = json['model']?.toString().trim() ?? '';
    final efforts =
        (json['supportedReasoningEfforts'] as List?)
            ?.map((item) => item.toString().trim())
            .where((item) => item.isNotEmpty)
            .toList() ??
        const <String>[];
    final requestedDefault =
        json['defaultReasoningEffort']?.toString().trim() ?? '';
    final reasoningItems =
        (json['reasoningEfforts'] as List?)
            ?.whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList() ??
        const <Map<String, dynamic>>[];
    final reasoningPrices = <String, int>{};
    final reasoningStandardPrices = <String, int>{};
    final rawMaxReferences = json['maxReferenceImages'];
    final maxReferences = rawMaxReferences is num
        ? rawMaxReferences.toInt()
        : 0;
    for (final item in reasoningItems) {
      final effort = item['id']?.toString().trim() ?? '';
      if (effort.isEmpty) continue;
      reasoningPrices[effort] = (item['pricePoints'] as num?)?.toInt() ?? 0;
      reasoningStandardPrices[effort] =
          (item['standardPricePoints'] as num?)?.toInt() ??
          reasoningPrices[effort]!;
    }
    return AssistantModelOption(
      id: id,
      label: json['label']?.toString().trim().isNotEmpty == true
          ? json['label'].toString().trim()
          : id,
      description: json['description']?.toString().trim() ?? '',
      pricePoints: (json['pricePoints'] as num?)?.toInt() ?? 0,
      standardPricePoints:
          (json['standardPricePoints'] as num?)?.toInt() ??
          (json['pricePoints'] as num?)?.toInt() ??
          0,
      reasoningEfforts: efforts,
      defaultReasoningEffort: efforts.contains(requestedDefault)
          ? requestedDefault
          : efforts.contains('medium')
          ? 'medium'
          : efforts.firstOrNull ?? '',
      isDefault: json['default'] == true,
      reasoningPricePoints: reasoningPrices,
      reasoningStandardPricePoints: reasoningStandardPrices,
      maxReferenceImages: maxReferences > 0 ? maxReferences.clamp(1, 4) : 4,
      resolutions: _stringList(json['resolutions']),
      aspectRatios: _stringList(json['aspectRatios']),
      aspectRatiosByResolution: _stringListMap(
        json['aspectRatiosByResolution'],
      ),
      qualities: _stringList(json['qualities']),
      maxImages: ((json['maxImages'] as num?)?.toInt() ?? 1).clamp(1, 4),
    );
  }

  final String id;
  final String label;
  final String description;
  final int pricePoints;
  final int standardPricePoints;
  final List<String> reasoningEfforts;
  final String defaultReasoningEffort;
  final bool isDefault;
  final Map<String, int> reasoningPricePoints;
  final Map<String, int> reasoningStandardPricePoints;
  final int maxReferenceImages;
  final List<String> resolutions;
  final List<String> aspectRatios;
  final Map<String, List<String>> aspectRatiosByResolution;
  final List<String> qualities;
  final int maxImages;

  bool get isDiscounted => standardPricePoints > pricePoints;

  int priceFor(String effort) => reasoningPricePoints[effort] ?? pricePoints;

  int standardPriceFor(String effort) =>
      reasoningStandardPricePoints[effort] ?? standardPricePoints;

  List<String> ratiosFor(String resolution) {
    final specific = aspectRatiosByResolution[resolution];
    return specific?.isNotEmpty == true ? specific! : aspectRatios;
  }
}

List<String> _stringList(dynamic value) =>
    (value as List?)
        ?.map((item) => item.toString().trim())
        .where((item) => item.isNotEmpty)
        .toList() ??
    const [];

Map<String, List<String>> _stringListMap(dynamic value) {
  if (value is! Map) return const {};
  return {
    for (final entry in value.entries)
      if (entry.key.toString().trim().isNotEmpty)
        entry.key.toString().trim(): _stringList(entry.value),
  };
}

class AssistantConfig {
  const AssistantConfig({
    required this.models,
    required this.defaultModelId,
    this.imageModels = const [],
    this.defaultImageModelId = '',
  });

  factory AssistantConfig.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final models =
        (map['conversationModels'] as List?)
            ?.whereType<Map>()
            .map(
              (item) => AssistantModelOption.fromJson(
                Map<String, dynamic>.from(item),
              ),
            )
            .where((item) => item.id.isNotEmpty)
            .toList() ??
        const <AssistantModelOption>[];
    final configuredDefault = map['chatModel']?.toString().trim() ?? '';
    final fallback =
        models.where((item) => item.isDefault).firstOrNull ??
        models.firstOrNull;
    final imageModels =
        (map['imageModels'] as List?)
            ?.whereType<Map>()
            .map(
              (item) => AssistantModelOption.fromJson(
                Map<String, dynamic>.from(item),
              ),
            )
            .where((item) => item.id.isNotEmpty)
            .toList() ??
        const <AssistantModelOption>[];
    final requestedImageModel = map['imageModel']?.toString().trim() ?? '';
    final imageFallback =
        imageModels.where((item) => item.isDefault).firstOrNull ??
        imageModels.firstOrNull;
    return AssistantConfig(
      models: models,
      defaultModelId: models.any((item) => item.id == configuredDefault)
          ? configuredDefault
          : fallback?.id ?? '',
      imageModels: imageModels,
      defaultImageModelId:
          imageModels.any((item) => item.id == requestedImageModel)
          ? requestedImageModel
          : imageFallback?.id ?? '',
    );
  }

  final List<AssistantModelOption> models;
  final String defaultModelId;
  final List<AssistantModelOption> imageModels;
  final String defaultImageModelId;

  AssistantModelOption? model(String id) =>
      models.where((item) => item.id == id).firstOrNull;

  AssistantModelOption? imageModel(String id) =>
      imageModels.where((item) => item.id == id).firstOrNull;
}

class AssistantProposal {
  const AssistantProposal({
    required this.action,
    required this.prompt,
    required this.summary,
    required this.ratio,
    required this.resolution,
    required this.count,
    required this.modelName,
    this.modelId = '',
    this.quality = '',
  });

  factory AssistantProposal.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final summary = map['planningSummary']?.toString().trim();
    final reason = map['reason']?.toString().trim();
    return AssistantProposal(
      action: map['action']?.toString().trim() == 'edit' ? 'edit' : 'generate',
      prompt: map['prompt']?.toString().trim() ?? '',
      summary: summary?.isNotEmpty == true ? summary! : reason ?? '',
      ratio: map['ratio']?.toString().trim() ?? '',
      resolution: map['resolution']?.toString().trim() ?? '',
      count: ((map['count'] as num?)?.toInt() ?? 1).clamp(1, 4),
      modelId: map['model']?.toString().trim() ?? '',
      modelName: map['modelName']?.toString().trim().isNotEmpty == true
          ? map['modelName'].toString().trim()
          : map['model']?.toString().trim() ?? '',
      quality: map['quality']?.toString().trim() ?? '',
    );
  }

  final String action;
  final String prompt;
  final String summary;
  final String ratio;
  final String resolution;
  final int count;
  final String modelId;
  final String modelName;
  final String quality;

  bool get isUsable => prompt.isNotEmpty;

  AssistantProposal copyWith({
    String? prompt,
    String? ratio,
    String? resolution,
    int? count,
    String? modelId,
    String? modelName,
    String? quality,
  }) => AssistantProposal(
    action: action,
    prompt: prompt ?? this.prompt,
    summary: summary,
    ratio: ratio ?? this.ratio,
    resolution: resolution ?? this.resolution,
    count: count ?? this.count,
    modelId: modelId ?? this.modelId,
    modelName: modelName ?? this.modelName,
    quality: quality ?? this.quality,
  );
}

class AssistantGeneratedImage {
  const AssistantGeneratedImage({
    required this.id,
    required this.fileKey,
    required this.url,
    required this.thumbnailUrl,
    required this.revisedPrompt,
    this.originalUrl = '',
  });

  factory AssistantGeneratedImage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final original = map['dataUrl']?.toString().trim() ?? '';
    final display = map['displayUrl']?.toString().trim() ?? '';
    return AssistantGeneratedImage(
      id: map['id']?.toString().trim() ?? '',
      fileKey: map['fileKey']?.toString().trim() ?? '',
      url: display.isNotEmpty ? display : original,
      originalUrl: original,
      thumbnailUrl: map['thumbUrl']?.toString().trim().isNotEmpty == true
          ? map['thumbUrl'].toString().trim()
          : display.isNotEmpty
          ? display
          : original,
      revisedPrompt: map['revisedPrompt']?.toString().trim() ?? '',
    );
  }

  final String id;
  final String fileKey;
  final String url;
  final String originalUrl;
  final String thumbnailUrl;
  final String revisedPrompt;

  String get downloadUrl => originalUrl.isNotEmpty ? originalUrl : url;
}

class AssistantUsage {
  const AssistantUsage({
    this.inputTokens = 0,
    this.outputTokens = 0,
    this.firstTokenMs = 0,
    this.durationMs = 0,
  });

  factory AssistantUsage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return AssistantUsage(
      inputTokens:
          (map['inputTokens'] as num?)?.toInt() ??
          (map['promptTokens'] as num?)?.toInt() ??
          0,
      outputTokens:
          (map['outputTokens'] as num?)?.toInt() ??
          (map['completionTokens'] as num?)?.toInt() ??
          0,
      firstTokenMs: (map['firstTokenMs'] as num?)?.toInt() ?? 0,
      durationMs: (map['durationMs'] as num?)?.toInt() ?? 0,
    );
  }

  final int inputTokens;
  final int outputTokens;
  final int firstTokenMs;
  final int durationMs;

  bool get isEmpty =>
      inputTokens <= 0 &&
      outputTokens <= 0 &&
      firstTokenMs <= 0 &&
      durationMs <= 0;
}

class AssistantQuotedMessage {
  const AssistantQuotedMessage({
    required this.id,
    required this.kind,
    required this.content,
  });

  factory AssistantQuotedMessage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final kind = map['kind']?.toString().trim() ?? '';
    final content = map['content']?.toString().trim() ?? '';
    return AssistantQuotedMessage(
      id: map['id']?.toString().trim() ?? '',
      kind: kind.isEmpty ? '回复' : kind,
      content: content.isEmpty ? 'AI 生成内容' : content,
    );
  }

  final String id;
  final String kind;
  final String content;

  Map<String, dynamic> toJson() => {'id': id, 'kind': kind, 'content': content};
}

enum AssistantFeedback { positive, negative }

extension AssistantFeedbackValue on AssistantFeedback {
  String get wireValue => name;
}

AssistantFeedback? assistantFeedbackFromValue(dynamic value) =>
    switch (value?.toString().trim().toLowerCase()) {
      'positive' => AssistantFeedback.positive,
      'negative' => AssistantFeedback.negative,
      _ => null,
    };

class AssistantMessage {
  const AssistantMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.kind,
    required this.status,
    required this.createdAt,
    this.updatedAt,
    this.referenceImages = const [],
    this.reasoning = '',
    this.proposal,
    this.images = const [],
    this.proposalSourceMessageId = '',
    this.usage,
    this.quoted,
    this.costPoints = 0,
    this.contextInputTokens = 0,
    this.feedback,
  });

  factory AssistantMessage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final context = map['context'] is Map
        ? Map<String, dynamic>.from(map['context'] as Map)
        : const <String, dynamic>{};
    final usage = map['usage'] is Map
        ? AssistantUsage.fromJson(map['usage'])
        : null;
    final quoted = map['quoted'] is Map
        ? AssistantQuotedMessage.fromJson(map['quoted'])
        : null;
    return AssistantMessage(
      id: map['id']?.toString().trim() ?? '',
      role: map['role']?.toString().trim() ?? 'assistant',
      content: map['content']?.toString() ?? '',
      kind: map['kind']?.toString().trim() ?? 'chat',
      status: map['status']?.toString().trim() ?? 'complete',
      createdAt: DateTime.tryParse(
        map['createdAt']?.toString() ?? '',
      )?.toLocal(),
      updatedAt: DateTime.tryParse(
        map['updatedAt']?.toString() ?? '',
      )?.toLocal(),
      referenceImages:
          (map['referenceImages'] as List?)
              ?.map(AssistantReferenceImage.fromJson)
              .where((item) => item.fileKey.isNotEmpty || item.url.isNotEmpty)
              .toList() ??
          const <AssistantReferenceImage>[],
      reasoning: map['reasoning']?.toString() ?? '',
      proposal: map['proposal'] is Map
          ? AssistantProposal.fromJson(map['proposal'])
          : null,
      images:
          (map['images'] as List?)
              ?.map(AssistantGeneratedImage.fromJson)
              .where((item) => item.url.isNotEmpty)
              .toList() ??
          const [],
      proposalSourceMessageId:
          map['proposalSourceMessageId']?.toString().trim() ?? '',
      usage: usage == null || usage.isEmpty ? null : usage,
      quoted: quoted?.content.isEmpty == true ? null : quoted,
      costPoints:
          (map['costPoints'] as num?)?.toInt() ??
          (map['costCents'] as num?)?.toInt() ??
          0,
      contextInputTokens:
          (context['estimatedInputTokens'] as num?)?.toInt() ?? 0,
      feedback: assistantFeedbackFromValue(map['feedback']),
    );
  }

  final String id;
  final String role;
  final String content;
  final String kind;
  final String status;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final List<AssistantReferenceImage> referenceImages;
  final String reasoning;
  final AssistantProposal? proposal;
  final List<AssistantGeneratedImage> images;
  final String proposalSourceMessageId;
  final AssistantUsage? usage;
  final AssistantQuotedMessage? quoted;
  final int costPoints;
  final int contextInputTokens;
  final AssistantFeedback? feedback;

  bool get isUser => role == 'user';
  bool get isPending => status == 'queued' || status == 'running';
  bool get canRetry => !isUser && (status == 'failed' || status == 'stopped');
  bool get canQuote =>
      !isUser && !isPending && (content.trim().isNotEmpty || images.isNotEmpty);
  bool get canUseAsCreationPrompt =>
      !isUser &&
      kind != 'image' &&
      kind != 'proposal' &&
      status == 'complete' &&
      content.trim().isNotEmpty;

  AssistantMessage copyWith({
    String? content,
    String? kind,
    String? status,
    DateTime? updatedAt,
    List<AssistantReferenceImage>? referenceImages,
    String? reasoning,
    AssistantProposal? proposal,
    List<AssistantGeneratedImage>? images,
    String? proposalSourceMessageId,
    AssistantUsage? usage,
    AssistantQuotedMessage? quoted,
    int? costPoints,
    int? contextInputTokens,
    AssistantFeedback? feedback,
    bool clearFeedback = false,
  }) => AssistantMessage(
    id: id,
    role: role,
    content: content ?? this.content,
    kind: kind ?? this.kind,
    status: status ?? this.status,
    createdAt: createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
    referenceImages: referenceImages ?? this.referenceImages,
    reasoning: reasoning ?? this.reasoning,
    proposal: proposal ?? this.proposal,
    images: images ?? this.images,
    proposalSourceMessageId:
        proposalSourceMessageId ?? this.proposalSourceMessageId,
    usage: usage ?? this.usage,
    quoted: quoted ?? this.quoted,
    costPoints: costPoints ?? this.costPoints,
    contextInputTokens: contextInputTokens ?? this.contextInputTokens,
    feedback: clearFeedback ? null : feedback ?? this.feedback,
  );
}

String assistantReplyCreationLocation(String content) => Uri(
  path: '/create',
  queryParameters: {'prompt': content.trim()},
).toString();

AssistantMessage? assistantRetrySource(
  List<AssistantMessage> messages,
  int assistantIndex,
) {
  if (assistantIndex < 0 || assistantIndex >= messages.length) return null;
  final target = messages[assistantIndex];
  if (target.isUser || target.isPending) return null;
  if (target.status != 'failed' &&
      target.status != 'stopped' &&
      target.status != 'complete') {
    return null;
  }
  for (var index = assistantIndex - 1; index >= 0; index -= 1) {
    final message = messages[index];
    if (message.isUser && message.content.trim().isNotEmpty) return message;
  }
  return null;
}

AssistantQuotedMessage assistantQuoteFrom(AssistantMessage message) {
  final content = message.content.trim();
  final revised = message.images.firstOrNull?.revisedPrompt.trim() ?? '';
  return AssistantQuotedMessage(
    id: message.id,
    kind: message.images.isNotEmpty ? '图片' : '回复',
    content: content.isNotEmpty
        ? content
        : (revised.isNotEmpty ? revised : 'AI 生成内容'),
  );
}

int estimateAssistantTokens(String text) {
  var ascii = 0;
  var other = 0;
  for (final unit in text.runes) {
    if (unit <= 0x7f) {
      ascii += 1;
    } else {
      other += 1;
    }
  }
  final tokens = ascii ~/ 4 + other;
  return text.trim().isEmpty ? 0 : (tokens < 1 ? 1 : tokens);
}

String formatAssistantTokens(int tokens) {
  final value = tokens < 0 ? 0 : tokens;
  if (value < 1000) return '$value';
  if (value < 1000000) {
    final scaled = value / 1000;
    final text = value >= 10000
        ? scaled.toStringAsFixed(0)
        : scaled.toStringAsFixed(1);
    return '${text.replaceFirst(RegExp(r'\.0$'), '')}K';
  }
  return '${(value / 1000000).toStringAsFixed(1)}M';
}

String formatAssistantDurationMs(int milliseconds) {
  if (milliseconds <= 0) return '';
  if (milliseconds < 100) return '${milliseconds}ms';
  if (milliseconds < 60000) {
    final seconds = milliseconds / 1000;
    return '${seconds.toStringAsFixed(1).replaceFirst(RegExp(r'\.0$'), '')}s';
  }
  final minutes = milliseconds ~/ 60000;
  final seconds = ((milliseconds % 60000) / 1000).round();
  return '$minutes分${seconds.toString().padLeft(2, '0')}秒';
}

AssistantUsage? resolvedAssistantUsage(AssistantMessage message) {
  if (message.isUser || message.isPending) return null;
  final raw = message.usage;
  var durationMs = raw?.durationMs ?? 0;
  if (durationMs <= 0 &&
      message.createdAt != null &&
      message.updatedAt != null &&
      message.updatedAt!.isAfter(message.createdAt!)) {
    durationMs = message.updatedAt!
        .difference(message.createdAt!)
        .inMilliseconds;
  }
  final firstTokenMs = raw?.firstTokenMs ?? 0;
  final isImage = message.kind == 'image' || message.images.isNotEmpty;
  if (isImage) {
    return durationMs > 0 ? AssistantUsage(durationMs: durationMs) : null;
  }
  var inputTokens = raw?.inputTokens ?? 0;
  if (inputTokens <= 0) {
    inputTokens = message.contextInputTokens;
  }
  var outputTokens = raw?.outputTokens ?? 0;
  if (outputTokens <= 0) {
    outputTokens = estimateAssistantTokens(message.content);
  }
  if (inputTokens <= 0 &&
      outputTokens <= 0 &&
      firstTokenMs <= 0 &&
      durationMs <= 0) {
    return null;
  }
  return AssistantUsage(
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    firstTokenMs: firstTokenMs,
    durationMs: durationMs,
  );
}

String assistantReplyMetricsLabel(
  AssistantMessage message, {
  int fallbackCostPoints = 0,
}) {
  final usage = resolvedAssistantUsage(message);
  final parts = <String>[];
  if (usage != null && usage.outputTokens > 0) {
    parts.add('消耗 ${formatAssistantTokens(usage.outputTokens)}');
  }
  if (usage != null && usage.inputTokens > 0) {
    parts.add('输入 ${formatAssistantTokens(usage.inputTokens)}');
  }
  if (usage != null && usage.firstTokenMs > 0) {
    parts.add('首字 ${formatAssistantDurationMs(usage.firstTokenMs)}');
  }
  final cost = message.costPoints > 0 ? message.costPoints : fallbackCostPoints;
  if (cost > 0) parts.add('$cost 积分');
  if (usage != null && usage.durationMs > 0) {
    parts.add(formatAssistantDurationMs(usage.durationMs));
  }
  return parts.join(' · ');
}

List<AssistantConversation> filterAssistantConversations(
  List<AssistantConversation> conversations,
  String query,
) {
  final terms = query
      .trim()
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((item) => item.isNotEmpty)
      .toList();
  if (terms.isEmpty) return List<AssistantConversation>.of(conversations);
  return conversations.where((conversation) {
    final searchable = [
      conversation.title,
      ...conversation.messages.map((message) => message.content),
    ].join('\n').toLowerCase();
    return terms.every(searchable.contains);
  }).toList();
}

List<AssistantConversation> sortAssistantConversations(
  List<AssistantConversation> conversations,
  Set<String> pinnedIds,
) {
  if (pinnedIds.isEmpty) return List<AssistantConversation>.of(conversations);
  final pinned = <AssistantConversation>[];
  final rest = <AssistantConversation>[];
  for (final conversation in conversations) {
    (pinnedIds.contains(conversation.id) ? pinned : rest).add(conversation);
  }
  return [...pinned, ...rest];
}

class AssistantConversationGroup {
  const AssistantConversationGroup({required this.label, required this.items});

  final String label;
  final List<AssistantConversation> items;
}

String assistantConversationGroupLabel(DateTime? updatedAt, {DateTime? now}) {
  if (updatedAt == null) return '较早';
  final current = now ?? DateTime.now();
  final today = DateTime(current.year, current.month, current.day);
  final day = DateTime(updatedAt.year, updatedAt.month, updatedAt.day);
  if (!day.isBefore(today)) return '今天';
  if (!day.isBefore(today.subtract(const Duration(days: 1)))) return '昨天';
  return '较早';
}

List<AssistantConversationGroup> groupAssistantConversations(
  List<AssistantConversation> conversations,
  Set<String> pinnedIds, {
  DateTime? now,
}) {
  final pinned = <AssistantConversation>[];
  final today = <AssistantConversation>[];
  final yesterday = <AssistantConversation>[];
  final earlier = <AssistantConversation>[];
  for (final conversation in conversations) {
    if (pinnedIds.contains(conversation.id)) {
      pinned.add(conversation);
      continue;
    }
    switch (assistantConversationGroupLabel(conversation.updatedAt, now: now)) {
      case '今天':
        today.add(conversation);
      case '昨天':
        yesterday.add(conversation);
      default:
        earlier.add(conversation);
    }
  }
  return [
    if (pinned.isNotEmpty)
      AssistantConversationGroup(label: '已置顶', items: pinned),
    if (today.isNotEmpty) AssistantConversationGroup(label: '今天', items: today),
    if (yesterday.isNotEmpty)
      AssistantConversationGroup(label: '昨天', items: yesterday),
    if (earlier.isNotEmpty)
      AssistantConversationGroup(label: '较早', items: earlier),
  ];
}

const assistantHistoryFilterAll = '全部';

const assistantHistoryFilters = [
  assistantHistoryFilterAll,
  '已置顶',
  '今天',
  '昨天',
  '较早',
];

List<AssistantConversationGroup> filterAssistantConversationGroups(
  List<AssistantConversationGroup> groups,
  String filter,
) {
  if (filter.isEmpty || filter == assistantHistoryFilterAll) {
    return List<AssistantConversationGroup>.of(groups);
  }
  return [
    for (final group in groups)
      if (group.label == filter) group,
  ];
}

String assistantConversationRelativeTime(DateTime? updatedAt, {DateTime? now}) {
  if (updatedAt == null) return '';
  final current = now ?? DateTime.now();
  var minutes = current.difference(updatedAt).inMinutes;
  if (minutes < 0) minutes = 0;
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return '$minutes 分钟前';
  final hours = minutes ~/ 60;
  if (hours < 24) return '$hours 小时前';
  final days = hours ~/ 24;
  if (days < 7) return '$days 天前';
  return '${updatedAt.month}月${updatedAt.day}日';
}

String assistantConversationThumbnailUrl(AssistantConversation conversation) {
  for (final message in conversation.messages.reversed) {
    for (final image in message.images.reversed) {
      final url = image.thumbnailUrl.isNotEmpty
          ? image.thumbnailUrl
          : image.url;
      if (url.isNotEmpty) return url;
    }
    for (final image in message.referenceImages.reversed) {
      if (image.url.isNotEmpty) return image.url;
    }
  }
  return '';
}

String assistantConversationMark(String title) {
  final match = RegExp(r'[\p{L}\p{N}]', unicode: true).firstMatch(title.trim());
  return (match?.group(0) ?? '新').toUpperCase();
}

const _legacyPinnedConversationIdsKey = 'assistant_pinned_conversation_ids';

String assistantPinnedConversationIdsKey(String namespace) =>
    'assistant_pinned_conversation_ids.${namespace.trim().toLowerCase()}';

Future<Set<String>> _loadPinnedConversationIds(String namespace) async {
  try {
    final preferences = await SharedPreferences.getInstance();
    final key = assistantPinnedConversationIdsKey(namespace);
    var stored = preferences.getStringList(key);
    if (stored == null) {
      stored = preferences.getStringList(_legacyPinnedConversationIdsKey);
      if (stored != null) {
        await preferences.setStringList(key, stored);
        await preferences.remove(_legacyPinnedConversationIdsKey);
      }
    }
    return (stored ?? const <String>[])
        .where((id) => id.trim().isNotEmpty)
        .toSet();
  } catch (_) {
    return {};
  }
}

Future<void> _savePinnedConversationIds(
  String namespace,
  Set<String> ids,
) async {
  try {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setStringList(
      assistantPinnedConversationIdsKey(namespace),
      ids.toList(),
    );
    await preferences.remove(_legacyPinnedConversationIdsKey);
  } catch (_) {}
}

class AssistantReferenceImage {
  const AssistantReferenceImage({
    required this.name,
    required this.fileKey,
    required this.url,
    this.id = '',
  });

  factory AssistantReferenceImage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return AssistantReferenceImage(
      id: map['id']?.toString().trim() ?? '',
      name: map['name']?.toString().trim().isNotEmpty == true
          ? map['name'].toString().trim()
          : '参考图',
      fileKey: map['fileKey']?.toString().trim() ?? '',
      url: map['thumbnailUrl']?.toString().trim().isNotEmpty == true
          ? map['thumbnailUrl'].toString().trim()
          : map['dataUrl']?.toString().trim() ?? '',
    );
  }

  final String id;
  final String name;
  final String fileKey;
  final String url;

  Map<String, dynamic> toJson() => {
    if (id.isNotEmpty) 'id': id,
    'name': name,
    if (fileKey.isNotEmpty) 'fileKey': fileKey,
    if (url.isNotEmpty) 'thumbnailUrl': url,
  };
}

class AssistantConversation {
  const AssistantConversation({
    required this.id,
    required this.title,
    required this.messages,
    required this.updatedAt,
  });

  factory AssistantConversation.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return AssistantConversation(
      id: map['id']?.toString().trim() ?? '',
      title: map['title']?.toString().trim().isNotEmpty == true
          ? map['title'].toString().trim()
          : '新对话',
      messages:
          (map['messages'] as List?)
              ?.map(AssistantMessage.fromJson)
              .where((item) => item.id.isNotEmpty)
              .toList() ??
          const <AssistantMessage>[],
      updatedAt: DateTime.tryParse(
        map['updatedAt']?.toString() ?? '',
      )?.toLocal(),
    );
  }

  final String id;
  final String title;
  final List<AssistantMessage> messages;
  final DateTime? updatedAt;

  AssistantConversation copyWith({
    String? title,
    List<AssistantMessage>? messages,
    DateTime? updatedAt,
  }) => AssistantConversation(
    id: id,
    title: title ?? this.title,
    messages: messages ?? this.messages,
    updatedAt: updatedAt ?? this.updatedAt,
  );
}

class AssistantRun {
  const AssistantRun({
    required this.id,
    required this.conversationId,
    required this.status,
    required this.stage,
    required this.errorMessage,
    required this.costPoints,
    this.assistantMessageId = '',
    this.mode = 'chat',
  });

  factory AssistantRun.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return AssistantRun(
      id: map['id']?.toString().trim() ?? '',
      conversationId: map['conversationId']?.toString().trim() ?? '',
      status: map['status']?.toString().trim() ?? 'queued',
      stage: map['stage']?.toString().trim() ?? '',
      errorMessage: map['errorMessage']?.toString().trim() ?? '',
      costPoints: (map['costCents'] as num?)?.toInt() ?? 0,
      assistantMessageId: map['assistantMessageId']?.toString().trim() ?? '',
      mode: map['mode']?.toString().trim() ?? 'chat',
    );
  }

  final String id;
  final String conversationId;
  final String status;
  final String stage;
  final String errorMessage;
  final int costPoints;
  final String assistantMessageId;
  final String mode;

  bool get isTerminal =>
      status == 'succeeded' || status == 'failed' || status == 'canceled';

  AssistantRun copyWith({String? status, String? stage}) => AssistantRun(
    id: id,
    conversationId: conversationId,
    status: status ?? this.status,
    stage: stage ?? this.stage,
    errorMessage: errorMessage,
    costPoints: costPoints,
    assistantMessageId: assistantMessageId,
    mode: mode,
  );
}

class AssistantStreamEvent {
  const AssistantStreamEvent({
    required this.content,
    required this.reasoning,
    required this.kind,
    required this.stage,
    required this.done,
    required this.status,
    this.image,
    this.usage,
    this.costPoints = 0,
  });

  factory AssistantStreamEvent.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final usage = map['usage'] is Map
        ? AssistantUsage.fromJson(map['usage'])
        : null;
    return AssistantStreamEvent(
      content: map['content']?.toString() ?? '',
      reasoning: map['reasoning']?.toString() ?? '',
      kind: map['kind']?.toString().trim() ?? '',
      stage: map['stage']?.toString().trim() ?? '',
      done: map['done'] == true,
      status: map['status']?.toString().trim() ?? '',
      image: map['image'] is Map
          ? AssistantGeneratedImage.fromJson(map['image'])
          : null,
      usage: usage == null || usage.isEmpty ? null : usage,
      costPoints:
          (map['costCents'] as num?)?.toInt() ??
          (map['costPoints'] as num?)?.toInt() ??
          0,
    );
  }

  final String content;
  final String reasoning;
  final String kind;
  final String stage;
  final bool done;
  final String status;
  final AssistantGeneratedImage? image;
  final AssistantUsage? usage;
  final int costPoints;

  bool get hasUpdate =>
      content.isNotEmpty ||
      reasoning.isNotEmpty ||
      kind.isNotEmpty ||
      stage.isNotEmpty ||
      image != null ||
      done;
}

class AssistantRunSnapshot {
  const AssistantRunSnapshot({
    required this.run,
    required this.assistantMessage,
    this.userMessage,
  });

  factory AssistantRunSnapshot.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return AssistantRunSnapshot(
      run: AssistantRun.fromJson(map['run']),
      assistantMessage: AssistantMessage.fromJson(map['assistantMessage']),
      userMessage: map['userMessage'] is Map
          ? AssistantMessage.fromJson(map['userMessage'])
          : null,
    );
  }

  final AssistantRun run;
  final AssistantMessage assistantMessage;
  final AssistantMessage? userMessage;
}

class CreateAssistantRunInput {
  const CreateAssistantRunInput({
    required this.conversationId,
    required this.prompt,
    required this.modelId,
    required this.reasoningEffort,
    required this.idempotencyKey,
    this.mode = AssistantMode.chat,
    this.referenceImages = const [],
    this.ratio = '',
    this.resolution = '',
    this.count = 1,
    this.quality = '',
    this.userMessageContent = '',
    this.proposalSourceMessageId = '',
    this.quoted,
  });

  final String conversationId;
  final String prompt;
  final String modelId;
  final String reasoningEffort;
  final String idempotencyKey;
  final AssistantMode mode;
  final List<AssistantReferenceImage> referenceImages;
  final String ratio;
  final String resolution;
  final int count;
  final String quality;
  final String userMessageContent;
  final String proposalSourceMessageId;
  final AssistantQuotedMessage? quoted;

  Map<String, dynamic> toJson() => {
    'conversationId': conversationId,
    'idempotencyKey': idempotencyKey,
    'prompt': prompt,
    'userMessageContent': userMessageContent.isEmpty
        ? prompt
        : userMessageContent,
    'mode': mode.wireValue,
    'model': modelId,
    'workspace': 'assistant',
    'referenceImages': referenceImages.map((item) => item.toJson()).toList(),
    if (mode == AssistantMode.image) ...{
      'ratio': ratio,
      'resolution': resolution,
      'count': count,
      'quality': quality,
    },
    if (reasoningEffort.isNotEmpty) 'reasoningEffort': reasoningEffort,
    if (proposalSourceMessageId.isNotEmpty)
      'proposalSourceMessageId': proposalSourceMessageId,
    if (quoted != null) 'quoted': quoted!.toJson(),
  };
}

abstract interface class AssistantRepository {
  Future<AssistantConfig> config();
  Future<List<AssistantConversation>> conversations();
  Future<List<AssistantRun>> activeRuns();
  Future<AssistantConversation> createConversation();
  Future<AssistantConversation> renameConversation(String id, String title);
  Future<void> deleteConversation(String id, {bool cancelActive = false});
  Future<void> deleteTurn(String userMessageId);
  Future<bool> deleteGeneratedImage(String messageId, String imageId);
  Future<AssistantMessage> setMessageFeedback(
    String messageId,
    AssistantFeedback? feedback,
  );
  Future<AssistantRunSnapshot> createRun(CreateAssistantRunInput input);
  Future<AssistantRunSnapshot> getRun(String id);
  Future<AssistantRun> cancelRun(String id);
  Stream<AssistantStreamEvent> streamRun(String id);
}

class ApiAssistantRepository implements AssistantRepository {
  const ApiAssistantRepository(this._apiClient);

  final ApiClient _apiClient;

  @override
  Future<AssistantConfig> config() async =>
      AssistantConfig.fromJson(await _apiClient.get('/assistant/config'));

  @override
  Future<List<AssistantConversation>> conversations() async {
    final data = await _apiClient.get(
      '/assistant/conversations',
      queryParameters: const {'workspace': 'assistant'},
    );
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return (map['conversations'] as List?)
            ?.map(AssistantConversation.fromJson)
            .where((item) => item.id.isNotEmpty)
            .toList() ??
        const [];
  }

  @override
  Future<List<AssistantRun>> activeRuns() async {
    final data = await _apiClient.get(
      '/assistant/runs',
      queryParameters: const {'workspace': 'assistant'},
    );
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return (map['runs'] as List?)
            ?.map(AssistantRun.fromJson)
            .where(
              (item) => item.id.isNotEmpty && item.conversationId.isNotEmpty,
            )
            .toList() ??
        const [];
  }

  @override
  Future<AssistantConversation> createConversation() async =>
      AssistantConversation.fromJson(
        await _apiClient.post(
          '/assistant/conversations',
          data: const {'title': '新对话', 'workspace': 'assistant'},
        ),
      );

  @override
  Future<AssistantConversation> renameConversation(
    String id,
    String title,
  ) async => AssistantConversation.fromJson(
    await _apiClient.patch(
      '/assistant/conversations/${Uri.encodeComponent(id)}',
      data: {'title': title.trim()},
    ),
  );

  @override
  Future<void> deleteConversation(String id, {bool cancelActive = false}) =>
      _apiClient.delete(
        '/assistant/conversations/${Uri.encodeComponent(id)}',
        queryParameters: {if (cancelActive) 'cancelActive': true},
      );

  @override
  Future<void> deleteTurn(String userMessageId) => _apiClient.delete(
    '/assistant/messages/${Uri.encodeComponent(userMessageId)}',
    queryParameters: const {'scope': 'turn'},
  );

  @override
  Future<bool> deleteGeneratedImage(String messageId, String imageId) async {
    final data = await _apiClient.delete(
      '/assistant/messages/${Uri.encodeComponent(messageId)}/images/${Uri.encodeComponent(imageId)}',
    );
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return map['messageDeleted'] == true;
  }

  @override
  Future<AssistantMessage> setMessageFeedback(
    String messageId,
    AssistantFeedback? feedback,
  ) async => AssistantMessage.fromJson(
    await _apiClient.put(
      '/assistant/messages/${Uri.encodeComponent(messageId)}/feedback',
      data: {'rating': feedback?.wireValue ?? ''},
    ),
  );

  @override
  Future<AssistantRunSnapshot> createRun(CreateAssistantRunInput input) async =>
      AssistantRunSnapshot.fromJson(
        await _apiClient.post('/assistant/runs', data: input.toJson()),
      );

  @override
  Future<AssistantRunSnapshot> getRun(String id) async =>
      AssistantRunSnapshot.fromJson(
        await _apiClient.get('/assistant/runs/${Uri.encodeComponent(id)}'),
      );

  @override
  Future<AssistantRun> cancelRun(String id) async {
    final data = await _apiClient.patch(
      '/assistant/runs/${Uri.encodeComponent(id)}',
      data: const {'status': 'canceled'},
    );
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return AssistantRun.fromJson(map['run']);
  }

  @override
  Stream<AssistantStreamEvent> streamRun(String id) async* {
    final cancelToken = CancelToken();
    try {
      final body = await _apiClient.openEventStream(
        '/assistant/runs/${Uri.encodeComponent(id)}/events',
        cancelToken: cancelToken,
      );
      await for (final event in SseDecoder.decode(body.stream)) {
        if (event.event != 'message' || event.data.trim().isEmpty) continue;
        try {
          final update = AssistantStreamEvent.fromJson(jsonDecode(event.data));
          if (update.hasUpdate) yield update;
        } catch (_) {
          // Ignore one malformed frame without tearing down the healthy stream.
        }
      }
    } finally {
      if (!cancelToken.isCancelled) cancelToken.cancel();
    }
  }
}

class AssistantWorkspaceState {
  const AssistantWorkspaceState({
    required this.config,
    required this.conversations,
    required this.selectedConversationId,
    required this.selectedModelId,
    required this.reasoningEffort,
    required this.activeRuns,
    this.selectedMode = AssistantMode.chat,
    this.selectedImageModelId = '',
    this.imageResolution = '',
    this.imageRatio = '',
    this.imageQuality = '',
    this.imageCount = 1,
    this.liveRunIds = const {},
    this.isSending = false,
    this.syncError,
    this.pinnedIds = const {},
  });

  final AssistantConfig config;
  final List<AssistantConversation> conversations;
  final String? selectedConversationId;
  final String selectedModelId;
  final String reasoningEffort;
  final Map<String, AssistantRun> activeRuns;
  final AssistantMode selectedMode;
  final String selectedImageModelId;
  final String imageResolution;
  final String imageRatio;
  final String imageQuality;
  final int imageCount;
  final Set<String> liveRunIds;
  final bool isSending;
  final String? syncError;
  final Set<String> pinnedIds;

  AssistantConversation? get selectedConversation => conversations
      .where((item) => item.id == selectedConversationId)
      .firstOrNull;

  AssistantModelOption? get selectedModel => selectedMode == AssistantMode.image
      ? config.imageModel(selectedImageModelId)
      : config.model(selectedModelId);

  List<AssistantModelOption> get availableModels =>
      selectedMode == AssistantMode.image ? config.imageModels : config.models;

  AssistantRun? get selectedRun => selectedConversationId == null
      ? null
      : activeRuns[selectedConversationId];

  bool get selectedRunIsLive =>
      selectedRun != null && liveRunIds.contains(selectedRun!.id);

  bool get canSend =>
      !isSending && selectedRun == null && selectedModel != null;

  bool get canStartNewConversation {
    final selected = selectedConversation;
    return selected == null || selected.messages.isNotEmpty;
  }

  AssistantConversation? get unusedConversation =>
      conversations.where((item) => item.messages.isEmpty).firstOrNull;

  AssistantWorkspaceState copyWith({
    List<AssistantConversation>? conversations,
    String? selectedConversationId,
    bool clearSelectedConversation = false,
    String? selectedModelId,
    String? reasoningEffort,
    Map<String, AssistantRun>? activeRuns,
    AssistantMode? selectedMode,
    String? selectedImageModelId,
    String? imageResolution,
    String? imageRatio,
    String? imageQuality,
    int? imageCount,
    Set<String>? liveRunIds,
    bool? isSending,
    String? syncError,
    bool clearSyncError = false,
    Set<String>? pinnedIds,
  }) => AssistantWorkspaceState(
    config: config,
    conversations: conversations ?? this.conversations,
    selectedConversationId: clearSelectedConversation
        ? null
        : selectedConversationId ?? this.selectedConversationId,
    selectedModelId: selectedModelId ?? this.selectedModelId,
    reasoningEffort: reasoningEffort ?? this.reasoningEffort,
    activeRuns: activeRuns ?? this.activeRuns,
    selectedMode: selectedMode ?? this.selectedMode,
    selectedImageModelId: selectedImageModelId ?? this.selectedImageModelId,
    imageResolution: imageResolution ?? this.imageResolution,
    imageRatio: imageRatio ?? this.imageRatio,
    imageQuality: imageQuality ?? this.imageQuality,
    imageCount: imageCount ?? this.imageCount,
    liveRunIds: liveRunIds ?? this.liveRunIds,
    isSending: isSending ?? this.isSending,
    syncError: clearSyncError ? null : syncError ?? this.syncError,
    pinnedIds: pinnedIds ?? this.pinnedIds,
  );
}

class AssistantWorkspaceController
    extends AsyncNotifier<AssistantWorkspaceState> {
  var _disposed = false;
  final Map<String, int> _pollGenerations = {};
  final Map<String, int> _streamGenerations = {};
  final Map<String, StreamSubscription<AssistantStreamEvent>>
  _streamSubscriptions = {};

  AssistantRepository get _repository => ref.read(assistantRepositoryProvider);

  String get _storageNamespace => userStorageNamespace(
    environment: ref.read(appEnvironmentProvider).name.name,
    userId: ref.read(sessionControllerProvider).valueOrNull?.user?.id,
  );

  @override
  Future<AssistantWorkspaceState> build() async {
    ref.onDispose(() {
      _disposed = true;
      for (final subscription in _streamSubscriptions.values) {
        unawaited(subscription.cancel());
      }
      _streamSubscriptions.clear();
    });
    final values = await Future.wait([
      _repository.config(),
      _repository.conversations(),
      _repository.activeRuns(),
    ]);
    final config = values[0] as AssistantConfig;
    final conversations = values[1] as List<AssistantConversation>;
    final runs = values[2] as List<AssistantRun>;
    final activeRuns = {for (final run in runs) run.conversationId: run};
    final selectedId =
        runs.firstOrNull?.conversationId ?? conversations.firstOrNull?.id;
    final modelId = config.defaultModelId;
    final effort = config.model(modelId)?.defaultReasoningEffort ?? '';
    final imageModelId = config.defaultImageModelId;
    final imageModel = config.imageModel(imageModelId);
    final imageResolution = imageModel?.resolutions.firstOrNull ?? '';
    final imageRatios = imageModel?.ratiosFor(imageResolution) ?? const [];
    final imageRatio = imageRatios.contains('auto')
        ? 'auto'
        : imageRatios.firstOrNull ?? '';
    final imageQuality = imageModel?.qualities.contains('high') == true
        ? 'high'
        : imageModel?.qualities.firstOrNull ?? 'high';
    final selectedMode = AssistantMode.fromWire(runs.firstOrNull?.mode);
    final pinnedIds = (await _loadPinnedConversationIds(
      _storageNamespace,
    )).intersection({for (final item in conversations) item.id});
    for (final run in runs) {
      unawaited(_pollRun(run.id));
    }
    Future<void>.microtask(() {
      if (_disposed) return;
      for (final run in runs) {
        _startStream(run.id);
      }
    });
    return AssistantWorkspaceState(
      config: config,
      conversations: conversations,
      selectedConversationId: selectedId,
      selectedModelId: modelId,
      reasoningEffort: effort,
      activeRuns: activeRuns,
      selectedMode: selectedMode,
      selectedImageModelId: imageModelId,
      imageResolution: imageResolution,
      imageRatio: imageRatio,
      imageQuality: imageQuality,
      imageCount: imageModel == null ? 1 : 2.clamp(1, imageModel.maxImages),
      pinnedIds: pinnedIds,
    );
  }

  void selectConversation(String id) {
    final current = state.asData?.value;
    if (current == null ||
        !current.conversations.any((item) => item.id == id)) {
      return;
    }
    state = AsyncData(current.copyWith(selectedConversationId: id));
  }

  void selectModel(String id) {
    final current = state.asData?.value;
    final model = current?.selectedMode == AssistantMode.image
        ? current?.config.imageModel(id)
        : current?.config.model(id);
    if (current == null || model == null || current.selectedRun != null) return;
    if (current.selectedMode == AssistantMode.image) {
      final resolution = model.resolutions.firstOrNull ?? '';
      final ratios = model.ratiosFor(resolution);
      state = AsyncData(
        current.copyWith(
          selectedImageModelId: id,
          imageResolution: resolution,
          imageRatio: ratios.contains('auto')
              ? 'auto'
              : ratios.firstOrNull ?? '',
          imageQuality: model.qualities.contains('high')
              ? 'high'
              : model.qualities.firstOrNull ?? 'high',
          imageCount: current.imageCount.clamp(1, model.maxImages),
        ),
      );
      return;
    }
    state = AsyncData(
      current.copyWith(
        selectedModelId: id,
        reasoningEffort: model.defaultReasoningEffort,
      ),
    );
  }

  void selectReasoningEffort(String effort) {
    final current = state.asData?.value;
    final model = current?.selectedModel;
    if (current == null || model == null || current.selectedRun != null) return;
    if (!model.reasoningEfforts.contains(effort)) return;
    state = AsyncData(current.copyWith(reasoningEffort: effort));
  }

  void selectMode(AssistantMode mode) {
    final current = state.asData?.value;
    if (current == null || current.selectedRun != null) return;
    state = AsyncData(current.copyWith(selectedMode: mode));
  }

  void selectImageResolution(String resolution) {
    final current = state.asData?.value;
    final model = current?.selectedModel;
    if (current == null ||
        model == null ||
        current.selectedMode != AssistantMode.image ||
        !model.resolutions.contains(resolution) ||
        current.selectedRun != null) {
      return;
    }
    final ratios = model.ratiosFor(resolution);
    final ratio = ratios.contains(current.imageRatio)
        ? current.imageRatio
        : ratios.contains('auto')
        ? 'auto'
        : ratios.firstOrNull ?? '';
    state = AsyncData(
      current.copyWith(imageResolution: resolution, imageRatio: ratio),
    );
  }

  void selectImageRatio(String ratio) {
    final current = state.asData?.value;
    final model = current?.selectedModel;
    if (current == null ||
        model == null ||
        current.selectedMode != AssistantMode.image ||
        !model.ratiosFor(current.imageResolution).contains(ratio) ||
        current.selectedRun != null) {
      return;
    }
    state = AsyncData(current.copyWith(imageRatio: ratio));
  }

  void selectImageQuality(String quality) {
    final current = state.asData?.value;
    final model = current?.selectedModel;
    if (current == null ||
        model == null ||
        current.selectedMode != AssistantMode.image ||
        !model.qualities.contains(quality) ||
        current.selectedRun != null) {
      return;
    }
    state = AsyncData(current.copyWith(imageQuality: quality));
  }

  void selectImageCount(int count) {
    final current = state.asData?.value;
    final model = current?.selectedModel;
    if (current == null ||
        model == null ||
        current.selectedMode != AssistantMode.image ||
        current.selectedRun != null) {
      return;
    }
    state = AsyncData(
      current.copyWith(imageCount: count.clamp(1, model.maxImages)),
    );
  }

  Future<void> newConversation() async {
    final current = state.asData?.value;
    if (current == null) return;
    if (!current.canStartNewConversation) return;
    final unused = current.unusedConversation;
    if (unused != null) {
      state = AsyncData(current.copyWith(selectedConversationId: unused.id));
      return;
    }
    final created = await _repository.createConversation();
    if (created.id.isEmpty) {
      throw const ApiException(code: 'invalid_response', message: '新建对话失败');
    }
    final latest = state.asData?.value;
    if (latest == null) return;
    state = AsyncData(
      latest.copyWith(
        conversations: [
          created,
          ...latest.conversations.where((item) => item.id != created.id),
        ],
        selectedConversationId: created.id,
      ),
    );
  }

  Future<void> renameConversation(String id, String title) async {
    final nextTitle = title.trim();
    final current = state.asData?.value;
    if (current == null || nextTitle.isEmpty) return;
    final existing = current.conversations
        .where((item) => item.id == id)
        .firstOrNull;
    if (existing == null || existing.title == nextTitle) return;
    final updated = await _repository.renameConversation(id, nextTitle);
    if (updated.id.isEmpty) {
      throw const ApiException(code: 'invalid_response', message: '重命名失败');
    }
    final latest = state.asData?.value;
    if (latest == null ||
        !latest.conversations.any((item) => item.id == updated.id)) {
      return;
    }
    state = AsyncData(
      latest.copyWith(
        conversations: latest.conversations
            .map((item) => item.id == updated.id ? updated : item)
            .toList(),
      ),
    );
  }

  Future<void> deleteConversation(String id) async {
    final current = state.asData?.value;
    if (current == null) return;
    final active = current.activeRuns[id];
    await _repository.deleteConversation(id, cancelActive: active != null);
    if (active != null) {
      _pollGenerations[active.id] = (_pollGenerations[active.id] ?? 0) + 1;
      _stopStream(active.id);
    }
    final latest = state.asData?.value;
    if (latest == null) return;
    final conversations = latest.conversations
        .where((item) => item.id != id)
        .toList();
    final runs = {...latest.activeRuns}..remove(id);
    state = AsyncData(
      latest.copyWith(
        conversations: conversations,
        selectedConversationId: latest.selectedConversationId == id
            ? conversations.firstOrNull?.id
            : latest.selectedConversationId,
        clearSelectedConversation:
            latest.selectedConversationId == id && conversations.isEmpty,
        activeRuns: runs,
        pinnedIds: {...latest.pinnedIds}..remove(id),
      ),
    );
    if (latest.pinnedIds.contains(id)) {
      unawaited(
        _savePinnedConversationIds(
          _storageNamespace,
          {...latest.pinnedIds}..remove(id),
        ),
      );
    }
  }

  Future<void> deleteTurn(String userMessageId) async {
    final current = state.asData?.value;
    final conversation = current?.selectedConversation;
    if (current == null || conversation == null) return;
    if (current.isSending || current.selectedRun != null) {
      throw const ApiException(
        code: 'assistant_conversation_busy',
        message: '请先停止当前任务',
      );
    }
    final index = conversation.messages.indexWhere(
      (message) => message.id == userMessageId && message.isUser,
    );
    if (index < 0) return;
    await _repository.deleteTurn(userMessageId);
    final latest = state.asData?.value;
    if (latest == null) return;
    state = AsyncData(
      latest.copyWith(
        conversations: latest.conversations.map((item) {
          if (item.id != conversation.id) return item;
          final latestIndex = item.messages.indexWhere(
            (message) => message.id == userMessageId && message.isUser,
          );
          if (latestIndex < 0) return item;
          return item.copyWith(
            messages: item.messages.take(latestIndex).toList(),
            updatedAt: DateTime.now(),
          );
        }).toList(),
      ),
    );
  }

  Future<void> deleteGeneratedImage(String messageId, String imageId) async {
    final current = state.asData?.value;
    final conversation = current?.selectedConversation;
    if (current == null || conversation == null) return;
    if (current.isSending || current.selectedRun != null) {
      throw const ApiException(
        code: 'assistant_conversation_busy',
        message: '图片仍在生成，请先停止任务',
      );
    }
    final message = conversation.messages
        .where((item) => item.id == messageId && !item.isUser)
        .firstOrNull;
    if (message == null) return;
    final target = message.images
        .where((image) => image.id == imageId || image.fileKey == imageId)
        .firstOrNull;
    if (target == null) return;
    final identifier = target.id.trim().isNotEmpty
        ? target.id.trim()
        : target.fileKey.trim();
    if (identifier.isEmpty) {
      throw const ApiException(code: 'validation_error', message: '图片 ID 无效');
    }
    final messageDeleted = await _repository.deleteGeneratedImage(
      messageId,
      identifier,
    );
    final latest = state.asData?.value;
    if (latest == null) return;
    state = AsyncData(
      latest.copyWith(
        conversations: latest.conversations.map((item) {
          if (item.id != conversation.id) return item;
          final messages = <AssistantMessage>[];
          for (final candidate in item.messages) {
            if (candidate.id != messageId) {
              messages.add(candidate);
              continue;
            }
            final remaining = candidate.images.where((image) {
              final candidateIdentifier = image.id.trim().isNotEmpty
                  ? image.id.trim()
                  : image.fileKey.trim();
              return candidateIdentifier != identifier;
            }).toList();
            if (!messageDeleted && remaining.isNotEmpty) {
              messages.add(candidate.copyWith(images: remaining));
            }
          }
          return item.copyWith(messages: messages, updatedAt: DateTime.now());
        }).toList(),
      ),
    );
  }

  Future<void> setMessageFeedback(
    String messageId,
    AssistantFeedback? feedback,
  ) async {
    final current = state.asData?.value;
    final conversation = current?.selectedConversation;
    final message = conversation?.messages
        .where(
          (item) => item.id == messageId && !item.isUser && !item.isPending,
        )
        .firstOrNull;
    if (current == null || conversation == null || message == null) return;
    final updated = await _repository.setMessageFeedback(messageId, feedback);
    if (updated.id != messageId) {
      throw const ApiException(code: 'invalid_response', message: '反馈状态同步失败');
    }
    final latest = state.asData?.value;
    if (latest == null) return;
    state = AsyncData(
      latest.copyWith(
        conversations: latest.conversations.map((item) {
          if (item.id != conversation.id) return item;
          return item.copyWith(
            messages: item.messages
                .map(
                  (candidate) =>
                      candidate.id == messageId ? updated : candidate,
                )
                .toList(),
          );
        }).toList(),
      ),
    );
  }

  Future<void> togglePinned(String id) async {
    final current = state.asData?.value;
    if (current == null ||
        !current.conversations.any((item) => item.id == id)) {
      return;
    }
    final next = {...current.pinnedIds};
    if (!next.remove(id)) next.add(id);
    state = AsyncData(current.copyWith(pinnedIds: next));
    await _savePinnedConversationIds(_storageNamespace, next);
  }

  Future<void> send(
    String value, {
    List<AssistantReferenceImage> referenceImages = const [],
    AssistantQuotedMessage? quoted,
  }) async {
    final prompt = value.trim();
    if (prompt.isEmpty) return;
    if (prompt.runes.length > 12000) {
      throw const ApiException(
        code: 'validation_error',
        message: '消息不能超过 12000 个字符',
      );
    }
    var current = state.asData?.value;
    if (current == null || current.isSending || current.selectedRun != null) {
      return;
    }
    if (current.selectedModel == null) {
      throw ApiException(
        code: 'assistant_unavailable',
        message: current.selectedMode == AssistantMode.image
            ? '当前没有可用的图片模型'
            : '当前没有可用的对话模型',
      );
    }
    state = AsyncData(current.copyWith(isSending: true, clearSyncError: true));
    try {
      var conversation = current.selectedConversation;
      if (conversation == null) {
        conversation = await _repository.createConversation();
        if (conversation.id.isEmpty) {
          throw const ApiException(code: 'invalid_response', message: '新建对话失败');
        }
        current = state.requireValue;
        current = current.copyWith(
          conversations: [conversation, ...current.conversations],
          selectedConversationId: conversation.id,
        );
        state = AsyncData(current);
      }
      final snapshot = await _repository.createRun(
        CreateAssistantRunInput(
          conversationId: conversation.id,
          prompt: prompt,
          modelId: current.selectedModel!.id,
          reasoningEffort: current.reasoningEffort,
          idempotencyKey: const Uuid().v4(),
          mode: current.selectedMode,
          referenceImages: referenceImages,
          ratio: current.imageRatio,
          resolution: current.imageResolution,
          count: current.imageCount,
          quality: current.imageQuality,
          quoted: quoted,
        ),
      );
      final latest = state.requireValue;
      final messages = [
        ...conversation.messages,
        if (snapshot.userMessage != null) snapshot.userMessage!,
        snapshot.assistantMessage,
      ];
      final updatedConversation = conversation.copyWith(
        title: conversation.title == '新对话'
            ? _assistantConversationTitle(prompt)
            : null,
        messages: _dedupeAssistantMessages(messages),
        updatedAt: DateTime.now(),
      );
      state = AsyncData(
        latest.copyWith(
          conversations: _upsertConversation(
            latest.conversations,
            updatedConversation,
          ),
          selectedConversationId: conversation.id,
          activeRuns: {...latest.activeRuns, conversation.id: snapshot.run},
          isSending: false,
        ),
      );
      if (!snapshot.run.isTerminal) {
        _startStream(snapshot.run.id);
        unawaited(_pollRun(snapshot.run.id));
      } else {
        _applyRunSnapshot(snapshot);
      }
    } catch (error) {
      final latest = state.asData?.value;
      if (latest != null) state = AsyncData(latest.copyWith(isSending: false));
      rethrow;
    }
  }

  Future<void> executeProposal({
    required String sourceMessageId,
    required AssistantProposal proposal,
    List<AssistantReferenceImage> referenceImages = const [],
  }) async {
    final prompt = proposal.prompt.trim();
    if (prompt.isEmpty) return;
    if (prompt.runes.length > 12000) {
      throw const ApiException(
        code: 'validation_error',
        message: '提示词不能超过 12000 个字符',
      );
    }
    final current = state.asData?.value;
    if (current == null || current.isSending || current.selectedRun != null) {
      return;
    }
    final imageModel =
        current.config.imageModel(proposal.modelId) ??
        current.config.imageModels
            .where((item) => item.label == proposal.modelName)
            .firstOrNull ??
        current.config.imageModel(current.config.defaultImageModelId) ??
        current.config.imageModels.firstOrNull;
    if (imageModel == null) {
      throw const ApiException(
        code: 'assistant_unavailable',
        message: '当前没有可用的图片模型',
      );
    }
    final resolution = imageModel.resolutions.contains(proposal.resolution)
        ? proposal.resolution
        : imageModel.resolutions.firstOrNull ?? '';
    final availableRatios = imageModel.ratiosFor(resolution);
    final ratio = availableRatios.contains(proposal.ratio)
        ? proposal.ratio
        : availableRatios.contains('auto')
        ? 'auto'
        : availableRatios.firstOrNull ?? '';
    final quality = imageModel.qualities.contains(proposal.quality)
        ? proposal.quality
        : imageModel.qualities.contains('high')
        ? 'high'
        : imageModel.qualities.firstOrNull ?? '';
    final count = proposal.count.clamp(1, imageModel.maxImages);
    final conversation = current.selectedConversation;
    if (conversation == null) {
      throw const ApiException(
        code: 'invalid_response',
        message: '当前对话不存在，请新建对话后重试',
      );
    }
    state = AsyncData(current.copyWith(isSending: true, clearSyncError: true));
    try {
      final snapshot = await _repository.createRun(
        CreateAssistantRunInput(
          conversationId: conversation.id,
          prompt: prompt,
          userMessageContent: '执行这个创作方案',
          modelId: imageModel.id,
          reasoningEffort: '',
          idempotencyKey: const Uuid().v4(),
          mode: AssistantMode.image,
          referenceImages: referenceImages,
          ratio: ratio,
          resolution: resolution,
          count: count,
          quality: quality,
          proposalSourceMessageId: sourceMessageId,
        ),
      );
      final latest = state.requireValue;
      final updatedConversation = conversation.copyWith(
        messages: _dedupeAssistantMessages([
          ...conversation.messages,
          if (snapshot.userMessage != null) snapshot.userMessage!,
          snapshot.assistantMessage,
        ]),
        updatedAt: DateTime.now(),
      );
      state = AsyncData(
        latest.copyWith(
          conversations: _upsertConversation(
            latest.conversations,
            updatedConversation,
          ),
          activeRuns: {...latest.activeRuns, conversation.id: snapshot.run},
          isSending: false,
        ),
      );
      if (!snapshot.run.isTerminal) {
        _startStream(snapshot.run.id);
        unawaited(_pollRun(snapshot.run.id));
      } else {
        _applyRunSnapshot(snapshot);
      }
    } catch (_) {
      final latest = state.asData?.value;
      if (latest != null) state = AsyncData(latest.copyWith(isSending: false));
      rethrow;
    }
  }

  Future<void> cancelSelectedRun() async {
    final current = state.asData?.value;
    final run = current?.selectedRun;
    if (current == null || run == null) return;
    await _repository.cancelRun(run.id);
    _pollGenerations[run.id] = (_pollGenerations[run.id] ?? 0) + 1;
    _stopStream(run.id);
    try {
      _applyRunSnapshot(await _repository.getRun(run.id));
      return;
    } catch (_) {
      // The cancellation already succeeded. Fall back to clearing the busy state.
    }
    final latest = state.asData?.value;
    if (latest == null) return;
    final runs = {...latest.activeRuns}..remove(run.conversationId);
    state = AsyncData(latest.copyWith(activeRuns: runs, clearSyncError: true));
  }

  Future<void> retrySync() async {
    final current = state.asData?.value;
    if (current == null) return;
    state = AsyncData(current.copyWith(clearSyncError: true));
    for (final run in current.activeRuns.values) {
      _startStream(run.id);
      unawaited(_pollRun(run.id));
    }
  }

  Future<void> _pollRun(String id) async {
    final generation = (_pollGenerations[id] ?? 0) + 1;
    _pollGenerations[id] = generation;
    var failures = 0;
    while (!_disposed && _pollGenerations[id] == generation) {
      await Future<void>.delayed(ref.read(assistantPollIntervalProvider));
      if (_disposed || _pollGenerations[id] != generation) return;
      try {
        final snapshot = await _repository.getRun(id);
        failures = 0;
        _applyRunSnapshot(snapshot);
        if (snapshot.run.isTerminal) return;
      } catch (_) {
        failures += 1;
        if (failures < 3) continue;
        final current = state.asData?.value;
        if (current != null) {
          state = AsyncData(current.copyWith(syncError: '回复状态同步中断，请检查网络后重试'));
        }
        return;
      }
    }
  }

  void _startStream(String id) {
    if (_disposed || id.isEmpty) return;
    _stopStream(id);
    final generation = (_streamGenerations[id] ?? 0) + 1;
    _streamGenerations[id] = generation;
    final subscription = _repository
        .streamRun(id)
        .listen(
          (event) {
            if (_disposed || _streamGenerations[id] != generation) return;
            _applyStreamEvent(id, event);
            if (event.done) unawaited(_finalizeStreamRun(id));
          },
          onError: (Object error, StackTrace stackTrace) {
            if (_streamGenerations[id] != generation) return;
            _markRunLive(id, false);
            _streamSubscriptions.remove(id);
          },
          onDone: () {
            if (_streamGenerations[id] != generation) return;
            _markRunLive(id, false);
            _streamSubscriptions.remove(id);
          },
          cancelOnError: true,
        );
    _streamSubscriptions[id] = subscription;
  }

  void _stopStream(String id) {
    _streamGenerations[id] = (_streamGenerations[id] ?? 0) + 1;
    final subscription = _streamSubscriptions.remove(id);
    if (subscription != null) unawaited(subscription.cancel());
    _markRunLive(id, false);
  }

  void _markRunLive(String id, bool live) {
    final current = state.asData?.value;
    if (current == null) return;
    final ids = {...current.liveRunIds};
    final changed = live ? ids.add(id) : ids.remove(id);
    if (changed) state = AsyncData(current.copyWith(liveRunIds: ids));
  }

  Future<void> _finalizeStreamRun(String id) async {
    try {
      _applyRunSnapshot(await _repository.getRun(id));
    } catch (_) {
      // Polling remains active and will reconcile the terminal snapshot.
    }
  }

  void _applyStreamEvent(String runId, AssistantStreamEvent event) {
    final current = state.asData?.value;
    if (current == null) return;
    final runEntry = current.activeRuns.entries
        .where((entry) => entry.value.id == runId)
        .firstOrNull;
    if (runEntry == null) return;
    final run = runEntry.value;
    final conversation = current.conversations
        .where((item) => item.id == run.conversationId)
        .firstOrNull;
    if (conversation == null) return;
    var messageId = run.assistantMessageId;
    if (messageId.isEmpty) {
      messageId =
          conversation.messages.reversed
              .where((item) => !item.isUser)
              .firstOrNull
              ?.id ??
          '';
    }
    if (messageId.isEmpty) return;
    final terminalStatus = switch (event.status) {
      'succeeded' => 'complete',
      'failed' => 'failed',
      'canceled' => 'stopped',
      _ => 'running',
    };
    var changed = false;
    final messages = conversation.messages.map((message) {
      if (message.id != messageId) return message;
      changed = true;
      final content = event.content.runes.length >= message.content.runes.length
          ? event.content
          : '';
      final reasoning =
          event.reasoning.runes.length >= message.reasoning.runes.length
          ? event.reasoning
          : '';
      return message.copyWith(
        content: content.isEmpty ? null : content,
        reasoning: reasoning.isEmpty ? null : reasoning,
        kind: event.kind.isEmpty ? null : event.kind,
        status: event.done ? terminalStatus : 'running',
        images: event.image == null
            ? null
            : _mergeGeneratedImages(message.images, [event.image!]),
        usage: event.usage,
        costPoints: event.costPoints > 0 ? event.costPoints : null,
      );
    }).toList();
    if (!changed) return;
    final nextRun = run.copyWith(
      status: event.done && event.status.isNotEmpty ? event.status : null,
      stage: event.stage.isEmpty ? null : event.stage,
    );
    final runs = {...current.activeRuns, run.conversationId: nextRun};
    final liveIds = {...current.liveRunIds};
    if (event.done) {
      liveIds.remove(runId);
    } else {
      liveIds.add(runId);
    }
    state = AsyncData(
      current.copyWith(
        conversations: _upsertConversation(
          current.conversations,
          conversation.copyWith(messages: messages),
        ),
        activeRuns: runs,
        liveRunIds: liveIds,
      ),
    );
  }

  void _applyRunSnapshot(AssistantRunSnapshot snapshot) {
    final current = state.asData?.value;
    if (current == null || snapshot.run.conversationId.isEmpty) return;
    final conversation = current.conversations
        .where((item) => item.id == snapshot.run.conversationId)
        .firstOrNull;
    if (conversation == null) return;
    var assistantMessage = snapshot.assistantMessage;
    if (snapshot.run.status == 'failed' &&
        assistantMessage.content.trim().isEmpty) {
      assistantMessage = assistantMessage.copyWith(
        content: snapshot.run.errorMessage.isEmpty
            ? '回复失败，请稍后重试'
            : snapshot.run.errorMessage,
      );
    }
    if (snapshot.run.costPoints > 0 && assistantMessage.costPoints <= 0) {
      assistantMessage = assistantMessage.copyWith(
        costPoints: snapshot.run.costPoints,
      );
    }
    final updatedConversation = conversation.copyWith(
      messages: _dedupeAssistantMessages([
        ...conversation.messages,
        assistantMessage,
      ]),
      updatedAt: DateTime.now(),
    );
    final runs = {...current.activeRuns};
    final liveIds = {...current.liveRunIds};
    final terminal = snapshot.run.isTerminal;
    if (terminal) {
      runs.remove(snapshot.run.conversationId);
      liveIds.remove(snapshot.run.id);
    } else {
      runs[snapshot.run.conversationId] = snapshot.run;
    }
    state = AsyncData(
      current.copyWith(
        conversations: _upsertConversation(
          current.conversations,
          updatedConversation,
        ),
        activeRuns: runs,
        liveRunIds: liveIds,
        clearSyncError: true,
      ),
    );
    if (terminal) _stopStream(snapshot.run.id);
  }
}

List<AssistantMessage> _dedupeAssistantMessages(
  Iterable<AssistantMessage> messages,
) {
  final result = <AssistantMessage>[];
  final indexes = <String, int>{};
  for (final message in messages) {
    if (message.id.isEmpty) continue;
    final existing = indexes[message.id];
    if (existing == null) {
      indexes[message.id] = result.length;
      result.add(message);
    } else {
      result[existing] = _mergeAssistantMessage(result[existing], message);
    }
  }
  return result;
}

AssistantMessage _mergeAssistantMessage(
  AssistantMessage current,
  AssistantMessage incoming,
) {
  final content = incoming.content.runes.length >= current.content.runes.length
      ? incoming.content
      : current.content;
  final reasoning =
      incoming.reasoning.runes.length >= current.reasoning.runes.length
      ? incoming.reasoning
      : current.reasoning;
  return incoming.copyWith(
    content: content,
    reasoning: reasoning,
    referenceImages: incoming.referenceImages.isNotEmpty
        ? incoming.referenceImages
        : current.referenceImages,
    proposal: incoming.proposal ?? current.proposal,
    images: incoming.images.isNotEmpty
        ? _mergeGeneratedImages(current.images, incoming.images)
        : current.images,
    proposalSourceMessageId: incoming.proposalSourceMessageId.isNotEmpty
        ? incoming.proposalSourceMessageId
        : current.proposalSourceMessageId,
    usage: incoming.usage ?? current.usage,
    quoted: incoming.quoted ?? current.quoted,
    costPoints: incoming.costPoints > 0
        ? incoming.costPoints
        : current.costPoints,
    contextInputTokens: incoming.contextInputTokens > 0
        ? incoming.contextInputTokens
        : current.contextInputTokens,
    updatedAt: incoming.updatedAt ?? current.updatedAt,
  );
}

List<AssistantGeneratedImage> _mergeGeneratedImages(
  Iterable<AssistantGeneratedImage> current,
  Iterable<AssistantGeneratedImage> incoming,
) {
  final result = <AssistantGeneratedImage>[];
  final indexes = <String, int>{};
  for (final image in [...current, ...incoming]) {
    final key = image.id.isNotEmpty ? image.id : image.fileKey;
    if (key.isEmpty) continue;
    final existing = indexes[key];
    if (existing == null) {
      indexes[key] = result.length;
      result.add(image);
    } else {
      result[existing] = image;
    }
  }
  return result;
}

List<AssistantConversation> _upsertConversation(
  List<AssistantConversation> items,
  AssistantConversation value,
) => [value, ...items.where((item) => item.id != value.id)];

String _assistantConversationTitle(String prompt) {
  final normalized = prompt.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (normalized.runes.length <= 28) return normalized;
  return '${String.fromCharCodes(normalized.runes.take(28))}...';
}

String assistantReasoningLabel(String value) => switch (value) {
  'none' => '关闭推理',
  'minimal' => '极简',
  'low' => '快速',
  'medium' => '标准',
  'high' => '深入',
  'xhigh' => '增强',
  'max' => '最强',
  _ => value,
};

String assistantRunStageLabel(AssistantRun run) {
  if (run.status == 'queued') return '正在排队';
  if (run.status == 'failed') return '回复失败';
  if (run.status == 'canceled') return '已停止';
  return switch (run.stage) {
    'routing' => '正在理解需求',
    'thinking' => '正在思考',
    'analyzing-image' => '正在分析图片',
    'analyzing-document' => '正在分析文档',
    'answering' => '正在实时回复',
    'generating' => '正在组织回复',
    _ => '正在回复',
  };
}

final assistantRepositoryProvider = Provider<AssistantRepository>(
  (ref) => ApiAssistantRepository(ref.watch(apiClientProvider)),
);

final assistantPollIntervalProvider = Provider<Duration>(
  (ref) => const Duration(milliseconds: 800),
);

final assistantWorkspaceProvider =
    AsyncNotifierProvider<
      AssistantWorkspaceController,
      AssistantWorkspaceState
    >(AssistantWorkspaceController.new);
