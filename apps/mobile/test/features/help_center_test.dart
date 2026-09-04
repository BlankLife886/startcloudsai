import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/features/profile/help_center_screen.dart';

void main() {
  List<Override> healthyService() => [
    helpServiceStatusProvider.overrideWith(
      (ref) async =>
          const HelpServiceStatus(HelpServiceState.online, '创作、助手和同步服务可正常连接'),
    ),
  ];

  test('help search requires every keyword and searches answers', () {
    expect(searchHelpTopics(helpTopics, '积分 退回').single.title, contains('积分'));
    expect(searchHelpTopics(helpTopics, '相册 权限'), hasLength(2));
    expect(searchHelpTopics(helpTopics, '助手 草稿').single.title, contains('助手'));
    expect(searchHelpTopics(helpTopics, '不存在的问题'), isEmpty);
    expect(searchHelpTopics(helpTopics, '  '), hasLength(helpTopics.length));
  });

  testWidgets('help center searches and expands on narrow dark UI', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: healthyService(),
        child: MaterialApp(
          theme: StarCloudsTheme.light(),
          darkTheme: StarCloudsTheme.dark(),
          themeMode: ThemeMode.dark,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const HelpCenterScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('帮助中心'), findsOneWidget);
    expect(find.text('线上服务运行正常'), findsOneWidget);
    expect(find.text('6 项'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.enterText(find.byKey(const Key('help-search')), '积分 退回');
    await tester.pumpAndSettle();
    expect(find.text('1 项'), findsOneWidget);
    expect(find.text('生成失败会退回积分吗？'), findsOneWidget);

    await tester.tap(find.text('生成失败会退回积分吗？'));
    await tester.pumpAndSettle();
    expect(find.textContaining('积分明细'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.enterText(find.byKey(const Key('help-search')), '无匹配内容');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('help-empty')), findsOneWidget);
    await tester.tap(find.text('查看全部问题'));
    await tester.pumpAndSettle();
    expect(find.text('6 项'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('help center opens the authenticated feedback route', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/help',
      routes: [
        GoRoute(
          path: '/help',
          builder: (context, state) => const HelpCenterScreen(),
        ),
        GoRoute(
          path: '/profile/feedback',
          builder: (context, state) => const Scaffold(body: Text('反馈目标页')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: healthyService(),
        child: MaterialApp.router(routerConfig: router),
      ),
    );

    await tester.scrollUntilVisible(
      find.byKey(const Key('help-feedback')),
      280,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('help-feedback')));
    await tester.pumpAndSettle();

    expect(router.state.uri.path, '/profile/feedback');
    expect(find.text('反馈目标页'), findsOneWidget);
  });

  testWidgets('service status retries from degraded to online', (tester) async {
    var checks = 0;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          helpServiceStatusProvider.overrideWith((ref) async {
            checks += 1;
            return checks == 1
                ? const HelpServiceStatus(
                    HelpServiceState.degraded,
                    '线上服务暂时异常，请稍后重新检查',
                  )
                : const HelpServiceStatus(
                    HelpServiceState.online,
                    '创作、助手和同步服务可正常连接',
                  );
          }),
        ],
        child: const MaterialApp(home: HelpCenterScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('线上服务暂时异常'), findsOneWidget);
    await tester.tap(find.byKey(const Key('help-service-refresh')));
    await tester.pumpAndSettle();

    expect(checks, 2);
    expect(find.text('线上服务运行正常'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
