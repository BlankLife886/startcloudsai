import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/core/storage/app_image_cache.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/profile/account_security_screen.dart';

const _user = AppUser(
  id: 'user-1',
  email: 'creator@example.com',
  username: '星空创作者',
);

class _SecuritySessionController extends SessionController {
  bool signOutCalled = false;

  @override
  FutureOr<SessionState> build() => const SessionState(user: _user);

  @override
  Future<void> signOut() async {
    signOutCalled = true;
    state = const AsyncData(SessionState());
  }
}

class _FakeImageCacheService extends AppImageCacheService {
  _FakeImageCacheService(this.value);

  AppImageCacheSnapshot value;
  bool clearCalled = false;

  @override
  AppImageCacheSnapshot snapshot() => value;

  @override
  AppImageCacheSnapshot clear() {
    clearCalled = true;
    return value = const AppImageCacheSnapshot(
      bytes: 0,
      entries: 0,
      liveEntries: 0,
    );
  }
}

Widget _screen({
  required _SecuritySessionController controller,
  required AppImageCacheService cache,
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) => ProviderScope(
  overrides: [
    sessionControllerProvider.overrideWith(() => controller),
    appImageCacheServiceProvider.overrideWithValue(cache),
  ],
  child: MaterialApp(
    theme: ThemeData(brightness: brightness, useMaterial3: true),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: AppNoticeHost(child: child!),
    ),
    home: const AccountSecurityScreen(),
  ),
);

void main() {
  test('formats cache sizes without overstating empty or small caches', () {
    expect(formatCacheSize(0), '0 KB');
    expect(formatCacheSize(512), '0.5 KB');
    expect(formatCacheSize(12 * 1024), '12 KB');
    expect(formatCacheSize(1536 * 1024), '1.5 MB');
    expect(formatCacheSize(12 * 1024 * 1024), '12 MB');
    expect(
      cachedImageCount(
        const AppImageCacheSnapshot(bytes: 1024, entries: 5, liveEntries: 3),
      ),
      5,
    );
  });

  testWidgets('account security remains usable on a narrow dark screen', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _screen(
        controller: _SecuritySessionController(),
        cache: _FakeImageCacheService(
          const AppImageCacheSnapshot(
            bytes: 1536 * 1024,
            entries: 5,
            liveEntries: 1,
          ),
        ),
        brightness: Brightness.dark,
        textScale: 1.6,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('账号与安全'), findsOneWidget);
    expect(find.text('账号已安全登录'), findsOneWidget);
    expect(find.text('creator@example.com'), findsWidgets);
    expect(find.text('会话保护'), findsOneWidget);
    expect(find.text('凭证与本地草稿按账号安全隔离'), findsOneWidget);
    expect(find.byKey(const Key('security-login-sessions')), findsOneWidget);
    expect(find.byKey(const Key('security-blocked-users')), findsOneWidget);
    expect(find.byKey(const Key('security-data-export')), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const Key('security-local-storage')),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('本地存储'), findsOneWidget);
    expect(find.text('管理图片缓存和未发送草稿'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const Key('security-delete-account')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('注销账号'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('sign out stays behind confirmation and returns home', (
    tester,
  ) async {
    final controller = _SecuritySessionController();
    final router = GoRouter(
      initialLocation: '/profile/security',
      routes: [
        GoRoute(
          path: '/profile/security',
          builder: (context, state) => const AccountSecurityScreen(),
        ),
        GoRoute(
          path: '/discover',
          builder: (context, state) => const Scaffold(body: Text('首页目标页')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionControllerProvider.overrideWith(() => controller),
          appImageCacheServiceProvider.overrideWithValue(
            _FakeImageCacheService(
              const AppImageCacheSnapshot(bytes: 0, entries: 0, liveEntries: 0),
            ),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byKey(const Key('security-sign-out')),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('security-sign-out')));
    await tester.pumpAndSettle();
    expect(find.text('退出当前账号？'), findsOneWidget);
    expect(controller.signOutCalled, isFalse);

    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(controller.signOutCalled, isFalse);

    await tester.tap(find.byKey(const Key('security-sign-out')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认退出'));
    await tester.pumpAndSettle();

    expect(controller.signOutCalled, isTrue);
    expect(router.state.uri.path, '/discover');
    expect(find.text('首页目标页'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
