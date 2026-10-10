import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/core/network/api_exception.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';
import 'package:starcloudsai_mobile/features/profile/blocked_users.dart';
import 'package:starcloudsai_mobile/features/profile/blocked_users_screen.dart';

class _FakeBlockedUsersRepository implements BlockedUsersRepository {
  _FakeBlockedUsersRepository(this.items);

  List<BlockedUser> items;
  int listCalls = 0;
  String? unblockedId;
  bool failListing = false;
  Object? listError;

  @override
  Future<List<BlockedUser>> listAll() async {
    listCalls++;
    if (listError case final error?) throw error;
    if (failListing) throw Exception('unavailable');
    return List.of(items);
  }

  @override
  Future<void> unblock(String id) async {
    unblockedId = id;
    items = items.where((item) => item.id != id).toList();
  }
}

Widget _screen(
  _FakeBlockedUsersRepository repository, {
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) => ProviderScope(
  overrides: [blockedUsersRepositoryProvider.overrideWithValue(repository)],
  child: MaterialApp(
    theme: StarCloudsTheme.light(),
    darkTheme: StarCloudsTheme.dark(),
    themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: AppNoticeHost(child: child!),
    ),
    home: const BlockedUsersScreen(),
  ),
);

void main() {
  test('blocked user parsing preserves safe fallbacks', () {
    final parsed = BlockedUser.fromJson({
      'id': 'user-1',
      'username': ' 创作者 ',
      'avatarUrl': '/api/v1/files/avatar.png',
      'blockedAt': '2026-09-02T03:00:00Z',
    });
    expect(parsed.id, 'user-1');
    expect(parsed.displayName, '创作者');
    expect(parsed.avatarUrl, '/api/v1/files/avatar.png');
    expect(parsed.blockedAt, DateTime.utc(2026, 9, 2, 3));
    expect(BlockedUser.fromJson(const {}).displayName, '星空用户');
  });

  testWidgets('blocked users fit a narrow dark screen and refresh', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final repository = _FakeBlockedUsersRepository([
      BlockedUser(
        id: 'user-1',
        username: '名称很长的社区创作者账号',
        blockedAt: DateTime.utc(2026, 9, 2),
      ),
      const BlockedUser(id: 'user-2', username: '另一位作者'),
    ]);
    await tester.pumpWidget(
      _screen(repository, brightness: Brightness.dark, textScale: 1.5),
    );
    await tester.pumpAndSettle();

    expect(find.text('已屏蔽用户'), findsOneWidget);
    expect(find.text('已屏蔽 2 位用户'), findsOneWidget);
    expect(find.text('屏蔽只影响你看到的社区内容'), findsOneWidget);
    expect(find.text('2026-09-02 屏蔽'), findsOneWidget);
    expect(find.byTooltip('解除屏蔽'), findsNWidgets(2));

    await tester.tap(find.byTooltip('刷新列表'));
    await tester.pumpAndSettle();
    expect(repository.listCalls, 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unblock stays behind confirmation and updates the list', (
    tester,
  ) async {
    final repository = _FakeBlockedUsersRepository([
      BlockedUser(
        id: 'user-1',
        username: '社区作者',
        blockedAt: DateTime.utc(2026, 9, 2),
      ),
    ]);
    await tester.pumpWidget(_screen(repository));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('unblock-user-user-1')));
    await tester.pumpAndSettle();
    expect(find.text('解除屏蔽 社区作者？'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(repository.unblockedId, isNull);

    await tester.tap(find.byKey(const Key('unblock-user-user-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认解除'));
    await tester.pumpAndSettle();
    expect(repository.unblockedId, 'user-1');
    expect(find.byKey(const Key('blocked-user-user-1')), findsNothing);
    expect(find.text('没有已屏蔽用户'), findsOneWidget);
    expect(find.text('已解除屏蔽'), findsOneWidget);
  });

  testWidgets('load error retries and recovers to the empty state', (
    tester,
  ) async {
    final repository = _FakeBlockedUsersRepository([])..failListing = true;
    await tester.pumpWidget(_screen(repository));
    await tester.pumpAndSettle();
    expect(find.text('暂时无法读取屏蔽列表'), findsOneWidget);

    repository.failListing = false;
    await tester.tap(find.byKey(const Key('blocked-users-retry')));
    await tester.pumpAndSettle();
    expect(repository.listCalls, 2);
    expect(find.text('被屏蔽的作者会显示在这里'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('missing endpoint renders a stable upgrade state', (
    tester,
  ) async {
    final repository = _FakeBlockedUsersRepository([])
      ..listError = const ApiException(
        statusCode: 404,
        code: 'not_found',
        message: 'Not Found',
      );
    await tester.pumpWidget(_screen(repository));
    await tester.pumpAndSettle();

    expect(find.text('屏蔽管理服务升级中'), findsOneWidget);
    expect(find.byKey(const Key('blocked-users-retry')), findsNothing);
    expect(find.byTooltip('刷新列表'), findsNothing);
    expect(repository.listCalls, 1);
    expect(tester.takeException(), isNull);
  });
}
