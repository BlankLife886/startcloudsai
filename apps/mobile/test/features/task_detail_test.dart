import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/gallery/gallery.dart';
import 'package:starcloudsai_mobile/features/tasks/task_detail_screen.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';

Widget _app(TaskItem task, {double textScale = 1}) => ProviderScope(
  overrides: [
    taskDetailProvider.overrideWith((ref, id) async => task),
    gallerySubmissionForTaskProvider.overrideWith((ref, id) async => null),
  ],
  child: MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: TaskDetailScreen(taskId: task.id),
  ),
);

TaskItem _task({
  String status = 'succeeded',
  List<String> displayUrls = const [],
  List<String> originalUrls = const [],
  DateTime? deletedAt,
  int deletedOutputCount = 0,
  String? errorMessage,
}) => TaskItem(
  id: 'task-1',
  type: 'text2image',
  model: 'image-pro',
  status: status,
  prompt: '一张留白克制的品牌海报',
  params: const {},
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
    expect(tester.takeException(), isNull);
  });
}
