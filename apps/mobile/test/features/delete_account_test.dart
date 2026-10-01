import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/profile/delete_account_screen.dart';

const _user = AppUser(
  id: 'user-delete',
  email: 'creator@qq.com',
  username: '待注销用户',
);

class _DeleteSessionController extends SessionController {
  String? requestedEmail;
  String? deletedWithCode;

  @override
  FutureOr<SessionState> build() => const SessionState(user: _user);

  @override
  Future<CodeDelivery> requestCode(String email) async {
    requestedEmail = email;
    return const CodeDelivery(
      expiresIn: 180,
      resendAfter: 60,
      developmentCode: '123456',
    );
  }

  @override
  Future<void> deleteAccount(String code) async {
    deletedWithCode = code;
    state = const AsyncData(SessionState());
  }
}

Widget _screen({
  required _DeleteSessionController controller,
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) => ProviderScope(
  overrides: [sessionControllerProvider.overrideWith(() => controller)],
  child: MaterialApp(
    theme: ThemeData(brightness: brightness, useMaterial3: true),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: AppNoticeHost(child: child!),
    ),
    home: const DeleteAccountScreen(),
  ),
);

void main() {
  testWidgets('delete account page fits narrow dark mode with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _screen(
        controller: _DeleteSessionController(),
        brightness: Brightness.dark,
        textScale: 1.6,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('注销账号'), findsOneWidget);
    expect(find.text('永久关闭当前账号'), findsOneWidget);
    expect(find.text('登录与资料'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const Key('delete-account-send-code')),
      280,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.byKey(const Key('delete-account-code')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('verification code is sent to the signed-in email', (
    tester,
  ) async {
    final controller = _DeleteSessionController();
    await tester.pumpWidget(_screen(controller: controller));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byKey(const Key('delete-account-send-code')),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('delete-account-send-code')));
    await tester.pump();

    expect(controller.requestedEmail, 'creator@qq.com');
    expect(find.text('开发验证码：123456'), findsOneWidget);
    expect(find.text('60s 后可重新发送'), findsOneWidget);
    expect(find.text('验证码已发送'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('permanent deletion requires acknowledgement and final confirm', (
    tester,
  ) async {
    final controller = _DeleteSessionController();
    final router = GoRouter(
      initialLocation: '/profile/security/delete',
      routes: [
        GoRoute(
          path: '/profile/security/delete',
          builder: (context, state) => const DeleteAccountScreen(),
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
        overrides: [sessionControllerProvider.overrideWith(() => controller)],
        child: MaterialApp.router(
          routerConfig: router,
          builder: (context, child) => AppNoticeHost(child: child!),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byKey(const Key('delete-account-code')),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.enterText(
      find.byKey(const Key('delete-account-code')),
      '123456',
    );
    await tester.ensureVisible(
      find.byKey(const Key('delete-account-acknowledge')),
    );
    await tester.tap(find.byKey(const Key('delete-account-acknowledge')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('delete-account-submit')));
    await tester.tap(find.byKey(const Key('delete-account-submit')));
    await tester.pumpAndSettle();

    expect(find.text('永久注销账号？'), findsOneWidget);
    expect(controller.deletedWithCode, isNull);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(controller.deletedWithCode, isNull);

    await tester.tap(find.byKey(const Key('delete-account-submit')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('确认永久注销'));
    await tester.pumpAndSettle();

    expect(controller.deletedWithCode, '123456');
    expect(router.state.uri.path, '/discover');
    expect(find.text('首页目标页'), findsOneWidget);
    expect(find.text('账号已注销'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
