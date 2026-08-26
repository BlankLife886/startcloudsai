import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/network/api_exception.dart';
import 'package:starcloudsai_mobile/features/tasks/task_deletion_ui.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';
import 'package:starcloudsai_mobile/features/tasks/works_screen.dart';

TaskItem _task(String status) => TaskItem(
  id: 'task-root',
  type: 't2i',
  model: 'image-fast',
  status: status,
  prompt: '一张用于验证删除交互和窄屏布局的星空城市海报',
  params: const {},
  inputKeys: const [],
  costPoints: 12,
  createdAt: DateTime(2026, 8, 24, 12, 30),
  startedAt: null,
  finishedAt: null,
  thumbnailUrls: const [],
  displayUrls: const [],
  originalUrls: const [],
  errorCode: null,
  errorMessage: null,
);

void main() {
  test('parses and deduplicates all deleted task ids', () {
    final result = TaskDeletionResult.fromJson({
      'deletedTaskIds': ['task-root', 'task-child', 'task-child', ''],
    }, fallbackId: 'fallback');
    final fallback = TaskDeletionResult.fromJson(null, fallbackId: 'fallback');

    expect(result.deletedTaskIds, ['task-root', 'task-child']);
    expect(fallback.deletedTaskIds, ['fallback']);
  });

  test('only terminal tasks can be deleted', () {
    expect(_task('queued').canDelete, isFalse);
    expect(_task('running').canDelete, isFalse);
    expect(_task('succeeded').canDelete, isTrue);
    expect(_task('failed').canDelete, isTrue);
    expect(_task('canceled').canDelete, isTrue);
  });

  testWidgets('task-in-use offers an explicit cascade confirmation', (
    tester,
  ) async {
    final calls = <bool>[];
    final busyStates = <bool>[];
    TaskDeletionResult? result;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => FilledButton(
              onPressed: () async {
                result = await runTaskDeletionFlow(
                  context,
                  task: _task('succeeded'),
                  onDelete: (cascade) async {
                    calls.add(cascade);
                    if (!cascade) {
                      throw const ApiException(
                        statusCode: 409,
                        code: 'task_in_use',
                        message: '该任务产物仍被其他内容引用，无法删除',
                      );
                    }
                    return const TaskDeletionResult(
                      deletedTaskIds: ['task-child', 'task-root'],
                    );
                  },
                  onBusyChanged: busyStates.add,
                );
              },
              child: const Text('打开删除'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('打开删除'));
    await tester.pumpAndSettle();
    expect(find.text('删除这件作品？'), findsOneWidget);
    await tester.tap(find.text('确认删除'));
    await tester.pumpAndSettle();

    expect(find.text('同时删除关联作品？'), findsOneWidget);
    expect(find.textContaining('所有依赖它的作品'), findsOneWidget);
    await tester.tap(find.text('删除全部关联作品'));
    await tester.pumpAndSettle();

    expect(calls, [false, true]);
    expect(busyStates, [true, false, true, false]);
    expect(result?.deletedTaskIds, ['task-child', 'task-root']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('canceling deletion does not send a request', (tester) async {
    var calls = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => FilledButton(
              onPressed: () => runTaskDeletionFlow(
                context,
                task: _task('failed'),
                onDelete: (cascade) async {
                  calls++;
                  return const TaskDeletionResult(
                    deletedTaskIds: ['task-root'],
                  );
                },
                onBusyChanged: (_) {},
              ),
              child: const Text('打开删除'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('打开删除'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();

    expect(calls, 0);
    expect(find.text('删除这件作品？'), findsNothing);
  });

  testWidgets('task card fits narrow width and isolates the delete action', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var opened = false;
    var deleted = false;

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(16),
              child: TaskCard(
                item: _task('succeeded'),
                onTap: () => opened = true,
                onDelete: () => deleted = true,
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.byTooltip('删除作品'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('删除作品'));
    await tester.pump();

    expect(deleted, isTrue);
    expect(opened, isFalse);
    expect(tester.takeException(), isNull);
  });
}
