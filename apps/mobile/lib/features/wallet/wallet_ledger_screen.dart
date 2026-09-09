import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../profile/profile.dart';
import 'wallet.dart';
import 'wallet_screen.dart';

class WalletLedgerScreen extends ConsumerStatefulWidget {
  const WalletLedgerScreen({
    this.initialFilter = WalletEntryFilter.all,
    super.key,
  });

  final WalletEntryFilter initialFilter;

  @override
  ConsumerState<WalletLedgerScreen> createState() => _WalletLedgerScreenState();
}

class _WalletLedgerScreenState extends ConsumerState<WalletLedgerScreen> {
  final _scrollController = ScrollController();
  late WalletEntryFilter _filter;
  bool _exporting = false;

  @override
  void initState() {
    super.initState();
    _filter = widget.initialFilter;
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients ||
        _scrollController.position.extentAfter > 260) {
      return;
    }
    unawaited(_loadMore());
  }

  Future<void> _refresh() async {
    ref.invalidate(walletProvider);
    ref.invalidate(profileOverviewProvider);
    await Future.wait([
      ref.read(walletProvider.future),
      ref.read(walletCenterControllerProvider.notifier).refresh(),
    ]);
  }

  Future<void> _loadMore() async {
    try {
      await ref.read(walletCenterControllerProvider.notifier).loadMore();
    } catch (error) {
      if (mounted) _showError(error, fallback: '账本读取失败');
    }
  }

  Future<void> _exportBill(BuildContext buttonContext) async {
    if (_exporting) return;
    final box = buttonContext.findRenderObject() as RenderBox?;
    final origin = box == null
        ? null
        : box.localToGlobal(Offset.zero) & box.size;
    File? file;
    setState(() => _exporting = true);
    try {
      file = await ref.read(walletBillExporterProvider).export();
      if (!mounted) return;
      await ref.read(walletBillShareHandlerProvider)(file, origin);
    } catch (error) {
      if (mounted) _showError(error, fallback: '账单导出失败，请稍后重试');
    } finally {
      file?.delete().ignore();
      if (mounted) setState(() => _exporting = false);
    }
  }

  void _showError(Object error, {required String fallback}) {
    final message = error is ApiException ? error.message : fallback;
    AppNotice.error(context, message);
  }

  @override
  Widget build(BuildContext context) {
    final center = ref.watch(walletCenterControllerProvider);
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: const AppTopBar(
        title: Text('积分明细'),
        fallbackLocation: '/profile/wallet',
      ),
      body: center.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Center(
          child: OutlinedButton.icon(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
            label: const Text('重新加载'),
          ),
        ),
        data: _buildLedger,
      ),
    );
  }

  Widget _buildLedger(WalletCenterState state) {
    final entries = state.items.where(_filter.includes).toList();
    final timeline = walletTimeline(entries);
    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
            sliver: SliverToBoxAdapter(
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      state.total == null
                          ? '已加载 ${state.items.length} 笔'
                          : '共 ${state.total} 笔',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Align(
                      alignment: Alignment.centerRight,
                      child: Builder(
                        builder: (buttonContext) => TextButton.icon(
                          key: const Key('wallet-export'),
                          onPressed: _exporting
                              ? null
                              : () => _exportBill(buttonContext),
                          icon: _exporting
                              ? const SizedBox.square(
                                  dimension: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.ios_share_outlined, size: 18),
                          label: Text(_exporting ? '正在导出' : '导出账单'),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
              child: Row(
                children: [
                  for (final filter in WalletEntryFilter.values) ...[
                    if (filter != WalletEntryFilter.values.first)
                      const SizedBox(width: 8),
                    _WalletFilterChip(
                      label: filter.label,
                      selected: _filter == filter,
                      onTap: () => setState(() => _filter = filter),
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (timeline.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: _WalletEmpty(
                filtered: state.items.isNotEmpty,
                hasMore: state.hasMore,
                onLoadMore: _loadMore,
              ),
            )
          else ...[
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverList.builder(
                itemCount: timeline.length,
                itemBuilder: (context, index) {
                  final item = timeline[index];
                  if (item.label != null) {
                    return Padding(
                      padding: const EdgeInsets.fromLTRB(4, 12, 4, 8),
                      child: Text(
                        item.label!,
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    );
                  }
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: WalletLedgerCard(entry: item.entry!),
                  );
                },
              ),
            ),
            SliverToBoxAdapter(
              child: _WalletLoadMore(
                hasMore: state.hasMore,
                loading: state.isLoadingMore,
                onLoadMore: _loadMore,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _WalletFilterChip extends StatelessWidget {
  const _WalletFilterChip({
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

class WalletTimelineItem {
  const WalletTimelineItem.header(this.label) : entry = null;
  const WalletTimelineItem.entry(this.entry) : label = null;

  final String? label;
  final WalletLedgerEntry? entry;
}

List<WalletTimelineItem> walletTimeline(List<WalletLedgerEntry> entries) {
  final output = <WalletTimelineItem>[];
  String? previous;
  for (final entry in entries) {
    final date = entry.createdAt;
    final key = date == null
        ? 'unknown'
        : DateFormat('yyyy-MM-dd').format(date);
    if (key != previous) {
      output.add(WalletTimelineItem.header(_walletDayLabel(date)));
      previous = key;
    }
    output.add(WalletTimelineItem.entry(entry));
  }
  return output;
}

String _walletDayLabel(DateTime? date) {
  if (date == null) return '更早';
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final target = DateTime(date.year, date.month, date.day);
  final difference = today.difference(target).inDays;
  if (difference == 0) return '今天';
  if (difference == 1) return '昨天';
  if (difference > 1 && difference < 7) return '$difference 天前';
  return date.year == now.year
      ? DateFormat('M月d日').format(date)
      : DateFormat('yyyy年M月d日').format(date);
}

class WalletLedgerCard extends StatelessWidget {
  const WalletLedgerCard({required this.entry, super.key});

  final WalletLedgerEntry entry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final positive = entry.increasesBalance;
    final icon = switch (entry.category) {
      WalletEntryCategory.income => Icons.add_circle_outline,
      WalletEntryCategory.spend => Icons.check_circle_outline,
      WalletEntryCategory.pending => Icons.hourglass_top,
      WalletEntryCategory.refund => Icons.replay,
    };
    final tone = switch (entry.category) {
      WalletEntryCategory.income => scheme.secondary,
      WalletEntryCategory.spend => scheme.error,
      WalletEntryCategory.pending => scheme.tertiary,
      WalletEntryCategory.refund => scheme.primary,
    };
    final amount = entry.displayPoints;
    final signedAmount = '${positive ? '增加' : '扣除'} $amount 积分';
    return Semantics(
      container: true,
      label:
          '${entry.title}，$signedAmount，结余 ${entry.balanceAfterPoints}${entry.reason.isEmpty ? '' : '，${entry.reason}'}',
      excludeSemantics: true,
      child: AppSoftCard(
        padding: const EdgeInsets.fromLTRB(12, 12, 14, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: tone.withValues(alpha: .12),
                shape: BoxShape.circle,
              ),
              child: SizedBox.square(
                dimension: 36,
                child: Icon(icon, color: tone, size: 18),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    entry.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  if (entry.reason.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      entry.reason,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 10,
                    runSpacing: 3,
                    children: [
                      if (entry.createdAt != null)
                        Text(
                          DateFormat('HH:mm').format(entry.createdAt!),
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                      Text(
                        '结余 ${entry.balanceAfterPoints}',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                      if (entry.creditBucket == 'trial')
                        Text(
                          '体验积分',
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(color: scheme.secondary),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 96),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.topRight,
                child: Text(
                  '${positive ? '+' : '-'}$amount',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: tone,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.4,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WalletEmpty extends StatelessWidget {
  const _WalletEmpty({
    required this.filtered,
    required this.hasMore,
    required this.onLoadMore,
  });

  final bool filtered;
  final bool hasMore;
  final Future<void> Function() onLoadMore;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.receipt_long_outlined,
              size: 42,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 12),
            Text(filtered ? '当前分类暂无记录' : '暂无余额变动记录'),
            if (hasMore) ...[
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: onLoadMore,
                child: const Text('加载更多记录'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _WalletLoadMore extends StatelessWidget {
  const _WalletLoadMore({
    required this.hasMore,
    required this.loading,
    required this.onLoadMore,
  });

  final bool hasMore;
  final bool loading;
  final Future<void> Function() onLoadMore;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      child: Center(
        child: hasMore
            ? TextButton.icon(
                onPressed: loading ? null : onLoadMore,
                icon: loading
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.expand_more),
                label: Text(loading ? '加载中' : '加载更多'),
              )
            : Text('已显示全部记录', style: Theme.of(context).textTheme.bodySmall),
      ),
    );
  }
}
