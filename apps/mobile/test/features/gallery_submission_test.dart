import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';
import 'package:starcloudsai_mobile/features/gallery/gallery.dart';
import 'package:starcloudsai_mobile/features/gallery/gallery_submission_ui.dart';
import 'package:starcloudsai_mobile/features/gallery/my_submissions_screen.dart';

GallerySubmission _submission(
  String id, {
  String status = 'pending',
  String title = '社区投稿作品',
  String? rejectReason,
}) => GallerySubmission.fromJson({
  'id': id,
  'taskId': 'task-$id',
  'title': title,
  'status': status,
  'rejectReason': rejectReason,
  'createdAt': '2026-08-24T08:00:00Z',
});

class _NoopApiClient extends ApiClient {
  _NoopApiClient()
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'http://localhost:8000',
        ),
        sessionStore: SessionStore(namespace: 'submission-test'),
      );

  @override
  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) => throw UnimplementedError();
}

class _QueuedGalleryRepository extends GalleryRepository {
  _QueuedGalleryRepository(this.pages) : super(_NoopApiClient());

  final List<FutureOr<GallerySubmissionPage> Function()> pages;

  @override
  Future<GallerySubmissionPage> mySubmissionsPage({
    String? cursor,
    int limit = 30,
  }) async => pages.removeAt(0)();
}

class _FakeSubmissionsController extends MyGallerySubmissionsController {
  @override
  Future<MyGallerySubmissionsState> build() async => MyGallerySubmissionsState(
    items: [
      _submission('pending', title: '等待审核的星空海报'),
      _submission('approved', status: 'approved', title: '已发布的城市插画'),
      _submission(
        'rejected',
        status: 'rejected',
        title: '需要调整的产品主图',
        rejectReason: '标题与作品内容不一致，请重新修改。',
      ),
    ],
    nextCursor: null,
  );
}

class _RecoveringSubmissionsController extends MyGallerySubmissionsController {
  int loadMoreCount = 0;

  @override
  Future<MyGallerySubmissionsState> build() async => MyGallerySubmissionsState(
    items: List.generate(
      8,
      (index) => _submission(
        'submission-$index',
        status: index.isEven ? 'pending' : 'approved',
        title: '第 ${index + 1} 件投稿作品',
      ),
    ),
    nextCursor: 'next-page',
  );

  @override
  Future<void> loadMore() async {
    final current = state.requireValue;
    if (!current.hasMore || current.isLoadingMore) return;
    loadMoreCount += 1;
    if (loadMoreCount == 1) throw StateError('temporary paging failure');
    state = AsyncData(current.copyWith(clearCursor: true));
  }
}

