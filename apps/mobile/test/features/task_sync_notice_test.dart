import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/tasks/task_sync.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';

void main() {
  test('creates a notice only when an active task reaches a final state', () {
    final notice = TaskSyncNotice.fromTransitions(
      [_task('task-1', 'succeeded')],
      {'task-1'},
    );

    expect(notice, isNotNull);
    expect(notice!.succeededCount, 1);
    expect(notice.failedCount, 0);
    expect(notice.isSingle, isTrue);
  });

  test('does not announce historical or canceled tasks', () {
    expect(
      TaskSyncNotice.fromTransitions([
        _task('historical', 'succeeded'),
      ], const {}),
      isNull,
    );
    expect(
      TaskSyncNotice.fromTransitions(
        [_task('canceled', 'canceled')],
        {'canceled'},
      ),
      isNull,
    );
  });

  test('summarizes mixed batch transitions', () {
    final notice = TaskSyncNotice.fromTransitions(
      [
        _task('done', 'succeeded'),
        _task('failed', 'failed'),
        _task('running', 'running'),
      ],
      {'done', 'failed', 'running'},
    );

    expect(notice, isNotNull);
    expect(notice!.tasks, hasLength(2));
    expect(notice.succeededCount, 1);
    expect(notice.failedCount, 1);
  });
}

TaskItem _task(String id, String status) => TaskItem(
  id: id,
  type: 't2i',
  model: 'test-model',
  status: status,
  prompt: '测试作品',
  params: const {},
  inputKeys: const [],
  costPoints: 0,
  createdAt: null,
  startedAt: null,
  finishedAt: null,
  thumbnailUrls: const [],
  displayUrls: const [],
  originalUrls: const [],
  errorCode: null,
  errorMessage: null,
);
