import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import 'account_sessions.dart';

class AccountSessionsScreen extends ConsumerStatefulWidget {
  const AccountSessionsScreen({super.key});

  @override
  ConsumerState<AccountSessionsScreen> createState() =>
      _AccountSessionsScreenState();
}

class _AccountSessionsScreenState extends ConsumerState<AccountSessionsScreen> {
  final Set<String> _revoking = {};
  bool _revokingOthers = false;

  Future<void> _refresh() async {
    ref.invalidate(accountSessionsProvider);
    try {
      await ref.read(accountSessionsProvider.future);
    } catch (_) {
      // The provider's error state renders the retry experience.
    }
  }

  void _showError(Object error) {
    AppNotice.error(
      context,
      error is ApiException ? error.message : '设备操作失败，请稍后重试',
    );
  }

  Future<bool> _confirm({required String title, required String detail}) async {
    return await showAppDialog<bool>(
          context: context,
          builder: (dialogContext) => AppDialog(
            icon: const Icon(Icons.logout_rounded),
            title: Text(title),
            content: Text(detail),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('确认退出'),
              ),
            ],
          ),
        ) ==
        true;
  }

  Future<void> _revoke(AccountSession session) async {
    if (_revoking.contains(session.id)) return;
    final confirmed = await _confirm(
      title: '退出这台设备？',
      detail: '${accountSessionDevice(session.userAgent)} 将需要重新验证邮箱才能登录。',
    );
    if (!confirmed || !mounted) return;
    setState(() => _revoking.add(session.id));
    try {
      await ref.read(accountSessionsRepositoryProvider).revoke(session.id);
      ref.invalidate(accountSessionsProvider);
      if (mounted) AppNotice.success(context, '设备已退出');
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _revoking.remove(session.id));
    }
  }

  Future<void> _revokeOthers(int count) async {
    if (_revokingOthers || count <= 0) return;
    final confirmed = await _confirm(
      title: '退出其他设备？',
      detail: '$count 台其他设备将立即退出，当前设备保持登录。',
    );
    if (!confirmed || !mounted) return;
    setState(() => _revokingOthers = true);
    try {
      final revoked = await ref
          .read(accountSessionsRepositoryProvider)
          .revokeOthers();
      ref.invalidate(accountSessionsProvider);
      if (mounted) {
        AppNotice.success(
          context,
          revoked == 0 ? '其他设备已退出' : '已退出 $revoked 台设备',
        );
      }
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _revokingOthers = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sessions = ref.watch(accountSessionsProvider);
    final featureUnavailable =
        sessions.hasError &&
        sessions.error is ApiException &&
        (sessions.error! as ApiException).isNotFound;
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('登录设备'),
        fallbackLocation: '/profile/security',
        actions: featureUnavailable
            ? null
            : [
                AppTopBarIconButton(
                  icon: const Icon(Icons.refresh_rounded),
                  tooltip: '刷新设备',
                  onPressed: _refresh,
                ),
              ],
      ),
      body: sessions.when(
        skipLoadingOnReload: true,
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) =>
            _SessionLoadError(error: error, onRetry: _refresh),
        data: (items) => _SessionList(
          items: items,
          revoking: _revoking,
          revokingOthers: _revokingOthers,
          onRevoke: _revoke,
          onRevokeOthers: _revokeOthers,
          onRefresh: _refresh,
        ),
      ),
    );
  }
}

class _SessionList extends StatelessWidget {
  const _SessionList({
    required this.items,
    required this.revoking,
    required this.revokingOthers,
    required this.onRevoke,
    required this.onRevokeOthers,
    required this.onRefresh,
  });

