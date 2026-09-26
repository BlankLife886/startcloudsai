import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/core/widgets/app_top_bar.dart';

void main() {
  testWidgets('secondary top bar pops the current route', (tester) async {
    final router = GoRouter(
      initialLocation: '/home',
      routes: [
        GoRoute(
          path: '/home',
          builder: (context, state) => Scaffold(
            body: FilledButton(
              onPressed: () => context.push('/detail'),
              child: const Text('打开详情'),
            ),
          ),
        ),
        GoRoute(
          path: '/detail',
          builder: (context, state) => const Scaffold(
            appBar: AppTopBar(title: Text('详情')),
            body: Text('详情内容'),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.tap(find.text('打开详情'));
    await tester.pumpAndSettle();

    expect(find.byTooltip('返回'), findsOneWidget);
    await tester.tap(find.byKey(const Key('app-top-bar-back')));
    await tester.pumpAndSettle();

    expect(find.text('打开详情'), findsOneWidget);
  });

  testWidgets('secondary top bar uses its fallback without route history', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/detail',
      routes: [
        GoRoute(
          path: '/home',
          builder: (context, state) => const Scaffold(body: Text('安全入口')),
        ),
        GoRoute(
          path: '/detail',
          builder: (context, state) => const Scaffold(
            appBar: AppTopBar(title: Text('详情'), fallbackLocation: '/home'),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));

    await tester.tap(find.byKey(const Key('app-top-bar-back')));
    await tester.pumpAndSettle();

    expect(find.text('安全入口'), findsOneWidget);
  });

  testWidgets('root top bar does not expose a back button', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          appBar: AppTopBar(title: Text('首页'), showBackButton: false),
        ),
      ),
    );

    expect(find.byTooltip('返回'), findsNothing);
    expect(find.byKey(const Key('app-top-bar')), findsOneWidget);
  });

  testWidgets('back returns to the page that opened the screen', (
    tester,
  ) async {
    for (final origin in ['/home', '/design']) {
      final originLabel = origin == '/home' ? '首页入口' : '设计入口';
      final router = GoRouter(
        initialLocation: origin,
        routes: [
          GoRoute(
            path: '/home',
            builder: (context, state) => Scaffold(
              body: FilledButton(
                onPressed: () => context.push('/create'),
                child: const Text('首页入口'),
              ),
            ),
          ),
          GoRoute(
            path: '/design',
            builder: (context, state) => Scaffold(
              body: FilledButton(
                onPressed: () => context.push('/create'),
                child: const Text('设计入口'),
              ),
            ),
          ),
          GoRoute(
            path: '/create',
            builder: (context, state) => const Scaffold(
              appBar: AppTopBar(
                title: Text('文生图'),
                fallbackLocation: '/design',
              ),
              body: Text('文生图内容'),
            ),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.tap(find.text(originLabel));
      await tester.pumpAndSettle();

      expect(find.text('文生图内容'), findsOneWidget);
      await tester.tap(find.byKey(const Key('app-top-bar-back')));
      await tester.pumpAndSettle();

      expect(find.text(originLabel), findsOneWidget);
      expect(find.text('文生图内容'), findsNothing);
    }
  });
}
