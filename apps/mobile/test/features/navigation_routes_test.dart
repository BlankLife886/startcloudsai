import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/app_router.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/billing/billing.dart';
import 'package:starcloudsai_mobile/features/billing/purchase_center_screen.dart';
import 'package:starcloudsai_mobile/features/billing/purchase_orders_screen.dart';
import 'package:starcloudsai_mobile/features/discover/discover.dart';
import 'package:starcloudsai_mobile/features/notifications/notifications.dart';
import 'package:starcloudsai_mobile/features/shell/app_shell.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';

const _user = AppUser(
  id: 'navigation-user',
  email: 'nav@example.com',
  username: 'QA',
);

class _Session extends SessionController {
  _Session(this.authenticated);
  final bool authenticated;

  @override
  Future<SessionState> build() async =>
      SessionState(user: authenticated ? _user : null);

  void clearSession() => state = const AsyncData(SessionState());
}

class _Orders extends PurchaseCenterController {
  int loads = 0;
  final linkedReads = <String>[];

  @override
  Future<PurchaseCenterState> build() async {
    loads++;
    return PurchaseCenterState(
      catalog: const PlanCatalog(
        items: [],
        paymentEnabled: false,
        paymentMethods: [],
      ),
      subscription: const UserSubscription(
        active: false,
        planName: '',
        dailyGrantPoints: 0,
        grantedToday: false,
      ),
      orders: [
        PurchaseOrder.fromJson({
          'id': 'pending',
          'status': 'pending',
          'amountCents': 100,
        }),
        PurchaseOrder.fromJson({
          'id': 'complete',
          'status': 'completed',
          'amountCents': 200,
        }),
      ],
    );
  }

  @override
  Future<PurchaseOrder> refreshOrder(String id) async {
    linkedReads.add(id);
    return state.requireValue.orders.firstWhere((order) => order.id == id);
  }
}

Future<ProviderContainer> _mount(
  WidgetTester tester, {
  required _Orders orders,
  bool authenticated = false,
  String location = '/design',
}) async {
  final container = ProviderContainer(
    overrides: [
      sessionControllerProvider.overrideWith(() => _Session(authenticated)),
      purchaseCenterControllerProvider.overrideWith(() => orders),
      notificationSummaryProvider.overrideWith((ref) async => 0),
      taskListProvider.overrideWith((ref) async => const []),
      authProvidersProvider.overrideWith(
        (ref) async => const AuthProviders(
          email: true,
          verificationCode: true,
          emailDomains: ['example.com'],
        ),
      ),
      discoverPromptPageProvider.overrideWith(
        (ref, query) async =>
            const PromptPage(items: [], total: 0, categoryCounts: {}, tags: []),
      ),
    ],
  );
  addTearDown(container.dispose);
  final router = container.read(appRouterProvider);
  addTearDown(router.dispose);
  router.go(location);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        theme: StarCloudsTheme.light(),
        routerConfig: router,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return container;
}

Finder _tab(int index) => find.byKey(Key('bottom-nav-item-$index'));

void main() {
  testWidgets('five tabs map to their routes without loading guest orders', (
    tester,
  ) async {
    final orders = _Orders();
    final container = await _mount(tester, orders: orders);
    final router = container.read(appRouterProvider);
    const routes = ['/discover', '/design', '/ai', '/orders', '/profile'];
    for (var index = 0; index < routes.length; index++) {
      await tester.tap(_tab(index));
      await tester.pumpAndSettle();
      expect(router.state.uri.path, routes[index]);
      expect(
        tester
            .widget<AppBottomNavigationBar>(find.byType(AppBottomNavigationBar))
            .selectedIndex,
        index,
      );
      expect(find.byKey(const Key('app-top-bar-back')), findsNothing);
      if (index == 3) {
        expect(find.text('登录后查看订单'), findsOneWidget);
        expect(find.byType(PurchaseOrdersScreen), findsNothing);
      }
      expect(orders.loads, 0);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('orders resume after login and preserve filtering across tabs', (
    tester,
  ) async {
    final orders = _Orders();
    final container = await _mount(tester, orders: orders, location: '/orders');
    final router = container.read(appRouterProvider);
    expect(orders.loads, 0);
    await tester.tap(find.byKey(const Key('authenticated-route-login')));
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/login');
    expect(orders.loads, 0);
    container.read(sessionControllerProvider.notifier).replaceUser(_user);
    router.pop(true);
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/orders');
    expect(orders.loads, 1);
    expect(find.byKey(const Key('order-pending')), findsOneWidget);
    expect(find.byKey(const Key('order-complete')), findsOneWidget);
    expect(find.byKey(const Key('app-top-bar-back')), findsNothing);
    expect(
      tester
          .widget<PurchaseOrdersScreen>(find.byType(PurchaseOrdersScreen))
          .showBackButton,
      isFalse,
    );

    await tester.tap(find.byKey(const Key('order-filter-已完成')));
    await tester.pumpAndSettle();
    await tester.tap(_tab(1));
    await tester.pumpAndSettle();
    await tester.tap(_tab(3));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('order-pending')), findsNothing);
    expect(find.byKey(const Key('order-complete')), findsOneWidget);
    expect(orders.loads, 1);

    (container.read(sessionControllerProvider.notifier) as _Session)
        .clearSession();
    await tester.pumpAndSettle();
    expect(find.text('登录后查看订单'), findsOneWidget);
    expect(find.byType(PurchaseOrdersScreen), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('signed-in orders stay deferred until the orders tab opens', (
    tester,
  ) async {
    final orders = _Orders();
    await _mount(tester, orders: orders, authenticated: true);
    expect(orders.loads, 0);
    await tester.tap(_tab(3));
    await tester.pumpAndSettle();
    expect(orders.loads, 1);
    expect(find.byKey(const Key('order-complete')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('new and legacy order links retain their matching navigation', (
    tester,
  ) async {
    final orders = _Orders();
    final container = await _mount(
      tester,
      orders: orders,
      authenticated: true,
      location: '/orders?order=complete',
    );
    final router = container.read(appRouterProvider);
    expect(orders.linkedReads, ['complete']);
    expect(find.byType(PaymentOrderSheet), findsOneWidget);
    router.pop();
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<AppBottomNavigationBar>(find.byType(AppBottomNavigationBar))
          .selectedIndex,
      3,
    );
    expect(find.byKey(const Key('app-top-bar-back')), findsNothing);

    router.go('/profile/purchases?order=complete');
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/profile/purchases/orders');
    expect(router.state.uri.queryParameters['order'], 'complete');
    expect(orders.linkedReads, ['complete', 'complete']);
    expect(find.byType(PaymentOrderSheet), findsOneWidget);
    router.pop();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(find.byType(AppBottomNavigationBar), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
