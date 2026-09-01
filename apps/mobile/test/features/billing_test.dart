import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:starcloudsai_mobile/features/billing/billing.dart';
import 'package:starcloudsai_mobile/features/billing/purchase_center_screen.dart';
import 'package:starcloudsai_mobile/features/billing/purchase_orders_screen.dart';

final _topup = PurchasePlan.fromJson({
  'id': 'plan-topup',
  'code': 'TOPUP-1000',
  'name': '灵感积分包',
  'description': '一次购买，积分即时进入钱包。',
  'badge': '热门',
  'kind': 'topup',
  'priceCents': 9900,
  'grantPoints': 1000,
  'bonusPoints': 100,
  'features': ['全平台创作工具通用', '积分即时到账'],
  'recommended': true,
  'sort': 10,
});

final _subscription = PurchasePlan.fromJson({
  'id': 'plan-subscription',
  'code': 'SUB-30',
  'name': '创作者月度订阅',
  'description': '每日自动发放创作积分。',
  'badge': '月度',
  'kind': 'subscription',
  'priceCents': 19900,
  'dailyGrantPoints': 100,
  'durationDays': 30,
  'features': ['每日积分发放', '到期自动停止'],
  'sort': 20,
});

PurchaseOrder _pendingOrder() => PurchaseOrder.fromJson({
  'id': 'order-pending',
  'planId': _topup.id,
  'status': 'pending',
  'amountCents': 9900,
  'grantPoints': 1000,
  'bonusPoints': 100,
  'provider': 'lanjing',
  'paymentMethod': 'alipay',
  'payUrl': 'https://pay.example.com/order-pending',
  'expiresAt': '2026-08-24T09:30:00Z',
  'createdAt': '2026-08-24T09:00:00Z',
});

PurchaseOrder _completedOrder(String id) => PurchaseOrder.fromJson({
  'id': id,
  'planId': _topup.id,
  'status': 'completed',
  'amountCents': 9900,
  'grantPoints': 1000,
  'bonusPoints': 100,
  'provider': 'lanjing',
  'paymentMethod': 'alipay',
  'completedAt': '2026-08-24T09:05:00Z',
  'createdAt': '2026-08-24T09:00:00Z',
});

PurchaseOrder _expiredOrder(String id) => PurchaseOrder.fromJson({
  'id': id,
  'planId': _topup.id,
  'status': 'expired',
  'amountCents': 9900,
  'grantPoints': 1000,
  'bonusPoints': 100,
  'provider': 'lanjing',
  'paymentMethod': 'alipay',
  'createdAt': '2026-08-24T08:00:00Z',
});

PurchaseCenterState _state({bool paymentEnabled = false}) =>
    PurchaseCenterState(
      catalog: PlanCatalog(
        items: [_topup, _subscription],
        paymentEnabled: paymentEnabled,
        paymentMethods: const ['alipay', 'wechat'],
      ),
      subscription: const UserSubscription(
        active: false,
        planName: '',
        dailyGrantPoints: 0,
        grantedToday: false,
      ),
      orders: const [],
    );

class _FakePurchaseController extends PurchaseCenterController {
  _FakePurchaseController({
    this.paymentEnabled = false,
    this.linkedOrder,
    this.orders = const [],
  });

  final bool paymentEnabled;
  final PurchaseOrder? linkedOrder;
  final List<PurchaseOrder> orders;
  String? selectedMethod;
  int refreshOrderCount = 0;

  @override
  Future<PurchaseCenterState> build() async =>
      _state(paymentEnabled: paymentEnabled).copyWith(orders: orders);

  @override
  Future<void> refresh() async {}

  @override
  Future<void> loadMore() async {}

  @override
  Future<PurchaseOrder> refreshOrder(String id) async {
    refreshOrderCount += 1;
    final order = linkedOrder;
    if (order == null || order.id != id) throw StateError('order not found');
    final current = state.requireValue;
    state = AsyncData(
      current.copyWith(
        orders: [order, ...current.orders.where((item) => item.id != order.id)],
      ),
    );
    return order;
  }

  @override
  Future<PurchaseOrder> createOrder(
    PurchasePlan plan,
    String paymentMethod,
  ) async {
    selectedMethod = paymentMethod;
    final order = PurchaseOrder.fromJson({
      'id': 'order-new',
      'planId': plan.id,
      'status': 'pending',
      'amountCents': plan.priceCents,
      'grantPoints': plan.grantPoints,
      'bonusPoints': plan.bonusPoints,
      'provider': 'lanjing',
      'paymentMethod': paymentMethod,
      'payUrl': 'https://pay.example.com/order-new',
      'payAmountCents': 9800,
      'requiresManualAmount': true,
      'expiresAt': '2026-08-24T09:30:00Z',
      'createdAt': '2026-08-24T09:00:00Z',
    });
    final current = state.requireValue;
    state = AsyncData(current.copyWith(orders: [order]));
    return order;
  }
}

