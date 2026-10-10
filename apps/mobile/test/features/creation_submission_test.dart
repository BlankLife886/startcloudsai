import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/network/api_exception.dart';
import 'package:starcloudsai_mobile/core/providers.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';
import 'package:starcloudsai_mobile/core/widgets/app_visual.dart';
import 'package:starcloudsai_mobile/features/create/create.dart';
import 'package:starcloudsai_mobile/features/create/create_screen.dart';
import 'package:starcloudsai_mobile/features/create/creation_draft.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';
import 'package:starcloudsai_mobile/features/tasks/task_sync.dart';

const _model = ImageModelOption(
  id: 'test-model',
  name: 'Test model',
  description: '',
  resolutions: ['1K'],
  aspectRatios: ['1:1'],
  qualities: ['medium'],
  maxImages: 4,
  maxReferenceImages: 6,
  pricePoints: 0,
);

class _BatchApi extends ApiClient {
  _BatchApi()
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'http://localhost',
        ),
        sessionStore: SessionStore(namespace: 'test'),
      );

  final requests = <Map<String, dynamic>>[];
  final committed = <String, String>{};
  int? failAt = 2;
  bool commitBeforeFailure = false;

  @override
  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async => <String, dynamic>{};

  @override
  Future<dynamic> post(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    expect(path, '/tasks');
    final payload = Map<String, dynamic>.from(data! as Map);
    requests.add(payload);
    final key = payload['idempotencyKey'] as String;
    if (requests.length == failAt) {
      if (commitBeforeFailure) committed[key] = 'task-${committed.length}';
      throw const ApiException(
        code: 'network_error',
        message: 'Connection interrupted',
      );
    }
    return {
      'task': {
        'id': committed.putIfAbsent(key, () => 'task-${committed.length}'),
      },
    };
  }
}

Future<TextToImageBatch> _submit(
  CreationRepository repository, {
  int count = 4,
}) => repository.createTextToImage(
  prompt: 'Original prompt',
  model: _model,
  aspectRatio: '1:1',
  resolution: '1K',
  quality: 'medium',
  count: count,
  inputKeys: ['uploads/reference.jpg'],
);

class _Session extends SessionController {
  @override
  SessionState build() => const SessionState(
    user: AppUser(id: 'test-user', email: 'qa@example.invalid', username: 'QA'),
  );
}

class _Draft implements CreationDraftStore {
  int clearCount = 0;
  @override
  Future<CreationDraft?> read() async => CreationDraft(
    prompt: 'Original prompt',
    count: 4,
    modelId: _model.id,
    updatedAt: DateTime(2026),
  );
  @override
  Future<void> write(CreationDraft draft) async {}
  @override
  Future<void> clear() async {
    clearCount++;
  }
}

class _Center extends TaskCenterController {
  @override
  Future<TaskCenterState> build() async => const TaskCenterState(items: []);
}

class _Sync extends TaskSyncController {
  @override
  TaskSyncState build() => const TaskSyncState();
}

