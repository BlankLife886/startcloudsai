import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/authenticated_image.dart';
import '../auth/auth.dart';
import '../discover/discover.dart';
import '../gallery/gallery.dart';
import 'task_deletion_ui.dart';
import 'task_sync.dart';
import 'tasks.dart';

class WorksScreen extends ConsumerStatefulWidget {
  const WorksScreen({super.key});

  @override
  ConsumerState<WorksScreen> createState() => _WorksScreenState();
}

class _WorksScreenState extends ConsumerState<WorksScreen> {
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();
  WorksTaskFilter _filter = WorksTaskFilter.all;
  String _typeFilter = '';
  String _query = '';
  String? _loadMoreError;
  bool _loadMoreInFlight = false;
  bool _searchingOlder = false;
  final Set<String> _removedTaskIds = {};
  final Set<String> _deletingTaskIds = {};

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_handleScroll);
  }

  void _handleScroll() {
    final taskCenter = ref.read(taskCenterControllerProvider).asData?.value;
    if (!_scrollController.hasClients ||
        _scrollController.position.extentAfter > 360 ||
        _scrollController.position.pixels <= 0 ||
        _loadMoreInFlight ||
        _loadMoreError != null ||
        taskCenter == null ||
        !taskCenter.hasMore ||
        taskCenter.isLoadingMore) {
      return;
    }
    unawaited(_loadMore(showErrorNotice: false));
  }

  Future<void> _refresh() async {
    if (_loadMoreError != null && mounted) {
      setState(() => _loadMoreError = null);
    }
    await Future.wait([
      ref.read(taskSyncControllerProvider.notifier).refreshNow(),
      ref.read(taskCenterControllerProvider.notifier).refresh(),
    ]);
  }

  Future<void> _loadMore({bool showErrorNotice = true}) async {
    if (_loadMoreInFlight) return;
    _loadMoreInFlight = true;
    if (_loadMoreError != null && mounted) {
      setState(() => _loadMoreError = null);
    }
    try {
      await ref.read(taskCenterControllerProvider.notifier).loadMore();
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException ? error.message : '更多作品加载失败，请稍后重试';
      setState(() => _loadMoreError = message);
      if (showErrorNotice) AppNotice.error(context, message);
    } finally {
      _loadMoreInFlight = false;
    }
  }

  Future<void> _findMatchingOlder() async {
    if (_searchingOlder || _loadMoreInFlight) return;
    final query = _query;
    final filter = _filter;
    final type = _typeFilter;
    final current = ref.read(taskCenterControllerProvider).asData?.value;
    if (current == null || !current.hasMore) return;
    final loadedMatches = filterTasksForWorks(
      current.items.where((item) => !_removedTaskIds.contains(item.id)),
      filter: filter,
      type: type,
      query: query,
    );
    if (loadedMatches.isNotEmpty) return;
    setState(() => _searchingOlder = true);
    try {
      for (var page = 0; page < 4; page += 1) {
        if (!mounted ||
            query != _query ||
            filter != _filter ||
            type != _typeFilter) {
          return;
        }
        final before = ref.read(taskCenterControllerProvider).asData?.value;
        if (before == null || !before.hasMore) return;
        await _loadMore();
        if (_loadMoreError != null) return;
        final after = ref.read(taskCenterControllerProvider).asData?.value;
        if (after == null) return;
        final matches = filterTasksForWorks(
          after.items.where((item) => !_removedTaskIds.contains(item.id)),
          filter: filter,
          type: type,
          query: query,
        );
        if (matches.isNotEmpty || !after.hasMore) return;
      }
    } finally {
      if (mounted) setState(() => _searchingOlder = false);
    }
  }

  Future<void> _delete(TaskItem task) async {
    try {
      final result = await runTaskDeletionFlow(
        context,
        task: task,
        onDelete: (cascade) => ref
            .read(taskRepositoryProvider)
            .deleteTask(task.id, cascade: cascade),
        onBusyChanged: (busy) {
          if (!mounted) return;
          setState(() {
            if (busy) {
              _deletingTaskIds.add(task.id);
            } else {
              _deletingTaskIds.remove(task.id);
            }
          });
        },
      );
      if (result == null || !mounted) return;
      _applyDeleted(result.deletedTaskIds);
      final count = result.deletedTaskIds.length;
      AppNotice.success(context, count > 1 ? '已删除 $count 件关联作品' : '作品已删除');
    } catch (error) {
      if (mounted) _showDeleteError(error);
    }
  }

  void _applyDeleted(Iterable<String> ids) {
    final deleted = ids.toSet();
    if (deleted.isEmpty) return;
    setState(() => _removedTaskIds.addAll(deleted));
    ref.read(taskCenterControllerProvider.notifier).removeIds(deleted);
    ref.invalidate(taskListProvider);
    ref.invalidate(myGallerySubmissionsProvider);
    ref.invalidate(gallerySubmissionSummaryProvider);
    ref.invalidate(discoverFeedProvider);
    ref.invalidate(discoverGalleryPageProvider);
    for (final id in deleted) {
      ref.invalidate(taskDetailProvider(id));
      ref.invalidate(gallerySubmissionForTaskProvider(id));
    }
  }

  void _showDeleteError(Object error) {
    final message = error is ApiException ? error.message : '作品删除失败，请稍后重试';
    AppNotice.error(context, message);
  }

  Future<void> _openTask(TaskItem task) async {
    final deleted = await context.push<List<String>>(
      '/works/${task.id}',
      extra: task,
    );
    if (deleted != null && mounted) _applyDeleted(deleted);
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_handleScroll)
      ..dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider);
    ref.listen<TaskSyncState>(taskSyncControllerProvider, (previous, next) {
      final task = next.lastTask;
      if (task == null ||
          (previous?.lastEventAt == next.lastEventAt &&
              previous?.lastTask?.status == task.status)) {
        return;
      }
      ref.read(taskCenterControllerProvider.notifier).upsert(task);
    });
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: const AppTopBar(
        title: Text('历史记录'),
        fallbackLocation: '/profile',
      ),
      body: session.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _SessionError(
          onRetry: () => ref.read(sessionControllerProvider.notifier).refresh(),
        ),
        data: (state) {
          if (!state.isAuthenticated) return const _LoginRequired();
          final tasks = ref.watch(taskCenterControllerProvider);
          return tasks.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, stackTrace) => _TaskError(
              error: error,
              onRetry: () =>
                  ref.read(taskCenterControllerProvider.notifier).refresh(),
            ),
            data: (taskCenter) {
              final visible = taskCenter.items
                  .where((item) => !_removedTaskIds.contains(item.id))
                  .toList();
              final filtered = filterTasksForWorks(
                visible,
                filter: _filter,
                type: _typeFilter,
                query: _query,
              );
              return RefreshIndicator(
                onRefresh: _refresh,
                child: CustomScrollView(
                  controller: _scrollController,
                  physics: const AlwaysScrollableScrollPhysics(),
                  slivers: [
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                      sliver: SliverToBoxAdapter(
                        child: TextField(
                          key: const Key('works-search'),
                          controller: _searchController,
                          textInputAction: TextInputAction.search,
                          decoration: InputDecoration(
                            hintText: '搜索提示词、模型',
                            prefixIcon: const Icon(
                              Icons.search_rounded,
                              size: 20,
                            ),
                            isDense: true,
                            suffixIcon: _query.isEmpty
                                ? null
                                : IconButton(
                                    key: const Key('works-search-clear'),
                                    tooltip: '清除搜索',
                                    onPressed: () {
                                      _searchController.clear();
                                      setState(() => _query = '');
                                    },
                                    icon: const Icon(
                                      Icons.close_rounded,
                                      size: 18,
                                    ),
                                  ),
                            filled: true,
                            fillColor: Theme.of(
                              context,
                            ).colorScheme.surfaceContainerLow,
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 10,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide.none,
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide.none,
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide.none,
                            ),
                          ),
                          onChanged: (value) => setState(() => _query = value),
                          onSubmitted: (_) {
                            FocusScope.of(context).unfocus();
                            unawaited(_findMatchingOlder());
                          },
                        ),
                      ),
                    ),
                    SliverToBoxAdapter(
                      child: _WorksFilterRow(
                        key: const Key('works-status-filters'),
                        children: [
                          for (final filter in WorksTaskFilter.values)
                            _WorksFilterChip(
                              key: Key('works-status-filter-${filter.label}'),
                              label: filter.label,
                              selected: _filter == filter,
                              onTap: () => setState(() => _filter = filter),
                            ),
                        ],
                      ),
                    ),
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: _WorksFilterRow(
                          key: const Key('works-type-filters'),
                          children: [
                            for (final filter in worksTypeFilters)
                              _WorksFilterChip(
                                key: Key('works-type-filter-${filter.label}'),
                                label: filter.label,
                                selected: _typeFilter == filter.id,
                                onTap: () =>
                                    setState(() => _typeFilter = filter.id),
                              ),
                          ],
                        ),
                      ),
                    ),
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
                      sliver: SliverToBoxAdapter(
                        child: _ResultSummary(
                          visibleCount: filtered.length,
                          loadedCount: visible.length,
                          hasMore: taskCenter.hasMore,
                        ),
                      ),
                    ),
                    if (filtered.isEmpty)
                      SliverFillRemaining(
                        hasScrollBody: false,
                        child: visible.isEmpty
                            ? _EmptyWorks(
                                hasMore: taskCenter.hasMore,
                                loading: taskCenter.isLoadingMore,
                                onLoadMore: _loadMore,
                              )
                            : _FilteredEmpty(
                                query: _query,
                                hasMore: taskCenter.hasMore,
                                loading:
                                    _searchingOlder || taskCenter.isLoadingMore,
                                onLoadMore: _findMatchingOlder,
                              ),
                      )
                    else ...[
                      for (final group in worksTimelineGroups(filtered)) ...[
                        SliverToBoxAdapter(
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
                            child: Text(
                              group.label,
                              style: Theme.of(context).textTheme.labelLarge
                                  ?.copyWith(
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.onSurfaceVariant,
                                    fontWeight: FontWeight.w700,
                                  ),
                            ),
                          ),
                        ),
                        SliverPadding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                          sliver: SliverMasonryGrid.count(
                            key: const Key('works-masonry'),
                            crossAxisCount: 2,
                            mainAxisSpacing: 10,
                            crossAxisSpacing: 10,
                            childCount: group.items.length,
                            itemBuilder: (context, index) {
                              final task = group.items[index];
                              return RepaintBoundary(
                                child: TaskCard(
                                  item: task,
                                  deleting: _deletingTaskIds.contains(task.id),
                                  onTap: () => _openTask(task),
                                  onDelete: task.canDelete
                                      ? () => _delete(task)
                                      : null,
                                ),
                              );
                            },
                          ),
                        ),
                      ],
                      SliverToBoxAdapter(
                        child: _LoadMoreWorks(
                          hasMore: taskCenter.hasMore,
                          loading: taskCenter.isLoadingMore,
                          errorMessage: _loadMoreError,
                          onLoadMore: _loadMore,
                        ),
                      ),
                    ],
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}