Widget _app({
  required PurchaseCenterController Function() controller,
  double textScale = 1,
  String? initialOrderId,
  bool ordersPage = false,
}) => ProviderScope(
  overrides: [purchaseCenterControllerProvider.overrideWith(controller)],
  child: MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: ordersPage
        ? PurchaseOrdersScreen(initialOrderId: initialOrderId)
        : const PurchaseCenterScreen(),
  ),
);

void main() {
  test('parses plan catalog, subscription and payment order fields', () {
    final catalog = PlanCatalog.fromJson({
      'items': [
        {
          'id': 'later',
          'name': '后展示',
          'priceCents': 200,
          'kind': 'topup',
          'sort': 20,
        },
        {
          'id': 'first',
          'name': '先展示',
          'priceCents': 100,
          'grantCents': 10,
          'bonusCents': 2,
          'kind': 'topup',
          'sort': 10,
        },
        {'id': '', 'name': '无效套餐', 'priceCents': 1},
      ],
      'paymentEnabled': true,
      'paymentMethods': ['wechat', 'unsupported', 'wechat', 'alipay'],
    });
    final subscription = UserSubscription.fromJson({
      'active': true,
      'planName': '月度订阅',
      'endsAt': '2026-09-24T00:00:00Z',
      'dailyGrantCents': 100,
      'grantedToday': true,
    });
    final order = PurchaseOrder.fromJson({
      'id': 'order-1',
      'planId': 'first',
      'status': 'pending',
      'amountCents': 100,
      'grantCents': 10,
      'bonusCents': 2,
      'payUrl': 'https://pay.example.com/order-1',
      'paymentMethod': 'wechat',
      'payAmountCents': 99,
      'requiresManualAmount': true,
      'expiresAt': '2026-08-24T09:30:00Z',
    });

    expect(catalog.items.map((item) => item.id), ['first', 'later']);
    expect(catalog.items.first.totalPoints, 12);
    expect(catalog.paymentMethods, ['wechat', 'alipay']);
    expect(subscription.active, isTrue);
    expect(subscription.dailyGrantPoints, 100);
    expect(order.isPending, isTrue);
    expect(order.payAmountCents, 99);
    expect(order.requiresManualAmount, isTrue);
  });

  test('order filters group active, completed and closed states', () {
    expect(PurchaseOrderFilter.pending.includes(_pendingOrder()), isTrue);
    expect(
      PurchaseOrderFilter.completed.includes(_completedOrder('completed')),
      isTrue,
    );
    expect(
      PurchaseOrderFilter.closed.includes(_expiredOrder('expired')),
      isTrue,
    );
    expect(
      PurchaseOrderFilter.closed.includes(_completedOrder('completed')),
      isFalse,
    );
  });

  testWidgets('disabled payments remain clear and fit narrow large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(controller: () => _FakePurchaseController(), textScale: 1.6),
    );
    await tester.pumpAndSettle();

    expect(find.text('在线购买暂未开放'), findsOneWidget);
    expect(find.text('暂未开放'), findsOneWidget);
    expect(find.text('灵感积分包'), findsOneWidget);
    expect(find.byKey(const Key('purchase-orders-entry')), findsOneWidget);
    expect(find.text('还没有套餐订单'), findsOneWidget);
    expect(find.byType(OrderCard), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('订阅'));
    await tester.pumpAndSettle();
    expect(find.text('创作者月度订阅'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('disabled payment offers the redemption fallback', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/profile/purchases',
      routes: [
        GoRoute(
          path: '/profile/purchases',
          builder: (context, state) => const PurchaseCenterScreen(),
        ),
        GoRoute(
          path: '/profile/wallet',
          builder: (context, state) => Scaffold(
            body: Text(
              state.uri.queryParameters['redeem'] == '1' ? '钱包兑换入口' : '积分钱包',
            ),
          ),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          purchaseCenterControllerProvider.overrideWith(
            _FakePurchaseController.new,
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('purchase-redeem-code')));
    await tester.pumpAndSettle();

    expect(find.text('钱包兑换入口'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('flat purchase center supports dark mode', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          purchaseCenterControllerProvider.overrideWith(
            _FakePurchaseController.new,
          ),
        ],
        child: MaterialApp(
          theme: ThemeData.light(),
          darkTheme: ThemeData.dark(),
          themeMode: ThemeMode.dark,
          home: const PurchaseCenterScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      Theme.of(tester.element(find.text('在线购买暂未开放'))).brightness,
      Brightness.dark,
    );
    expect(find.byKey(const Key('purchase-redeem-code')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('payment method selection creates QR order with exact amount', (
    tester,
  ) async {
    late _FakePurchaseController controller;
    await tester.pumpWidget(
      _app(
        controller: () =>
            controller = _FakePurchaseController(paymentEnabled: true),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, '立即购买'));
    await tester.pumpAndSettle();
    expect(find.byType(PaymentMethodSheet), findsOneWidget);

    await tester.tap(find.text('微信支付'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('确认下单'));
    await tester.pumpAndSettle();

    expect(controller.selectedMethod, 'wechat');
    expect(find.byType(PaymentOrderSheet), findsOneWidget);
    expect(find.byType(QrImageView), findsOneWidget);
    expect(find.text('扫码支付 ¥98.00'), findsOneWidget);
    expect(find.textContaining('付款时请确认金额必须为 ¥98.00'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('refreshing a paid order reports completion to its caller', (
    tester,
  ) async {
    bool? completed;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => FilledButton(
              onPressed: () async {
                completed = await showModalBottomSheet<bool>(
                  context: context,
                  isScrollControlled: true,
                  builder: (context) => PaymentOrderSheet(
                    order: _pendingOrder(),
                    plan: _topup,
                    onRefresh: (id) async => PurchaseOrder.fromJson({
                      'id': id,
                      'planId': _topup.id,
                      'status': 'completed',
                      'amountCents': 9900,
                      'grantPoints': 1000,
                      'bonusPoints': 100,
                      'provider': 'lanjing',
                      'completedAt': '2026-08-24T09:05:00Z',
                      'createdAt': '2026-08-24T09:00:00Z',
                    }),
                    onClose: (id) async => _pendingOrder(),
                  ),
                );
              },
              child: const Text('打开支付单'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('打开支付单'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('我已支付，刷新状态'));
    await tester.pumpAndSettle();

    expect(find.byType(PaymentOrderSheet), findsNothing);
    expect(completed, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('orders entry opens the orders page', (tester) async {
    final router = GoRouter(
      initialLocation: '/profile/purchases',
      routes: [
        GoRoute(
          path: '/profile/purchases',
          builder: (context, state) => const PurchaseCenterScreen(),
          routes: [
            GoRoute(
              path: 'orders',
              builder: (context, state) => const PurchaseOrdersScreen(),
            ),
          ],
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          purchaseCenterControllerProvider.overrideWith(
            () => _FakePurchaseController(
              orders: [_completedOrder('order-history')],
            ),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(OrderCard), findsNothing);
    expect(find.text('1 笔'), findsOneWidget);
    await tester.tap(find.byKey(const Key('purchase-orders-entry')));
    await tester.pumpAndSettle();

    expect(find.byType(PurchaseOrdersScreen), findsOneWidget);
    expect(find.byType(OrderCard), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('orders page lists history cards', (tester) async {
    await tester.pumpWidget(
      _app(
        ordersPage: true,
        controller: () =>
            _FakePurchaseController(orders: [_completedOrder('order-history')]),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('我的订单'), findsWidgets);
    expect(find.byType(OrderCard), findsOneWidget);
    expect(find.text('已完成'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('orders page filters loaded orders by status', (tester) async {
    await tester.pumpWidget(
      _app(
        ordersPage: true,
        controller: () => _FakePurchaseController(
          orders: [
            _pendingOrder(),
            _completedOrder('order-completed'),
            _expiredOrder('order-expired'),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(OrderCard), findsNWidgets(3));
    await tester.tap(find.byKey(const Key('order-filter-已完成')));
    await tester.pumpAndSettle();

    expect(find.byType(OrderCard), findsOneWidget);
    expect(find.text('已完成'), findsWidgets);
    expect(find.text('待支付'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('order detail copies the full order id', (tester) async {
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
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PaymentOrderSheet(
            order: _completedOrder('order-full-copy-id'),
            plan: _topup,
            onRefresh: (_) async => _completedOrder('order-full-copy-id'),
            onClose: (_) async => _completedOrder('order-full-copy-id'),
          ),
        ),
      ),
    );

    await tester.tap(find.byTooltip('复制订单号'));
    await tester.pump();

    expect(clipboardText, 'order-full-copy-id');
    expect(find.text('订单号已复制'), findsOneWidget);
  });

  testWidgets('notification deep link fetches and opens the exact order', (
    tester,
  ) async {
    late _FakePurchaseController controller;
    await tester.pumpWidget(
      _app(
        ordersPage: true,
        initialOrderId: 'order-linked',
        controller: () => controller = _FakePurchaseController(
          linkedOrder: _completedOrder('order-linked'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(controller.refreshOrderCount, 1);
    expect(find.byType(PaymentOrderSheet), findsOneWidget);
    expect(find.text('已完成'), findsWidgets);
    expect(find.text('通知关联'), findsOneWidget);
    expect(find.bySemanticsLabel('通知关联订单'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('linked order highlight fits narrow large text', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 260));
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
          body: OrderCard(
            order: _completedOrder('order-linked'),
            plan: _topup,
            busy: false,
            highlighted: true,
            onTap: () {},
          ),
        ),
      ),
    );

    expect(find.text('通知关联'), findsOneWidget);
    expect(find.bySemanticsLabel('通知关联订单'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
