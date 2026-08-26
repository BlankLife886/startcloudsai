import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/checkin/checkin.dart';
import 'package:starcloudsai_mobile/features/checkin/checkin_screen.dart';

Map<String, dynamic> _checkinJson({bool checked = false}) => {
  'enabled': true,
  'campaignTitle': '连续签到领创作积分',
  'today': '2026-08-24',
  'todayChecked': checked,
  'todayRecord': checked
      ? {
          'id': 'record-today',
          'date': '2026-08-24',
          'streak': 3,
          'cycleDay': 3,
          'rewardCents': 20,
        }
      : null,
  'currentStreak': checked ? 3 : 2,
  'claimCycleDay': 3,
  'claimRewardCents': 20,
  'nextCycleDay': 4,
  'nextRewardCents': 25,
  'rewards': [
    for (var day = 1; day <= 7; day++)
      {
        'day': day,
        'rewardCents': day == 7 ? 80 : day * 5 + 5,
        'milestone': day == 7,
      },
  ],
  'month': '2026-08',
  'monthRecords': [
    {
      'id': 'record-23',
      'date': '2026-08-23',
      'streak': 2,
      'cycleDay': 2,
      'rewardCents': 15,
    },
    if (checked)
      {
        'id': 'record-today',
        'date': '2026-08-24',
        'streak': 3,
        'cycleDay': 3,
        'rewardCents': 20,
      },
  ],
  'monthRewardCents': checked ? 35 : 15,
  'totalCheckins': checked ? 9 : 8,
  'claimedRewardCents': checked ? 20 : 0,
  'alreadyChecked': false,
};

class _FakeCheckinController extends CheckinController {
  @override
  Future<CheckinState> build() async => CheckinState.fromJson(_checkinJson());

  @override
  Future<CheckinState> claim() async {
    final next = CheckinState.fromJson(_checkinJson(checked: true));
    state = AsyncData(next);
    return next;
  }

  @override
  Future<void> refresh() async {}
}

void main() {
  test('parses check-in rewards, streak and monthly records', () {
    final state = CheckinState.fromJson(_checkinJson(checked: true));

    expect(state.campaignTitle, '连续签到领创作积分');
    expect(state.todayChecked, isTrue);
    expect(state.currentStreak, 3);
    expect(state.activeCycleDay, 3);
    expect(state.rewards, hasLength(7));
    expect(state.rewards.last.milestone, isTrue);
    expect(state.monthRecords, hasLength(2));
    expect(state.monthRewardPoints, 35);
    expect(state.todayRecord?.rewardPoints, 20);
  });

  test('normalizes an incomplete check-in response', () {
    final state = CheckinState.fromJson({
      'campaignTitle': ' ',
      'rewards': ['invalid'],
      'monthRecords': [
        {'date': ''},
      ],
    });

    expect(state.enabled, isTrue);
    expect(state.campaignTitle, '连续签到领创作积分');
    expect(state.rewards, isEmpty);
    expect(state.monthRecords, isEmpty);
    expect(state.activeCycleDay, 1);
  });

  testWidgets('claim action updates the visible state without reloading', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          checkinControllerProvider.overrideWith(_FakeCheckinController.new),
        ],
        child: const MaterialApp(home: CheckinScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('立即签到'), findsOneWidget);
    await tester.tap(find.text('立即签到'));
    await tester.pumpAndSettle();

    expect(find.text('今日已签到'), findsWidgets);
    expect(find.text('签到成功，获得 20 积分'), findsOneWidget);
    expect(find.text('明日继续签到可领 25 积分'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('check-in screen fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          checkinControllerProvider.overrideWith(_FakeCheckinController.new),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const CheckinScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('连续签到领创作积分'), findsOneWidget);
    expect(find.text('立即签到'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.scrollUntilVisible(
      find.text('2026 年 8 月'),
      320,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('本月已签到 1 天'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