enum WorksTaskFilter { all, succeeded, running, queued, failed }

const worksTypeFilters = [(id: '', label: '全部'), (id: 't2i', label: '文生图')];

extension WorksTaskFilterLabel on WorksTaskFilter {
  String get label => switch (this) {
    WorksTaskFilter.all => '全部状态',
    WorksTaskFilter.succeeded => '已完成',
    WorksTaskFilter.running => '生成中',
    WorksTaskFilter.queued => '排队中',
    WorksTaskFilter.failed => '失败',
  };

  bool includes(TaskItem task) => switch (this) {
    WorksTaskFilter.all => true,
    WorksTaskFilter.succeeded => task.status == 'succeeded',
    WorksTaskFilter.running => task.status == 'running',
    WorksTaskFilter.queued => task.status == 'queued',
    WorksTaskFilter.failed => task.status == 'failed',
  };
}

String worksTaskTypeKey(TaskItem task) {
  if (task.isTextToImage) return 't2i';
  return task.type.toLowerCase().replaceAll('-', '_');
}

String worksTaskTypeLabel(TaskItem task) {
  return switch (worksTaskTypeKey(task)) {
    't2i' => '文生图',
    'coloring' => '插画染色',
    'ui_design' => 'UI 设计稿',
    'ecommerce_design' => 'AI 电商',
    'model_sheet' => '模型设计',
    'game_art' => '游戏设计',
    'puzzle' => '拼图',
    'background_remove' => '背景移除',
    'media_tool' => '媒体工具',
    _ => '创作',
  };
}

