import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/notifications/notification_center_screen.dart';
import 'package:starcloudsai_mobile/features/notifications/notifications.dart';

class _FakeNotificationController extends NotificationCenterController {
  int markReadCount = 0;

  @override
  Future<NotificationCenterState> build() async => NotificationCenterState(
    items: [
      AppNotification.fromJson({
        'id': 'task-notification',
        'kind': 'task',
        'title': '作品已完成',
        'body': '你的作品已经可以查看。',
        'createdAt': '2026-08-24T01:00:00Z',
      }),
    ],
    nextCursor: null,
    unread: 1,
  );

  @override
  Future<void> markRead(String id) async {
    markReadCount += 1;
    final current = state.requireValue;
    state = AsyncData(
      current.copyWith(
        items: current.items
            .map((item) => item.id == id ? item.markRead() : item)
            .toList(),
        unread: 0,
      ),
    );
  }
}

AppNotification _notification(
  String id, {
  String kind = 'system',
  String title = '系统通知',
  String body = '',
  bool read = false,
}) => AppNotification.fromJson({
  'id': id,
  'kind': kind,
  'title': title,
  'body': body,
  if (read) 'readAt': '2026-08-24T01:05:00Z',
  'createdAt': '2026-08-24T01:00:00Z',
});

class _SearchNotificationController extends NotificationCenterController {
  @override
  Future<NotificationCenterState> build() async => NotificationCenterState(
    items: [
      _notification(
        'task-1',
        kind: 'task',
        title: '夏日海报生成完成',
        body: '作品已经可以查看。',
      ),
      _notification(
        'order-1',
        kind: 'order',
        title: '订阅开通成功',
        body: '月度套餐已经生效。',
        read: true,
      ),
      _notification('system-1', title: '系统维护完成', read: true),
    ],
    nextCursor: null,
    unread: 1,
  );
}

class _RecoveringNotificationController extends NotificationCenterController {
  int loadMoreCount = 0;

  @override
  Future<NotificationCenterState> build() async => NotificationCenterState(
    items: List.generate(
      8,
      (index) => _notification(
        'notification-$index',
        title: '第 ${index + 1} 条通知',
        body: '用于验证自动分页失败后的恢复操作。',
      ),
    ),
    nextCursor: 'next-page',
    unread: 8,
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
  test('parses notification pagination and unread state', () {
    final page = NotificationPage.fromJson({
      'items': [
        {
          'id': 'notification-1',
          'kind': 'task',
          'title': '作品生成完成',
          'body': '你的作品已经可以查看。',
          'sourceType': 'task',
          'sourceId': 'task-1',
          'readAt': null,
          'createdAt': '2026-08-24T01:00:00Z',
        },
        {
          'id': 'notification-2',
          'kind': 'reward',
          'title': '积分已到账',
          'readAt': '2026-08-24T01:01:00Z',
          'createdAt': '2026-08-24T00:59:00Z',
        },
      ],
      'nextCursor': 'next-page',
      'unread': 1,
    });

    expect(page.items, hasLength(2));
    expect(page.nextCursor, 'next-page');
    expect(page.unread, 1);
    expect(page.items.first.isRead, isFalse);
    expect(page.items.first.sourceType, 'task');
    expect(page.items.first.sourceId, 'task-1');
    expect(page.items.last.isRead, isTrue);
    expect(page.items.first.markRead().isRead, isTrue);
    expect(page.items.first.markRead().sourceId, 'task-1');
  });

  test('normalizes malformed notification pages to safe defaults', () {
    final page = NotificationPage.fromJson({'items': 'invalid'});

    expect(page.items, isEmpty);
    expect(page.nextCursor, isNull);
    expect(page.unread, 0);
  });

  test('searches notification title, body and visible kind label', () {
    final items = [
      _notification(
        'task-1',
        kind: 'task',
        title: '作品生成完成',
        body: '夏日海报已经可以查看。',
      ),
      _notification('order-1', kind: 'order', title: '套餐到账'),
    ];

    expect(searchNotifications(items, '夏日').map((item) => item.id), ['task-1']);
    expect(searchNotifications(items, '订单').map((item) => item.id), [
      'order-1',
    ]);
    expect(searchNotifications(items, '  ').length, 2);
  });

  test('maps actionable notifications to stable user destinations', () {
    AppNotification notification(String kind, String title) =>
        AppNotification.fromJson({
          'id': '$kind-$title',
          'kind': kind,
          'title': title,
        });

    expect(notification('task', '作品已完成').destination?.route, '/works');
    final preciseTask = AppNotification.fromJson({
      'id': 'task-precise',
      'kind': 'task',
      'title': '作品已完成',
      'sourceType': 'task',
      'sourceId': 'task/unsafe-segment',
    });
    expect(preciseTask.destination?.route, '/works/task%2Funsafe-segment');
    expect(preciseTask.destination?.label, '查看作品详情');
    expect(
      notification('reward', '里程碑奖励').destination?.route,
      '/profile/benefits/growth',
    );
    expect(
      notification('trial_access', '审核通过').destination?.route,
      '/profile/benefits/trial',
    );
    expect(
      notification('order', '套餐已到账').destination?.route,
      '/profile/purchases/orders',
    );
    final preciseOrder = AppNotification.fromJson({
      'id': 'order-precise',
      'kind': 'order',
      'title': '套餐已到账',
      'sourceType': 'order',
      'sourceId': 'order/unsafe query',
    });
    expect(
      preciseOrder.destination?.route,
      '/profile/purchases/orders?order=order%2Funsafe+query',
    );
    expect(preciseOrder.destination?.label, '查看订单详情');
    expect(preciseOrder.relationLabel, '关联订单');
    expect(
      notification('system', '投稿审核结果').destination?.route,
      '/profile/submissions',
    );
    expect(
      notification('system', '问题反馈进度更新').destination?.route,
      '/profile/feedback',
    );
    expect(
      notification('system', '兑换码入账').destination?.route,
      '/profile/wallet',
    );
    expect(notification('system', '系统维护完成').destination, isNull);
  });

  testWidgets('unread timeline tile fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var tapped = false;

    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: Scaffold(
          body: NotificationTimelineTile(
            notification: AppNotification.fromJson({
              'id': 'notification-1',
              'kind': 'trial_access',
              'title': '体验资格审核结果已经更新',
              'body': '你的体验资格已经通过审核，相关积分现已可以领取并用于支持的创作功能。',
              'createdAt': '2026-08-24T01:00:00Z',
            }),
            onTap: () => tapped = true,
          ),
        ),
      ),
    );

