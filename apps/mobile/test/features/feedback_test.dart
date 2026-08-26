import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';
import 'package:starcloudsai_mobile/features/feedback/feedback.dart';
import 'package:starcloudsai_mobile/features/feedback/feedback_screen.dart';

Map<String, dynamic> _feedbackJson({
  required String id,
  required String status,
  String category = 'bug',
  String title = '生成结果数量与提交数量不一致',
  String content = '提交多张图片后只显示部分结果，希望能够检查剩余任务的同步状态。',
  String? adminReply,
  bool adopted = false,
  int reward = 0,
}) => {
  'id': id,
  'category': category,
  'title': title,
  'content': content,
  'pageUrl': '/mobile/profile/feedback',
  'status': status,
  'adminReply': adminReply,
  'adopted': adopted,
  'rewardCents': reward,
  'rewardedAt': adopted ? '2026-08-24T08:30:00Z' : null,
  'handledAt': status == 'resolved' ? '2026-08-24T08:20:00Z' : null,
  'createdAt': '2026-08-24T08:00:00Z',
  'updatedAt': '2026-08-24T08:20:00Z',
};

final _initialFeedback = [
  UserFeedbackItem.fromJson(_feedbackJson(id: 'open-1', status: 'open')),
  UserFeedbackItem.fromJson(
    _feedbackJson(
      id: 'progress-1',
      status: 'in_progress',
      category: 'generation',
      title: '参考图生成结果需要进一步优化',
    ),
  ),
  UserFeedbackItem.fromJson(
    _feedbackJson(
      id: 'adopted-1',
      status: 'resolved',
      category: 'suggestion',
      title: '建议增加作品状态筛选器',
      adminReply: '建议已采纳并进入产品计划，感谢你的反馈。',
      adopted: true,
      reward: 120,
    ),
  ),
];

FeedbackCenterState _feedbackState() =>
    FeedbackCenterState(items: _initialFeedback, nextCursor: null);

class _NoopApiClient extends ApiClient {
  _NoopApiClient()
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'http://localhost:8000',
        ),
        sessionStore: SessionStore(namespace: 'feedback-test'),
      );

  @override
  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) => throw UnimplementedError();
}

class _QueuedFeedbackRepository extends FeedbackRepository {
  _QueuedFeedbackRepository(this.pages) : super(_NoopApiClient());

  final List<FutureOr<FeedbackPage> Function()> pages;

  @override
  Future<FeedbackPage> list({String? cursor, int limit = 24}) async =>
      pages.removeAt(0)();
}

class _FakeFeedbackController extends FeedbackCenterController {
  @override
  Future<FeedbackCenterState> build() async => _feedbackState();

  @override
  Future<void> refresh() async {}

  @override
  Future<void> loadMore() async {}

  @override
  Future<UserFeedbackItem> submit({
    required FeedbackCategory category,
    required String title,
    required String content,
  }) async {
    final item = UserFeedbackItem.fromJson(
      _feedbackJson(
        id: 'new-feedback',
        status: 'open',
        category: category.apiValue,
        title: title.trim(),
        content: content.trim(),
      ),
    );
    final current = state.requireValue;
    state = AsyncData(
      FeedbackCenterState(
        items: [item, ...current.items],
        nextCursor: current.nextCursor,
      ),
    );
    return item;
  }
}

class _RecoveringFeedbackController extends FeedbackCenterController {
  int loadMoreCount = 0;

