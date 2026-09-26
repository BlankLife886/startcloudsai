import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/providers.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/auth/login_screen.dart';

class _FakeSessionController extends SessionController {
  int requestCount = 0;
  int signInCount = 0;
  String? requestedEmail;
  String? developmentCode = '246810';
  Completer<void>? signInGate;
  Object? signInError;

  @override
  Future<SessionState> build() async => const SessionState();

  @override
  Future<CodeDelivery> requestCode(String email) async {
    requestCount += 1;
    requestedEmail = email;
    return CodeDelivery(
      expiresIn: 180,
      resendAfter: 60,
      developmentCode: developmentCode,
    );
  }

  @override
  Future<void> signIn(String email, String code) async {
    signInCount += 1;
    await signInGate?.future;
    if (signInError case final error?) throw error;
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
  Brightness brightness = Brightness.light,
  bool production = false,
  EdgeInsets viewInsets = EdgeInsets.zero,
  EdgeInsets padding = EdgeInsets.zero,
  bool reduceMotion = false,
  bool highContrast = false,
  DateTime Function()? now,
}) {
  assert(providers != null || providerLoader != null);
  return ProviderScope(
    overrides: [
      appEnvironmentProvider.overrideWithValue(
        AppEnvironment.create(
          name: production
              ? AppEnvironmentName.production
              : AppEnvironmentName.development,
          baseUrl: production
              ? 'https://starcloudisai.com'
              : 'http://localhost:8000',
        ),
      ),
      authProvidersProvider.overrideWith(
        (ref) => providerLoader?.call() ?? Future.value(providers!),
      ),
      if (sessionController != null)
        sessionControllerProvider.overrideWith(sessionController),
    ],
    child: MaterialApp(
      theme: brightness == Brightness.dark
          ? StarCloudsTheme.dark()
          : StarCloudsTheme.light(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
          viewInsets: viewInsets,
          padding: padding,
          disableAnimations: reduceMotion,
          highContrast: highContrast,
        ),
        child: child!,
      ),
      home: LoginScreen(now: now),
    ),
  );
}

Future<void> _tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
}

