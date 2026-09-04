import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/network/api_exception.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';
import 'package:starcloudsai_mobile/features/profile/account_sessions.dart';
import 'package:starcloudsai_mobile/features/profile/account_sessions_screen.dart';

class _FakeSessionsRepository implements AccountSessionsRepository {
  _FakeSessionsRepository(this.sessions);

  List<AccountSession> sessions;
  int listCalls = 0;
  String? revokedId;
  bool revokedOthers = false;
  bool failListing = false;
  Object? listError;

  @override
  Future<List<AccountSession>> list() async {
    listCalls++;
    if (listError case final error?) throw error;
    if (failListing) throw Exception('not available');
    return sortAccountSessions(sessions);
  }

  @override
  Future<void> revoke(String id) async {
    revokedId = id;
    sessions = sessions.where((session) => session.id != id).toList();
  }

  @override
  Future<int> revokeOthers() async {
    revokedOthers = true;
    final count = sessions.where((session) => !session.current).length;
    sessions = sessions.where((session) => session.current).toList();
    return count;
  }
}

AccountSession _session({
  required String id,
  required bool current,
  required String userAgent,
  String ip = '192.168.10.21',
  DateTime? createdAt,
}) => AccountSession(
  id: id,
  current: current,
  ip: ip,
  userAgent: userAgent,
  createdAt: createdAt ?? DateTime.utc(2026, 9, 1, 12),
  expiresAt: DateTime.utc(2026, 10, 1),
);

Widget _screen(
  _FakeSessionsRepository repository, {
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) => ProviderScope(
  overrides: [accountSessionsRepositoryProvider.overrideWithValue(repository)],
  child: MaterialApp(
    theme: ThemeData(brightness: brightness, useMaterial3: true),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: AppNoticeHost(child: child!),
    ),
    home: const AccountSessionsScreen(),
  ),
);

void main() {
  test(
    'identifies devices, clients, masks addresses, and sorts current first',
    () {
      expect(
        accountSessionDevice('Mozilla/5.0 (iPhone; CPU iPhone OS)'),
        'iPhone',
      );
      expect(
        accountSessionDevice('Mozilla/5.0 (Linux; Android 15)'),
        'Android',
      );
      expect(accountSessionClient('starcloudsai/1.0 (iPhone)'), '星空云绘 App');
      expect(
        accountSessionClient('Mozilla/5.0 Chrome/120 Safari/537'),
        'Chrome',
      );
      expect(maskSessionIp('192.168.10.21'), '192.168.*.*');
      expect(maskSessionIp('2001:db8::8a2e:370:7334'), '2001:****:7334');
      expect(maskSessionIp(''), '网络地址未知');

      final sorted = sortAccountSessions([
        _session(
          id: 'old',
          current: false,
          userAgent: 'Windows Chrome/120',
          createdAt: DateTime.utc(2026, 8, 1),
        ),
        _session(
          id: 'new',
          current: false,
          userAgent: 'Macintosh Safari/18',
          createdAt: DateTime.utc(2026, 9, 1),
        ),
        _session(
          id: 'current',
          current: true,
          userAgent: 'starcloudsai iPhone',
          createdAt: DateTime.utc(2026, 7, 1),
        ),
      ]);
      expect(sorted.map((item) => item.id), ['current', 'new', 'old']);
    },
  );

  testWidgets(
    'device list stays usable on a narrow dark screen and refreshes',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 700));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repository = _FakeSessionsRepository([
        _session(
          id: 'other',
          current: false,
          userAgent: 'Mozilla/5.0 (Windows) Chrome/120',
        ),
        _session(
          id: 'current',
          current: true,
          userAgent: 'starcloudsai/1.0 (iPhone)',
        ),
      ]);
      await tester.pumpWidget(
        _screen(repository, brightness: Brightness.dark, textScale: 1.35),
      );
      await tester.pumpAndSettle();

      expect(find.text('登录设备'), findsOneWidget);
      expect(find.text('2 台设备保持登录'), findsOneWidget);
      expect(find.text('当前会话受保护'), findsOneWidget);
      expect(find.text('本机'), findsOneWidget);
      expect(find.textContaining('192.168.*.*'), findsNWidgets(2));
      expect(find.byKey(const Key('sessions-revoke-others')), findsOneWidget);
      expect(find.byKey(const Key('session-revoke-current')), findsNothing);

      await tester.tap(find.byTooltip('刷新设备'));
      await tester.pumpAndSettle();
      expect(repository.listCalls, 2);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'single device exit requires confirmation and refreshes the list',
    (tester) async {
      final repository = _FakeSessionsRepository([
        _session(
          id: 'current',
          current: true,
          userAgent: 'starcloudsai iPhone',
        ),
        _session(id: 'other', current: false, userAgent: 'Macintosh Safari/18'),
      ]);
      await tester.pumpWidget(_screen(repository));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('session-revoke-other')));
      await tester.pumpAndSettle();
      expect(find.text('退出这台设备？'), findsOneWidget);
      expect(repository.revokedId, isNull);

      await tester.tap(find.text('确认退出'));
      await tester.pumpAndSettle();
      expect(repository.revokedId, 'other');
      expect(find.byKey(const Key('session-other')), findsNothing);
      expect(find.text('设备已退出'), findsOneWidget);
    },
  );

  testWidgets('other devices can be exited together after confirmation', (
    tester,
  ) async {
    final repository = _FakeSessionsRepository([
      _session(id: 'current', current: true, userAgent: 'starcloudsai Android'),
      _session(id: 'other-1', current: false, userAgent: 'Windows Chrome/120'),
      _session(id: 'other-2', current: false, userAgent: 'Linux Firefox/120'),
    ]);
    await tester.pumpWidget(_screen(repository));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('sessions-revoke-others')));
    await tester.pumpAndSettle();
    expect(find.text('2 台其他设备将立即退出，当前设备保持登录。'), findsOneWidget);

    await tester.tap(find.text('确认退出'));
    await tester.pumpAndSettle();
    expect(repository.revokedOthers, isTrue);
    expect(find.byKey(const Key('sessions-revoke-others')), findsNothing);
    expect(find.text('已退出 2 台设备'), findsOneWidget);
  });

  testWidgets('load failure stays actionable and can recover in place', (
    tester,
  ) async {
    final repository = _FakeSessionsRepository([
      _session(id: 'current', current: true, userAgent: 'starcloudsai iPhone'),
    ])..failListing = true;
    await tester.pumpWidget(_screen(repository));
    await tester.pumpAndSettle();

    expect(find.text('暂时无法读取登录设备'), findsOneWidget);
    expect(find.text('请稍后重试，其他账号安全功能不受影响'), findsOneWidget);

    repository.failListing = false;
    await tester.tap(find.byKey(const Key('sessions-retry')));
    await tester.pumpAndSettle();
    expect(find.text('1 台设备保持登录'), findsOneWidget);
    expect(repository.listCalls, 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets('missing endpoint renders a stable upgrade state', (
    tester,
  ) async {
    final repository = _FakeSessionsRepository([])
      ..listError = const ApiException(
        statusCode: 404,
        code: 'not_found',
        message: 'Not Found',
      );
    await tester.pumpWidget(_screen(repository));
    await tester.pumpAndSettle();

    expect(find.text('登录设备服务升级中'), findsOneWidget);
    expect(find.byKey(const Key('sessions-retry')), findsNothing);
    expect(find.byTooltip('刷新设备'), findsNothing);
    expect(repository.listCalls, 1);
    expect(tester.takeException(), isNull);
  });
}