  @override
  Future<FeedbackCenterState> build() async => FeedbackCenterState(
    items: List.generate(
      8,
      (index) => UserFeedbackItem.fromJson(
        _feedbackJson(
          id: 'feedback-$index',
          status: index.isEven ? 'open' : 'resolved',
          title: '第 ${index + 1} 条反馈记录',
          content: '用于验证自动加载失败后的内联恢复操作。',
        ),
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
  test('parses feedback status, reply and adoption reward', () {
    final item = UserFeedbackItem.fromJson(
      _feedbackJson(
        id: 'feedback-1',
        status: 'resolved',
        category: 'suggestion',
        adminReply: '已加入开发计划。',
        adopted: true,
        reward: 80,
      ),
    );
    final page = FeedbackPage.fromJson({
      'items': [
        _feedbackJson(id: 'feedback-1', status: 'resolved'),
        {'id': ''},
      ],
      'nextCursor': 'next-page',
    });

    expect(item.category, FeedbackCategory.suggestion);
    expect(item.status, FeedbackStatus.resolved);
    expect(item.isFinished, isTrue);
    expect(item.adminReply, '已加入开发计划。');
    expect(item.adopted, isTrue);
    expect(item.rewardPoints, 80);
    expect(page.items, hasLength(1));
    expect(page.nextCursor, 'next-page');
  });

  test('validates feedback fields using the server limits', () {
    expect(validateFeedbackTitle('短'), isNotNull);
    expect(validateFeedbackTitle('这是有效标题'), isNull);
    expect(validateFeedbackTitle(List.filled(121, '题').join()), isNotNull);
    expect(validateFeedbackContent('内容太短'), isNotNull);
    expect(validateFeedbackContent('这里是一段足够完整的问题描述内容。'), isNull);
    expect(validateFeedbackContent(List.filled(3001, '描').join()), isNotNull);
  });

  test('searches feedback title, content, category, status and reply', () {
    expect(
      searchFeedbackItems(_initialFeedback, '产品计划').map((item) => item.id),
      ['adopted-1'],
    );
    expect(
      searchFeedbackItems(_initialFeedback, '生成效果').map((item) => item.id),
      ['progress-1'],
    );
    expect(
      searchFeedbackItems(_initialFeedback, '处理中').map((item) => item.id),
      ['progress-1'],
    );
    expect(searchFeedbackItems(_initialFeedback, '  '), hasLength(3));
  });

  test('summarizes processing, finished and adopted feedback', () {
    final state = _feedbackState();

    expect(state.openCount, 2);
    expect(state.finishedCount, 1);
    expect(state.adoptedCount, 1);
  });

  test('refresh supersedes an in-flight feedback cursor page', () async {
    final oldPage = Completer<FeedbackPage>();
    final refreshed = UserFeedbackItem.fromJson(
      _feedbackJson(id: 'feedback-refreshed', status: 'open', title: '刷新后的反馈'),
    );
    final repository = _QueuedFeedbackRepository([
      () =>
          FeedbackPage(items: [_initialFeedback.first], nextCursor: 'cursor-2'),
      () => oldPage.future,
      () => FeedbackPage(items: [refreshed], nextCursor: null),
    ]);
    final container = ProviderContainer(
      overrides: [feedbackRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    final subscription = container.listen(
      feedbackCenterControllerProvider,
      (_, _) {},
    );
    addTearDown(subscription.close);
    await container.read(feedbackCenterControllerProvider.future);
    final controller = container.read(
      feedbackCenterControllerProvider.notifier,
    );

    final loadingOldPage = controller.loadMore();
    await Future<void>.delayed(Duration.zero);
    await controller.refresh();
    oldPage.complete(
      FeedbackPage(
        items: [
          UserFeedbackItem.fromJson(
            _feedbackJson(
              id: 'feedback-stale',
              status: 'closed',
              title: '旧分页反馈',
            ),
          ),
        ],
        nextCursor: null,
      ),
    );
    await loadingOldPage;

    final state = container.read(feedbackCenterControllerProvider).requireValue;
    expect(state.items.map((item) => item.id), ['feedback-refreshed']);
    expect(state.hasMore, isFalse);
  });

  testWidgets('feedback screen fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          feedbackCenterControllerProvider.overrideWith(
            _FakeFeedbackController.new,
          ),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const FeedbackScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('提交新反馈'), findsOneWidget);
    expect(find.text('全部反馈'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.scrollUntilVisible(
      find.text('生成结果数量与提交数量不一致'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('feedback search combines with status filter on narrow UI', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          feedbackCenterControllerProvider.overrideWith(
            _FakeFeedbackController.new,
          ),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const FeedbackScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('feedback-search')), '产品计划');
    await tester.pump();
    expect(find.text('已显示 1 / 已加载 3'), findsOneWidget);
    expect(find.text('建议增加作品状态筛选器'), findsOneWidget);

    await tester.tap(find.byKey(const Key('feedback-filter-处理中')));
    await tester.pump();
    expect(find.text('没有匹配的反馈'), findsOneWidget);
    expect(find.text('已显示 0 / 已加载 3'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('feedback automatic paging failure stays inline and retries', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _RecoveringFeedbackController controller;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          feedbackCenterControllerProvider.overrideWith(
            () => controller = _RecoveringFeedbackController(),
          ),
        ],
        child: const MaterialApp(home: FeedbackScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -2200));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.loadMoreCount, 1);
    expect(find.byKey(const Key('feedback-load-more-error')), findsOneWidget);
    expect(find.text('更多反馈加载失败，请稍后重试'), findsOneWidget);
    expect(find.byKey(const Key('app-notice-card')), findsNothing);

    await tester.tap(find.byKey(const Key('feedback-load-more-retry')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.loadMoreCount, 2);
    expect(controller.state.requireValue.hasMore, isFalse);
    expect(find.byKey(const Key('feedback-load-more-error')), findsNothing);
    expect(find.text('已显示全部反馈'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('submitting feedback prepends it to the list', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          feedbackCenterControllerProvider.overrideWith(
            _FakeFeedbackController.new,
          ),
        ],
        child: const MaterialApp(home: FeedbackScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('提交新反馈'));
    await tester.pumpAndSettle();
    expect(find.byType(FeedbackComposerSheet), findsOneWidget);

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), '希望增加作品批量管理功能');
    await tester.enterText(fields.at(1), '希望作品列表支持批量选择与分类管理，提高整理效率。');
    await tester.tap(find.widgetWithText(FilledButton, '提交反馈'));
    await tester.pumpAndSettle();

    expect(find.byType(FeedbackComposerSheet), findsNothing);
    expect(find.text('希望增加作品批量管理功能'), findsOneWidget);
    expect(find.text('反馈已提交，我们会尽快处理'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('adopted feedback detail shows reply, progress and reward', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => FeedbackCard(
              item: _initialFeedback.last,
              onTap: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (context) =>
                    FeedbackDetailSheet(item: _initialFeedback.last),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('建议增加作品状态筛选器'));
    await tester.pumpAndSettle();

    expect(find.text('处理回复'), findsOneWidget);
    expect(find.textContaining('建议已采纳并进入产品计划'), findsOneWidget);
    expect(find.textContaining('120 积分奖励已到账'), findsOneWidget);
    expect(find.text('已提交'), findsOneWidget);
    expect(find.text('已完成'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('feedback card keeps long content inside a narrow layout', (
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
            child: FeedbackCard(item: _initialFeedback.last, onTap: () {}),
          ),
        ),
      ),
    );

    expect(find.text('建议已采纳 · +120 积分'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
