import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/appearance.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/checkin/checkin.dart';
import 'package:starcloudsai_mobile/features/meta/meta.dart';
import 'package:starcloudsai_mobile/features/profile/profile.dart';
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
  @override
  Future<CheckinState> build() async => CheckinState.fromJson({
    'enabled': true,
    'todayChecked': false,
    'claimRewardCents': 20,
  });
}

class _ProfileAppearanceController extends AppearanceController {
  @override
  Future<AppAppearance> build() async => AppAppearance.system;
}

Widget _screen({
  required AppUser? user,
  bool overviewFails = false,
  double textScale = 1,
  Future<bool> Function(Uri uri)? openExternal,
}) => ProviderScope(
  overrides: [
    sessionControllerProvider.overrideWith(
      () => _ProfileSessionController(user),
    ),
    walletProvider.overrideWith((ref) async => _wallet),
    profileOverviewProvider.overrideWith((ref) async {
      if (overviewFails) throw StateError('overview unavailable');
      return _overview;
    }),
    checkinControllerProvider.overrideWith(_ProfileCheckinController.new),
    appearanceControllerProvider.overrideWith(_ProfileAppearanceController.new),
    latestChangelogProvider.overrideWith((ref) async => null),
  ],
  child: MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: ProfileScreen(openExternal: openExternal),
  ),
);

void main() {
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
    expect(
      find.descendant(of: website, matching: find.byType(DecoratedBox)),
      findsNothing,
    );
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
      '通知中心',
      '权益与服务',
      '每日签到',
      '福利中心',
      '套餐与订单',
      '设置与支持',
      '外观设置',
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
    expect(find.text('退出登录'), findsNothing);
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
