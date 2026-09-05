import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/gallery/gallery.dart';
import 'package:starcloudsai_mobile/features/tasks/task_detail_screen.dart';
import 'package:starcloudsai_mobile/features/tasks/task_sync.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';
import 'package:starcloudsai_mobile/features/tasks/works_screen.dart';

TaskItem _task(
  String id, {
  String status = 'succeeded',
  String prompt = '夏日产品海报',
  String model = 'image-fast',
  String type = 'text-to-image',
  Map<String, dynamic> params = const {},
}) => TaskItem(
  id: id,
  type: type,
  model: model,
  status: status,
  prompt: prompt,
  params: params,
  inputKeys: const [],
  costPoints: 8,
  createdAt: DateTime(2026, 8, 24, 12),
  startedAt: null,
  finishedAt: null,
  thumbnailUrls: const [],
  displayUrls: const [],
  originalUrls: const [],
  errorCode: null,
  errorMessage: null,
);

Map<String, dynamic> _taskJson(
  String id, {
  String status = 'succeeded',
  String prompt = '测试作品',
}) => {
  'id': id,
  'type': 'text-to-image',
  'model': 'image-fast',
  'status': status,
  'prompt': prompt,
  'createdAt': '2026-08-24T04:00:00Z',
};

class _StubApiClient extends ApiClient {
  _StubApiClient(this.responses)
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'http://localhost:8000',
        ),
        sessionStore: SessionStore(namespace: 'test'),
      );

  final List<FutureOr<dynamic> Function()> responses;
  final List<Map<String, dynamic>> queries = [];

  @override
  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    expect(path, '/tasks');
    queries.add({...?queryParameters});
    return responses.removeAt(0)();
  }
}

class _AuthenticatedSessionController extends SessionController {
  @override
  Future<SessionState> build() async => const SessionState(
    user: AppUser(id: 'user-1', email: 'qa@example.com', username: 'QA'),
  );
}

class _IdleTaskSyncController extends TaskSyncController {
  @override
  TaskSyncState build() => const TaskSyncState();

  @override
  Future<void> refreshNow() async {}
}

class _FakeTaskCenterController extends TaskCenterController {
  _FakeTaskCenterController({this.loadMoreGate});

  final Completer<void>? loadMoreGate;
  int loadMoreCount = 0;

  @override
  Future<TaskCenterState> build() async => TaskCenterState(
    items: [
      _task('task-1'),
      _task(
        'task-2',
        status: 'running',
        prompt: '复古人像插画',
        model: 'portrait-pro',
      ),
      _task('task-3', status: 'failed', prompt: '品牌标志草图'),
    ],
    nextCursor: 'next-page',
  );

  @override
  Future<void> loadMore() async {
    final current = state.requireValue;
    if (!current.hasMore || current.isLoadingMore) return;
    loadMoreCount += 1;
    if (loadMoreGate != null) {
      state = AsyncData(current.copyWith(isLoadingMore: true));
      await loadMoreGate!.future;
    }
    final latest = state.requireValue;
    state = AsyncData(
      latest.copyWith(
        items: [
          ...latest.items,
          _task('task-4', prompt: '山谷风景壁纸'),
        ],
        clearCursor: true,
        isLoadingMore: false,
      ),
    );
  }

  @override
  Future<void> refresh() async {}
}

class _RecoveringTaskCenterController extends _FakeTaskCenterController {
  @override
  Future<void> loadMore() async {
    final current = state.requireValue;
    if (!current.hasMore || current.isLoadingMore) return;
    loadMoreCount += 1;
    if (loadMoreCount == 1) throw StateError('temporary page failure');
    state = AsyncData(
      current.copyWith(
        items: [
          ...current.items,
          _task('task-4', prompt: '恢复后的作品'),
        ],
        clearCursor: true,
      ),
    );
  }
}

class _DeepSearchTaskCenterController extends TaskCenterController {
  int loadMoreCount = 0;

