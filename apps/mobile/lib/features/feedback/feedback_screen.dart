import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../app/starclouds_theme.dart';
import '../../core/providers.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../profile/app_info.dart';
import '../profile/profile.dart';
import 'feedback.dart';
import '../../core/widgets/app_chrome.dart';

class FeedbackScreen extends ConsumerStatefulWidget {
  const FeedbackScreen({super.key});

  @override
  ConsumerState<FeedbackScreen> createState() => _FeedbackScreenState();
}

class _FeedbackScreenState extends ConsumerState<FeedbackScreen> {
  final _searchController = TextEditingController();
  final _scrollController = ScrollController();
  final Set<String> _knownAdoptedIds = {};
  FeedbackFilter _filter = FeedbackFilter.all;
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
    final state = ref.read(feedbackCenterControllerProvider).asData?.value;
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
    await ref.read(feedbackCenterControllerProvider.notifier).refresh();
  }

  Future<void> _loadMore({bool showErrorNotice = true}) async {
    if (_loadMoreInFlight) return;
    _loadMoreInFlight = true;
    if (_loadMoreError != null && mounted) {
      setState(() => _loadMoreError = null);
    }
    try {
      await ref.read(feedbackCenterControllerProvider.notifier).loadMore();
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException ? error.message : '更多反馈加载失败，请稍后重试';
      setState(() => _loadMoreError = message);
      if (showErrorNotice) AppNotice.error(context, message);
    } finally {
      _loadMoreInFlight = false;
    }
  }

  Future<void> _compose() async {
    final result = await showAppSheet<UserFeedbackItem>(
      context: context,
      isScrollControlled: true,
      builder: (context) => FeedbackComposerSheet(
        draftStore: ref.read(feedbackDraftStoreProvider),
        loadDiagnostics: () async {
          final info = await ref.read(appPackageInfoProvider.future);
          if (!mounted) return null;
          return supportDiagnosticText(
            info,
            ref.read(appEnvironmentProvider),
            Theme.of(this.context).platform,
          );
        },
        onSubmit: ({required category, required title, required content}) => ref
            .read(feedbackCenterControllerProvider.notifier)
            .submit(category: category, title: title, content: content),
      ),
    );
    if (result == null || !mounted) return;
    AppNotice.success(context, '反馈已提交，我们会尽快处理');
  }

  @override
  Widget build(BuildContext context) {
    final feedback = ref.watch(feedbackCenterControllerProvider);
    ref.listen<AsyncValue<FeedbackCenterState>>(
      feedbackCenterControllerProvider,
      (_, next) {
        final adopted = next.asData?.value.items
            .where((item) => item.adopted)
            .map((item) => item.id)
            .toSet();
        if (adopted == null) return;
        if (adopted.difference(_knownAdoptedIds).isNotEmpty) {
          ref.invalidate(walletProvider);
          ref.invalidate(profileOverviewProvider);
        }
        _knownAdoptedIds.addAll(adopted);
      },
    );
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('问题反馈'),
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
      body: feedback.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _FeedbackError(onRetry: _refresh),
        data: _buildContent,
      ),
    );
  }

  Widget _buildContent(FeedbackCenterState state) {
    final items = searchFeedbackItems(
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
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            sliver: SliverToBoxAdapter(child: FeedbackOverview(state: state)),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            sliver: SliverToBoxAdapter(
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _compose,
                  icon: const Icon(Icons.add_comment_outlined),
                  label: const Text('提交新反馈'),
                ),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: TextField(
                key: const Key('feedback-search'),
                controller: _searchController,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: '搜索标题、正文、分类或回复',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          key: const Key('feedback-search-clear'),
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
                  for (final filter in FeedbackFilter.values) ...[
                    if (filter != FeedbackFilter.values.first)
                      const SizedBox(width: 8),
                    _FeedbackFilterChip(
                      key: Key('feedback-filter-${filter.label}'),
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
              child: _FeedbackResultSummary(
                visible: items.length,
                loaded: state.items.length,
                hasMore: state.hasMore,
              ),
            ),
          ),
          if (items.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: _FeedbackEmpty(
                filtered:
                    state.items.isNotEmpty &&
                    (_filter != FeedbackFilter.all || _query.trim().isNotEmpty),
                searching: _query.trim().isNotEmpty,
                hasMore: state.hasMore,
                loading: state.isLoadingMore,
                errorMessage: _loadMoreError,
                onLoadMore: _loadMore,
              ),
            )
          else ...[
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverList.separated(
                itemCount: items.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) => FeedbackCard(
                  item: items[index],
                  onTap: () => showAppSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    builder: (context) =>
                        FeedbackDetailSheet(item: items[index]),
                  ),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: _FeedbackLoadMore(
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

enum FeedbackFilter { all, processing, finished, adopted }

extension FeedbackFilterPresentation on FeedbackFilter {
  String get label => switch (this) {
    FeedbackFilter.all => '全部',
    FeedbackFilter.processing => '处理中',
    FeedbackFilter.finished => '已完成',
    FeedbackFilter.adopted => '已采纳',
  };

  bool includes(UserFeedbackItem item) => switch (this) {
    FeedbackFilter.all => true,
    FeedbackFilter.processing => !item.isFinished,
    FeedbackFilter.finished => item.isFinished,
    FeedbackFilter.adopted => item.adopted,
  };
}

class FeedbackOverview extends StatelessWidget {
  const FeedbackOverview({required this.state, super.key});

  final FeedbackCenterState state;

  @override
  Widget build(BuildContext context) {
    return AppSoftCard(
      radius: StarCloudsRadii.card,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 14),
      child: Row(
        children: [
          _FeedbackMetric(
            label: state.hasMore ? '已加载' : '全部反馈',
            value: state.items.length,
          ),
          _FeedbackMetric(label: '处理中', value: state.openCount),
          _FeedbackMetric(label: '已完成', value: state.finishedCount),
          _FeedbackMetric(label: '已采纳', value: state.adoptedCount),
        ],
      ),
    );
  }
}

class _FeedbackFilterChip extends StatelessWidget {
  const _FeedbackFilterChip({
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
    return AppFilterChip(label: label, selected: selected, onTap: onTap);
  }
}

class _FeedbackResultSummary extends StatelessWidget {
  const _FeedbackResultSummary({
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

class _FeedbackMetric extends StatelessWidget {
  const _FeedbackMetric({required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Semantics(
        label: '$label $value',
        excludeSemantics: true,
        child: Column(
          children: [
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                '$value',
                maxLines: 1,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w900,
                  height: 1.1,
                ),
              ),
            ),
            const SizedBox(height: 5),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class FeedbackCard extends StatelessWidget {
  const FeedbackCard({required this.item, required this.onTap, super.key});

  final UserFeedbackItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = feedbackStatusStyle(context, item.status);
    return AppSoftCard(
      onTap: onTap,
      radius: StarCloudsRadii.card,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_categoryIcon(item.category), size: 19),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  item.category.label,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
              Icon(status.icon, size: 17, color: status.color),
              const SizedBox(width: 5),
              Text(
                status.label,
                style: TextStyle(
                  color: status.color,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            item.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 5),
          Text(
            item.content,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (item.adminReply?.isNotEmpty == true) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(
                  Icons.mark_chat_read_outlined,
                  size: 16,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 6),
                const Expanded(
                  child: Text(
                    '已有处理回复',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
                const Icon(Icons.chevron_right, size: 18),
              ],
            ),
          ],
          if (item.adopted) ...[
            const SizedBox(height: 9),
            Text(
              '建议已采纳 · +${item.rewardPoints} 积分',
              style: TextStyle(
                color: Theme.of(context).colorScheme.secondary,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
          const SizedBox(height: 9),
          Text(
            item.createdAt == null
                ? ''
                : DateFormat('yyyy-MM-dd HH:mm').format(item.createdAt!),
            style: Theme.of(context).textTheme.labelSmall,
          ),
        ],
      ),
    );
  }
}

class FeedbackDetailSheet extends StatelessWidget {
  const FeedbackDetailSheet({required this.item, super.key});

  final UserFeedbackItem item;

  @override
  Widget build(BuildContext context) {
    final status = feedbackStatusStyle(context, item.status);
    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    item.title,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                Icon(status.icon, color: status.color),
                const SizedBox(width: 6),
                Text(
                  status.label,
                  style: TextStyle(
                    color: status.color,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              item.category.label,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 18),
            Text(
              item.content,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(height: 1.5),
            ),
            const SizedBox(height: 22),
            FeedbackProgress(status: item.status),
            if (item.adminReply?.isNotEmpty == true) ...[
              const SizedBox(height: 22),
              Text(
                '处理回复',
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Text(
                    item.adminReply!,
                    style: const TextStyle(height: 1.5),
                  ),
                ),
              ),
            ],
            if (item.adopted) ...[
              const SizedBox(height: 16),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.secondaryContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      const Icon(Icons.workspace_premium_outlined),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          '产品建议已采纳，${item.rewardPoints} 积分奖励已到账。',
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class FeedbackProgress extends StatelessWidget {
  const FeedbackProgress({required this.status, super.key});

  final FeedbackStatus status;

  @override
  Widget build(BuildContext context) {
    final active = switch (status) {
      FeedbackStatus.open => 0,
      FeedbackStatus.inProgress => 1,
      FeedbackStatus.resolved || FeedbackStatus.closed => 2,
    };
    const labels = ['已提交', '处理中', '已完成'];
    return Row(
      children: [
        for (var index = 0; index < labels.length; index++) ...[
          Expanded(
            child: Column(
              children: [
                Icon(
                  index <= active
                      ? Icons.check_circle
                      : Icons.radio_button_unchecked,
                  color: index <= active
                      ? Theme.of(context).colorScheme.primary
                      : Theme.of(context).colorScheme.outline,
                ),
                const SizedBox(height: 5),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    labels[index],
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                ),
              ],
            ),
          ),
          if (index < labels.length - 1)
            Expanded(
              child: Divider(
                color: index < active
                    ? Theme.of(context).colorScheme.primary
                    : Theme.of(context).colorScheme.outlineVariant,
              ),
            ),
        ],
      ],
    );
  }
}

typedef FeedbackSubmitCallback =
    Future<UserFeedbackItem> Function({
      required FeedbackCategory category,
      required String title,
      required String content,
    });

typedef FeedbackDiagnosticsLoader = Future<String?> Function();

class FeedbackComposerSheet extends StatefulWidget {
  const FeedbackComposerSheet({
    required this.onSubmit,
    this.draftStore,
    this.loadDiagnostics,
    this.saveDelay = const Duration(milliseconds: 450),
    super.key,
  });

  final FeedbackSubmitCallback onSubmit;
  final FeedbackDraftStore? draftStore;
  final FeedbackDiagnosticsLoader? loadDiagnostics;
  final Duration saveDelay;

  @override
  State<FeedbackComposerSheet> createState() => _FeedbackComposerSheetState();
}

class _FeedbackComposerSheetState extends State<FeedbackComposerSheet> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _contentController = TextEditingController();
  FeedbackCategory _category = FeedbackCategory.bug;
  bool _submitting = false;
  bool _submitted = false;
  bool _edited = false;
  bool _saved = false;
  bool _restoring = false;
  bool _attachingDiagnostics = false;
  String? _error;
  Timer? _saveTimer;
  Future<void>? _pendingSave;

  @override
  void initState() {
    super.initState();
    _titleController.addListener(_onEdited);
    _contentController.addListener(_onEdited);
    unawaited(_restoreDraft());
  }

  void _onEdited() {
    if (_restoring) return;
    _edited = true;
    _scheduleSave();
  }

  Future<void> _restoreDraft() async {
    try {
      final draft = await widget.draftStore?.read();
      if (!mounted || draft == null || _edited) return;
      _restoring = true;
      try {
        _category = draft.category;
        _titleController.text = draft.title;
        _contentController.text = draft.content;
      } finally {
        _restoring = false;
      }
      _edited = false;
      setState(() => _saved = true);
    } catch (_) {}
  }

  void _scheduleSave() {
    _saveTimer?.cancel();
    if (_saved && mounted) setState(() => _saved = false);
    _saveTimer = Timer(widget.saveDelay, () {
      final pending = _persistDraft();
      _pendingSave = pending;
      unawaited(
        pending.whenComplete(() {
          if (identical(_pendingSave, pending)) _pendingSave = null;
        }),
      );
    });
  }

  Future<void> _persistDraft() async {
    try {
      final draft = FeedbackDraft(
        category: _category,
        title: _titleController.text,
        content: _contentController.text,
        updatedAt: DateTime.now(),
      );
      await widget.draftStore?.write(draft);
      if (mounted) setState(() => _saved = !draft.isEmpty);
    } catch (_) {}
  }

  Future<void> _attachDiagnostics() async {
    if (_attachingDiagnostics || _submitting) return;
    const marker = '诊断信息（不包含账号与创作内容）';
    if (_contentController.text.contains(marker)) {
      AppNotice.info(context, '诊断信息已经附加');
      return;
    }
    setState(() => _attachingDiagnostics = true);
    try {
      final diagnostics = (await widget.loadDiagnostics?.call())?.trim() ?? '';
      if (!mounted) return;
      if (diagnostics.isEmpty) {
        AppNotice.error(context, '诊断信息读取失败，请稍后重试');
        return;
      }
      final current = _contentController.text.trimRight();
      final separator = current.isEmpty ? '' : '\n\n';
      final combined = '$current$separator$marker\n$diagnostics';
      if (combined.runes.length > 3000) {
        AppNotice.warning(context, '正文空间不足，请精简描述后再附加');
        return;
      }
      _contentController.value = TextEditingValue(
        text: combined,
        selection: TextSelection.collapsed(offset: combined.length),
      );
      AppNotice.success(context, '诊断信息已附加，可在正文中查看');
    } catch (_) {
      if (mounted) AppNotice.error(context, '诊断信息读取失败，请稍后重试');
    } finally {
      if (mounted) setState(() => _attachingDiagnostics = false);
    }
  }

  @override
  void dispose() {
    _saveTimer?.cancel();
    if (_edited && !_submitted) unawaited(_persistDraft());
    _titleController.removeListener(_onEdited);
    _contentController.removeListener(_onEdited);
    _titleController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate() || _submitting) return;
    _saveTimer?.cancel();
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final item = await widget.onSubmit(
        category: _category,
        title: _titleController.text,
        content: _contentController.text,
      );
      _submitted = true;
      await _pendingSave;
      try {
        await widget.draftStore?.clear();
      } catch (_) {
        // Draft cleanup must not turn a successful server submission into an error.
      }
      if (mounted) Navigator.pop(context, item);
    } catch (error) {
      if (!mounted) return;
      setState(
        () => _error = error is ApiException ? error.message : '反馈提交失败，请稍后重试',
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 18 + keyboard),
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '提交反馈',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 5),
              Text(
                '描述遇到的问题或建议，处理进度会显示在反馈中心。',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 18),
              AppSelectField<FeedbackCategory>(
                label: '反馈类型',
                prefixIcon: Icons.category_outlined,
                value: _category,
                enabled: !_submitting,
                options: [
                  for (final item in FeedbackCategory.values)
                    AppSelectOption(value: item, label: item.label),
                ],
                onChanged: (value) {
                  if (value != null) {
                    setState(() {
                      _category = value;
                      _edited = true;
                    });
                    _scheduleSave();
                  }
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _titleController,
                maxLength: 120,
                textInputAction: TextInputAction.next,
                validator: validateFeedbackTitle,
                decoration: const InputDecoration(
                  labelText: '标题',
                  prefixIcon: Icon(Icons.title),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _contentController,
                minLines: 5,
                maxLines: 9,
                maxLength: 3000,
                validator: validateFeedbackContent,
                decoration: const InputDecoration(
                  labelText: '问题描述',
                  alignLabelWithHint: true,
                  prefixIcon: Padding(
                    padding: EdgeInsets.only(bottom: 96),
                    child: Icon(Icons.notes_outlined),
                  ),
                ),
              ),
              if (widget.loadDiagnostics != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    key: const Key('feedback-attach-diagnostics'),
                    onPressed: _attachingDiagnostics || _submitting
                        ? null
                        : _attachDiagnostics,
                    icon: _attachingDiagnostics
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.add_link_rounded, size: 19),
                    label: Text(_attachingDiagnostics ? '读取中' : '附加诊断信息'),
                  ),
                ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              AnimatedSize(
                duration: const Duration(milliseconds: 160),
                child: _saved
                    ? Row(
                        key: const Key('feedback-draft-saved'),
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.check_circle_outline_rounded,
                            size: 15,
                            color: Theme.of(
                              context,
                            ).colorScheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 5),
                          Text(
                            '草稿已自动保存',
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.onSurfaceVariant,
                                ),
                          ),
                        ],
                      )
                    : const SizedBox.shrink(),
              ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _submitting ? null : _submit,
                  icon: _submitting
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.send_outlined),
                  label: Text(_submitting ? '提交中' : '提交反馈'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

({String label, Color color, IconData icon}) feedbackStatusStyle(
  BuildContext context,
  FeedbackStatus status,
) => switch (status) {
  FeedbackStatus.open => (
    label: '待处理',
    color: Theme.of(context).colorScheme.tertiary,
    icon: Icons.schedule,
  ),
  FeedbackStatus.inProgress => (
    label: '处理中',
    color: Theme.of(context).colorScheme.primary,
    icon: Icons.pending_actions,
  ),
  FeedbackStatus.resolved => (
    label: '已解决',
    color: Theme.of(context).colorScheme.secondary,
    icon: Icons.task_alt,
  ),
  FeedbackStatus.closed => (
    label: '已关闭',
    color: Theme.of(context).colorScheme.outline,
    icon: Icons.cancel_outlined,
  ),
};

IconData _categoryIcon(FeedbackCategory category) => switch (category) {
  FeedbackCategory.bug => Icons.bug_report_outlined,
  FeedbackCategory.generation => Icons.auto_awesome_outlined,
  FeedbackCategory.account => Icons.person_outline,
  FeedbackCategory.billing => Icons.receipt_long_outlined,
  FeedbackCategory.suggestion => Icons.lightbulb_outline,
  FeedbackCategory.other => Icons.chat_bubble_outline,
};

class _FeedbackEmpty extends StatelessWidget {
  const _FeedbackEmpty({
    required this.filtered,
    required this.searching,
    required this.hasMore,
    required this.loading,
    required this.errorMessage,
    required this.onLoadMore,
  });
  final bool filtered;
  final bool searching;
  final bool hasMore;
  final bool loading;
  final String? errorMessage;
  final Future<void> Function() onLoadMore;
  @override
  Widget build(BuildContext context) {
    final error = errorMessage?.trim();
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(searching ? Icons.search_off : Icons.forum_outlined, size: 44),
            const SizedBox(height: 12),
            Text(
              searching
                  ? '没有匹配的反馈'
                  : filtered
                  ? '当前筛选暂无反馈'
                  : '还没有反馈记录',
            ),
            if (error?.isNotEmpty == true) ...[
              const SizedBox(height: 14),
              _FeedbackPaginationError(message: error!, onRetry: onLoadMore),
            ] else if (hasMore) ...[
              const SizedBox(height: 14),
              OutlinedButton.icon(
                onPressed: loading ? null : onLoadMore,
                icon: loading
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.expand_more),
                label: Text(loading ? '正在加载' : '继续加载更多反馈'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _FeedbackLoadMore extends StatelessWidget {
  const _FeedbackLoadMore({
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
            ? _FeedbackPaginationError(message: error!, onRetry: onLoadMore)
            : loading
            ? Semantics(
                liveRegion: true,
                label: '正在自动加载更多反馈',
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: 10),
                    Text('正在自动加载更多反馈'),
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
                    key: const Key('feedback-load-more'),
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
                  Text('已显示全部反馈', style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
      ),
    );
  }
}

class _FeedbackPaginationError extends StatelessWidget {
  const _FeedbackPaginationError({
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
        key: const Key('feedback-load-more-error'),
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
            key: const Key('feedback-load-more-retry'),
            tooltip: '重试加载反馈',
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
    );
  }
}

class _FeedbackError extends StatelessWidget {
  const _FeedbackError({required this.onRetry});
  final Future<void> Function() onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: OutlinedButton.icon(
      onPressed: onRetry,
      icon: const Icon(Icons.refresh),
      label: const Text('重新加载反馈'),
    ),
  );
}