bool matchesWorksTypeFilter(TaskItem task, String type) {
  if (type.isEmpty) return true;
  return worksTaskTypeKey(task) == type;
}

double? _positiveRatio(double? width, double? height) {
  if (width == null || height == null || width <= 0 || height <= 0) return null;
  return (width / height).clamp(0.33, 3.0);
}

double worksTaskCoverAspect(TaskItem task) {
  for (final key in const ['requestedAspectRatio', 'aspectRatio']) {
    final raw = task.params[key]?.toString().trim() ?? '';
    if (raw.isEmpty || raw == 'auto') continue;
    final match = RegExp(
      r'^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$',
    ).firstMatch(raw);
    if (match == null) continue;
    final ratio = _positiveRatio(
      double.tryParse(match.group(1)!),
      double.tryParse(match.group(2)!),
    );
    if (ratio != null) return ratio;
  }
  for (final key in const ['size', 'outputSize']) {
    final raw = task.params[key]?.toString() ?? '';
    final match = RegExp(
      r'(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)',
    ).firstMatch(raw);
    if (match == null) continue;
    final ratio = _positiveRatio(
      double.tryParse(match.group(1)!),
      double.tryParse(match.group(2)!),
    );
    if (ratio != null) return ratio;
  }
  final ratio = _positiveRatio(
    (task.params['width'] as num?)?.toDouble(),
    (task.params['height'] as num?)?.toDouble(),
  );
  if (ratio != null) return ratio;
  if (task.status == 'failed' || task.status == 'canceled') return 1;
  return 4 / 5;
}

