import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import 'blocked_users.dart';

class BlockedUsersScreen extends ConsumerStatefulWidget {
  const BlockedUsersScreen({super.key});

  @override
  ConsumerState<BlockedUsersScreen> createState() => _BlockedUsersScreenState();
}

class _BlockedUsersScreenState extends ConsumerState<BlockedUsersScreen> {
  final Set<String> _unblocking = {};

  Future<void> _refresh() async {
    ref.invalidate(blockedUsersProvider);
    try {
      await ref.read(blockedUsersProvider.future);
    } catch (_) {
      // The provider error state owns retry feedback.
    }
  }

  Future<void> _unblock(BlockedUser user) async {
    if (_unblocking.contains(user.id)) return;
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (dialogContext) => AppDialog(
        icon: const Icon(Icons.visibility_outlined),
        title: Text('解除屏蔽 ${user.displayName}？'),
        content: const Text('解除后，该作者的公开社区作品会重新向你展示。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('确认解除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _unblocking.add(user.id));
    try {
      await ref.read(blockedUsersRepositoryProvider).unblock(user.id);
      ref.invalidate(blockedUsersProvider);
      if (mounted) AppNotice.success(context, '已解除屏蔽');
    } catch (error) {
      if (!mounted) return;
      AppNotice.error(
        context,
        error is ApiException ? error.message : '解除屏蔽失败，请稍后重试',
      );
    } finally {
      if (mounted) setState(() => _unblocking.remove(user.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final users = ref.watch(blockedUsersProvider);
    final featureUnavailable =
        users.hasError &&
        users.error is ApiException &&
        (users.error! as ApiException).isNotFound;
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('已屏蔽用户'),
        fallbackLocation: '/profile/security',
        actions: featureUnavailable
            ? null
            : [
                AppTopBarIconButton(
                  icon: const Icon(Icons.refresh_rounded),
                  tooltip: '刷新列表',
                  onPressed: _refresh,
                ),
              ],
      ),
      body: users.when(
        skipLoadingOnReload: true,
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) =>
            _BlockedUsersError(error: error, onRetry: _refresh),
        data: (items) => _BlockedUsersList(
          items: items,
          unblocking: _unblocking,
          onRefresh: _refresh,
          onUnblock: _unblock,
        ),
      ),
    );
  }
}

class _BlockedUsersList extends StatelessWidget {
  const _BlockedUsersList({
    required this.items,
    required this.unblocking,
    required this.onRefresh,
    required this.onUnblock,
  });

  final List<BlockedUser> items;
  final Set<String> unblocking;
  final Future<void> Function() onRefresh;
  final ValueChanged<BlockedUser> onUnblock;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 36),
        children: [
          Row(
            children: [
              Icon(Icons.person_off_outlined, size: 28, color: colors.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      items.isEmpty ? '没有已屏蔽用户' : '已屏蔽 ${items.length} 位用户',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '屏蔽只影响你看到的社区内容',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 22),
          if (items.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 48),
              child: Column(
                children: [
                  Icon(
                    Icons.visibility_outlined,
                    size: 36,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '被屏蔽的作者会显示在这里',
                    style: TextStyle(color: colors.onSurfaceVariant),
                  ),
                ],
              ),
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
                        indent: 62,
                        color: colors.outlineVariant.withValues(alpha: .7),
                      ),
                    _BlockedUserTile(
                      user: items[index],
                      unblocking: unblocking.contains(items[index].id),
                      onUnblock: () => onUnblock(items[index]),
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

class _BlockedUserTile extends StatelessWidget {
  const _BlockedUserTile({
    required this.user,
    required this.unblocking,
    required this.onUnblock,
  });

  final BlockedUser user;
  final bool unblocking;
  final VoidCallback onUnblock;

  @override
  Widget build(BuildContext context) {
    final blockedAt = user.blockedAt?.toLocal();
    return ListTile(
      key: Key('blocked-user-${user.id}'),
      contentPadding: const EdgeInsets.fromLTRB(14, 5, 8, 5),
      leading: CircleAvatar(
        radius: 20,
        child: Text(user.displayName.characters.first.toUpperCase()),
      ),
      title: Text(
        user.displayName,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      subtitle: Text(
        blockedAt == null
            ? '社区内容已隐藏'
            : '${DateFormat('yyyy-MM-dd').format(blockedAt)} 屏蔽',
      ),
      trailing: IconButton(
        key: Key('unblock-user-${user.id}'),
        tooltip: '解除屏蔽',
        onPressed: unblocking ? null : onUnblock,
        icon: unblocking
            ? const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.visibility_outlined),
      ),
    );
  }
}

class _BlockedUsersError extends StatelessWidget {
  const _BlockedUsersError({required this.error, required this.onRetry});

  final Object error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final unavailable =
        error is ApiException && (error as ApiException).isNotFound;
    return AppStatusView(
      key: const Key('blocked-users-status'),
      icon: unavailable
          ? Icons.system_update_alt_rounded
          : Icons.cloud_off_outlined,
      title: unavailable ? '屏蔽管理服务升级中' : '暂时无法读取屏蔽列表',
      message: unavailable ? '服务端完成升级后即可管理已屏蔽用户，社区浏览不受影响' : '请检查网络后重新加载',
      actionLabel: unavailable ? null : '重新加载',
      actionKey: const Key('blocked-users-retry'),
      onAction: unavailable ? null : onRetry,
    );
  }
}
