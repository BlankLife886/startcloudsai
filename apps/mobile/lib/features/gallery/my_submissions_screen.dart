import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/authenticated_image.dart';
import '../discover/discover.dart';
import 'gallery.dart';
import 'gallery_submission_ui.dart';
import '../../core/widgets/app_chrome.dart';

class MySubmissionsScreen extends ConsumerStatefulWidget {
  const MySubmissionsScreen({super.key});

  @override
  ConsumerState<MySubmissionsScreen> createState() =>
      _MySubmissionsScreenState();
}

class _MySubmissionsScreenState extends ConsumerState<MySubmissionsScreen> {
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();
  _SubmissionFilter _filter = _SubmissionFilter.all;
  String _query = '';
  String? _loadMoreError;
  bool _loadMoreInFlight = false;
  String? _deletingId;

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
    final state = ref
        .read(myGallerySubmissionsControllerProvider)
        .asData
        ?.value;
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

  Future<void> _loadMore({bool showErrorNotice = true}) async {
    if (_loadMoreInFlight) return;
    _loadMoreInFlight = true;
    if (_loadMoreError != null && mounted) {
      setState(() => _loadMoreError = null);
    }
    try {
      await ref
          .read(myGallerySubmissionsControllerProvider.notifier)
          .loadMore();
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException ? error.message : '更多投稿加载失败，请稍后重试';
      setState(() => _loadMoreError = message);
      if (showErrorNotice) AppNotice.error(context, message);
    } finally {
      _loadMoreInFlight = false;
    }
  }

  Future<void> _refresh() async {
    if (_loadMoreError != null && mounted) {
      setState(() => _loadMoreError = null);
    }
    await ref.read(myGallerySubmissionsControllerProvider.notifier).refresh();
    ref.invalidate(myGallerySubmissionsProvider);
    ref.invalidate(gallerySubmissionSummaryProvider);
    ref.invalidate(gallerySubmissionForTaskProvider);
  }

  void _showError(Object error) {
    final message = error is ApiException ? error.message : '投稿加载失败，请稍后重试';
    AppNotice.error(context, message);
  }

