import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/network/api_exception.dart';
import 'package:starcloudsai_mobile/features/benefits/benefits.dart';
import 'package:starcloudsai_mobile/features/profile/profile.dart';
import 'package:starcloudsai_mobile/features/wallet/wallet.dart';
import 'package:starcloudsai_mobile/features/wallet/wallet_ledger_screen.dart';
import 'package:starcloudsai_mobile/features/wallet/wallet_screen.dart';

Map<String, dynamic> _entry({
  required String id,
  required String kind,
  required int delta,
  required String source,
  required String createdAt,
  String reason = '',
  String creditBucket = 'normal',
  int balance = 100,
  Map<String, dynamic>? task,
}) {
  final value = <String, dynamic>{
    'id': id,
    'kind': kind,
    'deltaCents': delta,
    'balanceAfterCents': balance,
    'sourceType': source,
    'reason': reason,
    'creditBucket': creditBucket,
    'createdAt': createdAt,
  };
  if (task != null) value['task'] = task;
  return value;
}

final _entries = [
  _entry(
    id: 'income-1',
    kind: 'grant',
    delta: 100,
    source: 'signup_bonus',
    reason: '新用户注册赠送',
    creditBucket: 'trial',
    createdAt: '2026-08-24T08:00:00Z',
  ),
  _entry(
    id: 'freeze-1',
    kind: 'task_freeze',
    delta: -12,
    source: 'task',
    reason: '任务提交预扣',
    createdAt: '2026-08-24T07:55:00Z',
    task: {
      'id': 'task-1',
      'displayName': '一张夏日海报',
      'status': 'running',
      'modelName': '快速模型',
      'count': 1,
      'costPoints': 12,
      'settledCostPoints': 0,
    },
  ),
  _entry(
    id: 'spend-1',
    kind: 'task_settle',
    delta: 0,
    source: 'task',
    reason: '任务结算：消耗冻结 12 分',
    createdAt: '2026-08-23T07:56:00Z',
    task: {
      'id': 'task-1',
      'displayName': '一张夏日海报',
      'status': 'succeeded',
      'modelName': '快速模型',
      'count': 1,
      'costPoints': 12,
      'settledCostPoints': 12,
    },
  ),
  _entry(
    id: 'refund-1',
    kind: 'task_release',
    delta: 8,
    source: 'task',
    reason: '任务失败解冻',
    createdAt: '2026-08-22T07:56:00Z',
    task: {
      'id': 'task-2',
      'displayName': '未完成的创作任务',
      'status': 'failed',
      'modelName': '快速模型',
      'count': 1,
      'costPoints': 8,
      'settledCostPoints': 0,
    },
  ),
];

WalletCenterState _walletState() => WalletCenterState(
  items: _entries.map(WalletLedgerEntry.fromJson).toList(),
  nextCursor: null,
  total: 4,
  summary: const WalletSummary(
    incomePoints: 100,
    consumedPoints: 12,
    refundPoints: 8,
    entryCount: 4,
    incomeCount: 1,
    consumedCount: 1,
    refundCount: 1,
  ),
);

class _IdleBenefitsController extends BenefitsController {
  @override
  Future<BenefitsState> build() async => BenefitsState(
    campaign: null,
    application: null,
    growth: GrowthOverview.fromJson(const {}),
  );
}

class _FakeWalletController extends WalletCenterController {
  @override
  Future<WalletCenterState> build() async => _walletState();

  @override
  Future<void> refresh() async {}

  @override
  Future<void> loadMore() async {}

  @override
  Future<WalletRedemption> redeem(String code) async {
    return const WalletRedemption(grantPoints: 50);
  }
}

class _FakeWalletBillExporter extends WalletBillExporter {
  _FakeWalletBillExporter(this.onExport)
    : super(download: () async => const []);

  final Future<File> Function() onExport;

  @override
  Future<File> export() => onExport();
}

