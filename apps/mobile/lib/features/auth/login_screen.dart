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
    return Scaffold(
      appBar: const AppTopBar(
        title: SizedBox.shrink(),
        fallbackLocation: '/discover',
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: AutofillGroup(
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const AppAppear(
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: _BrandMark(),
                        ),
                      ),
                      const SizedBox(height: 20),
                      if (isDevelopment) ...[
                        _DevelopmentEnvironmentNotice(environment: environment),
                        const SizedBox(height: 18),
                      ],
                      Text(
                        isDevelopment ? '本地账号登录' : '登录星空云绘',
                        style: Theme.of(context).textTheme.headlineSmall
                            ?.copyWith(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '验证码将在 3 分钟内有效',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 16),
                      _AuthProviderStatus(
                        providers: providers,
                        onRetry: () => ref.invalidate(authProvidersProvider),
                      ),
                      const SizedBox(height: 20),
                      TextFormField(
                        key: const Key('login-email-field'),
                        controller: _emailController,
                        focusNode: _emailFocusNode,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        autocorrect: false,
                        enableSuggestions: false,
                        textInputAction: TextInputAction.next,
                        onFieldSubmitted: (_) => _codeFocusNode.requestFocus(),
                        validator: (value) => emailProviders == null
                            ? null
                            : validateLoginEmail(value, emailProviders),
                        decoration: const InputDecoration(
                          labelText: '邮箱',
                          prefixIcon: Icon(Icons.alternate_email),
                        ),
                      ),
                      const SizedBox(height: 14),
                      LayoutBuilder(
                        builder: (context, constraints) {
                          final textScale = MediaQuery.textScalerOf(
                            context,
                          ).scale(1);
                          final compact =
                              constraints.maxWidth < 360 || textScale > 1.3;
                          final codeField = TextFormField(
                            key: const Key('login-code-field'),
                            controller: _codeController,
                            focusNode: _codeFocusNode,
                            keyboardType: TextInputType.number,
                            autofillHints: const [AutofillHints.oneTimeCode],
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                              LengthLimitingTextInputFormatter(6),
                            ],
                            maxLength: 6,
                            textInputAction: TextInputAction.done,
                            onChanged: (_) => setState(() {}),
                            onFieldSubmitted: (_) => _submit(),
                            validator: (value) =>
                                RegExp(r'^\d{6}$').hasMatch(value?.trim() ?? '')
                                ? null
                                : '请输入六位验证码',
                            decoration: InputDecoration(
                              labelText: '验证码',
                              counterText: '',
                              prefixIcon: const Icon(Icons.password),
                              suffixIcon: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 160),
                                child: _codeController.text.length == 6
                                    ? Icon(
                                        Icons.check_circle,
                                        key: const Key('login-code-complete'),
                                        color: Theme.of(
                                          context,
                                        ).colorScheme.primary,
                                      )
                                    : const SizedBox.shrink(),
                              ),
                            ),
                          );
                          final sendButton = OutlinedButton.icon(
                            key: const Key('send-login-code'),
                            onPressed:
                                _sendingCode ||
                                    _signingIn ||
                                    _resendSeconds > 0 ||
                                    !canUseEmailCode
                                ? null
                                : _requestCode,
                            icon: _sendingCode
                                ? const SizedBox.square(
                                    dimension: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.send_outlined, size: 18),
                            label: Text(
                              _sendingCode
                                  ? '发送中'
                                  : _resendSeconds > 0
                                  ? '${_resendSeconds}s 后重试'
                                  : '获取验证码',
                            ),
                          );
                          if (compact) {
                            return Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                codeField,
                                const SizedBox(height: 10),
                                sendButton,
                              ],
                            );
                          }
                          return Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(child: codeField),
                              const SizedBox(width: 10),
                              SizedBox(width: 126, child: sendButton),
                            ],
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
                      const SizedBox(height: 22),
                      FilledButton(
                        onPressed:
                            _signingIn ||
                                _sendingCode ||
                                !canUseEmailCode ||
                                !_acceptedLegal
                            ? null
                            : _submit,
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(52),
                        ),
                        child: _signingIn
                            ? const SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Text('登录'),
                      ),
                      const SizedBox(height: 12),
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
          ),
        ),
      ),
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
                ).textTheme.bodySmall?.copyWith(color: muted),
              ),
              TextButton(
                key: const Key('login-terms'),
                style: style,
                onPressed: () => context.push('/legal/terms'),
                child: const Text('用户协议'),
              ),
              Text(
                '和',
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: muted),
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
              title: '邮箱验证码登录',
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
    final foreground = error ? colors.onErrorContainer : colors.onSurface;
    return DecoratedBox(
      key: const Key('auth-service-status'),
      decoration: BoxDecoration(
        color: error ? colors.errorContainer : colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: error
              ? colors.error.withValues(alpha: .28)
              : colors.outlineVariant,
        ),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
            child: Row(
              children: [
                Icon(icon, size: 21, color: foreground),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: foreground,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        detail,
                        style: Theme.of(
                          context,
                        ).textTheme.bodySmall?.copyWith(color: foreground),
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
          ),
          if (loading) const LinearProgressIndicator(minHeight: 2),
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
        borderRadius: BorderRadius.circular(8),
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

class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.auto_awesome_rounded, color: colors.primary, size: 24),
        const SizedBox(width: 9),
        Text(
          '星空云绘',
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
        ),
      ],
    );
  }
}