  final List<AccountSession> items;
  final Set<String> revoking;
  final bool revokingOthers;
  final ValueChanged<AccountSession> onRevoke;
  final ValueChanged<int> onRevokeOthers;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final otherCount = items.where((item) => !item.current).length;
    final colors = Theme.of(context).colorScheme;
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 36),
        children: [
          Row(
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: colors.primaryContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: SizedBox.square(
                  dimension: 48,
                  child: Icon(
                    Icons.devices_outlined,
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
                      '${items.length} 台设备保持登录',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '发现陌生设备时请立即退出',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Row(
                      children: [
                        Icon(
                          Icons.shield_outlined,
                          size: 14,
                          color: colors.primary,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          '当前会话受保护',
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(
                                color: colors.primary,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (otherCount > 0) ...[
            const SizedBox(height: 18),
            OutlinedButton.icon(
              key: const Key('sessions-revoke-others'),
              onPressed: revokingOthers
                  ? null
                  : () => onRevokeOthers(otherCount),
              icon: revokingOthers
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.phonelink_erase_outlined),
              label: Text(revokingOthers ? '正在退出' : '退出其他设备'),
            ),
          ],
          const SizedBox(height: 24),
          Text(
            '有效会话',
            style: Theme.of(
              context,
            ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          if (items.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 36),
              child: Center(child: Text('暂无有效登录设备')),
            )
          else
            Material(
              color: colors.surfaceContainerLow,
              borderRadius: BorderRadius.circular(8),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  for (var index = 0; index < items.length; index++) ...[
                    if (index > 0)
                      Divider(
                        height: 1,
                        indent: 56,
                        color: colors.outlineVariant.withValues(alpha: .7),
                      ),
                    _SessionTile(
                      session: items[index],
                      revoking: revoking.contains(items[index].id),
                      onRevoke: () => onRevoke(items[index]),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({
    required this.session,
    required this.revoking,
    required this.onRevoke,
  });

  final AccountSession session;
  final bool revoking;
  final VoidCallback onRevoke;

  @override
  Widget build(BuildContext context) {
    final device = accountSessionDevice(session.userAgent);
    final client = accountSessionClient(session.userAgent);
    final created = session.createdAt?.toLocal();
    final expires = session.expiresAt?.toLocal();
    final date = DateFormat('MM-dd HH:mm');
    final details = [
      client,
      maskSessionIp(session.ip),
      if (created != null) '${date.format(created)} 登录',
      if (expires != null) '${DateFormat('MM-dd').format(expires)} 到期',
    ];
    return ListTile(
      key: Key('session-${session.id}'),
      contentPadding: const EdgeInsets.fromLTRB(14, 6, 8, 6),
      leading: Icon(_deviceIcon(device), size: 24),
      title: Row(
        children: [
          Flexible(
            child: Text(
              device,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
          if (session.current) ...[
            const SizedBox(width: 8),
            Text(
              '本机',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ],
      ),
      subtitle: Text(details.join(' · '), maxLines: 3),
      trailing: session.current
          ? null
          : IconButton(
              key: Key('session-revoke-${session.id}'),
              tooltip: '退出该设备',
              onPressed: revoking ? null : onRevoke,
              icon: revoking
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.logout_rounded),
            ),
    );
  }
}

IconData _deviceIcon(String device) => switch (device) {
  'iPhone' => Icons.phone_iphone_rounded,
  'iPad' => Icons.tablet_mac_outlined,
  'Android' => Icons.phone_android_rounded,
  'Mac' || 'Windows' || 'Linux' => Icons.computer_outlined,
  _ => Icons.devices_other_outlined,
};

class _SessionLoadError extends StatelessWidget {
  const _SessionLoadError({required this.error, required this.onRetry});

  final Object error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final unavailable =
        error is ApiException && (error as ApiException).isNotFound;
    return AppStatusView(
      key: const Key('sessions-status'),
      icon: unavailable
          ? Icons.system_update_alt_rounded
          : Icons.devices_other_outlined,
      title: unavailable ? '登录设备服务升级中' : '暂时无法读取登录设备',
      message: unavailable
          ? '服务端完成升级后即可查看和退出其他设备，当前登录不受影响'
          : '请稍后重试，其他账号安全功能不受影响',
      actionLabel: unavailable ? null : '重新加载',
      actionKey: const Key('sessions-retry'),
      onAction: unavailable ? null : onRetry,
    );
  }
}
