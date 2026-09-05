import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/gallery/gallery.dart';
import 'package:starcloudsai_mobile/features/tasks/task_detail_screen.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';

Widget _app(
  TaskItem task, {
  double textScale = 1,
  bool dark = false,
  bool detailFails = false,
  TaskItem? initialTask,
}) => ProviderScope(
  overrides: [
    taskDetailProvider.overrideWith((ref, id) async {
      if (detailFails) throw StateError('detail unavailable');
      return task;
    }),
    gallerySubmissionForTaskProvider.overrideWith((ref, id) async => null),
  ],
  child: MaterialApp(
    theme: ThemeData.light(),
    darkTheme: ThemeData.dark(),
    themeMode: dark ? ThemeMode.dark : ThemeMode.light,
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: TaskDetailScreen(taskId: task.id, initialTask: initialTask),
  ),
);

TaskItem _task({
  String status = 'succeeded',
  List<String> displayUrls = const [],
  List<String> originalUrls = const [],
  DateTime? deletedAt,
  int deletedOutputCount = 0,
  String? errorMessage,
  Map<String, dynamic> params = const {},
  int count = 1,
}) => TaskItem(
  id: 'task-1',
  type: 'text2image',
  model: 'image-pro',
  status: status,
  prompt: '一张留白克制的品牌海报',
  params: params,
  inputKeys: const [],
  costPoints: 10,
  createdAt: DateTime(2026, 8, 24, 12),
  startedAt: null,
  finishedAt: null,
  thumbnailUrls: const [],
  displayUrls: displayUrls,
  originalUrls: originalUrls,
  errorCode: null,
  errorMessage: errorMessage,
  deletedAt: deletedAt,
  deletionActor: deletedAt == null ? null : 'user',
  deletedOutputCount: deletedOutputCount,
  count: count,
);