  @override
  Future<TaskCenterState> build() async => TaskCenterState(
    items: [_task('task-current', prompt: '当前页作品')],
    nextCursor: 'page-2',
  );

  @override
  Future<void> loadMore() async {
    final current = state.requireValue;
    if (!current.hasMore) return;
    loadMoreCount += 1;
    state = AsyncData(
      current.copyWith(
        items: [
          ...current.items,
          loadMoreCount == 1
              ? _task('task-older', prompt: '无关的旧作品')
              : _task('task-match', prompt: '山谷风景壁纸'),
        ],
        nextCursor: loadMoreCount == 1 ? 'page-3' : null,
        clearCursor: loadMoreCount > 1,
      ),
    );
  }

  @override
  Future<void> refresh() async {}
}

class _CachedDetailTaskCenterController extends TaskCenterController {
  @override
  Future<TaskCenterState> build() async => TaskCenterState(
    items: [
      TaskItem(
        id: 'cached-multi-image',
        type: 'text-to-image',
        model: 'image-pro',
        status: 'succeeded',
        prompt: '四图品牌视觉',
        params: const {'batchSize': 4},
        inputKeys: const [],
        costPoints: 12,
        createdAt: DateTime(2026, 8, 24, 12),
        startedAt: null,
        finishedAt: null,
        thumbnailUrls: const ['thumbnail'],
        displayUrls: const ['display-1', 'display-2', 'display-3', 'display-4'],
        originalUrls: const [
          'original-1',
          'original-2',
          'original-3',
          'original-4',
        ],
        errorCode: null,
        errorMessage: null,
        count: 4,
      ),
    ],
  );

  @override
  Future<void> refresh() async {}
}

Widget _worksApp({required TaskCenterController Function() controller}) {
  return ProviderScope(
    overrides: [
      sessionControllerProvider.overrideWith(
        _AuthenticatedSessionController.new,
      ),
      taskSyncControllerProvider.overrideWith(_IdleTaskSyncController.new),
      taskCenterControllerProvider.overrideWith(controller),
    ],
    child: MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: const TextScaler.linear(1.6)),
        child: child!,
      ),
      home: const WorksScreen(),
    ),
  );
}