List<TaskItem> filterTasksForWorks(
  Iterable<TaskItem> items, {
  required WorksTaskFilter filter,
  String type = '',
  String query = '',
}) {
  final terms = query
      .trim()
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((term) => term.isNotEmpty)
      .toList();
  return items.where((task) {
    if (!filter.includes(task)) return false;
    if (!matchesWorksTypeFilter(task, type)) return false;
    if (terms.isEmpty) return true;
    final searchable = [
      task.displayPrompt,
      task.model,
      task.type,
      worksTaskTypeLabel(task),
    ].join(' ').toLowerCase();
    return terms.every(searchable.contains);
  }).toList();
}

class WorksTimelineItem {
  const WorksTimelineItem.header(this.label) : task = null;
  const WorksTimelineItem.entry(this.task) : label = null;

  final String? label;
  final TaskItem? task;
}

class WorksTimelineGroup {
  const WorksTimelineGroup({required this.label, required this.items});

  final String label;
  final List<TaskItem> items;
}

List<WorksTimelineGroup> worksTimelineGroups(List<TaskItem> items) {
  final groups = <WorksTimelineGroup>[];
  for (final row in worksTimeline(items)) {
    if (row.label != null) {
      groups.add(WorksTimelineGroup(label: row.label!, items: []));
    } else if (groups.isNotEmpty && row.task != null) {
      groups.last.items.add(row.task!);
    }
  }
  return [
    for (final group in groups)
      if (group.items.isNotEmpty) group,
  ];
}

List<WorksTimelineItem> worksTimeline(List<TaskItem> items) {
  final output = <WorksTimelineItem>[];
  String? previous;
  for (final task in items) {
    final date = task.createdAt;
    final key = date == null
        ? 'unknown'
        : DateFormat('yyyy-MM-dd').format(date);
    if (key != previous) {
      output.add(WorksTimelineItem.header(_worksDayLabel(date)));
      previous = key;
    }
    output.add(WorksTimelineItem.entry(task));
  }
  return output;
}

String _worksDayLabel(DateTime? date) {
  if (date == null) return '更早';
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final target = DateTime(date.year, date.month, date.day);
  final difference = today.difference(target).inDays;
  if (difference == 0) return '今天';
  if (difference == 1) return '昨天';
  return date.year == now.year
      ? DateFormat('M月d日').format(date)
      : DateFormat('yyyy年M月d日').format(date);
}

class _WorksFilterRow extends StatelessWidget {
  const _WorksFilterRow({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 36,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: children.length,
        separatorBuilder: (context, index) => const SizedBox(width: 8),
        itemBuilder: (context, index) => children[index],
      ),
    );
  }
}

