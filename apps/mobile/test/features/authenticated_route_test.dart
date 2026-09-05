import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/app/app_router.dart';
import 'package:starcloudsai_mobile/features/assistant/assistant_screen.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/auth/authenticated_route.dart';
import 'package:starcloudsai_mobile/features/discover/discover.dart';
import 'package:starcloudsai_mobile/features/gallery/gallery.dart';

const _user = AppUser(id: 'user-1', email: 'qa@example.com', username: 'QA');

class _FakeSessionController extends SessionController {
  _FakeSessionController({
    this.authenticated = false,
    this.failInitial = false,
  });

  final bool authenticated;
  final bool failInitial;
  int refreshCount = 0;

  @override
  Future<SessionState> build() async {
    if (failInitial) throw StateError('session unavailable');
    return SessionState(user: authenticated ? _user : null);
  }

  @override
  Future<void> refresh() async {
    refreshCount += 1;
    state = const AsyncData(SessionState(user: _user));
  }
}

class _PendingSessionController extends SessionController {
  _PendingSessionController(this.gate);

  final Completer<SessionState> gate;

  @override
  Future<SessionState> build() => gate.future;
}

Widget _app({
  required _FakeSessionController Function() controller,
  required Widget child,
  double textScale = 1,
}) {
  final router = GoRouter(
    initialLocation: '/private',
    routes: [
      GoRoute(
        path: '/private',
        builder: (context, state) => AuthenticatedRoute(
          title: '积分钱包',
          icon: Icons.account_balance_wallet_outlined,
          child: child,
        ),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const Scaffold(body: Text('登录流程')),
      ),
    ],
  );
  return ProviderScope(
    overrides: [sessionControllerProvider.overrideWith(controller)],
    child: MaterialApp.router(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      routerConfig: router,
    ),
  );
}

