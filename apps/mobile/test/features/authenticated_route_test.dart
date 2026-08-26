import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/app/app_router.dart';
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
    late _FakeSessionController controller;
    await tester.pumpWidget(
      _app(
        controller: () =>
            controller = _FakeSessionController(failInitial: true),
        child: const Scaffold(body: Text('私有钱包内容')),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('账号状态暂不可用'), findsOneWidget);
    await tester.tap(find.text('重新检查'));
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

  testWidgets('home actions open standalone prompts and community routes', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(_FakeSessionController.new),
        discoverPromptCategoriesProvider.overrideWith((ref) async => const []),
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
    expect(find.byKey(const Key('home-tabs')), findsNothing);

    await tester.tap(find.byKey(const Key('all-prompts-action')));
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/prompts');
    expect(find.text('全部提示词'), findsOneWidget);
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(find.byType(SearchBar), findsOneWidget);
    expect(find.byKey(const Key('bottom-nav-home-button')), findsNothing);

    await tester.tap(find.byKey(const Key('app-top-bar-back')));
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/discover');
    expect(find.byKey(const Key('bottom-nav-item-1')), findsOneWidget);

    await tester.tap(find.byKey(const Key('bottom-nav-item-1')));
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/community');
    expect(
      find.descendant(of: find.byType(AppBar), matching: find.text('社区')),
      findsOneWidget,
    );

    router.go('/discover?tab=prompts');
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/prompts');
    expect(find.text('全部提示词'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

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
