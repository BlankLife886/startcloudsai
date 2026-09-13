import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/features/auth/authenticated_route.dart';
import 'package:starcloudsai_mobile/app/appearance.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/checkin/checkin.dart';
import 'package:starcloudsai_mobile/features/meta/meta.dart';
import 'package:starcloudsai_mobile/features/profile/profile.dart';
import 'package:starcloudsai_mobile/features/profile/app_info.dart';
import 'package:starcloudsai_mobile/features/profile/profile_screen.dart';

const _user = AppUser(
  id: 'user-1',
  email: 'creator@example.com',
  username: '创作者小星',
  bio: '专注品牌视觉与插画创作',
  location: '上海',
  websiteUrl: 'star.example.com',
);

const _wallet = WalletSnapshot(
  availablePoints: 180,
  frozenPoints: 12,
  trialPoints: 30,
);

final _overview = ProfileOverview(
  wallet: _wallet,
  taskStats: const ProfileTaskStats(
    total: 18,
    succeeded: 14,
    running: 2,
    failed: 1,
  ),
  submissionStats: const ProfileSubmissionStats(
    total: 3,
    pending: 1,
    approved: 2,
    rejected: 0,
  ),
  assetCount: 7,
  assetUngrouped: 2,
  unreadNotifications: 4,
  recentTasks: const [],
);

class _ProfileSessionController extends SessionController {
  _ProfileSessionController(this.user);

  final AppUser? user;

  @override
  Future<SessionState> build() async => SessionState(user: user);
}

class _ProfileCheckinController extends CheckinController {
  _ProfileCheckinController([this.onRead]);
  final VoidCallback? onRead;
  @override
  Future<CheckinState> build() async {
    onRead?.call();
    return CheckinState.fromJson({
      'enabled': true,
      'todayChecked': false,
      'claimRewardCents': 20,
    });
  }
}

class _ProfileAppearanceController extends AppearanceController {
  @override
  Future<AppAppearance> build() async => AppAppearance.system;
}

Widget _screen({
  required AppUser? user,
  bool overviewFails = false,
  double textScale = 1,
  Brightness brightness = Brightness.light,
  EdgeInsets padding = EdgeInsets.zero,
  VoidCallback? onPrivateRead,
  Widget? app,
  Future<bool> Function(Uri uri)? openExternal,
}) => ProviderScope(
  overrides: [
    sessionControllerProvider.overrideWith(
      () => _ProfileSessionController(user),
    ),
    walletProvider.overrideWith((ref) async {
      onPrivateRead?.call();
      return _wallet;
    }),
    profileOverviewProvider.overrideWith((ref) async {
      onPrivateRead?.call();
      if (overviewFails) throw StateError('overview unavailable');
      return _overview;
    }),
    checkinControllerProvider.overrideWith(
      () => _ProfileCheckinController(onPrivateRead),
    ),
    appearanceControllerProvider.overrideWith(_ProfileAppearanceController.new),
    latestChangelogProvider.overrideWith((ref) async => null),
    appPackageInfoProvider.overrideWith(
      (ref) async => PackageInfo(
        appName: '星空云绘',
        packageName: 'com.starcloudisai.app',
        version: '1.2.3',
        buildNumber: '45',
      ),
    ),
  ],
  child:
      app ??
      MaterialApp(
        theme: StarCloudsTheme.light(),
        darkTheme: StarCloudsTheme.dark(),
        themeMode: brightness == Brightness.dark
            ? ThemeMode.dark
            : ThemeMode.light,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(textScale),
            padding: padding,
          ),
          child: child!,
        ),
        home: ProfileScreen(openExternal: openExternal),
      ),
);