class _WorksFilterChip extends StatelessWidget {
  const _WorksFilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: selected ? colors.onSurface : colors.surfaceContainerLow,
      shape: const StadiumBorder(),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: selected ? colors.surface : colors.onSurface,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _ResultSummary extends StatelessWidget {
  const _ResultSummary({
    required this.visibleCount,
    required this.loadedCount,
    required this.hasMore,
  });

  final int visibleCount;
  final int loadedCount;
  final bool hasMore;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            '已显示 $visibleCount / 已加载 $loadedCount',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ),
        if (hasMore)
          Text(
            '还有更多',
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
      ],
    );
  }
}

class TaskCard extends StatelessWidget {
  const TaskCard({
    required this.item,
    required this.onTap,
    this.onDelete,
    this.deleting = false,
    super.key,
  });

  final TaskItem item;
  final VoidCallback onTap;
  final VoidCallback? onDelete;
  final bool deleting;

  @override
  Widget build(BuildContext context) {
    final status = _status(item.status);
    final colors = Theme.of(context).colorScheme;
    final imageUrl = item.thumbnailUrl ?? item.originalUrl ?? '';
    final prompt = item.displayPrompt.trim();
    final time = item.createdAt == null
        ? ''
        : DateFormat('HH:mm').format(item.createdAt!);
    return Material(
      color: colors.surfaceContainerLow,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _WorksCover(
              item: item,
              imageUrl: imageUrl,
              statusLabel: status.label,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 4, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    prompt.isEmpty ? '未填写提示词' : prompt,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          time,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(color: colors.onSurfaceVariant),
                        ),
                      ),
                      if (onDelete != null)
                        SizedBox.square(
                          dimension: 28,
                          child: IconButton(
                            tooltip: '删除作品',
                            padding: EdgeInsets.zero,
                            visualDensity: VisualDensity.compact,
                            onPressed: deleting ? null : onDelete,
                            color: colors.error,
                            icon: deleting
                                ? const SizedBox.square(
                                    dimension: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.delete_outline, size: 16),
                          ),
                        ),
                    ],
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

class _WorksCover extends StatefulWidget {
  const _WorksCover({
    required this.item,
    required this.imageUrl,
    required this.statusLabel,
  });

  final TaskItem item;
  final String imageUrl;
  final String statusLabel;

  @override
  State<_WorksCover> createState() => _WorksCoverState();
}

class _WorksCoverState extends State<_WorksCover> {
  double? _decodedAspect;

  @override
  void didUpdateWidget(covariant _WorksCover oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imageUrl != widget.imageUrl) {
      _decodedAspect = null;
    }
  }

