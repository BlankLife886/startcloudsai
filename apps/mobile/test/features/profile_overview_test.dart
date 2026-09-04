import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/profile/profile.dart';
import 'package:starcloudsai_mobile/features/profile/profile_screen.dart';

ProfileOverview _overview() => ProfileOverview(
  wallet: const WalletSnapshot(
    availablePoints: 180,
    frozenPoints: 12,
    trialPoints: 30,
  ),
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
  recentTasks: [
    ProfileRecentTask(
      id: 'task-1',
      prompt: '夏日海边产品海报',
      status: 'running',
      previewUrl: '',
      createdAt: DateTime(2026, 8, 24, 10),
    ),
    ProfileRecentTask(
      id: 'task-2',
      prompt: '复古风格人物插画',
      status: 'succeeded',
      previewUrl: '',
      createdAt: DateTime(2026, 8, 24, 9),
    ),
  ],
);

void main() {
  test('parses profile overview, recent tasks and safe defaults', () {
    final overview = ProfileOverview.fromJson({
      'wallet': {
        'availableCents': 180,
        'frozenCents': 12,
        'trialBalanceCents': 30,
      },
      'taskStats': {'total': 18, 'succeeded': 14, 'running': 2, 'failed': 1},
      'submissionStats': {'total': 3, 'pending': 1, 'approved': 2},
      'assetCount': 7,
      'assetUngrouped': 2,
      'unreadNotifications': 4,
      'recentTasks': [
        {
          'id': 'task-1',
          'status': 'succeeded',
          'prompt': '接口提示词',
          'params': {'userPrompt': '用户提示词'},
          'thumbnailUrls': ['/thumb.jpg'],
          'displayUrls': ['/display.jpg'],
          'createdAt': '2026-08-24T02:00:00Z',
        },
        {'id': '', 'status': 'failed'},
        'invalid',
      ],
    });

    expect(overview.wallet.availablePoints, 180);
    expect(overview.taskStats.total, 18);
    expect(overview.taskStats.running, 2);
    expect(overview.submissionStats.pending, 1);
    expect(overview.assetCount, 7);
    expect(overview.assetUngrouped, 2);
    expect(overview.unreadNotifications, 4);
    expect(overview.recentTasks, hasLength(1));
    expect(overview.recentTasks.first.prompt, '用户提示词');
    expect(overview.recentTasks.first.previewUrl, '/thumb.jpg');

    final empty = ProfileOverview.fromJson('invalid');
    expect(empty.taskStats.total, 0);
    expect(empty.recentTasks, isEmpty);
    expect(empty.wallet.availablePoints, 0);
  });

  test('wallet snapshot keeps normal, trial and total balances', () {
    final snapshot = WalletSnapshot.fromJson({
      'availableCents': 180,
      'frozenCents': 12,
      'totalCents': 192,
      'normalBalanceCents': 150,
      'trialBalanceCents': 30,
      'normalFrozenCents': 8,
      'trialFrozenCents': 4,
    });
    expect(snapshot.availablePoints, 180);
    expect(snapshot.normalPoints, 150);
    expect(snapshot.trialPoints, 30);
    expect(snapshot.totalPoints, 192);
    expect(snapshot.normalFrozenPoints, 8);
    expect(snapshot.trialFrozenPoints, 4);
  });

  testWidgets('creation overview opens works and recent task', (tester) async {
    var worksOpened = false;
    String? openedTask;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProfileCreationOverviewCard(
            overview: _overview(),
            onOpenWorks: () => worksOpened = true,
            onOpenTask: (id) => openedTask = id,
          ),
        ),
      ),
    );

    expect(find.text('2 个任务正在生成'), findsOneWidget);
    expect(find.text('18'), findsOneWidget);
    expect(find.text('14'), findsOneWidget);
    final overviewSemantics = tester
        .getSemantics(find.bySemanticsLabel('创作概览，2 个任务正在生成'))
        .getSemanticsData();
    expect(overviewSemantics.flagsCollection.isButton, isTrue);
    expect(overviewSemantics.flagsCollection.isEnabled, Tristate.isTrue);
    final taskSemantics = tester
        .getSemantics(find.bySemanticsLabel('夏日海边产品海报，生成中'))
        .getSemanticsData();
    expect(taskSemantics.flagsCollection.isButton, isTrue);
    expect(taskSemantics.flagsCollection.isEnabled, Tristate.isTrue);
    await tester.tap(find.text('创作概览'));
    expect(worksOpened, isTrue);

    await tester.tap(find.text('夏日海边产品海报'));
    expect(openedTask, 'task-1');
  });

  testWidgets('creation overview fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: ProfileCreationOverviewCard(
              overview: _overview(),
              onOpenWorks: () {},
              onOpenTask: (_) {},
            ),
          ),
        ),
      ),
    );

    expect(find.text('创作概览'), findsOneWidget);
    expect(find.text('夏日海边产品海报'), findsOneWidget);
    expect(find.text('复古风格人物插画'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
