import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/providers.dart';
import '../create/reference_image_service.dart';

const maxAssistantDraftReferences = 4;
const maxAssistantDraftRunes = 12000;

class AssistantDraft {
  const AssistantDraft({
    required this.prompt,
    required this.references,
    required this.updatedAt,
  });

  factory AssistantDraft.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final rawPrompt = map['prompt']?.toString() ?? '';
    final prompt = rawPrompt.runes.length > maxAssistantDraftRunes
        ? String.fromCharCodes(rawPrompt.runes.take(maxAssistantDraftRunes))
        : rawPrompt;
    final rawReferences = map['references'];
    return AssistantDraft(
      prompt: prompt,
      references: rawReferences is List
          ? rawReferences
                .map(_referenceFromJson)
                .whereType<ReferenceImageDraft>()
                .take(maxAssistantDraftReferences)
                .toList()
          : const [],
      updatedAt:
          DateTime.tryParse(map['updatedAt']?.toString() ?? '')?.toLocal() ??
          DateTime.now(),
    );
  }

  final String prompt;
  final List<ReferenceImageDraft> references;
  final DateTime updatedAt;

  bool get isEmpty => prompt.trim().isEmpty && references.isEmpty;

  Map<String, dynamic> toJson() => {
    'prompt': prompt,
    'references': references.map(_referenceToJson).toList(),
    'updatedAt': updatedAt.toUtc().toIso8601String(),
  };
}

ReferenceImageDraft? _referenceFromJson(dynamic data) {
  if (data is! Map) return null;
  final map = Map<String, dynamic>.from(data);
  final localPath = map['localPath']?.toString().trim() ?? '';
  final remoteKey = _optional(map['remoteKey']);
  if (localPath.isEmpty && remoteKey == null) return null;
  final rawFilename = map['filename']?.toString().trim() ?? '';
  final filename = rawFilename.isEmpty ? '参考图' : rawFilename;
  return ReferenceImageDraft(
    localPath: localPath,
    filename: filename.runes.length > 180
        ? String.fromCharCodes(filename.runes.take(180))
        : filename,
    remoteKey: remoteKey,
    remoteUrl: _optional(map['remoteUrl']),
    sourceAssetId: _optional(map['sourceAssetId']),
  );
}

Map<String, dynamic> _referenceToJson(ReferenceImageDraft reference) => {
  'localPath': reference.localPath,
  'filename': reference.filename,
  'remoteKey': reference.remoteKey,
  'remoteUrl': reference.remoteUrl,
  'sourceAssetId': reference.sourceAssetId,
};

String? _optional(dynamic value) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

abstract interface class AssistantDraftStore {
  Future<AssistantDraft?> read();
  Future<void> write(AssistantDraft draft);
  Future<void> clear();
}

class SecureAssistantDraftStore implements AssistantDraftStore {
  SecureAssistantDraftStore({
    required String namespace,
    FlutterSecureStorage? storage,
    Future<Directory> Function()? draftDirectory,
  }) : _storage = storage ?? const FlutterSecureStorage(),
       _key = keyFor(namespace),
       _draftDirectory =
           draftDirectory ??
           (() async {
             final support = await getApplicationSupportDirectory();
             return Directory(
               '${support.path}/assistant-drafts/${directoryNameFor(namespace)}',
             );
           });

  final FlutterSecureStorage _storage;
  final String _key;
  final Future<Directory> Function() _draftDirectory;

  static String keyFor(String namespace) {
    final normalized = _normalizedNamespace(namespace);
    return 'starclouds.assistant_draft.$normalized';
  }

  static String directoryNameFor(String namespace) =>
      _normalizedNamespace(namespace).replaceAll(RegExp(r'[^a-z0-9._-]'), '_');

  @override
  Future<AssistantDraft?> read() async {
    final raw = await _storage.read(key: _key);
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final draft = AssistantDraft.fromJson(jsonDecode(raw));
      final references = <ReferenceImageDraft>[];
      for (final reference in draft.references) {
        final localExists =
            reference.localPath.isNotEmpty &&
            await File(reference.localPath).exists();
        if (localExists) {
          references.add(reference);
        } else if (reference.remoteKey?.isNotEmpty == true) {
          references.add(
            ReferenceImageDraft(
              localPath: '',
              filename: reference.filename,
              remoteKey: reference.remoteKey,
              remoteUrl: reference.remoteUrl,
              sourceAssetId: reference.sourceAssetId,
            ),
          );
        }
      }
      final restored = AssistantDraft(
        prompt: draft.prompt,
        references: references,
        updatedAt: draft.updatedAt,
      );
      return restored.isEmpty ? null : restored;
    } catch (_) {
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(AssistantDraft draft) async {
    if (draft.isEmpty) {
      await clear();
      return;
    }
    final staged = await stageAssistantDraft(draft, await _draftDirectory());
    if (staged.isEmpty) {
      await clear();
      return;
    }
    await _storage.write(key: _key, value: jsonEncode(staged.toJson()));
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _key);
    final directory = await _draftDirectory();
    if (await directory.exists()) await directory.delete(recursive: true);
  }
}

Future<AssistantDraft> stageAssistantDraft(
  AssistantDraft draft,
  Directory directory,
) async {
  await directory.create(recursive: true);
  final directoryPrefix = '${directory.absolute.path}${Platform.pathSeparator}';
  final stagedReferences = <ReferenceImageDraft>[];
  final retainedPaths = <String>{};
  for (
    var index = 0;
    index < draft.references.length &&
        stagedReferences.length < maxAssistantDraftReferences;
    index += 1
  ) {
    final reference = draft.references[index];
    var localPath = reference.localPath.trim();
    if (localPath.isNotEmpty) {
      final source = File(localPath);
      if (await source.exists()) {
        if (!source.absolute.path.startsWith(directoryPrefix)) {
          final target = File(
            '${directory.path}/${index + 1}-${_safeFilename(reference.filename)}',
          );
          await source.copy(target.path);
          localPath = target.path;
        }
        retainedPaths.add(File(localPath).absolute.path);
      } else {
        localPath = '';
      }
    }
    if (localPath.isEmpty && reference.remoteKey?.isNotEmpty != true) continue;
    stagedReferences.add(
      ReferenceImageDraft(
        localPath: localPath,
        filename: reference.filename,
        remoteKey: reference.remoteKey,
        remoteUrl: reference.remoteUrl,
        sourceAssetId: reference.sourceAssetId,
      ),
    );
  }
  await for (final entity in directory.list()) {
    if (entity is File && !retainedPaths.contains(entity.absolute.path)) {
      await entity.delete();
    }
  }
  return AssistantDraft(
    prompt: draft.prompt,
    references: stagedReferences,
    updatedAt: draft.updatedAt,
  );
}

String _safeFilename(String value) {
  var filename = value.trim().replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');
  if (filename.isEmpty) filename = 'reference.jpg';
  if (!filename.contains('.')) filename = '$filename.jpg';
  return String.fromCharCodes(filename.runes.take(140));
}

String _normalizedNamespace(String value) {
  final normalized = value.trim().toLowerCase();
  return normalized.isEmpty ? 'production' : normalized;
}

final assistantDraftStoreProvider = Provider<AssistantDraftStore>(
  (ref) => SecureAssistantDraftStore(
    namespace: ref.watch(appEnvironmentProvider).name.name,
  ),
);