void main() {
  testWidgets(
    'screen retains a partial batch and draft until explicit recovery succeeds',
    (tester) async {
      final api = _BatchApi();
      final draft = _Draft();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            creationRepositoryProvider.overrideWithValue(
              CreationRepository(api),
            ),
            sessionControllerProvider.overrideWith(_Session.new),
            creationDraftStoreProvider.overrideWithValue(draft),
            runtimeCreationConfigProvider.overrideWith(
              (ref) async =>
                  const RuntimeCreationConfig(enabled: true, models: [_model]),
            ),
            taskListProvider.overrideWith((ref) async => []),
            taskCenterControllerProvider.overrideWith(_Center.new),
            taskSyncControllerProvider.overrideWith(_Sync.new),
          ],
          child: MaterialApp(
            theme: StarCloudsTheme.light(),
            home: const CreateScreen(),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.byKey(const Key('creation-submit')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('提交中断 · 已确认 1/4 张'), findsOneWidget);
      expect(api.requests.length, 2);
      expect(draft.clearCount, 0);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('creation-prompt')))
            .readOnly,
        isTrue,
      );
      await tester.tap(find.byKey(const Key('creation-submit')));
      await tester.pump();
      expect(api.requests.length, 2);
      await tester.tap(find.text('恢复提交'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const Key('creation-submission-notice')), findsNothing);
      expect(api.committed.length, 4);
      expect(draft.clearCount, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  test(
    'partial submission retains confirmed tasks and resumes remaining slots',
    () async {
      final api = _BatchApi();
      final repository = CreationRepository(api);
      final partial = await _submit(repository);
      expect(partial.taskIds, ['task-0']);
      expect(partial.isComplete, isFalse);
      expect(partial.requestedCount, 4);
      expect(api.requests.length, 2);
      final failedKey = api.requests.last['idempotencyKey'];
      api.failAt = null;
      final resumed = await repository.submitTextToImageBatch(
        partial.request!,
        completedTaskIds: partial.taskIds,
      );
      expect(resumed.isComplete, isTrue);
      expect(resumed.taskIds, ['task-0', 'task-1', 'task-2', 'task-3']);
      expect(api.requests[2]['idempotencyKey'], failedKey);
      expect(api.requests[2], api.requests[1]);
      expect(
        api.requests
            .where(
              (request) =>
                  request['idempotencyKey'] ==
                  api.requests.first['idempotencyKey'],
            )
            .length,
        1,
      );
      expect(resumed.batchId, partial.batchId);
      expect(api.committed.length, 4);
    },
  );

  test(
    'lost acknowledgement reuses server task without a second chargeable task',
    () async {
      final api = _BatchApi()..commitBeforeFailure = true;
      final repository = CreationRepository(api);
      final partial = await _submit(repository);
      expect(api.committed.length, 2);
      final resumed = await repository.submitTextToImageBatch(
        partial.request!,
        completedTaskIds: partial.taskIds,
      );
      expect(resumed.taskIds.toSet().length, 4);
      expect(api.committed.length, 4);
      expect(
        api.requests[2]['idempotencyKey'],
        api.requests[1]['idempotencyKey'],
      );
    },
  );

  test(
    'first request failure is recoverable and never automatically retried',
    () async {
      final api = _BatchApi()..failAt = 1;
      final repository = CreationRepository(api);
      final partial = await _submit(repository, count: 1);
      expect(partial.taskIds, isEmpty);
      expect(partial.error, isA<ApiException>());
      expect(api.requests.length, 1);
      final resumed = await repository.submitTextToImageBatch(partial.request!);
      expect(resumed.isComplete, isTrue);
      expect(resumed.taskIds.length, 1);
      expect(api.requests.first, api.requests.last);
      expect(resumed.batchId, isEmpty);
    },
  );

  test('request snapshots reference keys and respects model capacity', () {
    final keys = ['original'];
    final request = TextToImageRequest(
      prompt: 'Prompt',
      model: _model,
      aspectRatio: '1:1',
      resolution: '1K',
      quality: 'medium',
      count: 12,
      inputKeys: keys,
    );
    keys.clear();
    expect(request.inputKeys, ['original']);
    expect(request.count, 4);
    expect(request.idempotencyKeys.toSet().length, 4);
  });

  testWidgets('recovery notice fits a narrow screen with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var resumed = false;
    var ended = false;
    await tester.pumpWidget(
      MaterialApp(
        theme: StarCloudsTheme.light(),
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
          child: Scaffold(
            body: CreationSubmissionNotice(
              confirmedCount: 2,
              requestedCount: 4,
              onResume: () => resumed = true,
              onEnd: () => ended = true,
            ),
          ),
        ),
      ),
    );
    expect(find.text('提交中断 · 已确认 2/4 张'), findsOneWidget);
    await tester.tap(find.text('恢复提交'));
    await tester.tap(find.text('结束本次提交'));
    expect(resumed, isTrue);
    expect(ended, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'activity indicator becomes static for reduced motion and hidden views',
    (tester) async {
      Future<void> mount({bool reduce = false, bool visible = true}) =>
          tester.pumpWidget(
            MaterialApp(
              home: MediaQuery(
                data: MediaQueryData(disableAnimations: reduce),
                child: TickerMode(
                  enabled: visible,
                  child: const Center(child: AppActivityIndicator()),
                ),
              ),
            ),
          );
      await mount(reduce: true);
      expect(
        tester
            .widget<CircularProgressIndicator>(
              find.byType(CircularProgressIndicator),
            )
            .value,
        .7,
      );
      await tester.pumpAndSettle();
      await mount(visible: false);
      expect(
        tester
            .widget<CircularProgressIndicator>(
              find.byType(CircularProgressIndicator),
            )
            .value,
        .7,
      );
      await mount();
      expect(
        tester
            .widget<CircularProgressIndicator>(
              find.byType(CircularProgressIndicator),
            )
            .value,
        isNull,
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(
        tester
            .widget<CircularProgressIndicator>(
              find.byType(CircularProgressIndicator),
            )
            .value,
        .7,
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(
        tester
            .widget<CircularProgressIndicator>(
              find.byType(CircularProgressIndicator),
            )
            .value,
        isNull,
      );
      await tester.pumpWidget(const SizedBox());
    },
  );
}
