import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/features/benefits/benefits.dart';
import 'package:starcloudsai_mobile/features/benefits/benefits_screen.dart';

final _campaign = TrialCampaign.fromJson({
  'id': 'campaign-1',
  'title': '限量功能体验计划-第二期',
  'features': [
    {
      'key': 'text-to-image',
      'label': '文生图',
      'taskTypes': ['text_to_image'],
      'entitlementActive': true,
    },
    {'key': 'ui-design', 'label': 'UI 设计稿'},
  ],
  'accessMode': 'credit_only',
  'capacity': 100,
  'displayApplied': 13,
  'remaining': 87,
  'nextPosition': 14,
  'enabled': true,
  'remainingSeconds': 86400,
  'expiresAt': '2026-09-20T12:21:02.731Z',
});

TrialApplication _application({
  String status = 'pending',
  String rewardStatus = '',
  String reviewNote = '',
}) => TrialApplication.fromJson({
  'id': 'application-1',
  'campaignId': _campaign.id,
  'applicationNo': 14,
  'occupation': '产品设计师',
  'reason': '用于验证移动端产品设计工作流。',
  'status': status,
  'reviewNote': reviewNote,
  'rewardCents': 500,
  'rewardStatus': rewardStatus,
  'entitlementActive': status == 'approved',
  'features': [
    {
      'key': 'text-to-image',
      'label': '文生图',
      'entitlementActive': status == 'approved',
    },
  ],
});

final _rules = GrowthRules.fromJson({
  'groupEnabled': true,
  'groupCampaignOrdinal': 2,
  'groupTargetMembers': 3,
  'groupRewardCents': 200,
  'groupDurationHours': 48,
  'failureBonusEnabled': true,
  'failureBonusCents': 8,
  'failureBonusDailyLimit': 3,
  'failureClaimsToday': 1,
  'usageRewardsEnabled': true,
  'monthDeliveredUnits': 7,
  'usageMilestones': [
    {'units': 5, 'rewardCents': 20, 'achieved': true},
    {'units': 10, 'rewardCents': 50, 'achieved': false},
  ],
  'suggestionRewardMaxCents': 300,
});

GrowthGroup _group({String code = 'TEAM88'}) => GrowthGroup.fromJson({
  'id': 'group-1',
  'code': code,
  'status': 'active',
  'targetMembers': 3,
  'memberCount': 2,
  'rewardCents': 200,
  'expiresAt': '2026-09-18T10:30:00Z',
  'members': [
    {'userId': 'user-1', 'username': 'QA', 'role': 'owner'},
    {'userId': 'user-2', 'username': '  ', 'role': 'member'},
  ],
});

BenefitsState _state({TrialApplication? application, GrowthGroup? group}) =>
    BenefitsState(
      campaign: _campaign,
      application: application,
      growth: GrowthOverview(rules: _rules, group: group),
    );

class _FakeBenefitsController extends BenefitsController {
  _FakeBenefitsController({this.initialApplication, this.initialGroup});

  final TrialApplication? initialApplication;
  final GrowthGroup? initialGroup;
  String? submittedOccupation;
  String? submittedReason;
  String? joinedCode;
  int claimCount = 0;
  int createCount = 0;

  @override
  Future<BenefitsState> build() async =>
      _state(application: initialApplication, group: initialGroup);

  @override
  Future<void> refresh() async {}

  @override
  Future<TrialApplication> submitApplication({
    required String occupation,
    required String reason,
  }) async {
    submittedOccupation = occupation;
    submittedReason = reason;
    final item = _application();
    state = AsyncData(state.requireValue.copyWith(application: item));
    return item;
  }

  @override
  Future<TrialReward> claimReward() async {
    claimCount += 1;
    final item = _application(status: 'approved', rewardStatus: 'redeemed');
    state = AsyncData(state.requireValue.copyWith(application: item));
    return const TrialReward(grantPoints: 500, alreadyClaimed: false);
  }

  @override
  Future<GrowthGroup> createGroup() async {
    createCount += 1;
    final item = _group();
    state = AsyncData(
      state.requireValue.copyWith(
        growth: GrowthOverview(rules: _rules, group: item),
      ),
    );
    return item;
  }