void main() {
  testWidgets(
    'inline verification controls remain stable during countdown and completion',
    (tester) async {
      addTearDown(() => tester.binding.setSurfaceSize(null));
      for (final width in [320.0, 402.0]) {
        await tester.binding.setSurfaceSize(Size(width, 874));
        final controller = _FakeSessionController()..developmentCode = null;
        await tester.pumpWidget(
          _app(
            providers: _available,
            sessionController: () => controller,
            production: true,
            textScale: width == 320 ? 1.6 : 1,
          ),
        );
        await tester.pumpAndSettle();
        final code = find.byKey(const Key('login-code-field'));
        final send = find.byKey(const Key('send-login-code'));
        final codeWidth = tester.getSize(code).width;
        final buttonSize = tester.getSize(send);
        final input = tester.widget<TextField>(
          find.descendant(of: code, matching: find.byType(TextField)),
        );
        if (width == 320) expect(input.decoration!.prefixIcon, isNull);
        await tester.enterText(
          find.byKey(const Key('login-email-field')),
          'qa@example.com',
        );
        await _tapVisible(tester, send);
        await tester.pumpAndSettle();
        expect(controller.requestCount, 1);
        expect(find.text(width == 320 ? '60s' : '60s 后重试'), findsOneWidget);
        expect(tester.widget<TextButton>(send).onPressed, isNull);
        await tester.enterText(code, '246810');
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('login-code-complete')), findsOneWidget);
        expect(tester.getSize(code).width, codeWidth);
        expect(tester.getSize(send), buttonSize);
        expect(tester.getRect(code).contains(tester.getCenter(send)), isTrue);
        expect(find.descendant(of: code, matching: send), findsOneWidget);
        expect(find.byKey(const Key('login-code-divider')), findsOneWidget);
        expect(
          tester.widget<TextButton>(send).style!.backgroundColor!.resolve({}),
          Colors.transparent,
        );
        expect(
          tester.widget<TextButton>(send).style!.side!.resolve({}),
          BorderSide.none,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      }
    },
  );

  testWidgets(
    'reference layout keeps the heading outside a single rounded form panel',
    (tester) async {
      addTearDown(() => tester.binding.setSurfaceSize(null));
      for (final brightness in Brightness.values) {
        for (final width in [320.0, 402.0, 840.0]) {
          await tester.binding.setSurfaceSize(Size(width, 874));
          await tester.pumpWidget(
            _app(
              providers: const AuthProviders(
                email: true,
                verificationCode: true,
                emailDomains: ['gmail.com', 'googlemail.com', 'qq.com'],
              ),
              production: true,
              brightness: brightness,
              textScale: width == 320 ? 1.6 : 1,
              padding: const EdgeInsets.only(top: 59, bottom: 34),
            ),
          );
          await tester.pumpAndSettle();
          final panelFinder = find.byKey(const Key('login-form-panel'));
          final panel = tester.getRect(panelFinder);
          final header = tester.getRect(find.byKey(const Key('login-header')));
          final brand = tester.getRect(
            find.byKey(const Key('login-brand-mark')),
          );
          final heading = tester.getRect(find.byKey(const Key('login-title')));
          final email = tester.getRect(
            find.byKey(const Key('login-email-field')),
          );
          final code = tester.getRect(
            find.byKey(const Key('login-code-field')),
          );
          final send = tester.getRect(find.byKey(const Key('send-login-code')));
          final submit = tester.getRect(find.byKey(const Key('login-submit')));
          expect(panel.width, lessThanOrEqualTo(440));
          expect(panel.left, header.left);
          expect(brand.left, header.left);
          expect(brand.size, const Size(52, 52));
          expect(heading.left, brand.right + 16);
          expect(panel.top, closeTo(header.bottom + 28, .01));
          expect(email.left, panel.left + 20);
          expect(code.left, email.left);
          expect(code.right, email.right);
          expect(send.left, greaterThan(code.left));
          expect(send.right, lessThanOrEqualTo(code.right));
          expect(send.top, greaterThanOrEqualTo(code.top));
          expect(send.bottom, lessThanOrEqualTo(code.bottom));
          expect(submit.left, email.left);
          expect(submit.top, greaterThan(send.bottom));
          final decoration =
              tester.widget<DecoratedBox>(panelFinder).decoration
                  as BoxDecoration;
          expect(decoration.borderRadius, BorderRadius.circular(28));
          expect(decoration.gradient, isNull);
          expect(
            decoration.color,
            brightness == Brightness.dark
                ? const Color(0xFF1B2028)
                : Colors.white,
          );
          expect(decoration.border!.top.color.r, 1);
          expect(decoration.border!.top.color.g, 1);
          expect(decoration.border!.top.color.b, 1);
          final input = tester.widget<TextField>(
            find.descendant(
              of: find.byKey(const Key('login-email-field')),
              matching: find.byType(TextField),
            ),
          );
          expect(
            (input.decoration!.enabledBorder! as OutlineInputBorder)
                .borderRadius,
            BorderRadius.circular(28),
          );
          expect(find.text('星空云绘'), findsOneWidget);
          expect(find.text('账号登录'), findsOneWidget);
          expect(find.bySemanticsLabel('星空云绘标识'), findsOneWidget);
          expect(find.text('登录星空云绘'), findsNothing);
          expect(find.textContaining('验证即登录'), findsNothing);
          expect(find.text('验证码登录'), findsOneWidget);
          expect(find.text('本地开发环境'), findsNothing);
          expect(find.byType(BackdropFilter), findsNothing);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        }
      }
    },
  );

  testWidgets(
    'keyboard and large text leave fields and legal consent reachable',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 760));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final controller = _FakeSessionController();
      await tester.pumpWidget(
        _app(
          providers: _available,
          sessionController: () => controller,
          production: true,
          textScale: 1.6,
          padding: const EdgeInsets.only(top: 59, bottom: 34),
          viewInsets: const EdgeInsets.only(bottom: 300),
        ),
      );
      await tester.pumpAndSettle();
      final email = find.byKey(const Key('login-email-field'));
      final code = find.byKey(const Key('login-code-field'));
      final submit = find.byKey(const Key('login-submit'));
      await tester.enterText(email, 'qa@example.com');
      await tester.enterText(code, '246810');
      await _tapVisible(tester, find.byKey(const Key('login-legal-checkbox')));
      await tester.ensureVisible(submit);
      await tester.pumpAndSettle();
      expect(tester.getBottomRight(submit).dy, lessThanOrEqualTo(460));
      expect(
        tester.widget<TextFormField>(email).controller!.text,
        'qa@example.com',
      );
      expect(tester.widget<TextFormField>(code).controller!.text, '246810');
      expect(tester.widget<FilledButton>(submit).onPressed, isNotNull);
      expect(controller.signInCount, 0);
      expect(controller.requestCount, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'pending service keeps the new form visible and actions disabled',
    (tester) async {
      final gate = Completer<AuthProviders>();
      await tester.pumpWidget(
        _app(production: true, providerLoader: () => gate.future),
      );
      await tester.pump();
      expect(find.byKey(const Key('login-form-panel')), findsOneWidget);
      expect(find.byKey(const Key('login-email-field')), findsOneWidget);
      expect(
        tester
            .widget<TextButton>(find.byKey(const Key('send-login-code')))
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('login-submit')))
            .onPressed,
        isNull,
      );
      gate.complete(_available);
      await tester.pumpAndSettle();
      expect(find.text('验证码登录'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'high contrast and reduced motion preserve the form without decorative effects',
    (tester) async {
      await tester.pumpWidget(
        _app(
          providers: _available,
          production: true,
          brightness: Brightness.dark,
          highContrast: true,
          reduceMotion: true,
        ),
      );
      await tester.pumpAndSettle();
      final decoration =
          tester
                  .widget<DecoratedBox>(
                    find.byKey(const Key('login-form-panel')),
                  )
                  .decoration
              as BoxDecoration;
      expect(decoration.color!.a, 1);
      expect(decoration.boxShadow, isNull);
      await tester.enterText(
        find.byKey(const Key('login-code-field')),
        '246810',
      );
      await tester.pump();
      final switcher = tester.widget<AnimatedSwitcher>(
        find.descendant(
          of: find.byKey(const Key('login-code-field')),
          matching: find.byType(AnimatedSwitcher),
        ),
      );
      expect(switcher.duration, Duration.zero);
      expect(tester.takeException(), isNull);
    },
  );

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

  test('resend deadline rounds up and expires against wall-clock time', () {
    final now = DateTime(2026, 8, 27, 10);

    expect(codeResendSecondsRemaining(null, now), 0);
    expect(
      codeResendSecondsRemaining(
        now.add(const Duration(milliseconds: 1001)),
        now,
      ),
      2,
    );
    expect(codeResendSecondsRemaining(now, now), 0);
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

    expect(find.text('验证码登录'), findsOneWidget);
    expect(find.text('支持 example.com'), findsOneWidget);
    final status = tester.widget<DecoratedBox>(
      find.byKey(const Key('login-form-panel')),
    );
    expect(
      (status.decoration as BoxDecoration).borderRadius,
      BorderRadius.circular(28),
    );
    await tester.enterText(find.byType(TextFormField).first, 'qa@gmail.com');
    await _tapVisible(tester, find.text('获取验证码'));
    await tester.pump();
    expect(find.text('仅支持 example.com'), findsOneWidget);
    expect(controller.requestCount, 0);

    await tester.enterText(find.byType(TextFormField).first, 'qa@example.com');
    await _tapVisible(tester, find.text('获取验证码'));
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

  testWidgets('login fields support autofill, keyboard flow, and safe paste', (
    tester,
  ) async {
    final controller = _FakeSessionController()..developmentCode = null;
    await tester.pumpWidget(
      _app(providers: _available, sessionController: () => controller),
    );
    await tester.pump();
    await tester.pump();

    final emailFinder = find.byKey(const Key('login-email-field'));
    final codeFinder = find.byKey(const Key('login-code-field'));
    final emailField = tester.widget<TextField>(
      find.descendant(of: emailFinder, matching: find.byType(TextField)),
    );
    final codeField = tester.widget<TextField>(
      find.descendant(of: codeFinder, matching: find.byType(TextField)),
    );

    expect(find.byType(AutofillGroup), findsOneWidget);
    expect(emailField.autofillHints, contains(AutofillHints.email));
    expect(emailField.keyboardType, TextInputType.emailAddress);
    expect(emailField.textInputAction, TextInputAction.next);
    expect(codeField.autofillHints, contains(AutofillHints.oneTimeCode));
    expect(codeField.textInputAction, TextInputAction.done);

    await tester.enterText(emailFinder, ' qa@example.com ');
    await _tapVisible(tester, find.text('获取验证码'));
    await tester.pump();

    expect(controller.requestedEmail, 'qa@example.com');
    expect(codeField.focusNode?.hasFocus, isTrue);

    await tester.enterText(codeFinder, '12a34 567');
    await tester.pump();
    expect(codeField.controller?.text, '123456');
    expect(find.byKey(const Key('login-code-complete')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('resend countdown corrects itself after app resume', (
    tester,
  ) async {
    final controller = _FakeSessionController();
    var now = DateTime(2026, 8, 27, 10);
    await tester.pumpWidget(
      _app(
        providers: _available,
        sessionController: () => controller,
        now: () => now,
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).first, 'qa@example.com');
    await _tapVisible(tester, find.text('获取验证码'));
    await tester.pump();
    expect(find.text('60s 后重试'), findsOneWidget);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    now = now.add(const Duration(seconds: 61));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();

    expect(find.text('获取验证码'), findsOneWidget);
    expect(tester.takeException(), isNull);
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
          .widget<TextButton>(find.byKey(const Key('send-login-code')))
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

  testWidgets('legal consent gates login and keyboard submit explains why', (
    tester,
  ) async {
    final controller = _FakeSessionController();
    await tester.pumpWidget(
      _app(providers: _available, sessionController: () => controller),
    );
    await tester.pump();
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).first, 'qa@example.com');
    await tester.enterText(find.byType(TextFormField).last, '246810');
    final codeField = tester.widget<TextField>(find.byType(TextField).last);
    codeField.onSubmitted?.call('246810');
    await tester.pump();

    expect(find.text('请先阅读并同意用户协议和隐私政策'), findsOneWidget);
    expect(controller.signInCount, 0);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, '登录'))
          .onPressed,
      isNull,
    );

    await _tapVisible(tester, find.byKey(const Key('login-legal-checkbox')));
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, '登录'))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('login submission is locked and recovers after failure', (
    tester,
  ) async {
    final gate = Completer<void>();
    final controller = _FakeSessionController()
      ..signInGate = gate
      ..signInError = StateError('failed');
    await tester.pumpWidget(
      _app(providers: _available, sessionController: () => controller),
    );
    await tester.pump();
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).first, 'qa@example.com');
    await tester.enterText(find.byType(TextFormField).last, '246810');
    await _tapVisible(tester, find.byKey(const Key('login-legal-checkbox')));
    await tester.pump();
    final codeField = tester.widget<TextField>(find.byType(TextField).last);
    codeField.onSubmitted?.call('246810');
    codeField.onSubmitted?.call('246810');
    await tester.pump();

    expect(controller.signInCount, 1);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(
      tester
          .widget<TextButton>(find.byKey(const Key('send-login-code')))
          .onPressed,
      isNull,
    );

    gate.complete();
    await tester.pump();
    await tester.pump();

    expect(find.text('请求失败，请稍后重试'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, '登录'))
          .onPressed,
      isNotNull,
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
    await _tapVisible(tester, find.byTooltip('重新检查'));
    await tester.pump();
    await tester.pump();

    expect(attempts, 2);
    expect(find.text('验证码登录'), findsOneWidget);
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
    expect(find.text('验证码登录'), findsOneWidget);
    expect(find.text('支持 example.com'), findsOneWidget);
    expect(find.byKey(const Key('login-terms')), findsOneWidget);
    expect(find.byKey(const Key('login-privacy-policy')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('legal consent remains usable in dark mode with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(providers: _available, textScale: 1.6, brightness: Brightness.dark),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('我已阅读并同意'), findsOneWidget);
    expect(find.byKey(const Key('login-legal-checkbox')), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('login-legal-checkbox')));
    await tester.pumpAndSettle();
    await _tapVisible(tester, find.byKey(const Key('login-legal-checkbox')));
    await tester.pump();
    expect(
      tester
          .widget<Checkbox>(find.byKey(const Key('login-legal-checkbox')))
          .value,
      isTrue,
    );
    expect(tester.takeException(), isNull);
  });
}