Widget _worksRouterApp() {
  final router = GoRouter(
    initialLocation: '/works',
    routes: [
      GoRoute(
        path: '/works',
        builder: (context, state) => const WorksScreen(),
        routes: [
          GoRoute(
            path: ':id',
            builder: (context, state) => TaskDetailScreen(
              taskId: state.pathParameters['id']!,
              initialTask: state.extra as TaskItem?,
            ),
          ),
        ],
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      sessionControllerProvider.overrideWith(
        _AuthenticatedSessionController.new,
      ),
      taskSyncControllerProvider.overrideWith(_IdleTaskSyncController.new),
      taskCenterControllerProvider.overrideWith(
        _CachedDetailTaskCenterController.new,
      ),
      taskDetailProvider.overrideWith(
        (ref, id) async => throw StateError('detail unavailable'),
      ),
      gallerySubmissionForTaskProvider.overrideWith((ref, id) async => null),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

void main() {
  test('parses task pages and normalizes malformed data', () {
    final page = TaskPage.fromJson({
      'items': [_taskJson('task-1'), _taskJson(''), 'invalid'],
      'nextCursor': ' next-page ',
    });
    final malformed = TaskPage.fromJson({'items': 'invalid'});

    expect(page.items.map((item) => item.id), ['task-1']);
    expect(page.nextCursor, 'next-page');
    expect(malformed.items, isEmpty);
    expect(malformed.nextCursor, isNull);
  });

  test(
    'task center paginates with deduplication and supports live updates',
    () async {
      final api = _StubApiClient([
        () => {
          'items': [_taskJson('task-1'), _taskJson('task-2')],
          'nextCursor': 'cursor-2',
        },
        () => {
          'items': [_taskJson('task-2'), _taskJson('task-3')],
          'nextCursor': null,
        },
      ]);
      final container = ProviderContainer(
        overrides: [
          taskRepositoryProvider.overrideWithValue(TaskRepository(api)),
        ],
      );
      addTearDown(container.dispose);

      final first = await container.read(taskCenterControllerProvider.future);
      expect(first.items.map((item) => item.id), ['task-1', 'task-2']);
      expect(api.queries.first, {'limit': 24});

      final controller = container.read(taskCenterControllerProvider.notifier);
      await controller.loadMore();
      expect(api.queries.last, {'limit': 24, 'cursor': 'cursor-2'});
      expect(
        container
            .read(taskCenterControllerProvider)
            .requireValue
            .items
            .map((item) => item.id),
        ['task-1', 'task-2', 'task-3'],
      );

      controller.upsert(_task('task-2', status: 'running'));
      controller.upsert(_task('task-new', status: 'queued'));
      controller.removeIds(['task-1', 'missing']);
      final updated = container.read(taskCenterControllerProvider).requireValue;
      expect(updated.items.first.id, 'task-new');
      expect(
        updated.items.singleWhere((item) => item.id == 'task-2').status,
        'running',
      );
      expect(updated.items.map((item) => item.id), isNot(contains('task-1')));
    },
  );

  test('load-more failure keeps existing task content', () async {
    final api = _StubApiClient([
      () => {
        'items': [_taskJson('task-1')],
        'nextCursor': 'cursor-2',
      },
      () => throw StateError('page failed'),
    ]);
    final container = ProviderContainer(
      overrides: [
        taskRepositoryProvider.overrideWithValue(TaskRepository(api)),
      ],
    );
    addTearDown(container.dispose);
    await container.read(taskCenterControllerProvider.future);

    await expectLater(
      container.read(taskCenterControllerProvider.notifier).loadMore(),
      throwsStateError,
    );

    final state = container.read(taskCenterControllerProvider).requireValue;
    expect(state.items.map((item) => item.id), ['task-1']);
    expect(state.nextCursor, 'cursor-2');
    expect(state.isLoadingMore, isFalse);
  });

  test('refresh supersedes an in-flight cursor page', () async {
    final oldPage = Completer<dynamic>();
    final api = _StubApiClient([
      () => {
        'items': [_taskJson('task-old')],
        'nextCursor': 'cursor-2',
      },
      () => oldPage.future,
      () => {
        'items': [_taskJson('task-refreshed')],
        'nextCursor': null,
      },
    ]);
    final container = ProviderContainer(
      overrides: [
        taskRepositoryProvider.overrideWithValue(TaskRepository(api)),
      ],
    );
    addTearDown(container.dispose);
    final subscription = container.listen(
      taskCenterControllerProvider,
      (_, _) {},
    );
    addTearDown(subscription.close);
    await container.read(taskCenterControllerProvider.future);
    final controller = container.read(taskCenterControllerProvider.notifier);

    final loadingOldPage = controller.loadMore();
    await Future<void>.delayed(Duration.zero);
    await controller.refresh();
    oldPage.complete({
      'items': [_taskJson('task-stale')],
      'nextCursor': null,
    });
    await loadingOldPage;

    final state = container.read(taskCenterControllerProvider).requireValue;
    expect(state.items.map((item) => item.id), ['task-refreshed']);
    expect(state.hasMore, isFalse);
  });

  test('search combines prompt, model and type with status filtering', () {
    final items = [
      _task('task-1', prompt: '夏日产品海报'),
      _task('task-2', status: 'running', prompt: '人像', model: 'PORTRAIT-PRO'),
      _task('task-3', status: 'failed', type: 'IMAGE-TO-IMAGE'),
    ];

    expect(
      filterTasksForWorks(
        items,
        filter: WorksTaskFilter.succeeded,
        query: '产品 image-fast',
      ).map((item) => item.id),
      ['task-1'],
    );
    expect(
      filterTasksForWorks(
        items,
        filter: WorksTaskFilter.running,
        query: 'portrait',
      ).map((item) => item.id),
      ['task-2'],
    );
    expect(
      filterTasksForWorks(
        items,
        filter: WorksTaskFilter.all,
        type: 't2i',
      ).map((item) => item.id),
      ['task-1', 'task-2'],
    );
    expect(
      filterTasksForWorks(
        items,
        filter: WorksTaskFilter.failed,
        query: 'image-to-image',
      ).map((item) => item.id),
      ['task-3'],
    );
    expect(
      filterTasksForWorks(
        items,
        filter: WorksTaskFilter.all,
        query: '产品 portrait',
      ),
      isEmpty,
    );
    expect(
      filterTasksForWorks(
        [...items, _task('task-4', type: 'coloring', prompt: '线稿上色')],
        filter: WorksTaskFilter.all,
        type: 't2i',
      ).map((item) => item.id),
      ['task-1', 'task-2'],
    );
  });

  test('groups works into local calendar days', () {
    final items = worksTimeline([
      _task('task-1', prompt: '今天的海报'),
      _task('task-2', prompt: '同一天的插画'),
      TaskItem(
        id: 'task-3',
        type: 'text-to-image',
        model: 'image-fast',
        status: 'succeeded',
        prompt: '更早的记录',
        params: const {},
        inputKeys: const [],
        costPoints: 8,
        createdAt: DateTime(2026, 8, 22, 9),
        startedAt: null,
        finishedAt: null,
        thumbnailUrls: const [],
        displayUrls: const [],
        originalUrls: const [],
        errorCode: null,
        errorMessage: null,
      ),
    ]);

    expect(items.where((item) => item.label != null), hasLength(2));
    expect(items.where((item) => item.task != null), hasLength(3));
    expect(
      worksTimelineGroups([
        _task('task-1', prompt: '今天的海报'),
        _task('task-2', prompt: '同一天的插画'),
      ]).single.items.map((item) => item.id),
      ['task-1', 'task-2'],
    );
  });

  test('history cover aspect follows generation ratio', () {
    expect(worksTaskCoverAspect(_task('square')), closeTo(4 / 5, 0.001));
    expect(worksTaskCoverAspect(_task('failed', status: 'failed')), 1);
    expect(
      worksTaskCoverAspect(
        _task('wide', params: const {'requestedAspectRatio': '16:9'}),
      ),
      closeTo(16 / 9, 0.001),
    );
    expect(
      worksTaskCoverAspect(_task('sized', params: const {'size': '1920x1080'})),
      closeTo(16 / 9, 0.001),
    );
  });

  testWidgets('works search and filters fit narrow large text', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _worksApp(controller: _FakeTaskCenterController.new),
    );
    await tester.pump();
    await tester.pump();

    await tester.enterText(find.byKey(const Key('works-search')), '产品');
    await tester.pump();
    expect(find.text('已显示 1 / 已加载 3'), findsOneWidget);
    expect(find.text('夏日产品海报'), findsOneWidget);

    await tester.ensureVisible(
      find.byKey(const Key('works-status-filter-生成中')),
    );
    await tester.tap(find.byKey(const Key('works-status-filter-生成中')));
    await tester.pump();
    expect(find.text('没有匹配的作品'), findsOneWidget);
    expect(find.text('还可以继续查找更早的历史记录'), findsOneWidget);
    expect(find.text('查找更多历史'), findsOneWidget);
    final search = tester.widget<TextField>(
      find.byKey(const Key('works-search')),
    );
    final border = search.decoration!.border! as OutlineInputBorder;
    expect(border.borderRadius, BorderRadius.circular(8));
    expect(tester.takeException(), isNull);
  });

  testWidgets('search action continues into older pages until a match', (
    tester,
  ) async {
    late _DeepSearchTaskCenterController controller;
    await tester.pumpWidget(
      _worksApp(
        controller: () => controller = _DeepSearchTaskCenterController(),
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.enterText(
      find.byKey(const Key('works-search')),
      '山谷 image-fast',
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();

    expect(controller.loadMoreCount, 2);
    expect(find.text('山谷风景壁纸'), findsOneWidget);
    expect(find.text('没有匹配的作品'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('works type filters only keep text-to-image', (tester) async {
    await tester.pumpWidget(
      _worksApp(controller: _FakeTaskCenterController.new),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('works-type-filters')), findsOneWidget);
    expect(find.text('文生图'), findsWidgets);
    expect(find.text('插画染色'), findsNothing);
    expect(find.text('模型设计'), findsNothing);
    expect(find.text('背景移除'), findsNothing);
    await tester.tap(find.byKey(const Key('works-type-filter-文生图')));
    await tester.pump();
    expect(find.text('夏日产品海报'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'opening a work carries its cached task into failed detail sync',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(_worksRouterApp());
      await tester.pumpAndSettle();

      await tester.tap(find.byType(TaskCard).first);
      await tester.pumpAndSettle();

      expect(find.text('作品详情'), findsOneWidget);
      expect(find.byKey(const Key('task-detail-cache-notice')), findsOneWidget);
      expect(find.text('详情同步失败，已显示列表中的作品数据'), findsOneWidget);
      expect(find.text('保存全部'), findsOneWidget);
      expect(find.text('详情未同步'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('history uses two-column masonry', (tester) async {
    await tester.pumpWidget(
      _worksApp(controller: _FakeTaskCenterController.new),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('works-masonry')), findsWidgets);
    final grid = tester.widget<SliverMasonryGrid>(
      find.byType(SliverMasonryGrid).first,
    );
    expect(
      grid.gridDelegate,
      isA<SliverSimpleGridDelegateWithFixedCrossAxisCount>().having(
        (delegate) => delegate.crossAxisCount,
        'crossAxisCount',
        2,
      ),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('scrolling near the footer automatically loads the next page', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 520));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final loadMoreGate = Completer<void>();
    late _FakeTaskCenterController controller;
    await tester.pumpWidget(
      _worksApp(
        controller: () =>
            controller = _FakeTaskCenterController(loadMoreGate: loadMoreGate),
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -900));
    await tester.pump();

    expect(controller.loadMoreCount, 1);
    expect(find.text('正在自动加载更多作品'), findsOneWidget);

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -120));
    await tester.pump();
    expect(controller.loadMoreCount, 1);

    loadMoreGate.complete();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(controller.state.requireValue.items.last.prompt, '山谷风景壁纸');
    expect(controller.state.requireValue.hasMore, isFalse);
    final scrollable = tester.state<ScrollableState>(
      find
          .descendant(
            of: find.byType(CustomScrollView),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    for (var index = 0; index < 3; index += 1) {
      scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
      await tester.pump();
    }
    expect(find.text('已加载全部作品'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('automatic pagination failure shows an inline retry', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 520));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _RecoveringTaskCenterController controller;
    await tester.pumpWidget(
      _worksApp(
        controller: () => controller = _RecoveringTaskCenterController(),
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -900));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.loadMoreCount, 1);
    expect(find.byKey(const Key('works-load-more-error')), findsOneWidget);
    expect(find.text('更多作品加载失败，请稍后重试'), findsOneWidget);

    await tester.tap(find.byKey(const Key('works-load-more-retry')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.loadMoreCount, 2);
    expect(controller.state.requireValue.items.last.prompt, '恢复后的作品');
    expect(find.byKey(const Key('works-load-more-error')), findsNothing);
    final scrollable = tester.state<ScrollableState>(
      find
          .descendant(
            of: find.byType(CustomScrollView),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    for (var index = 0; index < 3; index += 1) {
      scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
      await tester.pump();
    }
    expect(find.text('已加载全部作品'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
