import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../core/providers.dart';

class CreationDraft {
  const CreationDraft({
    required this.prompt,
    required this.count,
    required this.updatedAt,
    this.modelId,
    this.aspectRatio,
    this.resolution,
    this.quality,
  });

  factory CreationDraft.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final prompt = map['prompt']?.toString() ?? '';
    return CreationDraft(
      prompt: prompt.runes.length > 20000
          ? String.fromCharCodes(prompt.runes.take(20000))
          : prompt,
      modelId: _optional(map['modelId']),
      aspectRatio: _optional(map['aspectRatio']),
      resolution: _optional(map['resolution']),
      quality: _optional(map['quality']),
      count: ((map['count'] as num?)?.toInt() ?? 1).clamp(1, 4),
      updatedAt:
          DateTime.tryParse(map['updatedAt']?.toString() ?? '')?.toLocal() ??
          DateTime.now(),
    );
  }

  final String prompt;
  final String? modelId;
  final String? aspectRatio;
  final String? resolution;
  final String? quality;
  final int count;
  final DateTime updatedAt;

  bool get isEmpty => prompt.trim().isEmpty;

  Map<String, dynamic> toJson() => {
    'prompt': prompt,
    'modelId': modelId,
    'aspectRatio': aspectRatio,
    'resolution': resolution,
    'quality': quality,
    'count': count,
    'updatedAt': updatedAt.toUtc().toIso8601String(),
  };
}

String? _optional(dynamic value) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

abstract interface class CreationDraftStore {
  Future<CreationDraft?> read();
  Future<void> write(CreationDraft draft);
  Future<void> clear();
}

class SecureCreationDraftStore implements CreationDraftStore {
  SecureCreationDraftStore({
    required String namespace,
    FlutterSecureStorage? storage,
  }) : _storage = storage ?? const FlutterSecureStorage(),
       _key = keyFor(namespace);

  final FlutterSecureStorage _storage;
  final String _key;

  static String keyFor(String namespace) {
    final normalized = namespace.trim().toLowerCase();
    return 'starclouds.creation_draft.${normalized.isEmpty ? 'production' : normalized}';
  }

  @override
  Future<CreationDraft?> read() async {
    final raw = await _storage.read(key: _key);
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final draft = CreationDraft.fromJson(jsonDecode(raw));
      return draft.isEmpty ? null : draft;
    } catch (_) {
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(CreationDraft draft) =>
      _storage.write(key: _key, value: jsonEncode(draft.toJson()));

  @override
  Future<void> clear() => _storage.delete(key: _key);
}

final creationDraftStoreProvider = Provider<CreationDraftStore>(
  (ref) => SecureCreationDraftStore(
    namespace: ref.watch(appEnvironmentProvider).name.name,
  ),
);