  @override
  Future<GrowthGroup> joinGroup(String code) async {
    joinedCode = code;
    final item = _group(code: code.toUpperCase());
    state = AsyncData(
      state.requireValue.copyWith(
        growth: GrowthOverview(rules: _rules, group: item),
      ),
    );
    return item;
  }
}

Widget _app({
  required BenefitsController Function() controller,
  double textScale = 1,
  String location = '/profile/benefits',
  GrowthGroupShareHandler? shareHandler,
}) {
  final router = GoRouter(
    initialLocation: location,
    routes: [
      GoRoute(
        path: '/profile/benefits',
        builder: (context, state) => const BenefitsScreen(),
        routes: [
          GoRoute(
            path: 'trial',
            builder: (context, state) => const TrialBenefitScreen(),
          ),
          GoRoute(
            path: 'growth',
            builder: (context, state) => const GrowthBenefitScreen(),
          ),
          GoRoute(
            path: 'group',
            builder: (context, state) => const GrowthGroupBenefitScreen(),
          ),
        ],
      ),
      GoRoute(
        path: '/profile/feedback',
        builder: (context, state) => const Scaffold(body: Text('反馈')),
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      benefitsControllerProvider.overrideWith(controller),
      if (shareHandler != null)
        growthGroupShareHandlerProvider.overrideWithValue(shareHandler),
    ],
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
  test('parses campaign, application, growth rules and group safely', () {
    final group = _group();

    expect(_campaign.features.map((item) => item.label), ['文生图', 'UI 设计稿']);
    expect(_campaign.progress, closeTo(0.13, 0.001));
    expect(_campaign.nextPosition, 14);
    expect(_application(status: 'approved').canClaimReward, isFalse);
    expect(
      _application(status: 'approved', rewardStatus: 'active').canClaimReward,
      isTrue,
    );
    expect(_rules.milestones.length, 2);
    expect(_rules.monthDeliveredUnits, 7);
    expect(group.progress, closeTo(2 / 3, 0.001));
    expect(group.members.last.username, '星空用户');
  });

  test('normalizes and validates application fields and group codes', () {
    expect(normalizeOccupations('设计师,开发者；设计师、 产品经理'), '设计师、开发者、产品经理');
    expect(validateOccupations(''), isNotNull);
    expect(validateOccupations('甲乙,丙丁,戊己,庚辛,壬癸'), contains('4'));
    expect(validateOccupations('产品设计师、独立开发者'), isNull);
    expect(validateTrialReason('太短'), contains('10'));
    expect(validateTrialReason('这是一段超过十个字的申请理由'), isNull);
    expect(validateTrialReason('x' * 1001), contains('1000'));
    expect(validateGroupCode('12345'), contains('6-16'));
    expect(validateGroupCode('TEAM88'), isNull);
  });

  testWidgets('application sheet validates then submits through controller', (
    tester,
  ) async {
    late _FakeBenefitsController controller;
    await tester.pumpWidget(
      _app(controller: () => controller = _FakeBenefitsController()),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('体验资格'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('填写体验申请'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '提交申请'));
    await tester.pump();
    expect(find.text('请填写职业或使用场景'), findsOneWidget);
    expect(find.text('申请理由至少需要 10 个字符'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField).first, '产品设计师, 独立开发者');
    await tester.enterText(
      find.byType(TextFormField).last,
      '用于验证移动端产品设计工作流和交互效果。',
    );
    await tester.tap(find.widgetWithText(FilledButton, '提交申请'));
    await tester.pumpAndSettle();

    expect(controller.submittedOccupation, '产品设计师, 独立开发者');
    expect(controller.submittedReason, contains('移动端'));
    expect(find.text('体验申请已提交，审核结果会通过通知告知'), findsOneWidget);
  });

  testWidgets('approved reward can be claimed and status becomes claimed', (
    tester,
  ) async {
    late _FakeBenefitsController controller;
    await tester.pumpWidget(
      _app(
        controller: () => controller = _FakeBenefitsController(
          initialApplication: _application(
            status: 'approved',
            rewardStatus: 'active',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('体验资格'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('领取 500 体验积分'));
    await tester.pumpAndSettle();
    expect(controller.claimCount, 1);
    expect(find.text('体验积分已领取'), findsOneWidget);
    expect(find.text('500 体验积分已到账'), findsOneWidget);
  });

  testWidgets('create and join group actions use controller', (tester) async {
    late _FakeBenefitsController createController;
    await tester.pumpWidget(
      _app(controller: () => createController = _FakeBenefitsController()),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('好友拼团'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('创建拼团'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认创建'));
    await tester.pumpAndSettle();
    expect(createController.createCount, 1);
    expect(find.text('2/3 人'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    late _FakeBenefitsController joinController;
    await tester.pumpWidget(
      _app(controller: () => joinController = _FakeBenefitsController()),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('好友拼团'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('输入拼团码'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'team88');
    await tester.tap(find.widgetWithText(FilledButton, '加入拼团'));
    await tester.pumpAndSettle();
    expect(joinController.joinedCode, 'team88');
    expect(find.text('拼团码 TEAM88'), findsOneWidget);
  });

  testWidgets('group code can be copied', (tester) async {
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
      _app(controller: () => _FakeBenefitsController(initialGroup: _group())),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('好友拼团'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('复制拼团码'));
    await tester.pump();
    expect(clipboardText, 'TEAM88');
    expect(find.text('拼团码已复制'), findsOneWidget);
  });

  testWidgets('active group can be shared with its invite code', (
    tester,
  ) async {
    String? sharedCode;
    Rect? sharedOrigin;
    await tester.pumpWidget(
      _app(
        controller: () => _FakeBenefitsController(initialGroup: _group()),
        location: '/profile/benefits/group',
        shareHandler: (code, origin) async {
          sharedCode = code;
          sharedOrigin = origin;
        },
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('分享拼团码'));
    await tester.pump();

    expect(sharedCode, 'TEAM88');
    expect(sharedOrigin, isNotNull);
    expect(sharedOrigin!.isEmpty, isFalse);
    expect(find.textContaining('有效期至'), findsOneWidget);
  });

  testWidgets('campaign, growth and group fit 320px with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        controller: () => _FakeBenefitsController(initialGroup: _group()),
        textScale: 1.6,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('体验资格'), findsOneWidget);
    expect(find.text('成长奖励'), findsOneWidget);
    expect(find.text('好友拼团'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(
      _app(
        controller: () => _FakeBenefitsController(initialGroup: _group()),
        textScale: 1.6,
        location: '/profile/benefits/trial',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('剩余 87 个名额 · 下一位第 14 名'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(
      _app(
        controller: () => _FakeBenefitsController(initialGroup: _group()),
        textScale: 1.6,
        location: '/profile/benefits/growth',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('本月创作里程碑'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(
      _app(
        controller: () => _FakeBenefitsController(initialGroup: _group()),
        textScale: 1.6,
        location: '/profile/benefits/group',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('拼团码 TEAM88'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('application status panels cover pending, rejected and claimed', (
    tester,
  ) async {
    for (final entry in [
      (_application(), '待审核'),
      (_application(status: 'rejected', reviewNote: '请补充更具体的工作流'), '未通过'),
      (_application(status: 'approved', rewardStatus: 'redeemed'), '体验积分已领取'),
    ]) {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TrialApplicationPanel(
              campaign: _campaign,
              application: entry.$1,
              submitting: false,
              claiming: false,
              onApply: () {},
              onClaim: () {},
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text(entry.$2), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('benefits hub supports dark mode without layout errors', (
    tester,
  ) async {
    final router = GoRouter(
      routes: [
        GoRoute(path: '/', builder: (context, state) => const BenefitsScreen()),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          benefitsControllerProvider.overrideWith(_FakeBenefitsController.new),
        ],
        child: MaterialApp.router(
          theme: ThemeData.light(),
          darkTheme: ThemeData.dark(),
          themeMode: ThemeMode.dark,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('资格与奖励'), findsOneWidget);
    expect(
      Theme.of(tester.element(find.text('资格与奖励'))).brightness,
      Brightness.dark,
    );
    expect(tester.takeException(), isNull);
  });
}