  Future<void> _delete(GallerySubmission submission) async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.delete_outline),
        title: const Text('撤回这次投稿？'),
        content: const Text('作品将从社区移除，之后仍可从作品详情重新投稿。'),
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
            child: const Text('确认撤回'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _deletingId = submission.id);
    try {
      await ref.read(galleryRepositoryProvider).delete(submission.id);
      ref
          .read(myGallerySubmissionsControllerProvider.notifier)
          .removeLocal(submission.id);
      ref.invalidate(myGallerySubmissionsProvider);
      ref.invalidate(gallerySubmissionSummaryProvider);
      ref.invalidate(gallerySubmissionForTaskProvider(submission.taskId));
      ref.invalidate(discoverFeedProvider);
      ref.invalidate(discoverGalleryPageProvider);
      if (!mounted) return;
      AppNotice.success(context, '投稿已撤回');
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _deletingId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final submissions = ref.watch(myGallerySubmissionsControllerProvider);
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('我的投稿'),
        fallbackLocation: '/profile',
        actions: [
          IconButton(
            tooltip: '刷新',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: submissions.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) =>
            _SubmissionError(error: error, onRetry: _refresh),
        data: _buildList,
      ),
    );
  }

  Widget _buildList(MyGallerySubmissionsState state) {
    final filtered = searchGallerySubmissions(
      state.items.where(_filter.includes),
      _query,
    );
    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
            sliver: SliverToBoxAdapter(
              child: _SubmissionOverview(summary: state.summary),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: TextField(
                key: const Key('submission-search'),
                controller: _searchController,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: '搜索标题、审核状态或驳回原因',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          key: const Key('submission-search-clear'),
                          tooltip: '清除搜索',
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _query = '');
                          },
                          icon: const Icon(Icons.close),
                        ),
                  filled: true,
                  fillColor: Theme.of(context).colorScheme.surfaceContainerLow,
                ),
                onChanged: (value) => setState(() => _query = value),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: SegmentedButton<_SubmissionFilter>(
                segments: _SubmissionFilter.values
                    .map(
                      (filter) => ButtonSegment<_SubmissionFilter>(
                        value: filter,
                        label: Text(filter.label),
                      ),
                    )
                    .toList(),
                selected: {_filter},
                showSelectedIcon: false,
                style: const ButtonStyle(visualDensity: VisualDensity.compact),
                onSelectionChanged: (selection) =>
                    setState(() => _filter = selection.first),
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            sliver: SliverToBoxAdapter(
              child: _SubmissionResultSummary(
                visible: filtered.length,
                loaded: state.items.length,
                hasMore: state.hasMore,
              ),
            ),
          ),
          if (filtered.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: _SubmissionEmpty(
                hasAny: state.items.isNotEmpty,
                hasMore: state.hasMore,
                filter: _filter,
                query: _query,
                loading: state.isLoadingMore,
                errorMessage: _loadMoreError,
                onLoadMore: _loadMore,
              ),
            )
          else ...[
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverList.separated(
                itemCount: filtered.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final submission = filtered[index];
                  return GallerySubmissionCard(
                    submission: submission,
                    deleting: _deletingId == submission.id,
                    onTap: () => context.push('/works/${submission.taskId}'),
                    onDelete: () => _delete(submission),
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

enum _SubmissionFilter { all, pending, approved, attention }

extension on _SubmissionFilter {
  String get label => switch (this) {
    _SubmissionFilter.all => '全部',
    _SubmissionFilter.pending => '审核中',
    _SubmissionFilter.approved => '已发布',
    _SubmissionFilter.attention => '需处理',
  };

  bool includes(GallerySubmission submission) => switch (this) {
    _SubmissionFilter.all => true,
    _SubmissionFilter.pending => submission.status == 'pending',
    _SubmissionFilter.approved => submission.status == 'approved',
    _SubmissionFilter.attention =>
      submission.status == 'rejected' || submission.status == 'removed',
  };
}

class _SubmissionOverview extends StatelessWidget {
  const _SubmissionOverview({required this.summary});

  final GallerySubmissionSummary summary;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border.all(color: colors.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        child: Row(
          children: [
            _SummaryMetric(
              label: '已加载',
              value: summary.total,
              color: colors.primary,
            ),
            _SummaryMetric(
              label: '审核中',
              value: summary.pending,
              color: const Color(0xFFD97706),
            ),
            _SummaryMetric(
              label: '已发布',
              value: summary.approved,
              color: const Color(0xFF0F766E),
            ),
            _SummaryMetric(
              label: '需处理',
              value: summary.needsAttention,
              color: colors.error,
            ),
          ],
        ),
      ),
    );
  }
}

class _SubmissionResultSummary extends StatelessWidget {
  const _SubmissionResultSummary({
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

class _SummaryMetric extends StatelessWidget {
  const _SummaryMetric({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final int value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            '$value',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              color: color,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 2),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class GallerySubmissionCard extends StatelessWidget {
  const GallerySubmissionCard({
    required this.submission,
    required this.onTap,
    required this.onDelete,
    this.deleting = false,
    super.key,
  });

  final GallerySubmission submission;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final bool deleting;

  @override
  Widget build(BuildContext context) {
    final style = gallerySubmissionStyle(submission.status);
    final cardHeight = MediaQuery.textScalerOf(
      context,
    ).scale(128).clamp(128.0, 230.0);
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: colors.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: cardHeight,
          child: Row(
            children: [
              SizedBox(
                width: 108,
                height: double.infinity,
                child: submission.coverUrl?.isNotEmpty == true
                    ? AuthenticatedImage(
                        url: submission.coverUrl!,
                        fit: BoxFit.cover,
                      )
                    : ColoredBox(
                        color: Theme.of(
                          context,
                        ).colorScheme.surfaceContainerHighest,
                        child: const Icon(Icons.image_outlined),
                      ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            style.buttonLabel,
                            style: TextStyle(
                              color: style.color,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const Spacer(),
                          IconButton(
                            tooltip: '撤回投稿',
                            visualDensity: VisualDensity.compact,
                            onPressed: deleting ? null : onDelete,
                            icon: deleting
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.delete_outline, size: 20),
                          ),
                        ],
                      ),
                      Text(
                        submission.title.isEmpty ? '未命名作品' : submission.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const Spacer(),
                      if (submission.rejectReason?.isNotEmpty == true)
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                submission.rejectReason!,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: colors.error,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            IconButton(
                              key: Key(
                                'copy-submission-review-${submission.id}',
                              ),
                              tooltip: '复制审核意见',
                              constraints: const BoxConstraints.tightFor(
                                width: 40,
                                height: 40,
                              ),
                              visualDensity: VisualDensity.compact,
                              onPressed: () async {
                                await Clipboard.setData(
                                  ClipboardData(text: submission.rejectReason!),
                                );
                                if (!context.mounted) return;
                                AppNotice.success(context, '审核意见已复制');
                              },
                              icon: const Icon(Icons.copy_outlined, size: 17),
                            ),
                          ],
                        )
                      else
                        Text(
                          submission.createdAt == null
                              ? '查看作品详情'
                              : DateFormat(
                                  'yyyy-MM-dd HH:mm',
                                ).format(submission.createdAt!),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
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
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 30),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 52),
        child: error?.isNotEmpty == true
            ? _SubmissionPaginationError(message: error!, onRetry: onLoadMore)
            : loading
            ? Semantics(
                liveRegion: true,
                label: '正在自动加载更多投稿',
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: 10),
                    Text('正在自动加载更多投稿'),
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
                    key: const Key('submission-load-more'),
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
                  Text('已加载全部投稿', style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
      ),
    );
  }
}

class _SubmissionEmpty extends StatelessWidget {
  const _SubmissionEmpty({
    required this.hasAny,
    required this.hasMore,
    required this.filter,
    required this.query,
    required this.loading,
    required this.errorMessage,
    required this.onLoadMore,
  });

  final bool hasAny;
  final bool hasMore;
  final _SubmissionFilter filter;
  final String query;
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
                  : hasAny
                  ? Icons.filter_alt_off_outlined
                  : Icons.public_outlined,
              size: 46,
            ),
            const SizedBox(height: 12),
            Text(
              searching
                  ? '没有匹配的投稿'
                  : hasAny
                  ? '${filter.label}暂无投稿'
                  : '还没有社区投稿',
            ),
            if (error?.isNotEmpty == true) ...[
              const SizedBox(height: 14),
              _SubmissionPaginationError(message: error!, onRetry: onLoadMore),
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
                label: Text(loading ? '正在加载' : '继续加载更多投稿'),
              ),
            ] else if (!hasAny) ...[
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () => context.push('/create'),
                icon: const Icon(Icons.auto_awesome),
                label: const Text('创作一件作品'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SubmissionPaginationError extends StatelessWidget {
  const _SubmissionPaginationError({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      child: Row(
        key: const Key('submission-load-more-error'),
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
            key: const Key('submission-load-more-retry'),
            tooltip: '重试加载投稿',
            onPressed: () {
              unawaited(onRetry());
            },
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
    );
  }
}

class _SubmissionError extends StatelessWidget {
  const _SubmissionError({required this.error, required this.onRetry});

  final Object error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is ApiException
        ? (error as ApiException).message
        : '投稿记录加载失败';
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
