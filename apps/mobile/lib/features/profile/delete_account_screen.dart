import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/user_session_cache.dart';
import '../../core/network/api_exception.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../auth/auth.dart';

class DeleteAccountScreen extends ConsumerStatefulWidget {
  const DeleteAccountScreen({this.now, super.key});

  final DateTime Function()? now;

  @override
  ConsumerState<DeleteAccountScreen> createState() =>
      _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen>
    with WidgetsBindingObserver {
  final _codeController = TextEditingController();
  Timer? _timer;
  DateTime? _resendDeadline;
  int _resendSeconds = 0;
  bool _acknowledged = false;
  bool _sendingCode = false;
  bool _deleting = false;
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
    _codeController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _syncCountdown();
  }

  void _startCountdown(int seconds) {
    _timer?.cancel();
    final duration = seconds.clamp(0, 3600);
    _resendDeadline = duration == 0
        ? null
        : _now.add(Duration(seconds: duration));
    _syncCountdown();
    if (_resendDeadline != null) {
      _timer = Timer.periodic(
        const Duration(seconds: 1),
        (_) => _syncCountdown(),
      );
    }
  }

  void _syncCountdown() {
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

  void _showError(Object error, {String fallback = '请求失败，请稍后重试'}) {
    if (!mounted) return;
    AppNotice.error(context, error is ApiException ? error.message : fallback);
  }

  Future<void> _requestCode(String email) async {
    if (_sendingCode || _deleting || _resendSeconds > 0) return;
    setState(() => _sendingCode = true);
    try {
      final delivery = await ref
          .read(sessionControllerProvider.notifier)
          .requestCode(email);
      if (!mounted) return;
      setState(() {
        _developmentCode = delivery.developmentCode;
        if (delivery.developmentCode != null) {
          _codeController.text = delivery.developmentCode!;
        }
      });
      _startCountdown(delivery.resendAfter);
      AppNotice.success(context, '验证码已发送');
    } catch (error) {
      _showError(error, fallback: '验证码发送失败，请稍后重试');
    } finally {
      if (mounted) setState(() => _sendingCode = false);
    }
  }

  Future<void> _submit() async {
    final code = _codeController.text.trim();
    if (!_acknowledged) {
      AppNotice.warning(context, '请先确认已了解注销影响');
      return;
    }
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      AppNotice.warning(context, '请输入 6 位邮箱验证码');
      return;
    }
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (dialogContext) => AppDialog(
        icon: Icon(
          Icons.delete_forever_outlined,
          color: Theme.of(dialogContext).colorScheme.error,
        ),
        title: const Text('永久注销账号？'),
        content: const Text('注销完成后无法恢复。原邮箱以后可以注册新账号，但不会找回当前账号的数据。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('取消'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(dialogContext).colorScheme.error,
              foregroundColor: Theme.of(dialogContext).colorScheme.onError,
            ),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('确认永久注销'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _deleting = true);
    try {
      await ref.read(sessionControllerProvider.notifier).deleteAccount(code);
      ref.read(userSessionCacheProvider).clear();
      if (!mounted) return;
      context.go('/discover');
      AppNotice.success(context, '账号已注销');
    } catch (error) {
      _showError(error, fallback: '账号注销失败，请稍后重试');
      if (mounted) setState(() => _deleting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(sessionControllerProvider).asData?.value.user;
    final colors = Theme.of(context).colorScheme;
    if (user == null) {
      return Scaffold(
        appBar: const AppTopBar(
          title: Text('注销账号'),
          fallbackLocation: '/profile',
        ),
        body: const Center(child: Text('登录状态已失效')),
      );
    }
    final codeReady = RegExp(r'^\d{6}$').hasMatch(_codeController.text.trim());
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const AppTopBar(
        title: Text('注销账号'),
        fallbackLocation: '/profile/security',
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 36),
        children: [
          _DeleteHeader(email: user.email),
          const SizedBox(height: 24),
          const _ImpactList(),
          const SizedBox(height: 28),
          Text(
            '验证账号身份',
            style: Theme.of(
              context,
            ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          Text(
            '验证码将发送至 ${user.email}',
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('delete-account-code'),
            controller: _codeController,
            enabled: !_deleting,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.oneTimeCode],
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(6),
            ],
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: '6 位验证码',
              hintText: '请输入邮箱验证码',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const Key('delete-account-send-code'),
            onPressed: _sendingCode || _deleting || _resendSeconds > 0
                ? null
                : () => _requestCode(user.email),
            icon: _sendingCode
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.mark_email_read_outlined),
            label: Text(
              _sendingCode
                  ? '正在发送'
                  : _resendSeconds > 0
                  ? '${_resendSeconds}s 后可重新发送'
                  : '发送验证码',
            ),
          ),
          if (_developmentCode != null) ...[
            const SizedBox(height: 8),
            Text(
              '开发验证码：$_developmentCode',
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
          const SizedBox(height: 20),
          CheckboxListTile(
            key: const Key('delete-account-acknowledge'),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _acknowledged,
            onChanged: _deleting
                ? null
                : (value) => setState(() => _acknowledged = value == true),
            title: const Text('我已了解账号注销后无法恢复'),
            subtitle: const Text('必要的订单与安全记录会在移除身份信息后保留'),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            key: const Key('delete-account-submit'),
            style: FilledButton.styleFrom(
              backgroundColor: colors.error,
              foregroundColor: colors.onError,
              minimumSize: const Size.fromHeight(50),
            ),
            onPressed: _deleting || !_acknowledged || !codeReady
                ? null
                : _submit,
            icon: _deleting
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.delete_forever_outlined),
            label: Text(_deleting ? '正在注销' : '永久注销账号'),
          ),
        ],
      ),
    );
  }
}

class _DeleteHeader extends StatelessWidget {
  const _DeleteHeader({required this.email});

  final String email;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: colors.errorContainer,
            borderRadius: BorderRadius.circular(8),
          ),
          child: SizedBox.square(
            dimension: 48,
            child: Icon(
              Icons.person_off_outlined,
              color: colors.onErrorContainer,
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '永久关闭当前账号',
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              Text(
                email,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ImpactList extends StatelessWidget {
  const _ImpactList();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    const items = [
      ('登录与资料', '所有设备立即退出，头像和个人资料永久匿名化'),
      ('公开内容', '公开投稿将隐藏，当前账号不再可访问作品与素材'),
      ('必要记录', '订单与安全记录移除身份信息后按合规要求保留'),
    ];
    return Material(
      color: colors.surfaceContainerLow,
      borderRadius: BorderRadius.circular(8),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var index = 0; index < items.length; index++) ...[
            if (index > 0)
              Divider(
                height: 1,
                indent: 44,
                color: colors.outlineVariant.withValues(alpha: .7),
              ),
            ListTile(
              contentPadding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
              leading: Icon(
                Icons.remove_circle_outline,
                size: 20,
                color: colors.error,
              ),
              title: Text(
                items[index].$1,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              subtitle: Text(items[index].$2),
            ),
          ],
        ],
      ),
    );
  }
}