  void _rememberDecodedSize(Size size) {
    if (size.width <= 0 || size.height <= 0) return;
    final next = (size.width / size.height).clamp(0.33, 3.0);
    if (_decodedAspect != null && (next - _decodedAspect!).abs() < 0.01) {
      return;
    }
    setState(() => _decodedAspect = next);
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final colors = Theme.of(context).colorScheme;
    return AspectRatio(
      aspectRatio: _decodedAspect ?? worksTaskCoverAspect(item),
      child: ColoredBox(
        color: colors.surfaceContainerHigh,
        child: Stack(
          fit: StackFit.expand,
          children: [
            widget.imageUrl.isEmpty
                ? Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        item.status == 'failed'
                            ? Icons.close_rounded
                            : item.isActive
                            ? Icons.hourglass_top_rounded
                            : Icons.image_outlined,
                        size: 28,
                        color: colors.onSurfaceVariant,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        widget.statusLabel,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: colors.onSurfaceVariant,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  )
                : AuthenticatedImage(
                    url: widget.imageUrl,
                    fit: BoxFit.contain,
                    onDecoded: _rememberDecodedSize,
                  ),
            Positioned(
              left: 8,
              top: 8,
              child: _WorksCoverChip(label: worksTaskTypeLabel(item)),
            ),
            Positioned(
              right: 8,
              top: 8,
              child: _WorksCoverChip(label: widget.statusLabel),
            ),
            if (item.originalUrls.length > 1)
              Positioned(
                left: 8,
                bottom: 8,
                child: _WorksCoverChip(label: '${item.originalUrls.length} 张'),
              ),
            if (item.isActive)
              const Positioned(
                right: 8,
                bottom: 8,
                child: SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _WorksCoverChip extends StatelessWidget {
  const _WorksCoverChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: .55),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        child: Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 9,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _FilteredEmpty extends StatelessWidget {
  const _FilteredEmpty({
    required this.query,
    required this.hasMore,
    required this.loading,
    required this.onLoadMore,
  });

  final String query;
  final bool hasMore;
  final bool loading;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.filter_alt_off_outlined, size: 42),
            const SizedBox(height: 10),
            Text(
              query.trim().isEmpty ? '当前筛选暂无作品' : '没有匹配的作品',
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 5),
            Text(
              hasMore ? '还可以继续查找更早的历史记录' : '已查找全部历史记录',
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            if (hasMore) ...[
              const SizedBox(height: 14),
              OutlinedButton.icon(
                key: const Key('works-search-older'),
                onPressed: loading ? null : onLoadMore,
                icon: loading
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.manage_search_outlined),
                label: Text(loading ? '正在查找历史' : '查找更多历史'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

({String label, Color color}) _status(String value) => switch (value) {
  'queued' => (label: '排队中', color: const Color(0xFFD97706)),
  'running' => (label: '生成中', color: const Color(0xFF4F67D6)),
  'succeeded' => (label: '已完成', color: const Color(0xFF0F766E)),
  'failed' => (label: '失败', color: const Color(0xFFDC2626)),
  'canceled' => (label: '已取消', color: const Color(0xFF64748B)),
  _ => (label: value, color: const Color(0xFF64748B)),
};

class _LoginRequired extends StatelessWidget {
  const _LoginRequired();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.history, size: 48),
            const SizedBox(height: 14),
            Text(
              '登录后查看历史记录',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: () => context.push('/login'),
              icon: const Icon(Icons.login),
              label: const Text('登录'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyWorks extends StatelessWidget {
  const _EmptyWorks({
    required this.hasMore,
    required this.loading,
    required this.onLoadMore,
  });

  final bool hasMore;
  final bool loading;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.history_outlined, size: 48),
          const SizedBox(height: 12),
          const Text('还没有历史记录'),
          const SizedBox(height: 16),
          if (hasMore)
            OutlinedButton.icon(
              onPressed: loading ? null : onLoadMore,
              icon: loading
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.expand_more),
              label: Text(loading ? '正在加载' : '继续加载更多作品'),
            )
          else
            FilledButton.icon(
              onPressed: () => context.push('/create'),
              icon: const Icon(Icons.auto_awesome),
              label: const Text('开始创作'),
            ),
        ],
      ),
    );
  }
}

class _LoadMoreWorks extends StatelessWidget {
  const _LoadMoreWorks({
    required this.hasMore,
    required this.loading,
    required this.errorMessage,
    required this.onLoadMore,
  });

  final bool hasMore;
  final bool loading;
  final String? errorMessage;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final error = errorMessage?.trim();
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 30),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48),
        child: error?.isNotEmpty == true
            ? Semantics(
                liveRegion: true,
                child: Row(
                  key: const Key('works-load-more-error'),
                  children: [
                    Icon(Icons.error_outline, color: colors.error, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        error!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(
                          context,
                        ).textTheme.bodySmall?.copyWith(color: colors.error),
                      ),
                    ),
                    IconButton(
                      key: const Key('works-load-more-retry'),
                      tooltip: '重试加载作品',
                      onPressed: onLoadMore,
                      icon: const Icon(Icons.refresh),
                    ),
                  ],
                ),
              )
            : loading
            ? Semantics(
                liveRegion: true,
                label: '正在自动加载更多作品',
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: 10),
                    Text('正在自动加载更多作品'),
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
                    key: const Key('works-load-more'),
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
                  Text('已加载全部作品', style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
      ),
    );
  }
}

class _TaskError extends StatelessWidget {
  const _TaskError({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is ApiException
        ? (error as ApiException).message
        : '作品加载失败，请稍后重试';
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

class _SessionError extends StatelessWidget {
  const _SessionError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: OutlinedButton.icon(
        onPressed: onRetry,
        icon: const Icon(Icons.refresh),
        label: const Text('重新检查登录状态'),
      ),
    );
  }
}