    expect(find.text('体验资格审核结果已经更新'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('体验资格审核结果已经更新'));
    expect(tapped, isTrue);
  });

  testWidgets('read timeline tile remains available for detail viewing', (
    tester,
  ) async {
    var tapped = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: NotificationTimelineTile(
            notification: AppNotification.fromJson({
              'id': 'notification-1',
              'kind': 'system',
              'title': '系统维护完成',
              'readAt': '2026-08-24T01:05:00Z',
            }),
            onTap: () => tapped = true,
          ),
        ),
      ),
    );

    await tester.tap(find.text('系统维护完成'));
    expect(tapped, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('notification detail exposes destination action', (tester) async {
    var opened = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: NotificationDetailSheet(
            notification: AppNotification.fromJson({
              'id': 'order-1',
              'kind': 'order',
              'title': '套餐已到账',
              'body': '你的订阅套餐已经生效。',
              'sourceType': 'order',
              'sourceId': 'order-1',
              'createdAt': '2026-08-24T01:00:00Z',
            }),
            onOpenDestination: () => opened = true,
          ),
        ),
      ),
    );

    expect(find.text('订单'), findsOneWidget);
    expect(find.text('关联订单'), findsOneWidget);
    expect(find.text('查看订单详情'), findsOneWidget);
    await tester.tap(find.text('查看订单详情'));
    expect(opened, isTrue);
  });

  testWidgets('task notification detail shows its precise work relation', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
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
          body: NotificationDetailSheet(
            notification: AppNotification.fromJson({
              'id': 'task-notification',
              'kind': 'task',
              'title': '夏日新品系列宣传海报作品已经生成完成',
              'body': '文生图已生成 2 张图片。',
              'sourceType': 'task',
              'sourceId': 'task-1',
              'createdAt': '2026-08-24T01:00:00Z',
            }),
            onOpenDestination: () {},
          ),
        ),
      ),
    );

    expect(find.text('关联作品'), findsOneWidget);
    expect(find.text('查看作品详情'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('notification center marks unread item then opens its detail', (
    tester,
  ) async {
    late _FakeNotificationController controller;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          notificationCenterControllerProvider.overrideWith(
            () => controller = _FakeNotificationController(),
          ),
        ],
        child: const MaterialApp(home: NotificationCenterScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('作品已完成'));
    await tester.pumpAndSettle();

    expect(controller.markReadCount, 1);
    expect(controller.state.requireValue.unread, 0);
    expect(find.byType(NotificationDetailSheet), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(NotificationDetailSheet),
        matching: find.text('查看作品'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('notification search combines with unread filter on narrow UI', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          notificationCenterControllerProvider.overrideWith(
            _SearchNotificationController.new,
          ),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const NotificationCenterScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('notification-search')), '订单');
    await tester.pump();
    expect(find.text('已显示 1 / 已加载 3'), findsOneWidget);
    expect(find.text('订阅开通成功'), findsOneWidget);
    expect(find.text('夏日海报生成完成'), findsNothing);

    await tester.tap(find.text('未读'));
    await tester.pump();
    expect(find.text('没有匹配的通知'), findsOneWidget);
    expect(find.text('已显示 0 / 已加载 3'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('automatic paging failure stays inline and can retry', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _RecoveringNotificationController controller;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          notificationCenterControllerProvider.overrideWith(
            () => controller = _RecoveringNotificationController(),
          ),
        ],
        child: const MaterialApp(home: NotificationCenterScreen()),
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -1800));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.loadMoreCount, 1);
    expect(
      find.byKey(const Key('notification-load-more-error')),
      findsOneWidget,
    );
    expect(find.text('更多通知加载失败，请稍后重试'), findsOneWidget);
    expect(find.byKey(const Key('app-notice-card')), findsNothing);

    await tester.tap(find.byKey(const Key('notification-load-more-retry')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.loadMoreCount, 2);
    expect(controller.state.requireValue.hasMore, isFalse);
    expect(find.byKey(const Key('notification-load-more-error')), findsNothing);
    expect(find.text('已加载全部通知'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('notification detail fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
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
          body: NotificationDetailSheet(
            notification: AppNotification.fromJson({
              'id': 'trial-1',
              'kind': 'trial_access',
              'title': '体验资格审核结果已经更新，请及时查看本次申请结果',
              'body':
                  '你的体验资格已经通过审核，相关积分现已可以领取并用于支持的创作功能。'
                  '这是一段用于验证完整正文在窄屏大字体下仍然可阅读的补充说明。',
              'createdAt': '2026-08-24T01:00:00Z',
            }),
            onOpenDestination: () {},
          ),
        ),
      ),
    );

    expect(find.text('查看体验权益'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
