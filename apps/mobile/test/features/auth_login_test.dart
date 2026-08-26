import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/providers.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/auth/login_screen.dart';

class _FakeSessionController extends SessionController {
  int requestCount = 0;
  String? requestedEmail;

  @override
  Future<SessionState> build() async => const SessionState();

  @override
  Future<CodeDelivery> requestCode(String email) async {
    requestCount += 1;
    requestedEmail = email;
    return const CodeDelivery(
      expiresIn: 180,
      resendAfter: 60,
      developmentCode: '246810',
    );
  }
}

const _available = AuthProviders(
  email: true,
  verificationCode: true,
  emailDomains: ['example.com'],
);

Widget _app({
  AuthProviders? providers,
  Future<AuthProviders> Function()? providerLoader,
  _FakeSessionController Function()? sessionController,
  double textScale = 1,
}) {
  assert(providers != null || providerLoader != null);
  return ProviderScope(
    overrides: [
      appEnvironmentProvider.overrideWithValue(
        AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'http://localhost:8000',
        ),
      ),
      authProvidersProvider.overrideWith(
        (ref) => providerLoader?.call() ?? Future.value(providers!),
      ),
      if (sessionController != null)
        sessionControllerProvider.overrideWith(sessionController),
    ],
    child: MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: const LoginScreen(),
    ),
  );
}

void main() {
  test('parses login providers and rejects malformed availability', () {
    final providers = AuthProviders.fromJson({
      'email': true,
      'verificationCode': true,
      'emailDomains': [' Gmail.com ', 'gmail.com', 'QQ.COM', ''],
    });
    final malformed = AuthProviders.fromJson({'email': true});

    expect(providers.canUseEmailCode, isTrue);
    expect(providers.emailDomains, ['gmail.com', 'qq.com']);
    expect(formatLoginEmailDomains(providers.emailDomains), 'Gmail、QQ 邮箱');
    expect(malformed.canUseEmailCode, isFalse);
    expect(AuthProviders.fromJson(null).canUseEmailCode, isFalse);
  });

  test('validates email against server-provided domains', () {
    expect(validateLoginEmail('', _available), '请输入有效邮箱');
    expect(validateLoginEmail('qa@gmail.com', _available), '仅支持 example.com');
    expect(validateLoginEmail(' QA@EXAMPLE.COM ', _available), isNull);
  });

  testWidgets('available provider drives validation and code delivery', (
    tester,
  ) async {
    final controller = _FakeSessionController();
    await tester.pumpWidget(
      _app(providers: _available, sessionController: () => controller),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('邮箱验证码登录'), findsOneWidget);
    expect(find.text('支持 example.com'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).first, 'qa@gmail.com');
    await tester.tap(find.text('获取验证码'));
    await tester.pump();
    expect(find.text('仅支持 example.com'), findsOneWidget);
    expect(controller.requestCount, 0);

    await tester.enterText(find.byType(TextFormField).first, 'qa@example.com');
    await tester.tap(find.text('获取验证码'));
    await tester.pump();
    expect(controller.requestCount, 1);
    expect(controller.requestedEmail, 'qa@example.com');
    expect(find.text('开发环境验证码已自动填入'), findsOneWidget);
    expect(
      (tester.widget<TextFormField>(find.byType(TextFormField).last).controller)
          ?.text,
      '246810',
    );

    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('unavailable provider disables authentication actions', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        providers: const AuthProviders(
          email: false,
          verificationCode: true,
          emailDomains: ['gmail.com'],
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('邮箱登录暂不可用'), findsOneWidget);
    expect(find.text('当前环境未配置验证码发送服务'), findsOneWidget);
    expect(
      tester
          .widget<OutlinedButton>(find.widgetWithText(OutlinedButton, '获取验证码'))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, '登录'))
          .onPressed,
      isNull,
    );
  });

  testWidgets('provider status failure can retry successfully', (tester) async {
    var attempts = 0;
    await tester.pumpWidget(
      _app(
        providerLoader: () async {
          attempts += 1;
          if (attempts == 1) throw StateError('temporary failure');
          return _available;
        },
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('登录服务状态获取失败'), findsOneWidget);
    await tester.tap(find.byTooltip('重新检查'));
    await tester.pump();
    await tester.pump();

    expect(attempts, 2);
    expect(find.text('邮箱验证码登录'), findsOneWidget);
  });

  testWidgets('login service panel fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_app(providers: _available, textScale: 1.6));
    await tester.pump();
    await tester.pump();

    expect(find.text('本地账号登录'), findsOneWidget);
    expect(find.text('邮箱验证码登录'), findsOneWidget);
    expect(find.text('支持 example.com'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