void main() {
  testWidgets('empty successful output offers refresh and recreation', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_task()));
    await tester.pump();

    expect(find.text('暂未找到作品图片'), findsOneWidget);
    expect(find.text('刷新图片'), findsOneWidget);
    expect(find.text('再次创作'), findsOneWidget);
    expect(find.text('保存'), findsNothing);
    expect(find.text('分享'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('deleted output is explained without a redundant refresh', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(_task(deletedAt: DateTime(2026, 8, 24, 12), deletedOutputCount: 2)),
    );
    await tester.pump();

    expect(find.text('作品文件已移除'), findsOneWidget);
    expect(find.text('文件已移除'), findsOneWidget);
    expect(find.textContaining('已移除 2 个图片文件'), findsOneWidget);
    expect(find.text('刷新图片'), findsNothing);
    expect(find.text('再次创作'), findsOneWidget);
  });

  testWidgets('failed output shows its reason once in the recovery panel', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(_task(status: 'failed', errorMessage: '模型服务暂时不可用')),
    );
    await tester.pump();

    expect(find.text('本次创作未完成'), findsOneWidget);
    expect(find.text('模型服务暂时不可用'), findsOneWidget);
    expect(find.text('再次创作'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('action bar wraps safely on narrow screens with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 740));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _task(
          displayUrls: const ['/api/v1/files/display.webp'],
          originalUrls: const ['/api/v1/files/original.png'],
        ),
        textScale: 1.6,
      ),
    );
    await tester.pump();

    expect(find.text('保存'), findsOneWidget);
    expect(find.text('分享'), findsOneWidget);
    expect(find.text('投稿'), findsOneWidget);
    expect(
      tester.getSize(find.byType(ListView).first).height,
      greaterThan(400),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('multi-image action bar offers compact batch commands', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _task(
          displayUrls: const ['display-1', 'display-2', 'display-3'],
          originalUrls: const ['original-1', 'original-2', 'original-3'],
          count: 3,
        ),
        textScale: 1.6,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('保存全部'), findsOneWidget);
    expect(find.text('保存'), findsNothing);
    expect(find.text('分享全部'), findsOneWidget);
    expect(find.text('分享'), findsNothing);
    expect(find.byKey(const Key('task-save-images')), findsOneWidget);
    expect(find.byKey(const Key('task-share-images')), findsOneWidget);
    expect(find.text('投稿'), findsOneWidget);
    expect(
      tester.getSize(find.byType(ListView).first).height,
      greaterThan(500),
    );
    expect(find.byKey(const Key('task-image-thumbnails')), findsOneWidget);
    expect(find.text('1/3'), findsOneWidget);

    final thirdThumbnail = find.byKey(const Key('task-image-thumbnail-2'));
    await tester.tap(thirdThumbnail);
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('3/3'), findsOneWidget);
    expect(find.text('1/3'), findsNothing);

    await tester.tap(find.byTooltip('全屏预览'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('task-fullscreen-page-view')), findsOneWidget);
    expect(find.byKey(const Key('task-fullscreen-thumbnails')), findsOneWidget);
    expect(find.byKey(const Key('task-fullscreen-actions')), findsOneWidget);
    expect(find.byKey(const Key('task-fullscreen-save')), findsOneWidget);
    expect(find.byKey(const Key('task-fullscreen-share')), findsOneWidget);
    expect(find.text('3 / 3'), findsOneWidget);
    expect(find.text('保存第 3 张'), findsOneWidget);
    expect(find.text('分享第 3 张'), findsOneWidget);

    await tester.tap(find.byKey(const Key('task-fullscreen-thumbnail-0')));
    await tester.pumpAndSettle();
    expect(find.text('1 / 3'), findsOneWidget);
    expect(find.text('保存第 1 张'), findsOneWidget);
    expect(find.text('分享第 1 张'), findsOneWidget);

    await tester.drag(
      find.byKey(const Key('task-fullscreen-page-view')),
      const Offset(-240, 0),
    );
    await tester.pumpAndSettle();
    expect(find.text('2 / 3'), findsOneWidget);
    expect(find.text('保存第 2 张'), findsOneWidget);
    expect(find.text('分享第 2 张'), findsOneWidget);

    await tester.tap(find.byKey(const Key('task-fullscreen-close')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('task-fullscreen-page-view')), findsNothing);
    expect(find.text('2/3'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('cached list task survives a failed detail sync', (tester) async {
    await tester.binding.setSurfaceSize(const Size(440, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final cached = _task(
      displayUrls: const ['display-1', 'display-2', 'display-3', 'display-4'],
      originalUrls: const [
        'original-1',
        'original-2',
        'original-3',
        'original-4',
      ],
      count: 4,
    );
    await tester.pumpWidget(
      _app(cached, detailFails: true, initialTask: cached, dark: true),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('task-detail-cache-notice')), findsOneWidget);
    expect(find.text('详情同步失败，已显示列表中的作品数据'), findsOneWidget);
    expect(find.byKey(const Key('task-detail-cache-retry')), findsOneWidget);
    expect(find.text('保存全部'), findsOneWidget);
    expect(find.text('分享全部'), findsOneWidget);
    expect(find.text('详情未同步'), findsOneWidget);
    expect(tester.getSize(find.text('详情未同步')).height, lessThan(30));
    expect(find.text('投稿'), findsNothing);
    expect(find.byTooltip('删除作品'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  test('batch image saving reports complete and partial progress', () async {
    final savedPaths = <String>[];
    final completed = await saveTaskImages(
      count: 3,
      downloadPath: (index) async => 'image-$index.png',
      savePath: (path) async => savedPaths.add(path),
    );

    expect(savedPaths, ['image-0.png', 'image-1.png', 'image-2.png']);
    expect(completed.savedCount, 3);
    expect(completed.totalCount, 3);
    expect(completed.isComplete, isTrue);

    final attempted = <int>[];
    final partial = await saveTaskImages(
      count: 4,
      downloadPath: (index) async {
        attempted.add(index);
        if (index == 2) throw StateError('download failed');
        return 'image-$index.png';
      },
      savePath: (path) async {},
    );

    expect(attempted, [0, 1, 2]);
    expect(partial.savedCount, 2);
    expect(partial.totalCount, 4);
    expect(partial.isComplete, isFalse);
    expect(partial.error, isA<StateError>());

    final missing = await saveTaskImages(
      count: 0,
      downloadPath: (index) async => throw UnimplementedError(),
      savePath: (path) async {},
    );
    expect(missing.savedCount, 0);
    expect(missing.isComplete, isFalse);
    expect(missing.error, isA<FormatException>());
  });

  test('batch image sharing continues after one download fails', () async {
    final attempted = <int>[];
    final result = await prepareTaskImagesForShare(
      count: 4,
      downloadPath: (index) async {
        attempted.add(index);
        if (index == 1) throw StateError('download failed');
        return 'image-$index.png';
      },
    );

    expect(attempted, [0, 1, 2, 3]);
    expect(result.paths, ['image-0.png', 'image-2.png', 'image-3.png']);
    expect(result.totalCount, 4);
    expect(result.failedCount, 1);
    expect(result.error, isA<StateError>());
  });

  testWidgets('prompt panel copies complete text in centered notice', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    String? clipboardText;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          clipboardText = (call.arguments as Map)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    final task = _task();
    await tester.pumpWidget(_app(task, textScale: 1.3, dark: true));
    await tester.pump();

    final copy = find.byKey(const Key('copy-task-prompt'));
    await tester.ensureVisible(copy);
    await tester.pumpAndSettle();
    await tester.tap(copy);
    await tester.pumpAndSettle();

    expect(clipboardText, task.displayPrompt);
    expect(find.text('提示词已复制'), findsOneWidget);
    final notice = find.byKey(const Key('app-notice-card'));
    expect(tester.getCenter(notice).dx, closeTo(195, 1));
    expect(tester.getCenter(notice).dy, closeTo(422, 1));
    final panel = tester.widget<Material>(
      find.byKey(const Key('task-prompt-panel')),
    );
    final shape = panel.shape! as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(8));
    expect(
      Theme.of(tester.element(find.text(task.displayPrompt))).brightness,
      Brightness.dark,
    );
    expect(tester.takeException(), isNull);
  });

  test('generation parameters use the historical recreation values', () {
    final items = taskGenerationParameters(
      _task(
        count: 3,
        params: const {
          'requestedAspectRatio': '16:9',
          'resolutionScale': '2K',
          'quality': 'high',
          'batchSize': 3,
        },
      ),
    );

    expect(items, [
      (label: '模型', value: 'image-pro'),
      (label: '画幅', value: '16:9'),
      (label: '清晰度', value: '2K'),
      (label: '质量', value: '高清'),
      (label: '张数', value: '3 张'),
    ]);
    expect(
      taskGenerationParameters(
        _task(params: const {'aspectRatio': 'auto', 'quality': 'standard'}),
      ),
      [
        (label: '模型', value: 'image-pro'),
        (label: '画幅', value: '自动'),
        (label: '质量', value: '标准'),
        (label: '张数', value: '1 张'),
      ],
    );
  });

  testWidgets('parameter panel fits a dark narrow large-text layout', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 740));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _task(
          params: const {
            'requestedAspectRatio': '16:9',
            'resolutionScale': '2K',
            'quality': 'high',
            'batchSize': 4,
          },
          count: 4,
        ),
        textScale: 1.6,
        dark: true,
      ),
    );
    await tester.pump();

    final panel = find.byKey(const Key('task-parameters-panel'));
    await tester.ensureVisible(panel);
    await tester.pumpAndSettle();
    expect(find.text('生成参数'), findsOneWidget);
    expect(find.text('16:9'), findsOneWidget);
    expect(find.text('2K'), findsOneWidget);
    expect(find.text('高清'), findsOneWidget);
    expect(find.text('4 张'), findsOneWidget);
    final material = tester.widget<Material>(panel);
    final shape = material.shape! as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(8));
    expect(Theme.of(tester.element(panel)).brightness, Brightness.dark);
    expect(tester.takeException(), isNull);
  });
}
