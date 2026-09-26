import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';
import 'package:starcloudsai_mobile/features/create/create.dart';
import 'package:starcloudsai_mobile/features/gallery/gallery.dart';
import 'package:starcloudsai_mobile/features/tasks/task_detail_screen.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';

class _CancelApi extends ApiClient {
  _CancelApi()
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'http://localhost',
        ),
        sessionStore: SessionStore(namespace: 'task-lifecycle-test'),
      );

  Map<String, dynamic>? capturedRequest;

  @override
  Future<dynamic> patch(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    expect(path, '/tasks/task-1');
    capturedRequest = Map<String, dynamic>.from(data! as Map);
    return {'id': 'task-1', 'status': 'canceled'};
  }
}

TaskItem _running() => TaskItem.fromJson({
  'id': 'task-1',
  'type': 't2i',
  'status': 'running',
  'prompt': '测试生成',
  'createdAt': '2026-09-07T00:00:00Z',
  'cancelPolicy': {
    'allowed': true,
    'mode': 'abandon_upstream',
    'upstreamSubmitted': true,
    'refunded': false,
    'message': '已提交上游，本次积分不会退回。',
  },
});

void main() {
  test(
    'task cancellation parses server policy and sends explicit consent',
    () async {
      final api = _CancelApi();
      final task = _running();
      expect(task.cancelPolicy?.mode, 'abandon_upstream');
      expect(task.cancelPolicy?.upstreamSubmitted, isTrue);
      expect(task.cancelPolicy?.refunded, isFalse);
      expect(task.canCancel, isTrue);
      expect(task.cancelConfirmationMessage, contains('不会退回'));
      await TaskRepository(api).cancel(task.id, acknowledgeUpstream: true);
      expect(api.capturedRequest, {
        'status': 'canceled',
        'acknowledgeUpstream': true,
      });
      final denied = TaskItem.fromJson({
        'status': 'running',
        'cancelPolicy': {'allowed': false},
      });
      expect(denied.canCancel, isFalse);
      final queued = TaskItem.fromJson({
        'status': 'queued',
        'cancelPolicy': {
          'allowed': true,
          'mode': 'immediate',
          'refunded': true,
          'message': '取消会退回积分。',
        },
      });
      expect(queued.cancelConfirmationMessage, contains('若确认时已提交上游'));
    },
  );

  testWidgets(
    'confirming stop acknowledges upstream while declining does not send',
    (tester) async {
      final api = _CancelApi();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            taskRepositoryProvider.overrideWithValue(TaskRepository(api)),
            taskDetailProvider.overrideWith(
              (ref, id) async => api.capturedRequest == null
                  ? _running()
                  : TaskItem.fromJson({'id': id, 'status': 'canceled'}),
            ),
            gallerySubmissionForTaskProvider.overrideWith(
              (ref, id) async => null,
            ),
          ],
          child: const MaterialApp(home: TaskDetailScreen(taskId: 'task-1')),
        ),
      );
      await tester.pump();
      await tester.tap(find.text('停止生成'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('不会退回'), findsOneWidget);
      await tester.tap(find.text('继续等待'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(api.capturedRequest, isNull);
      await tester.tap(find.text('停止生成'));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.text('停止任务'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(api.capturedRequest?['acknowledgeUpstream'], isTrue);
      await tester.pumpWidget(const SizedBox());
    },
  );

  test('total task time includes queue and earlier attempts on mobile', () {
    final created = DateTime.utc(2026, 9, 7);
    final lastAttempt = created.add(const Duration(seconds: 70));
    final finished = created.add(const Duration(seconds: 100));
    for (final active in [true, false]) {
      expect(
        creationElapsedDuration(
          active: active,
          createdAt: created,
          startedAt: lastAttempt,
          finishedAt: active ? null : finished,
          now: finished,
        ),
        const Duration(seconds: 100),
      );
    }
    final task = TaskItem.fromJson({
      'createdAt': created.toIso8601String(),
      'startedAt': lastAttempt.toIso8601String(),
      'finishedAt': finished.toIso8601String(),
      'status': 'succeeded',
    });
    expect(task.duration, const Duration(seconds: 100));
    expect(
      creationGroupElapsedDuration(tasks: [task, task], active: false),
      const Duration(seconds: 100),
    );
    expect(
      creationElapsedDuration(active: true, createdAt: created, now: finished),
      const Duration(seconds: 100),
    );
    expect(creationElapsedDuration(active: false, createdAt: created), isNull);
  });
}
