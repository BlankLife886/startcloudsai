import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/config/app_environment.dart';
import '../../core/network/api_exception.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../../core/providers.dart';
import 'auth.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({this.now, super.key});

  final DateTime Function()? now;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen>
    with WidgetsBindingObserver {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _codeController = TextEditingController();
  final _emailFocusNode = FocusNode();
  final _codeFocusNode = FocusNode();
  Timer? _timer;
  DateTime? _resendDeadline;
  int _resendSeconds = 0;
  bool _sendingCode = false;
  bool _signingIn = false;
  bool _acceptedLegal = false;
  String? _developmentCode;

  DateTime get _now => (widget.now ?? DateTime.now)();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _emailFocusNode.dispose();
    _codeFocusNode.dispose();
    _emailController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _syncResendCountdown();
  }

  void _startResendCountdown(int seconds) {
    _timer?.cancel();
    final duration = seconds.clamp(0, 3600);
    _resendDeadline = duration == 0
        ? null
        : _now.add(Duration(seconds: duration));
    _syncResendCountdown();
    if (_resendDeadline != null) {
      _timer = Timer.periodic(
        const Duration(seconds: 1),
        (_) => _syncResendCountdown(),
      );
    }
  }

  void _syncResendCountdown() {
    if (!mounted) return;
    final remaining = codeResendSecondsRemaining(_resendDeadline, _now);
    if (remaining != _resendSeconds) {
      setState(() => _resendSeconds = remaining);
    }
    if (remaining == 0) {
      _resendDeadline = null;
      _timer?.cancel();
      _timer = null;
    }
  }

  void _showError(Object error) {
    if (!mounted) return;
    final message = error is ApiException ? error.message : '请求失败，请稍后重试';
    AppNotice.error(context, message);
  }

  AuthProviders? get _providers =>
      ref.read(authProvidersProvider).asData?.value;

  bool _ensureEmailLoginAvailable() {
    final providers = _providers;
    if (providers?.canUseEmailCode == true) return true;
    AppNotice.warning(
      context,
      providers == null ? '正在检查登录服务，请稍后重试' : '邮箱验证码服务暂不可用',
    );
    return false;
  }

  Future<void> _requestCode() async {
    if (_sendingCode || _signingIn) return;
    if (!_ensureEmailLoginAvailable()) return;
    if (_resendSeconds > 0 ||
        validateLoginEmail(_emailController.text, _providers!) != null) {
      _formKey.currentState?.validate();
      return;
    }
    setState(() => _sendingCode = true);
    try {
      final delivery = await ref
          .read(sessionControllerProvider.notifier)
          .requestCode(_emailController.text.trim());
      if (!mounted) return;
      setState(() {
        _developmentCode = delivery.developmentCode;
        if (delivery.developmentCode != null) {
          _codeController.text = delivery.developmentCode!;
        }
      });
      _startResendCountdown(delivery.resendAfter);
      if (delivery.developmentCode == null) _codeFocusNode.requestFocus();
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _sendingCode = false);
    }
  }

  Future<void> _submit() async {
    if (_signingIn || _sendingCode) return;
    if (!_ensureEmailLoginAvailable()) return;
    if (!_formKey.currentState!.validate()) return;
    if (!_acceptedLegal) {
      AppNotice.warning(context, '请先阅读并同意用户协议和隐私政策');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() => _signingIn = true);
    try {
      await ref
          .read(sessionControllerProvider.notifier)
          .signIn(_emailController.text.trim(), _codeController.text.trim());
      if (!mounted) return;
      TextInput.finishAutofillContext(shouldSave: true);
      if (context.canPop()) {
        context.pop(true);
      } else {
        context.go('/discover');
      }
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _signingIn = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final environment = ref.watch(appEnvironmentProvider);
    final providers = ref.watch(authProvidersProvider);
    final emailProviders = providers.asData?.value;
    final canUseEmailCode = emailProviders?.canUseEmailCode == true;
    final isDevelopment = environment.name == AppEnvironmentName.development;
    final colors = Theme.of(context).colorScheme;
    final dark = colors.brightness == Brightness.dark;
    final background = dark ? colors.surface : const Color(0xFFF7F8FA);
    final primary = dark ? Colors.white : const Color(0xFF24262B);
    final onPrimary = dark ? const Color(0xFF24262B) : Colors.white;
    return Scaffold(
      key: const Key('login-screen'),
      backgroundColor: background,
      appBar: AppTopBar(
        title: const SizedBox.shrink(),
        fallbackLocation: '/discover',
        backgroundColor: background,
      ),
      body: SafeArea(
        top: false,
        child: Align(
          alignment: Alignment.topCenter,
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.fromLTRB(24, 16, 24, 28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AppAppear(child: _LoginHeader(isDevelopment: isDevelopment)),
                  const SizedBox(height: 28),
                  if (isDevelopment) ...[
                    _DevelopmentEnvironmentNotice(environment: environment),
                    const SizedBox(height: 16),
                  ],
                  _LoginFormSurface(
                    child: AutofillGroup(
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _AuthProviderStatus(
                              providers: providers,
                              onRetry: () =>
                                  ref.invalidate(authProvidersProvider),
                            ),
                            const SizedBox(height: 18),
                            TextFormField(
                              key: const Key('login-email-field'),
                              controller: _emailController,
                              focusNode: _emailFocusNode,
                              keyboardType: TextInputType.emailAddress,
                              autofillHints: const [AutofillHints.email],
                              autocorrect: false,
                              enableSuggestions: false,
                              textInputAction: TextInputAction.next,
                              onFieldSubmitted: (_) =>
                                  _codeFocusNode.requestFocus(),
                              validator: (value) => emailProviders == null
                                  ? null
                                  : validateLoginEmail(value, emailProviders),
                              decoration: _loginInputDecoration(
                                context,
                                hint: '邮箱',
                                icon: Icons.mail_outline_rounded,
                              ),
                            ),
                            const SizedBox(height: 14),
                            LayoutBuilder(
                              builder: (context, constraints) {
                                final compact =
                                    constraints.maxWidth < 280 ||
                                    MediaQuery.textScalerOf(context).scale(1) >
                                        1.3;
                                final sendLabel = _sendingCode
                                    ? '发送中'
                                    : _resendSeconds > 0
                                    ? '${_resendSeconds}s 后重试'
                                    : '获取验证码';
                                return TextFormField(
                                  key: const Key('login-code-field'),
                                  controller: _codeController,
                                  focusNode: _codeFocusNode,
                                  keyboardType: TextInputType.number,
                                  autofillHints: const [
                                    AutofillHints.oneTimeCode,
                                  ],
                                  inputFormatters: [
                                    FilteringTextInputFormatter.digitsOnly,
                                    LengthLimitingTextInputFormatter(6),
                                  ],
                                  maxLength: 6,
                                  textInputAction: TextInputAction.done,
                                  onChanged: (_) => setState(() {}),
                                  onFieldSubmitted: (_) => _submit(),
                                  validator: (value) =>
                                      RegExp(
                                        r'^\d{6}$',
                                      ).hasMatch(value?.trim() ?? '')
                                      ? null
                                      : '请输入六位验证码',
                                  decoration:
                                      _loginInputDecoration(
                                        context,
                                        hint: '验证码',
                                        icon: compact
                                            ? null
                                            : Icons.password_rounded,
                                      ).copyWith(
                                        counterText: '',
                                        contentPadding:
                                            const EdgeInsets.symmetric(
                                              horizontal: 12,
                                              vertical: 19,
                                            ),
                                        suffixIconConstraints: BoxConstraints(
                                          minWidth: compact ? 121 : 157,
                                          maxWidth: compact ? 121 : 157,
                                          minHeight: 56,
                                        ),
                                        suffixIcon: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            SizedBox(
                                              width: 24,
                                              child: Center(
                                                child: AnimatedSwitcher(
                                                  duration:
                                                      MediaQuery.disableAnimationsOf(
                                                        context,
                                                      )
                                                      ? Duration.zero
                                                      : AppMotion.selection,
                                                  child:
                                                      _codeController
                                                              .text
                                                              .length ==
                                                          6
                                                      ? Icon(
                                                          Icons.check_circle,
                                                          key: const Key(
                                                            'login-code-complete',
                                                          ),
                                                          size: 18,
                                                          color: Theme.of(
                                                            context,
                                                          ).colorScheme.primary,
                                                        )
                                                      : const SizedBox(
                                                          width: 24,
                                                        ),
                                                ),
                                              ),
                                            ),
                                            SizedBox(
                                              key: const Key(
                                                'login-code-divider',
                                              ),
                                              width: 1,
                                              height: 24,
                                              child: ColoredBox(
                                                color: colors.onSurface
                                                    .withValues(alpha: .14),
                                              ),
                                            ),
                                            SizedBox(
                                              width: compact ? 92 : 128,
                                              child: Tooltip(
                                                message: sendLabel,
                                                child: TextButton.icon(
                                                  key: const Key(
                                                    'send-login-code',
                                                  ),
                                                  style: TextButton.styleFrom(
                                                    minimumSize: const Size(
                                                      0,
                                                      56,
                                                    ),
                                                    padding:
                                                        const EdgeInsets.symmetric(
                                                          horizontal: 10,
                                                          vertical: 16,
                                                        ),
                                                    backgroundColor:
                                                        Colors.transparent,
                                                    foregroundColor:
                                                        colors.onSurface,
                                                    side: BorderSide.none,
                                                    shape: const RoundedRectangleBorder(
                                                      borderRadius:
                                                          BorderRadius.horizontal(
                                                            right:
                                                                Radius.circular(
                                                                  28,
                                                                ),
                                                          ),
                                                    ),
                                                  ),
                                                  onPressed:
                                                      _sendingCode ||
                                                          _signingIn ||
                                                          _resendSeconds > 0 ||
                                                          !canUseEmailCode
                                                      ? null
                                                      : _requestCode,
                                                  icon:
                                                      compact ||
                                                          _resendSeconds > 0
                                                      ? null
                                                      : _sendingCode
                                                      ? const SizedBox.square(
                                                          dimension: 16,
                                                          child:
                                                              CircularProgressIndicator(
                                                                strokeWidth: 2,
                                                              ),
                                                        )
                                                      : const Icon(
                                                          Icons.send_outlined,
                                                          size: 18,
                                                        ),
                                                  label: Text(
                                                    compact && !_sendingCode
                                                        ? (_resendSeconds > 0
                                                              ? '${_resendSeconds}s'
                                                              : '获取')
                                                        : sendLabel,
                                                  ),
                                                ),
                                              ),
                                            ),
                                            const SizedBox(width: 4),
                                          ],
                                        ),
                                      ),
                                );
                              },
                            ),
                            if (_developmentCode != null) ...[
                              const SizedBox(height: 10),
                              Text(
                                '开发环境验证码已自动填入',
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.tertiary,
                                ),
                              ),
                            ],
                            const SizedBox(height: 24),
                            FilledButton(
                              key: const Key('login-submit'),
                              onPressed:
                                  _signingIn ||
                                      _sendingCode ||
                                      !canUseEmailCode ||
                                      !_acceptedLegal
                                  ? null
                                  : _submit,
                              style: FilledButton.styleFrom(
                                minimumSize: const Size.fromHeight(56),
                                backgroundColor: primary,
                                foregroundColor: onPrimary,
                                disabledBackgroundColor: dark
                                    ? const Color(0xFF343A43)
                                    : const Color(0xFF484C53),
                                disabledForegroundColor: dark
                                    ? const Color(0xFFBFC5CF)
                                    : const Color(0xFFD9DDE3),
                                side: BorderSide(
                                  color: Colors.white.withValues(alpha: .4),
                                ),
                                shape: const StadiumBorder(),
                              ),
                              child: _signingIn
                                  ? const SizedBox.square(
                                      dimension: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Text('登录'),
                            ),
                            const SizedBox(height: 14),
                            _LegalConsent(
                              accepted: _acceptedLegal,
                              onChanged: (value) {
                                setState(() => _acceptedLegal = value);
                              },
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

InputDecoration _loginInputDecoration(
  BuildContext context, {
  required String hint,
  required IconData? icon,
}) {
  final colors = Theme.of(context).colorScheme;
  final highContrast = MediaQuery.highContrastOf(context);
  final edge = Colors.white.withValues(
    alpha: colors.brightness == Brightness.dark ? .14 : .95,
  );
  const radius = BorderRadius.all(Radius.circular(28));
  return InputDecoration(
    hintText: hint,
    prefixIcon: icon == null ? null : Icon(icon, size: 21),
    prefixIconConstraints: const BoxConstraints(minWidth: 54, minHeight: 56),
    filled: true,
    fillColor: colors.surfaceContainerLow,
    contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 19),
    border: const OutlineInputBorder(borderRadius: radius),
    enabledBorder: OutlineInputBorder(
      borderRadius: radius,
      borderSide: BorderSide(color: highContrast ? colors.outline : edge),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: radius,
      borderSide: BorderSide(color: colors.primary, width: 1.5),
    ),
    errorBorder: OutlineInputBorder(
      borderRadius: radius,
      borderSide: BorderSide(color: colors.error),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderRadius: radius,
      borderSide: BorderSide(color: colors.error, width: 1.5),
    ),
    errorMaxLines: 3,
  );
}

class _LoginFormSurface extends StatelessWidget {
  const _LoginFormSurface({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dark = colors.brightness == Brightness.dark;
    final highContrast = MediaQuery.highContrastOf(context);
    return DecoratedBox(
      key: const Key('login-form-panel'),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(
          color: highContrast
              ? colors.outline
              : Colors.white.withValues(alpha: dark ? .16 : 1),
        ),
        boxShadow: highContrast
            ? null
            : [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? .18 : .055),
                  blurRadius: 22,
                  offset: const Offset(0, 8),
                  spreadRadius: -4,
                ),
              ],
      ),
      child: Padding(padding: const EdgeInsets.all(20), child: child),
    );
  }
}

class _LegalConsent extends StatelessWidget {
  const _LegalConsent({required this.accepted, required this.onChanged});

  final bool accepted;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final style = TextButton.styleFrom(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      minimumSize: const Size(44, 36),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
      foregroundColor: Theme.of(context).colorScheme.onSurface,
      textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
    );
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Row(
      key: const Key('login-legal-consent'),
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Checkbox(
          key: const Key('login-legal-checkbox'),
          value: accepted,
          onChanged: (value) => onChanged(value ?? false),
          visualDensity: VisualDensity.compact,
          materialTapTargetSize: MaterialTapTargetSize.padded,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
        ),
        const SizedBox(width: 2),
        Expanded(
          child: Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 1,
            children: [
              Text(
                '我已阅读并同意',
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: muted, fontSize: 12),
              ),
              TextButton(
                key: const Key('login-terms'),
                style: style,
                onPressed: () => context.push('/legal/terms'),
                child: const Text('用户协议'),
              ),
              TextButton(
                key: const Key('login-privacy-policy'),
                style: style,
                onPressed: () => context.push('/legal/privacy'),
                child: const Text('隐私政策'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AuthProviderStatus extends StatelessWidget {
  const _AuthProviderStatus({required this.providers, required this.onRetry});

  final AsyncValue<AuthProviders> providers;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return providers.when(
      loading: () => const _AuthStatusPanel(
        icon: Icons.sync,
        title: '正在检查登录服务',
        detail: '确认当前环境可用的邮箱验证方式',
        loading: true,
      ),
      error: (error, stackTrace) => _AuthStatusPanel(
        icon: Icons.cloud_off_outlined,
        title: '登录服务状态获取失败',
        detail: '请检查网络连接后重试',
        error: true,
        onRetry: onRetry,
      ),
      data: (value) => value.canUseEmailCode
          ? _AuthStatusPanel(
              icon: Icons.verified_user_outlined,
              title: '验证码登录',
              detail: '支持 ${formatLoginEmailDomains(value.emailDomains)}',
            )
          : _AuthStatusPanel(
              icon: Icons.mark_email_unread_outlined,
              title: '邮箱登录暂不可用',
              detail: '当前环境未配置验证码发送服务',
              error: true,
              onRetry: onRetry,
            ),
    );
  }
}

class _AuthStatusPanel extends StatelessWidget {
  const _AuthStatusPanel({
    required this.icon,
    required this.title,
    required this.detail,
    this.loading = false,
    this.error = false,
    this.onRetry,
  });

  final IconData icon;
  final String title;
  final String detail;
  final bool loading;
  final bool error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final foreground = error ? colors.error : colors.onSurface;
    return ConstrainedBox(
      key: const Key('auth-service-status'),
      constraints: const BoxConstraints(minHeight: 64),
      child: Row(
        children: [
          SizedBox.square(
            dimension: 40,
            child: Center(
              child: loading
                  ? const SizedBox.square(
                      dimension: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(icon, size: 28, color: foreground),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: foreground,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  detail,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          if (onRetry != null)
            IconButton(
              tooltip: '重新检查',
              onPressed: onRetry,
              color: foreground,
              icon: const Icon(Icons.refresh),
            ),
        ],
      ),
    );
  }
}

class _DevelopmentEnvironmentNotice extends StatelessWidget {
  const _DevelopmentEnvironmentNotice({required this.environment});

  final AppEnvironment environment;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.tertiaryContainer,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.tertiary.withValues(alpha: .25)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Icon(Icons.dns_outlined, color: colors.onTertiaryContainer),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '本地开发环境',
                    style: TextStyle(
                      color: colors.onTertiaryContainer,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    Uri.parse(environment.origin).authority,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colors.onTertiaryContainer,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LoginHeader extends StatelessWidget {
  const _LoginHeader({required this.isDevelopment});

  final bool isDevelopment;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      key: const Key('login-header'),
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: Image.asset(
            'assets/brand/brand_mark.png',
            key: const Key('login-brand-mark'),
            width: 52,
            height: 52,
            cacheWidth: 156,
            semanticLabel: '星空云绘标识',
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                header: true,
                child: Text(
                  '星空云绘',
                  key: const Key('login-title'),
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontSize: 28,
                    height: 1.25,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0,
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                isDevelopment ? '本地账号登录' : '账号登录',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                  fontSize: 14,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