void main() {
  test(
    'parses wallet entries and preserves zero-delta task settlement cost',
    () {
      final page = WalletLedgerPage.fromJson({
        'items': _entries,
        'nextCursor': 'next-page',
        'total': 4,
      });

      expect(page.items, hasLength(4));
      expect(page.nextCursor, 'next-page');
      expect(page.total, 4);
      expect(page.items[0].title, '注册赠送');
      expect(page.items[0].category, WalletEntryCategory.income);
      expect(page.items[1].category, WalletEntryCategory.pending);
      expect(page.items[2].category, WalletEntryCategory.spend);
      expect(page.items[2].displayPoints, 12);
      expect(page.items[3].category, WalletEntryCategory.refund);
    },
  );

  test('parses wallet summary and validates redemption codes', () {
    final summary = WalletSummary.fromJson({
      'incomeCents': 320,
      'consumedCents': 80,
      'refundCents': 12,
      'entryCount': 9,
      'incomeCount': 2,
      'consumedCount': 4,
      'refundCount': 1,
      'items': [
        {
          'id': 'daily_checkin',
          'label': '签到积分',
          'hint': '每日签到到账，连续签到奖励更高',
          'cents': 40,
          'count': 3,
        },
        {'id': 'trial_access', 'label': '体验积分', 'cents': 20, 'count': 1},
      ],
    });

    expect(summary.incomePoints, 320);
    expect(summary.consumedPoints, 80);
    expect(summary.refundPoints, 12);
    expect(summary.entryCount, 9);
    expect(summary.incomeCount, 2);
    expect(summary.consumedCount, 4);
    expect(summary.refundCount, 1);
    expect(summary.items.single.label, '签到积分');
    expect(summary.items.single.route, '/profile/checkin');
    expect(validateRedemptionCode('  '), '请输入兑换码');
    expect(validateRedemptionCode(List.filled(33, 'A').join()), isNotNull);
    expect(validateRedemptionCode('SC-ABCD-EFGH-JK23'), isNull);
  });

  test(
    'wallet bill exporter writes complete bytes with stable filename',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'starclouds-wallet-test-',
      );
      addTearDown(() => directory.delete(recursive: true));
      final exporter = WalletBillExporter(
        download: () async => const [0xEF, 0xBB, 0xBF, 0x61, 0x2C, 0x62],
        temporaryDirectory: () async => directory,
        now: () => DateTime(2026, 8, 24, 9, 5, 7),
      );

      final file = await exporter.export();

      expect(
        file.uri.pathSegments.last,
        'starclouds-wallet-20260824-090507.csv',
      );
      expect(await file.readAsBytes(), [0xEF, 0xBB, 0xBF, 0x61, 0x2C, 0x62]);
    },
  );

  test('wallet bill exporter rejects an empty response', () async {
    final exporter = WalletBillExporter(
      download: () async => const [],
      temporaryDirectory: () async => Directory.systemTemp,
    );

    await expectLater(exporter.export(), throwsA(isA<FormatException>()));
  });

  test('groups wallet entries into local calendar days', () {
    final items = walletTimeline(
      _entries.map(WalletLedgerEntry.fromJson).toList(),
    );

    expect(items.where((item) => item.label != null), hasLength(3));
    expect(items.where((item) => item.entry != null), hasLength(4));
  });

  test('wallet entry filters distinguish normal and trial balances', () {
    final entries = _entries.map(WalletLedgerEntry.fromJson).toList();

    expect(walletEntryFilterFromName('trial'), WalletEntryFilter.trial);
    expect(walletEntryFilterFromName('unknown'), WalletEntryFilter.all);
    expect(entries.where(WalletEntryFilter.trial.includes), hasLength(1));
    expect(entries.where(WalletEntryFilter.normal.includes), hasLength(3));
  });

  testWidgets('wallet screen fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          walletProvider.overrideWith(
            (ref) async => WalletSnapshot.fromJson({
              'availableCents': 100,
              'frozenCents': 12,
              'trialBalanceCents': 20,
            }),
          ),
          walletCenterControllerProvider.overrideWith(
            _FakeWalletController.new,
          ),
          benefitsControllerProvider.overrideWith(_IdleBenefitsController.new),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const WalletScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('可用余额'), findsOneWidget);
    expect(find.text('账户总额'), findsOneWidget);
    expect(find.text('冻结中'), findsOneWidget);
    expect(find.text('普通积分'), findsOneWidget);
    expect(find.text('体验积分'), findsOneWidget);
    expect(find.text('账单汇总'), findsOneWidget);
    expect(find.text('入账'), findsOneWidget);
    expect(find.text('消耗'), findsOneWidget);
    expect(find.text('退回'), findsOneWidget);
    expect(find.text('兑换积分'), findsOneWidget);
    expect(find.text('积分明细'), findsOneWidget);
    expect(find.text('购买套餐'), findsOneWidget);
    expect(find.text('共 4 笔'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('redemption sheet validates and maps server errors inline', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => FilledButton(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (context) => RedeemCodeSheet(
                  onSubmit: (code) => throw const ApiException(
                    statusCode: 404,
                    code: 'code_invalid',
                    message: '兑换码不存在',
                  ),
                ),
              ),
              child: const Text('打开兑换'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('打开兑换'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('立即兑换'));
    await tester.pump();
    expect(find.text('请输入兑换码'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'SC-INVALID-CODE');
    await tester.tap(find.text('立即兑换'));
    await tester.pumpAndSettle();

    expect(find.text('兑换码不存在，请检查后重试'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('successful redemption closes the sheet and confirms credit', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          walletProvider.overrideWith(
            (ref) async => WalletSnapshot.fromJson({
              'availableCents': 100,
              'frozenCents': 0,
              'trialBalanceCents': 0,
            }),
          ),
          walletCenterControllerProvider.overrideWith(
            _FakeWalletController.new,
          ),
          benefitsControllerProvider.overrideWith(_IdleBenefitsController.new),
        ],
        child: const MaterialApp(home: WalletScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('兑换积分'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'SC-ABCD-EFGH-JK23');
    await tester.tap(find.text('立即兑换'));
    await tester.pumpAndSettle();

    expect(find.byType(RedeemCodeSheet), findsNothing);
    expect(find.text('兑换成功，50 积分已入账'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('wallet deep link automatically opens redemption', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          walletProvider.overrideWith(
            (ref) async => WalletSnapshot.fromJson({
              'availableCents': 100,
              'frozenCents': 0,
              'trialBalanceCents': 0,
            }),
          ),
          walletCenterControllerProvider.overrideWith(
            _FakeWalletController.new,
          ),
          benefitsControllerProvider.overrideWith(_IdleBenefitsController.new),
        ],
        child: const MaterialApp(home: WalletScreen(initiallyOpenRedeem: true)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(RedeemCodeSheet), findsOneWidget);
    expect(find.text('立即兑换'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('ledger screen lists billed entries and export', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          walletProvider.overrideWith(
            (ref) async => WalletSnapshot.fromJson({
              'availableCents': 100,
              'frozenCents': 12,
              'trialBalanceCents': 20,
            }),
          ),
          walletCenterControllerProvider.overrideWith(
            _FakeWalletController.new,
          ),
        ],
        child: const MaterialApp(home: WalletLedgerScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('积分明细'), findsWidgets);
    expect(find.text('共 4 笔'), findsOneWidget);
    expect(find.text('导出账单'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('wallet composition opens the matching ledger filter', (
    tester,
  ) async {
    WalletEntryFilter? opened;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: WalletCompositionGrid(
            wallet: AsyncData(
              WalletSnapshot.fromJson({
                'availableCents': 100,
                'frozenCents': 12,
                'trialBalanceCents': 20,
              }),
            ),
            onOpenLedger: (filter) => opened = filter,
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('wallet-composition-trial')));
    expect(opened, WalletEntryFilter.trial);
  });

  testWidgets('flat wallet balance supports dark mode', (tester) async {
    final snapshot = AsyncData(
      WalletSnapshot.fromJson({
        'availableCents': 100,
        'frozenCents': 12,
        'trialBalanceCents': 20,
      }),
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(),
        darkTheme: ThemeData.dark(),
        themeMode: ThemeMode.dark,
        home: Scaffold(
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              WalletBalancePanel(
                wallet: snapshot,
                onRedeem: () {},
                onLedger: () {},
                onPurchase: () {},
              ),
              const SizedBox(height: 12),
              WalletCompositionGrid(wallet: snapshot, onOpenLedger: (_) {}),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      Theme.of(tester.element(find.text('可用余额'))).brightness,
      Brightness.dark,
    );
    expect(find.text('普通积分'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('ledger restores a deep-linked initial filter', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          walletProvider.overrideWith(
            (ref) async => WalletSnapshot.fromJson({'availableCents': 100}),
          ),
          walletCenterControllerProvider.overrideWith(
            _FakeWalletController.new,
          ),
        ],
        child: const MaterialApp(
          home: WalletLedgerScreen(initialFilter: WalletEntryFilter.trial),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('注册赠送'), findsOneWidget);
    expect(find.text('一张夏日海报'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'wallet export prevents duplicates and shares the generated CSV',
    (tester) async {
      final directory = Directory.systemTemp.createTempSync(
        'starclouds-wallet-share-',
      );
      addTearDown(() {
        if (directory.existsSync()) directory.deleteSync(recursive: true);
      });
      final exportedFile = File(
        '${directory.path}/starclouds-wallet-20260824-103000.csv',
      )..writeAsBytesSync(const [0xEF, 0xBB, 0xBF, 0x61]);
      final export = Completer<File>();
      var exportCount = 0;
      var shareCount = 0;
      String? sharedFilename;
      final exporter = _FakeWalletBillExporter(() {
        exportCount += 1;
        return export.future;
      });
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            walletProvider.overrideWith(
              (ref) async => WalletSnapshot.fromJson({
                'availableCents': 100,
                'frozenCents': 0,
                'trialBalanceCents': 0,
              }),
            ),
            walletCenterControllerProvider.overrideWith(
              _FakeWalletController.new,
            ),
            walletBillExporterProvider.overrideWithValue(exporter),
            walletBillShareHandlerProvider.overrideWithValue((file, origin) {
              shareCount += 1;
              expect(file.existsSync(), isTrue);
              sharedFilename = file.uri.pathSegments.last;
              return Future.value();
            }),
          ],
          child: const MaterialApp(home: WalletLedgerScreen()),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('wallet-export')));
      await tester.pump();
      expect(find.text('正在导出'), findsOneWidget);
      await tester.tap(find.byKey(const Key('wallet-export')));
      expect(exportCount, 1);

      export.complete(exportedFile);
      await tester.pumpAndSettle();

      expect(shareCount, 1);
      expect(sharedFilename, 'starclouds-wallet-20260824-103000.csv');
      expect(find.text('导出账单'), findsOneWidget);
      expect(File('${directory.path}/$sharedFilename').existsSync(), isFalse);
    },
  );

  testWidgets('wallet export failure is visible and recovers the action', (
    tester,
  ) async {
    final exporter = _FakeWalletBillExporter(
      () => throw const ApiException(
        code: 'network_error',
        message: '账单导出失败，请检查网络后重试',
      ),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          walletProvider.overrideWith(
            (ref) async => WalletSnapshot.fromJson({
              'availableCents': 100,
              'frozenCents': 0,
              'trialBalanceCents': 0,
            }),
          ),
          walletCenterControllerProvider.overrideWith(
            _FakeWalletController.new,
          ),
          walletBillExporterProvider.overrideWithValue(exporter),
        ],
        child: const MaterialApp(home: WalletLedgerScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('wallet-export')));
    await tester.pumpAndSettle();

    expect(find.text('账单导出失败，请检查网络后重试'), findsOneWidget);
    expect(find.text('导出账单'), findsOneWidget);
  });

  testWidgets('ledger card keeps long amounts inside a narrow layout', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
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
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: WalletLedgerCard(
              entry: WalletLedgerEntry.fromJson(
                _entry(
                  id: 'large-amount',
                  kind: 'grant',
                  delta: 999999999,
                  source: 'redeem_code',
                  reason: '一笔金额很大且说明文字较长的兑换码入账记录',
                  createdAt: '2026-08-24T08:00:00Z',
                  balance: 999999999,
                ),
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text('+999999999'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
