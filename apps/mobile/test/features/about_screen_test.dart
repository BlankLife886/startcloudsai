import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/providers.dart';
import 'package:starcloudsai_mobile/features/meta/meta.dart';
import 'package:starcloudsai_mobile/features/profile/about_screen.dart';
import 'package:starcloudsai_mobile/features/profile/app_info.dart';
import 'package:starcloudsai_mobile/features/profile/legal_document_screen.dart';

const _environment = AppEnvironment(
  name: AppEnvironmentName.production,
  origin: 'https://starcloudisai.com',
  apiBaseUrl: 'https://starcloudisai.com/api/v1',
);

PackageInfo _packageInfo() => PackageInfo(
  appName: '星空云绘',
  packageName: 'com.starcloudisai.app',
  version: '1.2.3',
  buildNumber: '45',
);

List<Override> _overrides({
  List<AppAnnouncement> announcements = const [],
  Future<List<AppAnnouncement>> Function()? announcementLoader,
}) => [
  appEnvironmentProvider.overrideWithValue(_environment),
  appPackageInfoProvider.overrideWith((ref) async => _packageInfo()),
  startupAnnouncementsProvider.overrideWith(
    (ref) => announcementLoader?.call() ?? Future.value(announcements),
  ),
];

void main() {
  test('manual update check selects the highest version for this platform', () {
    AppAnnouncement update(
      String id,
      String version, {
      List<String> platforms = const [],
      String? minimum,
    }) => AppAnnouncement(
      id: id,
      title: '版本 $version',
      body: '',
      createdAt: null,
      latestAppVersion: version,
      minimumSupportedAppVersion: minimum,
      targetPlatforms: platforms,
      ctaText: '更新',
      ctaUrl: '/updates',
    );

    final result = findAvailableAppUpdate(
      [
        update('old', '1.2.3'),
        update('android', '9.0.0', platforms: const ['android']),
        update('recommended', '1.8.0'),
        update('required', '1.6.0', minimum: '1.5.0'),
      ],
      installedVersion: '1.2.3',
      platform: TargetPlatform.iOS,
    );

    expect(result?.announcement.id, 'recommended');
    expect(result?.latestVersion, '1.8.0');
    expect(result?.required, isFalse);
  });

  test('support diagnostics contain release context without account data', () {
    final text = supportDiagnosticText(
      _packageInfo(),
      _environment,
      TargetPlatform.iOS,
    );

    expect(text, contains('版本：1.2.3 (45)'));
    expect(text, contains('应用标识：com.starcloudisai.app'));
    expect(text, contains('平台：iOS'));
    expect(text, contains('运行环境：正式环境'));
    expect(text, contains('服务地址：https://starcloudisai.com'));
    expect(text, isNot(contains('qa@example.com')));
  });

  testWidgets('about page fits narrow large text in light and dark themes', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    for (final brightness in [Brightness.light, Brightness.dark]) {
      await tester.pumpWidget(
        ProviderScope(
          key: ValueKey(brightness),
          overrides: _overrides(),
          child: MaterialApp(
            theme: StarCloudsTheme.light(),
            darkTheme: StarCloudsTheme.dark(),
            themeMode: brightness == Brightness.dark
                ? ThemeMode.dark
                : ThemeMode.light,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(1.6)),
              child: child!,
            ),
            home: const AboutScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('星空云绘'), findsOneWidget);
      expect(find.text('v1.2.3 (45)'), findsWidgets);
      expect(find.bySemanticsLabel('星空云绘标识'), findsOneWidget);
      expect(find.byKey(const Key('about-updates')), findsOneWidget);
      expect(find.byKey(const Key('about-check-update')), findsOneWidget);
      expect(find.text('已是最新版本'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(const Key('about-data-use')),
        260,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.textContaining('不用于跨应用跟踪'), findsOneWidget);
      expect(find.byKey(const Key('about-privacy-policy')), findsOneWidget);
      expect(find.byKey(const Key('about-terms')), findsOneWidget);
      expect(
        find.byKey(const Key('about-open-source-licenses')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('about page copies non-sensitive diagnostic context', (
    tester,
  ) async {
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
      ProviderScope(
        overrides: _overrides(),
        child: const MaterialApp(home: AboutScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('about-copy-diagnostics')));
    await tester.pump();

    expect(clipboardText, contains('版本：1.2.3 (45)'));
    expect(clipboardText, contains('平台：Android'));
    expect(find.text('诊断信息已复制'), findsOneWidget);
  });

  testWidgets('about page shares the official app link with a tablet anchor', (
    tester,
  ) async {
    String? sharedText;
    Rect? sharedOrigin;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          ..._overrides(),
          appShareHandlerProvider.overrideWithValue((text, origin) async {
            sharedText = text;
            sharedOrigin = origin;
          }),
        ],
        child: const MaterialApp(home: AboutScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byKey(const Key('about-share-app')),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(find.byKey(const Key('about-share-app')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('about-share-app')));
    await tester.pump();

    expect(sharedText, appShareText);
    expect(sharedText, contains('https://starcloudisai.com'));
    expect(sharedOrigin, isNotNull);
    expect(sharedOrigin!.width, greaterThan(0));
    expect(sharedOrigin!.height, greaterThan(0));
    expect(tester.takeException(), isNull);
  });

  testWidgets('about page opens the dedicated update history', (tester) async {
    final router = GoRouter(
      initialLocation: '/about',
      routes: [
        GoRoute(
          path: '/about',
          builder: (context, state) => const AboutScreen(),
        ),
        GoRoute(
          path: '/updates',
          builder: (context, state) => const Scaffold(body: Text('更新记录目标页')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(),
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('about-updates')));
    await tester.pumpAndSettle();

    expect(router.state.uri.path, '/updates');
    expect(find.text('更新记录目标页'), findsOneWidget);
  });

  testWidgets('available update is visible and opens its internal action', (
    tester,
  ) async {
    final announcement = AppAnnouncement(
      id: 'mobile-2',
      title: '新版本',
      body: '',
      createdAt: null,
      latestAppVersion: '2.0.0',
      ctaText: '立即更新',
      ctaUrl: '/updates',
    );
    final router = GoRouter(
      initialLocation: '/about',
      routes: [
        GoRoute(
          path: '/about',
          builder: (context, state) => const AboutScreen(),
        ),
        GoRoute(
          path: '/updates',
          builder: (context, state) => const Scaffold(body: Text('新版详情')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(announcements: [announcement]),
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('发现新版本 v2.0.0'), findsOneWidget);
    expect(find.byTooltip('立即更新'), findsOneWidget);
    await tester.tap(find.byKey(const Key('about-check-update-action')));
    await tester.pumpAndSettle();

    expect(router.state.uri.path, '/updates');
    expect(find.text('新版详情'), findsOneWidget);
  });

  testWidgets('latest-version action performs a fresh online check', (
    tester,
  ) async {
    var requests = 0;
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(
          announcementLoader: () async {
            requests += 1;
            return const [];
          },
        ),
        child: const MaterialApp(home: AboutScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(requests, 1);
    await tester.tap(find.byKey(const Key('about-check-update-action')));
    await tester.pumpAndSettle();

    expect(requests, 2);
    expect(find.text('当前已是最新版本'), findsOneWidget);
  });

  testWidgets('about page opens permission management', (tester) async {
    final router = GoRouter(
      initialLocation: '/about',
      routes: [
        GoRoute(
          path: '/about',
          builder: (context, state) => const AboutScreen(),
        ),
        GoRoute(
          path: '/permissions',
          builder: (context, state) => const Scaffold(body: Text('权限管理目标页')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(),
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byKey(const Key('about-permissions')),
      220,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(find.byKey(const Key('about-permissions')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('about-permissions')));
    await tester.pumpAndSettle();

    expect(router.state.uri.path, '/permissions');
    expect(find.text('权限管理目标页'), findsOneWidget);
  });

  testWidgets('about page opens privacy policy and user agreement', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/about',
      routes: [
        GoRoute(
          path: '/about',
          builder: (context, state) => const AboutScreen(),
        ),
        GoRoute(
          path: '/legal/privacy',
          builder: (context, state) =>
              const LegalDocumentScreen(kind: LegalDocumentKind.privacy),
        ),
        GoRoute(
          path: '/legal/terms',
          builder: (context, state) =>
              const LegalDocumentScreen(kind: LegalDocumentKind.terms),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(),
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byKey(const Key('about-privacy-policy')),
      320,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(find.byKey(const Key('about-privacy-policy')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('about-privacy-policy')));
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/legal/privacy');
    expect(find.text('隐私政策'), findsOneWidget);

    router.pop();
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const Key('about-terms')),
      320,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(find.byKey(const Key('about-terms')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('about-terms')));
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/legal/terms');
    expect(find.text('用户协议'), findsOneWidget);
  });

  testWidgets('about page opens third-party licenses', (tester) async {
    final router = GoRouter(
      initialLocation: '/about',
      routes: [
        GoRoute(
          path: '/about',
          builder: (context, state) => const AboutScreen(),
        ),
        GoRoute(
          path: '/licenses',
          builder: (context, state) => const Scaffold(body: Text('开源许可目标页')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(),
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byKey(const Key('about-open-source-licenses')),
      320,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(
      find.byKey(const Key('about-open-source-licenses')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('about-open-source-licenses')));
    await tester.pumpAndSettle();

    expect(router.state.uri.path, '/licenses');
    expect(find.text('开源许可目标页'), findsOneWidget);
  });
}
