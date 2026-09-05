import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/create/create.dart';
import 'package:starcloudsai_mobile/features/discover/discover.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';
import 'package:starcloudsai_mobile/features/tasks/task_detail_screen.dart';

void main() {
  test('parses a public image model', () {
    final model = ImageModelOption.fromJson({
      'id': 'image-fast',
      'name': '快速模型',
      'resolutions': ['1K', '2K'],
      'aspectRatios': ['auto', '1:1'],
      'qualities': ['medium'],
      'maxImages': 2,
      'maxReferenceImages': 4,
      'pricePoints': 12,
    });

    expect(model.id, 'image-fast');
    expect(model.maxImages, 2);
    expect(model.maxReferenceImages, 4);
    expect(model.pricePoints, 12);
  });

  test(
    'image model keeps configured reference capacity within safety limit',
    () {
      final model = ImageModelOption.fromJson({
        'id': 'image-reference-heavy',
        'maxReferenceImages': 8,
      });
      final oversized = ImageModelOption.fromJson({
        'id': 'image-reference-oversized',
        'maxReferenceImages': 40,
      });

      expect(model.maxReferenceImages, 8);
      expect(oversized.maxReferenceImages, 15);
      expect(creationReferenceLimit(model), 6);
      expect(creationReferenceLimit(oversized), 6);
    },
  );

  test('parses prompt dimensions and task media', () {
    final prompt = PromptItem.fromJson({
      'id': 'prompt-id',
      'title': '海报',
      'prompt': 'poster prompt',
      'coverWidth': 1200,
      'coverHeight': 800,
    });
    final task = TaskItem.fromJson({
      'id': 'task-id',
      'status': 'succeeded',
      'params': {'userPrompt': 'poster prompt'},
      'count': 3,
      'thumbnailUrls': ['/api/v1/files/thumb.jpg'],
      'displayUrls': [
        '/api/v1/files/display-1.webp',
        '/api/v1/files/display-2.webp',
      ],
      'originalUrls': [
        '/api/v1/files/original-1.png',
        '/api/v1/files/original-2.png',
      ],
      'inputKeys': ['uploads/user/original/reference.jpg'],
      'costCents': 20,
      'startedAt': '2026-08-23T12:00:00Z',
      'finishedAt': '2026-08-23T12:00:42Z',
    });

    expect(prompt.aspectRatio, 1.5);
    expect(task.prompt, 'poster prompt');
    expect(task.thumbnailUrl, '/api/v1/files/thumb.jpg');
    expect(task.previewUrls, hasLength(2));
    expect(task.originalUrls, hasLength(2));
    expect(task.inputKeys, hasLength(1));
    expect(task.duration, const Duration(seconds: 42));
    expect(task.costPoints, 20);
    expect(task.count, 3);
    expect(task.isTextToImage, isFalse);
    expect(
      TaskItem.fromJson({'id': 't2i', 'type': 't2i'}).isTextToImage,
      isTrue,
    );
    expect(
      TaskItem.fromJson({
        'id': 'legacy',
        'type': 'text_to_image',
      }).isTextToImage,
      isTrue,
    );
  });

  test('parses output deletion audit fields and classifies empty results', () {
    final deleted = TaskItem.fromJson({
      'id': 'deleted-task',
      'status': 'succeeded',
      'deletedAt': '2026-08-24T12:00:00Z',
      'deletionActor': 'user',
      'deletedOutputCount': 2,
    });
    final failed = TaskItem.fromJson({
      'id': 'failed-task',
      'status': 'failed',
      'errorMessage': '模型服务暂时不可用',
    });
    final missing = TaskItem.fromJson({
      'id': 'missing-task',
      'status': 'succeeded',
    });

    expect(deleted.hasDeletedOutputs, isTrue);
    expect(deleted.deletionActor, 'user');
    expect(deleted.deletedOutputCount, 2);
    expect(taskOutputState(deleted), TaskOutputState.deleted);
    expect(taskOutputState(failed), TaskOutputState.failed);
    expect(taskOutputState(missing), TaskOutputState.missing);
  });

  test('historical task parameters round-trip through a creation route', () {
    final task = TaskItem.fromJson({
      'id': 'task-1',
      'status': 'succeeded',
      'model': 'internal-model',
      'count': 3,
      'params': {
        'userPrompt': '历史海报提示词',
        'publicModelKey': 'image-pro',
        'requestedAspectRatio': '16:9',
        'resolutionScale': '2K',
        'quality': 'high',
      },
    });

    final preset = creationPresetForTask(task);
    final restored = CreationPreset.fromQuery(preset.toQueryParameters());

    expect(restored, preset);
    expect(restored?.originTaskId, 'task-1');
    expect(restored?.prompt, '历史海报提示词');
    expect(restored?.modelId, 'image-pro');
    expect(restored?.aspectRatio, '16:9');
    expect(restored?.resolution, '2K');
    expect(restored?.quality, 'high');
    expect(restored?.count, 3);
    expect(CreationPreset.fromQuery({'prompt': '普通灵感'}), isNull);
  });

  test('retired tools recreate from the text-to-image workbench', () {
    final coloring = TaskItem.fromJson({
      'id': 'coloring-1',
      'type': 'coloring',
      'status': 'succeeded',
      'params': {'userPrompt': '服务端完整提示词', 'customPrompt': '电影暖调'},
    });
    final modelSheet = TaskItem.fromJson({
      'id': 'model-1',
      'type': 'model_sheet',
      'status': 'succeeded',
      'params': {'userPrompt': '机甲角色'},
    });
    final background = TaskItem.fromJson({
      'id': 'remove-1',
      'type': 'background_remove',
      'status': 'succeeded',
    });

    expect(taskRecreationAction(coloring).label, '再次创作');
    expect(Uri.parse(taskRecreationAction(coloring).location).path, '/create');
    expect(taskRecreationAction(modelSheet).label, '再次创作');
    expect(
      Uri.parse(taskRecreationAction(modelSheet).location).path,
      '/create',
    );
    expect(taskRecreationAction(background).label, '再次创作');
    expect(
      Uri.parse(taskRecreationAction(background).location).path,
      '/create',
    );
  });

  test('displayPrompt falls back to the raw user prompt', () {
    final withFullPrompt = TaskItem.fromJson({
      'id': 'task-full',
      'type': 'text2image',
      'status': 'succeeded',
      'params': {'userPrompt': '一只橘猫', 'prompt': '超长服务端完整提示词'},
    });
    final onlyRawPrompt = TaskItem.fromJson({
      'id': 'task-raw',
      'type': 'text2image',
      'status': 'succeeded',
      'params': {'userPrompt': '只有用户输入'},
    });
    final empty = TaskItem.fromJson({
      'id': 'task-empty',
      'type': 'text2image',
      'status': 'succeeded',
    });

    expect(withFullPrompt.displayPrompt, '一只橘猫');
    expect(onlyRawPrompt.displayPrompt, '只有用户输入');
    expect(empty.displayPrompt, isEmpty);
  });

  test('parses discover pages, counts and cursors defensively', () {
    final prompts = PromptPage.fromJson({
      'items': [
        {
          'id': 'prompt-1',
          'title': '海报',
          'prompt': 'poster prompt',
          'tags': ['商业', '排版'],
        },
        {'id': '', 'prompt': 'invalid'},
      ],
      'total': 18,
      'nextCursor': ' next-page ',
      'categoryCounts': {'poster': 12, 'portrait': 6.0, 'invalid': 'x'},
      'tags': ['商业', '', '排版'],
    });
    final gallery = GalleryPage.fromJson({
      'items': [
        {
          'id': 'gallery-1',
          'title': '夏日海报',
          'author': {'username': '小星'},
          'mediaThumbUrls': ['/thumb.webp'],
        },
        {'title': 'invalid'},
      ],
      'nextCursor': '',
    });
    final category = PromptCategory.fromJson({
      'key': 'poster',
      'label': '海报设计',
      'count': 12,
      'sort': 20,
    });

    expect(prompts.items, hasLength(1));
    expect(prompts.total, 18);
    expect(prompts.nextCursor, 'next-page');
    expect(prompts.categoryCounts['portrait'], 6);
    expect(prompts.categoryCounts['invalid'], 0);
    expect(gallery.items.single.coverUrl, '/thumb.webp');
    expect(gallery.nextCursor, isNull);
    expect(category.label, '海报设计');
  });

  test(
    'text-to-image tasks with the same batch id form one conversation turn',
    () {
      final groups = groupCreationTurns([
        TaskItem.fromJson({
          'id': 'task-c',
          'type': 't2i',
          'params': {'batchId': 'batch-1', 'batchIndex': 2},
        }),
        TaskItem.fromJson({'id': 'task-solo', 'type': 't2i'}),
        TaskItem.fromJson({
          'id': 'task-a',
          'type': 't2i',
          'params': {'batchId': 'batch-1', 'batchIndex': 0},
        }),
        TaskItem.fromJson({
          'id': 'task-b',
          'type': 't2i',
          'params': {'batchId': 'batch-1', 'batchIndex': 1},
        }),
      ]);

      expect(groups, hasLength(2));
      expect(groups.first.map((task) => task.id), [
        'task-a',
        'task-b',
        'task-c',
      ]);
      expect(groups.last.single.id, 'task-solo');
    },
  );
}
