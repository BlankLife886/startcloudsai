import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import 'notifications.dart';
import '../../core/widgets/app_chrome.dart';

class NotificationCenterScreen extends ConsumerStatefulWidget {
  const NotificationCenterScreen({super.key});

  @override
  ConsumerState<NotificationCenterScreen> createState() =>
      _NotificationCenterScreenState();
}

class _NotificationCenterScreenState
    extends ConsumerState<NotificationCenterScreen> {
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();
  _NotificationFilter _filter = _NotificationFilter.all;
  String _query = '';
  String? _loadMoreError;
  bool _loadMoreInFlight = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    final state = ref.read(notificationCenterControllerProvider).asData?.value;
    if (!_scrollController.hasClients ||
        _scrollController.position.extentAfter > 300 ||
        _scrollController.position.pixels <= 0 ||
        _loadMoreInFlight ||
        _loadMoreError != null ||
        state == null ||
        !state.hasMore ||
        state.isLoadingMore) {
      return;
    }
    unawaited(_loadMore(showErrorNotice: false));
  }

  Future<void> _refresh() async {
    if (_loadMoreError != null && mounted) {
      setState(() => _loadMoreError = null);
    }
    await ref.read(notificationCenterControllerProvider.notifier).refresh();
  }

  Future<void> _loadMore({bool showErrorNotice = true}) async {
    if (_loadMoreInFlight) return;
    _loadMoreInFlight = true;
    if (_loadMoreError != null && mounted) {
      setState(() => _loadMoreError = null);
    }
    try {
      await ref.read(notificationCenterControllerProvider.notifier).loadMore();
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException ? error.message : '更多通知加载失败，请稍后重试';
      setState(() => _loadMoreError = message);
      if (showErrorNotice) AppNotice.error(context, message);
    } finally {
      _loadMoreInFlight = false;
    }
  }

  Future<void> _markRead(
    AppNotification notification, {
    bool showSuccess = false,
  }) async {
    try {
      await ref
          .read(notificationCenterControllerProvider.notifier)
          .markRead(notification.id);
      if (mounted && showSuccess) AppNotice.success(context, '已标记为已读');
    } catch (error) {
      if (mounted) _showError(error);
    }
  }

  Future<void> _openNotification(AppNotification notification) async {
    if (!notification.isRead) await _markRead(notification);
    if (!mounted) return;
    final destination = notification.destination;
    await showAppSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => NotificationDetailSheet(
        notification: notification,
        onOpenDestination: destination == null
            ? null
            : () {
                Navigator.pop(sheetContext);
                context.push(destination.route);
              },
      ),
    );
  }

  Future<void> _markAllRead() async {
    try {
      await ref
          .read(notificationCenterControllerProvider.notifier)
          .markAllRead();
      if (!mounted) return;
      AppNotice.success(context, '全部通知已标记为已读');
    } catch (error) {
      if (mounted) _showError(error);
    }
  }

  Future<bool> _confirmDelete(AppNotification notification) async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.delete_outline),
        title: const Text('删除这条通知？'),
        content: Text('“${notification.title}”将从通知列表中移除。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    return confirmed == true;
  }

  Future<void> _deleteNotification(AppNotification notification) async {
    try {
      await ref
          .read(notificationCenterControllerProvider.notifier)
          .dismiss(notification.id);
      if (mounted) AppNotice.success(context, '通知已删除');
    } catch (error) {
      if (mounted) _showError(error);
    }
  }

  Future<void> _clearAll() async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.delete_sweep_outlined),
        title: const Text('清空全部通知？'),
        content: const Text('个人通知将被删除，全站通知也会从你的列表中隐藏。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认清空'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref.read(notificationCenterControllerProvider.notifier).clearAll();
      if (!mounted) return;
      AppNotice.success(context, '通知已清空');
    } catch (error) {
      if (mounted) _showError(error);
    }
  }

  void _showError(Object error) {
    final message = error is ApiException ? error.message : '通知操作失败，请稍后重试';
    AppNotice.error(context, message);
  }

  @override
  Widget build(BuildContext context) {
    final notifications = ref.watch(notificationCenterControllerProvider);
    final data = notifications.asData?.value;
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('通知中心'),
        fallbackLocation: '/profile',
        actions: [
          IconButton(
            tooltip: '全部已读',
            onPressed: data != null && data.unread > 0 && !data.isBusy
                ? _markAllRead
                : null,
            icon: data?.isMarkingAll == true
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.done_all),
          ),
          IconButton(
            tooltip: '清空通知',
            onPressed: data != null && data.items.isNotEmpty && !data.isBusy
                ? _clearAll
                : null,
            icon: data?.isClearing == true
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.delete_sweep_outlined),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: notifications.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) =>
            _NotificationError(error: error, onRetry: _refresh),
        data: _buildTimeline,
      ),
    );
  }

  Widget _buildTimeline(NotificationCenterState state) {
    final filtered = searchNotifications(
      state.items.where(_filter.includes),
      _query,
    );
    final entries = _timelineEntries(filtered);
    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
            sliver: SliverToBoxAdapter(
              child: TextField(
                key: const Key('notification-search'),
                controller: _searchController,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: '搜索标题、正文或通知类型',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          key: const Key('notification-search-clear'),
                          tooltip: '清除搜索',
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _query = '');
                          },
                          icon: const Icon(Icons.close),
                        ),
                  filled: true,
                  fillColor: Theme.of(context).colorScheme.surfaceContainerLow,
                  border: const OutlineInputBorder(
                    borderRadius: BorderRadius.all(Radius.circular(8)),
                  ),
                ),
                onChanged: (value) => setState(() => _query = value),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Row(
                children: [
                  for (final filter in _NotificationFilter.values) ...[
                    if (filter != _NotificationFilter.values.first)
                      const SizedBox(width: 8),
                    _NotificationFilterChip(
                      label: filter.label,
                      selected: _filter == filter,
                      onTap: () => setState(() => _filter = filter),
                    ),
                  ],
                ],
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            sliver: SliverToBoxAdapter(
              child: _NotificationResultSummary(
                visible: filtered.length,
                loaded: state.items.length,
                hasMore: state.hasMore,
              ),
            ),
          ),
          if (entries.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: _NotificationEmpty(
                filter: _filter,
                query: _query,
                hasMore: state.hasMore,
                loading: state.isLoadingMore,
                errorMessage: _loadMoreError,
                onLoadMore: _loadMore,
              ),
            )
          else ...[
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverList.builder(
                itemCount: entries.length,
                itemBuilder: (context, index) {
                  final entry = entries[index];
                  if (entry.header != null) {
                    return _DateHeader(label: entry.header!);
                  }
                  final notification = entry.notification!;
                  return Dismissible(
                    key: Key('notification-dismiss-${notification.id}'),
                    direction: state.isBusy
                        ? DismissDirection.none
                        : DismissDirection.endToStart,
                    confirmDismiss: (_) => _confirmDelete(notification),
                    onDismissed: (_) =>
                        unawaited(_deleteNotification(notification)),
                    background: const _NotificationDeleteBackground(),
                    child: NotificationTimelineTile(
                      notification: notification,
                      marking: state.markingIds.contains(notification.id),
                      onTap: () => _openNotification(notification),
                      onMarkRead: notification.isRead
                          ? null
                          : () => _markRead(notification, showSuccess: true),
                    ),
                  );
                },
              ),
            ),
            SliverToBoxAdapter(
              child: _LoadMoreFooter(
                hasMore: state.hasMore,
                loading: state.isLoadingMore,
                errorMessage: _loadMoreError,
                onLoadMore: _loadMore,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _NotificationDeleteBackground extends StatelessWidget {
  const _NotificationDeleteBackground();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.errorContainer,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              Icon(Icons.delete_outline, color: colors.onErrorContainer),
              const SizedBox(width: 6),
              Text(
                '删除',
                style: TextStyle(
                  color: colors.onErrorContainer,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum _NotificationFilter { all, unread }

extension on _NotificationFilter {
  String get label => switch (this) {
    _NotificationFilter.all => '全部',
    _NotificationFilter.unread => '未读',
  };

  bool includes(AppNotification notification) => switch (this) {
    _NotificationFilter.all => true,
    _NotificationFilter.unread => !notification.isRead,
  };
}

class _TimelineEntry {
  const _TimelineEntry.header(this.header) : notification = null;
  const _TimelineEntry.notification(this.notification) : header = null;

  final String? header;
  final AppNotification? notification;
}

List<_TimelineEntry> _timelineEntries(List<AppNotification> items) {
  final entries = <_TimelineEntry>[];
  String? previousHeader;
  for (final item in items) {
    final header = _dateGroup(item.createdAt);
    if (header != previousHeader) {
      entries.add(_TimelineEntry.header(header));
      previousHeader = header;
    }
    entries.add(_TimelineEntry.notification(item));
  }
  return entries;
}

String _dateGroup(DateTime? value) {
  if (value == null) return '更早';
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final date = DateTime(value.year, value.month, value.day);
  final days = today.difference(date).inDays;
  if (days == 0) return '今天';
  if (days == 1) return '昨天';
  if (value.year == now.year) return '${value.month}月${value.day}日';
  return '${value.year}年${value.month}月${value.day}日';
}

class _DateHeader extends StatelessWidget {
  const _DateHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 10, 4, 6),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _NotificationFilterChip extends StatelessWidget {
  const _NotificationFilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppFilterChip(label: label, selected: selected, onTap: onTap);
  }
}

class _NotificationResultSummary extends StatelessWidget {
  const _NotificationResultSummary({
    required this.visible,
    required this.loaded,
    required this.hasMore,
  });

  final int visible;
  final int loaded;
  final bool hasMore;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      children: [
        Icon(Icons.filter_list, size: 16, color: colors.outline),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            '已显示 $visible / 已加载 $loaded',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        if (hasMore)
          Text(
            '还有更多',
            style: Theme.of(
              context,
            ).textTheme.labelMedium?.copyWith(color: colors.primary),
          ),
      ],
    );
  }
}

class NotificationTimelineTile extends StatelessWidget {
  const NotificationTimelineTile({
    required this.notification,
    required this.onTap,
    this.onMarkRead,
    this.marking = false,
    super.key,
  });

  final AppNotification notification;
  final VoidCallback? onTap;
  final VoidCallback? onMarkRead;
  final bool marking;

  @override
  Widget build(BuildContext context) {
    final style = notificationKindStyle(notification.kind);
    final destination = notification.destination;
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: notification.isRead
            ? colors.surface
            : style.color.withValues(alpha: 0.04),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(
            color: notification.isRead
                ? colors.outlineVariant
                : style.color.withValues(alpha: 0.34),
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox.square(
                  dimension: 26,
                  child: Icon(style.icon, size: 21, color: style.color),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              notification.title,
                              style: TextStyle(
                                fontWeight: notification.isRead
                                    ? FontWeight.w600
                                    : FontWeight.w800,
                              ),
                            ),
                          ),
                          if (!notification.isRead) ...[
                            const SizedBox(width: 4),
                            if (marking)
                              const Padding(
                                padding: EdgeInsets.all(8),
                                child: SizedBox.square(
                                  dimension: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                ),
                              )
                            else
                              IconButton(
                                key: Key(
                                  'notification-mark-read-${notification.id}',
                                ),
                                tooltip: '标为已读',
                                onPressed: onMarkRead,
                                visualDensity: VisualDensity.compact,
                                icon: const Icon(Icons.done, size: 18),
                              ),
                          ],
                        ],
                      ),
                      if (notification.body.isNotEmpty) ...[
                        const SizedBox(height: 5),
                        Text(
                          notification.body,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                                height: 1.4,
                              ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 12,
                        runSpacing: 5,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            _notificationTime(notification.createdAt),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          Text(
                            notificationKindLabel(notification.kind),
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(
                                  color: style.color,
                                  fontWeight: FontWeight.w800,
                                ),
                          ),
                          if (destination != null)
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  destination.label,
                                  style: Theme.of(context).textTheme.labelSmall
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                const SizedBox(width: 2),
                                const Icon(Icons.chevron_right, size: 16),
                              ],
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

({IconData icon, Color color}) notificationKindStyle(
  String kind,
) => switch (kind) {
  'task' => (icon: Icons.auto_awesome_outlined, color: const Color(0xFF4F67D6)),
  'reward' => (
    icon: Icons.card_giftcard_outlined,
    color: const Color(0xFF0F766E),
  ),
  'trial_access' => (
    icon: Icons.verified_outlined,
    color: const Color(0xFFD97706),
  ),
  'order' => (
    icon: Icons.receipt_long_outlined,
    color: const Color(0xFF7C3AED),
  ),
  'gallery' => (icon: Icons.public_outlined, color: const Color(0xFFDB2777)),
  _ => (icon: Icons.campaign_outlined, color: const Color(0xFF64748B)),
};

String _notificationTime(DateTime? value) {
  if (value == null) return '';
  final hour = value.hour.toString().padLeft(2, '0');
  final minute = value.minute.toString().padLeft(2, '0');
  return '$hour:$minute';
}

class NotificationDetailSheet extends StatelessWidget {
  const NotificationDetailSheet({
    required this.notification,
    this.onOpenDestination,
    super.key,
  });

  final AppNotification notification;
  final VoidCallback? onOpenDestination;

  @override
  Widget build(BuildContext context) {
    final style = notificationKindStyle(notification.kind);
    final destination = notification.destination;
    final relationLabel = notification.relationLabel;
    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: style.color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(style.icon, color: style.color),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        notification.title,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Wrap(
                        spacing: 10,
                        runSpacing: 4,
                        children: [
                          Text(
                            notificationKindLabel(notification.kind),
                            style: TextStyle(
                              color: style.color,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            _notificationDateTime(notification.createdAt),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          if (relationLabel != null)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: style.color.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.link,
                                    size: 14,
                                    color: style.color,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    relationLabel,
                                    style: Theme.of(context)
                                        .textTheme
                                        .labelSmall
                                        ?.copyWith(
                                          color: style.color,
                                          fontWeight: FontWeight.w800,
                                        ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (notification.body.isNotEmpty) ...[
              const SizedBox(height: 20),
              Text(
                notification.body,
                style: Theme.of(
                  context,
                ).textTheme.bodyLarge?.copyWith(height: 1.55),
              ),
            ],
            const SizedBox(height: 24),
            if (destination != null && onOpenDestination != null)
              FilledButton.icon(
                onPressed: onOpenDestination,
                icon: Icon(style.icon),
                label: Text(destination.label),
              )
            else
              FilledButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('关闭'),
              ),
          ],
        ),
      ),
    );
  }
}

String _notificationDateTime(DateTime? value) {
  if (value == null) return '';
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  return '${value.year}年$month月$day日 ${_notificationTime(value)}';
}

class _LoadMoreFooter extends StatelessWidget {
  const _LoadMoreFooter({
    required this.hasMore,
    required this.loading,
    required this.errorMessage,
    required this.onLoadMore,
  });

  final bool hasMore;
  final bool loading;
  final String? errorMessage;
  final Future<void> Function() onLoadMore;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final error = errorMessage?.trim();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 52),
        child: error?.isNotEmpty == true
            ? _PaginationError(message: error!, onRetry: onLoadMore)
            : loading
            ? Semantics(
                liveRegion: true,
                label: '正在自动加载更多通知',
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: 10),
                    Text('正在自动加载更多通知'),
                  ],
                ),
              )
            : hasMore
            ? Row(
                children: [
                  Icon(
                    Icons.keyboard_arrow_down,
                    size: 20,
                    color: colors.primary,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      '继续向下浏览将自动加载',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  TextButton(
                    key: const Key('notification-load-more'),
                    onPressed: onLoadMore,
                    child: const Text('立即加载'),
                  ),
                ],
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.check_circle_outline,
                    size: 18,
                    color: colors.outline,
                  ),
                  const SizedBox(width: 7),
                  Text('已加载全部通知', style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
      ),
    );
  }
}