void main() {
  testWidgets('anonymous deep link does not build private content', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var privateBuilds = 0;
    await tester.pumpWidget(
      _app(
        textScale: 1.6,
        controller: _FakeSessionController.new,
        child: Builder(
          builder: (context) {
            privateBuilds += 1;
            return const Text('私有钱包内容');
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(privateBuilds, 0);
    expect(find.text('登录后查看积分钱包'), findsOneWidget);
    expect(find.text('账号验证完成后将自动返回当前页面'), findsOneWidget);
    final icon = tester.widget<Icon>(
      find.byKey(const Key('authenticated-route-icon')),
    );
    expect(icon.size, 40);
    expect(
      find.ancestor(
        of: find.byKey(const Key('authenticated-route-icon')),
        matching: find.byType(DecoratedBox),
      ),
      findsNothing,
    );
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const Key('authenticated-route-login')));
    await tester.pumpAndSettle();
    expect(find.text('登录流程'), findsOneWidget);
  });

  testWidgets('authenticated deep link renders its destination', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        controller: () => _FakeSessionController(authenticated: true),
        child: const Scaffold(body: Text('私有钱包内容')),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('私有钱包内容'), findsOneWidget);
    expect(find.byKey(const Key('authenticated-route-login')), findsNothing);
  });

  testWidgets('session check error retries and restores destination', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _FakeSessionController controller;
    await tester.pumpWidget(
      _app(
        textScale: 1.6,
        controller: () =>
            controller = _FakeSessionController(failInitial: true),
        child: const Scaffold(body: Text('私有钱包内容')),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('账号状态暂不可用'), findsOneWidget);
    expect(find.text('请检查网络连接后重新验证账号状态'), findsOneWidget);
    expect(find.byKey(const Key('authenticated-route-retry')), findsOneWidget);
    await tester.tap(find.byKey(const Key('authenticated-route-retry')));
    await tester.pumpAndSettle();

    expect(controller.refreshCount, 1);
    expect(find.text('私有钱包内容'), findsOneWidget);
  });

  testWidgets('real wallet deep link is guarded before private API screens', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
      ],
    );
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    router.go('/profile/wallet');
    await tester.pumpAndSettle();

    expect(find.text('登录后查看积分钱包'), findsOneWidget);
    expect(find.byKey(const Key('authenticated-route-login')), findsOneWidget);
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('account data export deep link checks authentication first', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
      ],
    );
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    router.go('/profile/security/data-export');
    await tester.pumpAndSettle();

    expect(find.text('登录后查看账号数据'), findsOneWidget);
    expect(find.byKey(const Key('authenticated-route-login')), findsOneWidget);
    expect(find.byKey(const Key('account-data-export-action')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('all account security deep links check authentication first', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
      ],
    );
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );

    for (final route in const [
      ('/profile/security', '登录后查看账号与安全'),
      ('/profile/security/sessions', '登录后查看登录设备'),
      ('/profile/security/blocked-users', '登录后查看已屏蔽用户'),
      ('/profile/security/delete', '登录后查看注销账号'),
    ]) {
      router.go(route.$1);
      await tester.pumpAndSettle();
      expect(find.text(route.$2), findsOneWidget, reason: route.$1);
      expect(
        find.byKey(const Key('authenticated-route-login')),
        findsOneWidget,
        reason: route.$1,
      );
      expect(tester.takeException(), isNull, reason: route.$1);
    }

    expect(find.byTooltip('刷新设备'), findsNothing);
    expect(find.byTooltip('刷新列表'), findsNothing);
    expect(find.byKey(const Key('delete-account-submit')), findsNothing);
  });

  testWidgets('real ledger deep link is guarded before private API screens', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
      ],
    );
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    router.go('/profile/wallet/ledger');
    await tester.pumpAndSettle();

    expect(find.text('登录后查看积分明细'), findsOneWidget);
    expect(find.byKey(const Key('authenticated-route-login')), findsOneWidget);
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('works deep link uses the shared authentication gate', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
      ],
    );
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    router.go('/works');
    await tester.pumpAndSettle();

    expect(find.text('登录后查看历史记录'), findsOneWidget);
    expect(find.byKey(const Key('authenticated-route-login')), findsOneWidget);
    expect(find.byKey(const Key('works-search')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('orders deep link is guarded before private API screens', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
      ],
    );
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    router.go('/profile/purchases/orders');
    await tester.pumpAndSettle();

    expect(find.text('登录后查看我的订单'), findsOneWidget);
    expect(find.byKey(const Key('authenticated-route-login')), findsOneWidget);
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('membership deep link keeps its title and fallback navigation', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
      ],
    );
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    router.go('/profile/purchases');
    await tester.pumpAndSettle();

    expect(find.text('会员与订单'), findsOneWidget);
    expect(find.text('登录后查看会员与订单'), findsOneWidget);
    expect(find.textContaining('套餐与订单'), findsNothing);
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('assistant deep link is guarded before private API screens', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
      ],
    );
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    router.go('/assistant');
    await tester.pumpAndSettle();

    expect(find.text('登录后查看AI 助手'), findsOneWidget);
    expect(find.byKey(const Key('authenticated-route-login')), findsOneWidget);
    expect(find.byKey(const Key('assistant-composer')), findsNothing);
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('assistant route shows a skeleton while session is checking', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/ai',
      routes: [
        GoRoute(
          path: '/ai',
          builder: (context, state) => const AuthenticatedRoute(
            title: 'AI 助手',
            icon: Icons.auto_awesome_outlined,
            showBackButton: false,
            loading: AssistantPageSkeleton(),
            child: AssistantScreen(),
          ),
        ),
        GoRoute(
          path: '/login',
          builder: (context, state) => const Scaffold(body: Text('登录流程')),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionControllerProvider.overrideWith(
            () => _PendingSessionController(Completer<SessionState>()),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pump();

    expect(
      find.byKey(const Key('assistant-workspace-skeleton')),
      findsOneWidget,
    );
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('正在检查账号状态'), findsNothing);
    expect(find.text('登录后查看AI 助手'), findsNothing);
    expect(find.byKey(const Key('assistant-composer')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('AI navigation tab is guarded before private API screens', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
      ],
    );
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    router.go('/ai');
    await tester.pumpAndSettle();

    expect(find.text('登录后查看AI 助手'), findsOneWidget);
    expect(find.byKey(const Key('bottom-nav-ai-button')), findsOneWidget);
    expect(find.byKey(const Key('assistant-composer')), findsNothing);
    expect(find.byKey(const Key('app-top-bar-back')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'home tabs switch prompts and community without leaving discover',
    (tester) async {
      final container = ProviderContainer(
        overrides: [
          sessionControllerProvider.overrideWith(_FakeSessionController.new),
          discoverPromptCategoriesProvider.overrideWith(
            (ref) async => const [],
          ),
          discoverPromptPageProvider.overrideWith(
            (ref, query) async => const PromptPage(
              items: [],
              total: 0,
              categoryCounts: {},
              tags: [],
            ),
          ),
          galleryCategoriesProvider.overrideWith((ref) async => const []),
          discoverGalleryPageProvider.overrideWith(
            (ref, query) async => const GalleryPage(items: []),
          ),
        ],
      );
      addTearDown(container.dispose);
      final router = container.read(appRouterProvider);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router),
        ),
      );

      await tester.pumpAndSettle();
      expect(router.state.uri.path, '/discover');
      expect(find.byKey(const Key('home-tabs')), findsOneWidget);
      expect(find.byKey(const Key('home-tab-home')), findsOneWidget);
      expect(find.byKey(const Key('home-tab-prompts')), findsOneWidget);
      expect(find.byKey(const Key('home-tab-community')), findsOneWidget);

      await tester.tap(find.byKey(const Key('all-prompts-action')));
      await tester.pumpAndSettle();
      expect(router.state.uri.path, '/discover');
      expect(router.state.uri.queryParameters['tab'], 'prompts');
      expect(find.byType(SearchBar), findsOneWidget);
      expect(find.byKey(const Key('app-top-bar-back')), findsNothing);
      expect(find.byKey(const Key('home-tabs')), findsOneWidget);

      await tester.tap(find.byKey(const Key('home-tab-community')));
      await tester.pumpAndSettle();
      expect(router.state.uri.path, '/discover');
      expect(router.state.uri.queryParameters['tab'], 'community');
      expect(find.byKey(const Key('home-tabs')), findsOneWidget);

      router.go('/prompts');
      await tester.pumpAndSettle();
      expect(router.state.uri.path, '/discover');
      expect(router.state.uri.queryParameters['tab'], 'prompts');
      expect(find.byType(SearchBar), findsOneWidget);

      router.go('/community');
      await tester.pumpAndSettle();
      expect(router.state.uri.path, '/discover');
      expect(router.state.uri.queryParameters['tab'], 'community');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('retired design tools redirect to the design hub', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
      ],
    );
    addTearDown(container.dispose);
    final router = container.read(appRouterProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );

    for (final path in ['/background-remove', '/coloring', '/model-sheet']) {
      router.go(path);
      await tester.pumpAndSettle();
      expect(router.state.uri.path, '/design');
      expect(
        find.byKey(const Key('design-tool-text-to-image')),
        findsOneWidget,
      );
      expect(find.text('模型设计'), findsNothing);
      expect(find.text('插画染色'), findsNothing);
      expect(find.text('智能去背景'), findsNothing);
      expect(find.byKey(const Key('background-remove-picker')), findsNothing);
      expect(find.byKey(const Key('coloring-source-picker')), findsNothing);
      expect(find.byKey(const Key('model-sheet-prompt')), findsNothing);
    }
    expect(tester.takeException(), isNull);
  });
}
