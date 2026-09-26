import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/assistant/assistant_draft.dart';
import 'package:starcloudsai_mobile/features/create/reference_image_service.dart';

void main() {
  test('assistant draft normalizes untrusted persisted values', () {
    final prompt = List.filled(maxAssistantDraftRunes + 20, '绘').join();
    final draft = AssistantDraft.fromJson({
      'prompt': prompt,
      'updatedAt': '2026-08-24T04:00:00Z',
      'references': [
        for (var index = 0; index < 6; index += 1)
          {
            'localPath': '',
            'filename': '参考图 $index',
            'remoteKey': 'uploads/user/reference-$index.jpg',
          },
        {'localPath': '', 'remoteKey': ''},
      ],
    });

    expect(draft.prompt.runes.length, maxAssistantDraftRunes);
    expect(draft.references, hasLength(maxAssistantDraftReferences));
    expect(draft.references.first.filename, '参考图 0');
    expect(draft.updatedAt.toUtc(), DateTime.utc(2026, 8, 24, 4));
    expect(AssistantDraft.fromJson('invalid').isEmpty, isTrue);
  });

  test('secure draft storage keys are isolated by environment', () {
    expect(
      SecureAssistantDraftStore.keyFor('Development'),
      'starclouds.assistant_draft.development',
    );
    expect(
      SecureAssistantDraftStore.keyFor('production'),
      'starclouds.assistant_draft.production',
    );
    expect(
      SecureAssistantDraftStore.keyFor('Development'),
      isNot(SecureAssistantDraftStore.keyFor('production')),
    );
    expect(
      SecureAssistantDraftStore.directoryNameFor(' Preview / QA '),
      'preview___qa',
    );
  });

  test('stages local references and removes orphaned private files', () async {
    final root = await Directory.systemTemp.createTemp('assistant-draft-test-');
    addTearDown(() => root.delete(recursive: true));
    final source = File('${root.path}/source image.png');
    await source.writeAsBytes([1, 2, 3, 4]);
    final draftDirectory = Directory('${root.path}/private/draft');
    await draftDirectory.create(recursive: true);
    final orphan = File('${draftDirectory.path}/orphan.jpg');
    await orphan.writeAsBytes([9]);

    final staged = await stageAssistantDraft(
      AssistantDraft(
        prompt: '分析两张参考图',
        references: [
          ReferenceImageDraft(localPath: source.path, filename: '产品 正面.png'),
          const ReferenceImageDraft(
            localPath: '',
            filename: '素材库参考图',
            remoteKey: 'uploads/user/asset.jpg',
            remoteUrl: '/api/v1/files/uploads/user/asset.jpg',
          ),
          ReferenceImageDraft(
            localPath: '${root.path}/missing.jpg',
            filename: '已丢失的临时图.jpg',
          ),
        ],
        updatedAt: DateTime(2026, 8, 24, 12),
      ),
      draftDirectory,
    );

    expect(staged.references, hasLength(2));
    final local = staged.references.first;
    expect(local.localPath, startsWith(draftDirectory.path));
    expect(local.localPath, isNot(source.path));
    expect(await File(local.localPath).readAsBytes(), [1, 2, 3, 4]);
    expect(staged.references.last.remoteKey, 'uploads/user/asset.jpg');
    expect(staged.references.last.localPath, isEmpty);
    expect(await source.exists(), isTrue);
    expect(await orphan.exists(), isFalse);
  });
}