class _NotificationEmpty extends StatelessWidget {
  const _NotificationEmpty({
    required this.filter,
    required this.query,
    required this.hasMore,
    required this.loading,
    required this.errorMessage,
    required this.onLoadMore,
  });

  final _NotificationFilter filter;
  final String query;
  final bool hasMore;
  final bool loading;
  final String? errorMessage;
  final Future<void> Function() onLoadMore;

  @override
  Widget build(BuildContext context) {
    final searching = query.trim().isNotEmpty;
    final error = errorMessage?.trim();
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              searching
                  ? Icons.search_off
                  : filter == _NotificationFilter.unread
                  ? Icons.mark_email_read_outlined
                  : Icons.notifications_none,
              size: 48,
            ),
            const SizedBox(height: 12),
            Text(
              searching
                  ? '没有匹配的通知'
                  : filter == _NotificationFilter.unread
                  ? '没有未读通知'
                  : '暂时没有通知',
            ),
            if (error?.isNotEmpty == true) ...[
              const SizedBox(height: 14),
              _PaginationError(message: error!, onRetry: onLoadMore),
            ] else if (hasMore) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: loading ? null : onLoadMore,
                icon: loading
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.expand_more),
                label: Text(loading ? '正在加载' : '继续加载更多通知'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PaginationError extends StatelessWidget {
  const _PaginationError({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      child: Row(
        key: const Key('notification-load-more-error'),
        children: [
          Icon(Icons.error_outline, size: 20, color: colors.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: colors.error),
            ),
          ),
          IconButton(
            key: const Key('notification-load-more-retry'),
            tooltip: '重试加载通知',
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
    );
  }
}

class _NotificationError extends StatelessWidget {
  const _NotificationError({required this.error, required this.onRetry});

  final Object error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is ApiException
        ? (error as ApiException).message
        : '通知加载失败';
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.cloud_off_outlined,
              size: 44,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('重新加载'),
            ),
          ],
        ),
      ),
    );
  }
}
