import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/user_session_cache.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_top_bar.dart';
import '../auth/auth.dart';

class AccountSecurityScreen extends ConsumerStatefulWidget {
  const AccountSecurityScreen({super.key});

  @override
  ConsumerState<AccountSecurityScreen> createState() =>
      _AccountSecurityScreenState();
}

class _AccountSecurityScreenState extends ConsumerState<AccountSecurityScreen> {
  bool _signingOut = false;

  Future<void> _confirmSignOut() async {
    if (_signingOut) return;
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (dialogContext) => AppDialog(
        icon: const Icon(Icons.logout_rounded),
        title: const Text('退出当前账号？'),
        content: const Text('本机登录状态将被清除，作品、积分和素材仍保存在账号中。'),
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
            child: const Text('确认退出'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _signingOut = true);
    await ref.read(sessionControllerProvider.notifier).signOut();
    ref.read(userSessionCacheProvider).clear();
    if (mounted) context.go('/discover');
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider);
    final user = session.asData?.value.user;
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const AppTopBar(
        title: Text('账号与安全'),
        fallbackLocation: '/profile',
      ),
      body: user == null
          ? _SignedOutState(onLogin: () => context.push('/login'))
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 36),
              children: [
                _SecurityStatus(email: user.email),
                const SizedBox(height: 28),
                const _SectionTitle('账号'),
                const SizedBox(height: 8),
                _SettingsGroup(
                  children: [
                    _SettingsRow(
                      key: const Key('security-account-email'),
                      icon: Icons.alternate_email_rounded,
                      title: '登录邮箱',
                      detail: user.email,
                    ),
                    const _SettingsRow(
                      icon: Icons.enhanced_encryption_outlined,
                      title: '会话保护',
                      detail: '凭证与本地草稿按账号安全隔离',
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                const _SectionTitle('设备与数据'),
                const SizedBox(height: 8),
                _SettingsGroup(
                  children: [
                    _SettingsRow(
                      key: const Key('security-login-sessions'),
                      icon: Icons.devices_outlined,
                      title: '登录设备',
                      detail: '查看并退出已登录的设备',
                      onTap: () => context.push('/profile/security/sessions'),
                    ),
                    _SettingsRow(
                      key: const Key('security-blocked-users'),
                      icon: Icons.person_off_outlined,
                      title: '已屏蔽用户',
                      detail: '管理不再显示的社区作者',
                      onTap: () =>
                          context.push('/profile/security/blocked-users'),
                    ),
                    _SettingsRow(
                      key: const Key('security-data-export'),
                      icon: Icons.file_download_outlined,
                      title: '导出账号数据',
                      detail: '获取资料、创作与交易记录副本',
                      onTap: () =>
                          context.push('/profile/security/data-export'),
                    ),
                    _SettingsRow(
                      key: const Key('security-permissions'),
                      icon: Icons.admin_panel_settings_outlined,
                      title: '权限管理',
                      detail: '照片、相机、麦克风与语音识别',
                      onTap: () => context.push('/permissions'),
                    ),
                    _SettingsRow(
                      key: const Key('security-local-storage'),
                      icon: Icons.storage_outlined,
                      title: '本地存储',
                      detail: '管理图片缓存和未发送草稿',
                      onTap: () => context.push('/profile/security/storage'),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                _SettingsGroup(
                  children: [
                    _SettingsRow(
                      key: const Key('security-sign-out'),
                      icon: Icons.logout_rounded,
                      title: _signingOut ? '正在退出' : '退出登录',
                      detail: '只清除本机登录状态',
                      foregroundColor: colors.error,
                      onTap: _signingOut ? null : _confirmSignOut,
                      trailing: _signingOut
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : null,
                    ),
                    _SettingsRow(
                      key: const Key('security-delete-account'),
                      icon: Icons.person_off_outlined,
                      title: '注销账号',
                      detail: '永久关闭账号并移除身份信息',
                      foregroundColor: colors.error,
                      onTap: () => context.push('/profile/security/delete'),
                    ),
                  ],
                ),
              ],
            ),
    );
  }
}

class _SecurityStatus extends StatelessWidget {
  const _SecurityStatus({required this.email});

  final String email;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: colors.primaryContainer,
            borderRadius: BorderRadius.circular(8),
          ),
          child: SizedBox.square(
            dimension: 48,
            child: Icon(
              Icons.verified_user_outlined,
              color: colors.onPrimaryContainer,
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '账号已安全登录',
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 3),
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

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Text(
    title,
    style: Theme.of(
      context,
    ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
  );
}

class _SettingsGroup extends StatelessWidget {
  const _SettingsGroup({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerLow,
      borderRadius: BorderRadius.circular(8),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var index = 0; index < children.length; index++) ...[
            if (index > 0)
              Divider(
                height: 1,
                indent: 54,
                color: colors.outlineVariant.withValues(alpha: .7),
              ),
            children[index],
          ],
        ],
      ),
    );
  }
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({
    required this.icon,
    required this.title,
    required this.detail,
    this.onTap,
    this.trailing,
    this.foregroundColor,
    super.key,
  });

  final IconData icon;
  final String title;
  final String detail;
  final VoidCallback? onTap;
  final Widget? trailing;
  final Color? foregroundColor;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      contentPadding: const EdgeInsets.fromLTRB(14, 4, 8, 4),
      leading: Icon(
        icon,
        color: foregroundColor ?? colors.onSurfaceVariant,
        size: 22,
      ),
      title: Text(
        title,
        style: TextStyle(color: foregroundColor, fontWeight: FontWeight.w700),
      ),
      subtitle: Text(detail, maxLines: 2, overflow: TextOverflow.ellipsis),
      trailing:
          trailing ??
          (onTap == null
              ? null
              : const Icon(Icons.chevron_right_rounded, size: 20)),
      onTap: onTap,
    );
  }
}

class _SignedOutState extends StatelessWidget {
  const _SignedOutState({required this.onLogin});

  final VoidCallback onLogin;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.lock_outline_rounded, size: 42),
          const SizedBox(height: 14),
          const Text(
            '登录状态已失效',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
          ),
          const SizedBox(height: 14),
          FilledButton(onPressed: onLogin, child: const Text('重新登录')),
        ],
      ),
    ),
  );
}