void main() {
  test('parses gallery categories and submission review details', () {
    final category = GalleryCategory.fromJson({
      'id': 'category-1',
      'name': '插画',
      'sort': 2,
    });
    final submission = GallerySubmission.fromJson({
      'id': 'submission-1',
      'taskId': 'task-1',
      'title': '星空城市',
      'status': 'rejected',
      'coverThumbUrl': '/api/v1/files/thumb.jpg',
      'mediaUrls': ['/api/v1/files/original.png'],
      'categoryId': 'category-1',
      'rejectReason': '画面包含不可识别文字',
      'reviewedAt': '2026-08-23T12:00:00Z',
      'createdAt': '2026-08-23T11:00:00Z',
    });

    expect(category.name, '插画');
    expect(category.sort, 2);
    expect(submission.taskId, 'task-1');
    expect(submission.coverUrl, '/api/v1/files/thumb.jpg');
    expect(submission.mediaUrls, ['/api/v1/files/original.png']);
    expect(submission.rejectReason, '画面包含不可识别文字');
    expect(submission.reviewedAt, isNotNull);
    expect(submission.isApproved, isFalse);
  });

  test('creates a concise default community title', () {
    final title = defaultGalleryTitle(List.filled(160, '星').join());

    expect(title.length, 121);
    expect(title.endsWith('…'), isTrue);
    expect(defaultGalleryTitle('  简短标题  '), '简短标题');
  });

  test('parses a cursor page and summarizes loaded review states', () {
    final page = GallerySubmissionPage.fromJson({
      'items': [
        {'id': '1', 'taskId': 't1', 'status': 'pending'},
        {'id': '2', 'taskId': 't2', 'status': 'approved'},
        {'id': '3', 'taskId': 't3', 'status': 'rejected'},
        {'id': '4', 'taskId': 't4', 'status': 'removed'},
      ],
      'nextCursor': 'next-page',
    });
    final summary = GallerySubmissionSummary.fromItems(
      page.items,
      hasMore: page.nextCursor != null,
    );

    expect(page.items, hasLength(4));
    expect(page.nextCursor, 'next-page');
    expect(summary.total, 4);
    expect(summary.pending, 1);
    expect(summary.approved, 1);
    expect(summary.needsAttention, 2);
    expect(summary.hasMore, isTrue);
  });

  test('searches submission title, status and rejection reason', () {
    final items = [
      _submission('pending', title: '等待审核的星空海报'),
      _submission('approved', status: 'approved', title: '已发布的城市插画'),
      _submission(
        'rejected',
        status: 'rejected',
        title: '需要调整的产品主图',
        rejectReason: '标题与作品内容不一致',
      ),
    ];

    expect(searchGallerySubmissions(items, '星空').map((item) => item.id), [
      'pending',
    ]);
    expect(searchGallerySubmissions(items, '已发布').map((item) => item.id), [
      'approved',
    ]);
    expect(searchGallerySubmissions(items, '内容不一致').map((item) => item.id), [
      'rejected',
    ]);
  });

  test('refresh supersedes an in-flight submission cursor page', () async {
    final oldPage = Completer<GallerySubmissionPage>();
    final repository = _QueuedGalleryRepository([
      () => GallerySubmissionPage(
        items: [_submission('initial')],
        nextCursor: 'cursor-2',
      ),
      () => oldPage.future,
      () => GallerySubmissionPage(
        items: [_submission('refreshed', title: '刷新后的投稿')],
        nextCursor: null,
      ),
    ]);
    final container = ProviderContainer(
      overrides: [galleryRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    final subscription = container.listen(
      myGallerySubmissionsControllerProvider,
      (_, _) {},
    );
    addTearDown(subscription.close);
    await container.read(myGallerySubmissionsControllerProvider.future);
    final controller = container.read(
      myGallerySubmissionsControllerProvider.notifier,
    );

    final loadingOldPage = controller.loadMore();
    await Future<void>.delayed(Duration.zero);
    await controller.refresh();
    oldPage.complete(
      GallerySubmissionPage(
        items: [_submission('stale', title: '旧分页投稿')],
        nextCursor: null,
      ),
    );
    await loadingOldPage;

    final state = container
        .read(myGallerySubmissionsControllerProvider)
        .requireValue;
    expect(state.items.map((item) => item.id), ['refreshed']);
    expect(state.hasMore, isFalse);
  });

  testWidgets('review status panel fits a narrow phone layout', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: GallerySubmissionStatusPanel(
              submission: GallerySubmission.fromJson({
                'id': 'submission-1',
                'taskId': 'task-1',
                'status': 'rejected',
                'rejectReason': '标题与作品内容不一致，请调整后重新投稿。',
              }),
            ),
          ),
        ),
      ),
    );

    expect(find.text('投稿未通过'), findsOneWidget);
    expect(find.textContaining('标题与作品内容不一致'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('submission sheet handles an empty category list', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () => showGallerySubmissionSheet(
                  context,
                  previewUrl: '',
                  initialTitle: '待投稿作品',
                  categories: const [],
                ),
                child: const Text('打开'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('打开'));
    await tester.pumpAndSettle();

    expect(find.text('投稿到社区'), findsOneWidget);
    expect(find.text('暂未设置分类，将投稿到全部作品'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '确认投稿'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('submission card fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: Scaffold(
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: GallerySubmissionCard(
              submission: GallerySubmission.fromJson({
                'id': 'submission-1',
                'taskId': 'task-1',
                'title': '一件标题较长但仍需在窄屏中保持完整操作区域的社区作品',
                'status': 'rejected',
                'rejectReason': '请调整作品标题后重新投稿',
              }),
              onTap: () {},
              onDelete: () {},
            ),
          ),
        ),
      ),
    );

    expect(find.text('未通过'), findsOneWidget);
    expect(find.byTooltip('撤回投稿'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('submission search combines with status filter on narrow UI', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          myGallerySubmissionsControllerProvider.overrideWith(
            _FakeSubmissionsController.new,
          ),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const MySubmissionsScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('submission-search')), '内容不一致');
    await tester.pump();
    expect(find.text('已显示 1 / 已加载 3'), findsOneWidget);
    expect(find.text('需要调整的产品主图'), findsOneWidget);

    await tester.tap(find.text('已发布').last);
    await tester.pump();
    expect(find.text('没有匹配的投稿'), findsOneWidget);
    expect(find.text('已显示 0 / 已加载 3'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('submission automatic paging failure stays inline and retries', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _RecoveringSubmissionsController controller;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          myGallerySubmissionsControllerProvider.overrideWith(
            () => controller = _RecoveringSubmissionsController(),
          ),
        ],
        child: const MaterialApp(home: MySubmissionsScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -1900));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.loadMoreCount, 1);
    expect(find.byKey(const Key('submission-load-more-error')), findsOneWidget);
    expect(find.text('更多投稿加载失败，请稍后重试'), findsOneWidget);
    expect(find.byKey(const Key('app-notice-card')), findsNothing);

    final retry = find.byKey(const Key('submission-load-more-retry'));
    await tester.ensureVisible(retry);
    await tester.pump();
    await tester.tap(retry);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.loadMoreCount, 2);
    expect(controller.state.requireValue.hasMore, isFalse);
    expect(find.byKey(const Key('submission-load-more-error')), findsNothing);
    expect(find.text('已加载全部投稿'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