void main() {
  testWidgets(
    'guest account layout fits large text and does not load private data',
    (tester) async {
      var privateReads = 0;
      addTearDown(() => tester.binding.setSurfaceSize(null));
      for (final brightness in Brightness.values) {
        for (final width in [320.0, 840.0]) {
          await tester.binding.setSurfaceSize(Size(width, 720));
          await tester.pumpWidget(
            _screen(
              user: null,
              brightness: brightness,
              textScale: 1.6,
              padding: const EdgeInsets.only(top: 59),
              onPrivateRead: () => privateReads++,
            ),
          );
          await tester.pumpAndSettle();
          final panel = find.byKey(const Key('profile-account-panel'));
          expect(tester.getTopLeft(panel).dy, closeTo(123, 1));
          expect(tester.getSize(panel).width, lessThanOrEqualTo(640));
          expect(find.text('星空账号'), findsOneWidget);
          expect(find.text('未登录'), findsOneWidget);
          expect(find.byKey(const Key('profile-quick-works')), findsOneWidget);
          expect(find.byKey(const Key('profile-quick-assets')), findsOneWidget);
          expect(privateReads, 0);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        }
      }
    },
  );

  for (final destination in ['/works', '/profile/assets']) {
    testWidgets(
      'guest shortcut $destination stays protected and resumes after login',
      (tester) async {
        var privateBuilds = 0;
        final router = GoRouter(
          initialLocation: '/profile',
          routes: [
            GoRoute(
              path: '/profile',
              builder: (context, state) => const ProfileScreen(),
            ),
            GoRoute(
              path: destination,
              builder: (context, state) => AuthenticatedRoute(
                title: '私有内容',
                icon: Icons.lock_outline,
                child: Builder(
                  builder: (context) {
                    privateBuilds++;
                    return const Scaffold(body: Text('私有内容已打开'));
                  },
                ),
              ),
            ),
            GoRoute(
              path: '/login',
              builder: (context, state) => Consumer(
                builder: (context, ref, child) => Scaffold(
                  body: FilledButton(
                    onPressed: () {
                      ref
                          .read(sessionControllerProvider.notifier)
                          .replaceUser(_user);
                      context.pop(true);
                    },
                    child: const Text('测试登录'),
                  ),
                ),
              ),
            ),
          ],
        );
        addTearDown(router.dispose);
        await tester.pumpWidget(
          _screen(user: null, app: MaterialApp.router(routerConfig: router)),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(
            Key(
              destination == '/works'
                  ? 'profile-quick-works'
                  : 'profile-quick-assets',
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(router.state.uri.path, destination);
        expect(privateBuilds, 0);
        await tester.tap(find.byKey(const Key('authenticated-route-login')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('测试登录'));
        await tester.pumpAndSettle();
        expect(router.state.uri.path, destination);
        expect(find.text('私有内容已打开'), findsOneWidget);
        expect(privateBuilds, greaterThan(0));
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('guest support and legal links open their existing routes', (
    tester,
  ) async {
    const destinations = {
      'profile-login': '/login',
      'profile-help': '/help',
      'profile-terms': '/legal/terms',
      'profile-privacy': '/legal/privacy',
    };
    final router = GoRouter(
      initialLocation: '/profile',
      routes: [
        GoRoute(
          path: '/profile',
          builder: (context, state) => const ProfileScreen(),
        ),
        for (final path in destinations.values)
          GoRoute(
            path: path,
            builder: (context, state) => Scaffold(body: Text('opened:$path')),
          ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      _screen(user: null, app: MaterialApp.router(routerConfig: router)),
    );
    await tester.pumpAndSettle();
    for (final entry in destinations.entries) {
      final control = find.byKey(Key(entry.key));
      await tester.ensureVisible(control);
      await tester.pumpAndSettle();
      await tester.tap(control);
      await tester.pumpAndSettle();
      expect(router.state.uri.path, entry.value);
      expect(find.text('opened:${entry.value}'), findsOneWidget);
      router.pop();
      await tester.pumpAndSettle();
    }
    expect(tester.takeException(), isNull);
  });

  test('normalizes legacy profile websites and rejects unsafe schemes', () {
    expect(
      profileWebsiteUri(' star.example.com/portfolio '),
      Uri.parse('https://star.example.com/portfolio'),
    );
    expect(
      profileWebsiteUri('http://example.com/path?q=1'),
      Uri.parse('http://example.com/path?q=1'),
    );
    expect(profileWebsiteUri('javascript:alert(1)'), isNull);
    expect(profileWebsiteUri('ftp://example.com'), isNull);
    expect(profileWebsiteUri('  '), isNull);
  });

  test('formats installed release and non-production versions accurately', () {
    final info = PackageInfo(
      appName: '星空云绘',
      packageName: 'com.starcloudisai.app',
      version: '1.2.3',
      buildNumber: '45',
    );

    expect(installedVersionLabel(info, '正式环境'), 'v1.2.3 (45)');
    expect(installedVersionLabel(info, '预发布环境'), 'v1.2.3 (45) · 预发布环境');
  });

  testWidgets('profile website opens safely from a flat metadata action', (
    tester,
  ) async {
    Uri? opened;
    await tester.pumpWidget(
      _screen(
        user: _user,
        openExternal: (uri) async {
          opened = uri;
          return true;
        },
      ),
    );
    await tester.pumpAndSettle();

    final website = find.byKey(const Key('profile-website'));
    expect(website, findsOneWidget);
    final focusSurface = tester.widget<DecoratedBox>(
      find.descendant(of: website, matching: find.byType(DecoratedBox)),
    );
    final focusDecoration = focusSurface.decoration as BoxDecoration;
    expect(focusDecoration.color, isNull);
    expect(focusDecoration.boxShadow, isNull);
    expect(focusDecoration.border?.top.color, Colors.transparent);
    final hero = tester.widget<ColoredBox>(
      find.byKey(const Key('profile-hero-surface')),
    );
    expect(hero.color, Theme.of(tester.element(website)).colorScheme.surface);

    await tester.tap(website);
    await tester.pumpAndSettle();

    expect(opened, Uri.parse('https://star.example.com'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('profile website launch failure uses the centered notice', (
    tester,
  ) async {
    await tester.pumpWidget(
      _screen(user: _user, openExternal: (uri) async => false),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('profile-website')));
    await tester.pump();

    expect(find.text('暂时无法打开个人网站'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('signed-in profile is grouped and contains no repeated tools', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_screen(user: _user, textScale: 1.6));
    await tester.pumpAndSettle();

    expect(find.text('创作者小星'), findsOneWidget);
    expect(find.text('creator@example.com'), findsOneWidget);
    expect(find.byKey(const Key('profile-edit')), findsOneWidget);
    expect(find.text('账户概览'), findsNothing);
    expect(find.text('历史记录'), findsOneWidget);
    expect(find.text('我的素材'), findsOneWidget);
    expect(find.bySemanticsLabel('可用积分，180'), findsOneWidget);
    expect(find.bySemanticsLabel('历史记录，18'), findsOneWidget);
    expect(find.bySemanticsLabel('我的素材，7'), findsOneWidget);

    for (final removed in ['AI 助手', '模型设计', '插画染色', '智能去背景', '创作记录']) {
      expect(find.text(removed), findsNothing);
    }
    for (final unique in [
      '内容管理',
      '我的投稿',
      '我的收藏',
      '权益与服务',
      '每日签到',
      '福利中心',
      '会员与订单',
      '设置与支持',
      '外观设置',
      '账号与安全',
      '问题反馈',
      '关于星空云绘',
    ]) {
      for (
        var attempt = 0;
        attempt < 20 && find.text(unique).evaluate().isEmpty;
        attempt++
      ) {
        await tester.drag(find.byType(ListView), const Offset(0, -240));
        await tester.pumpAndSettle();
      }
      expect(find.text(unique), findsOneWidget, reason: 'missing $unique');
      expect(tester.takeException(), isNull);
      for (final removed in ['AI 助手', '模型设计', '插画染色', '智能去背景', '创作记录']) {
        expect(find.text(removed), findsNothing);
      }
    }
    expect(find.byTooltip('刷新'), findsNothing);
    expect(find.byKey(const Key('profile-favorite-prompts')), findsOneWidget);
    expect(find.text('通知中心'), findsNothing);
    expect(find.text('退出登录'), findsNothing);
    expect(find.text('v1.2.3 (45) · 开发环境'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('overview failure is consolidated into one recoverable status', (
    tester,
  ) async {
    await tester.pumpWidget(_screen(user: _user, overviewFails: true));
    await tester.pumpAndSettle();

    expect(find.text('部分数据暂不可用'), findsOneWidget);
    expect(find.byKey(const Key('profile-overview-retry')), findsOneWidget);
    expect(find.text('钱包加载失败'), findsNothing);
    expect(find.text('创作概览加载失败'), findsNothing);
    expect(find.bySemanticsLabel('可用积分，180'), findsOneWidget);
    expect(find.bySemanticsLabel('历史记录，--'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('anonymous profile keeps the same compact support structure', (
    tester,
  ) async {
    await tester.pumpWidget(_screen(user: null));
    await tester.pumpAndSettle();

    expect(find.text('未登录'), findsOneWidget);
    expect(find.byKey(const Key('profile-login')), findsOneWidget);
    expect(find.text('设置与支持'), findsOneWidget);
    expect(find.text('外观设置'), findsOneWidget);
    expect(find.text('关于星空云绘'), findsOneWidget);
    expect(find.text('账户概览'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
