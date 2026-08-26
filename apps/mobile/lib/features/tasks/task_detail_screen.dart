import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gal/gal.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/network/api_exception.dart';
import '../../app/starclouds_theme.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/authenticated_image.dart';
import '../create/create.dart';
import '../discover/discover.dart';
import '../gallery/gallery.dart';
import '../gallery/gallery_submission_ui.dart';
import '../profile/profile.dart';
import 'task_deletion_ui.dart';
import 'tasks.dart';
import '../../core/widgets/app_chrome.dart';

class TaskDetailScreen extends ConsumerStatefulWidget {
  const TaskDetailScreen({required this.taskId, super.key});

  final String taskId;

  @override
  ConsumerState<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends ConsumerState<TaskDetailScreen>
    with WidgetsBindingObserver {
  final _pageController = PageController();
  Timer? _pollTimer;
  int _pageIndex = 0;
  bool _resumed = true;
  _TaskAction? _busyAction;

  bool get _busy => _busyAction != null;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (_) => _poll());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _pageController.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _resumed = state == AppLifecycleState.resumed;
    if (_resumed) {
      ref.invalidate(taskDetailProvider(widget.taskId));
      ref.invalidate(myGallerySubmissionsProvider);
      ref.invalidate(gallerySubmissionForTaskProvider(widget.taskId));
    }
  }

  void _poll() {
    if (!_resumed || !mounted) return;
    final task = ref.read(taskDetailProvider(widget.taskId)).asData?.value;
    if (task?.isActive == true) {
      ref.invalidate(taskDetailProvider(widget.taskId));
    }
  }

  void _showError(Object error) {
    final message = error is ApiException
        ? error.message
        : error is FormatException
        ? error.message
        : error is GalException
        ? _galleryError(error)
        : '操作失败，请稍后重试';
    AppNotice.error(context, message);
  }

  Future<void> _cancel(TaskItem task) async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        title: const Text('停止生成？'),
        content: const Text('已提交给模型的任务可能仍会按实际用量结算。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('继续等待'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('停止任务'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busyAction = _TaskAction.cancel);
    try {
      await ref.read(taskRepositoryProvider).cancel(task.id);
      ref.invalidate(taskDetailProvider(task.id));
      ref.invalidate(taskListProvider);
      ref.invalidate(taskCenterControllerProvider);
      ref.invalidate(profileOverviewProvider);
      ref.invalidate(walletProvider);
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _busyAction = null);
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
          if (mounted) {
            setState(() => _busyAction = busy ? _TaskAction.deleteTask : null);
          }
        },
      );
      if (result == null || !mounted) return;
      ref.invalidate(taskListProvider);
      ref.invalidate(taskCenterControllerProvider);
      ref.invalidate(profileOverviewProvider);
      ref.invalidate(myGallerySubmissionsProvider);
      ref.invalidate(gallerySubmissionSummaryProvider);
      ref.invalidate(discoverFeedProvider);
      ref.invalidate(discoverGalleryPageProvider);
      for (final id in result.deletedTaskIds) {
        ref.invalidate(gallerySubmissionForTaskProvider(id));
      }
      final count = result.deletedTaskIds.length;
      AppNotice.success(context, count > 1 ? '已删除 $count 件关联作品' : '作品已删除');
      context.pop(result.deletedTaskIds);
    } catch (error) {
      if (mounted) _showError(error);
    }
  }

  Future<void> _save(TaskItem task) async {
    setState(() => _busyAction = _TaskAction.save);
    try {
      final file = await ref
          .read(taskRepositoryProvider)
          .downloadOriginal(task, _safeIndex(task));
      await Gal.putImage(file.path);
      if (!mounted) return;
      AppNotice.success(context, '已保存到系统相册');
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  Future<void> _share(TaskItem task, BuildContext buttonContext) async {
    final box = buttonContext.findRenderObject() as RenderBox?;
    final origin = box == null
        ? null
        : box.localToGlobal(Offset.zero) & box.size;
    setState(() => _busyAction = _TaskAction.share);
    try {
      final file = await ref
          .read(taskRepositoryProvider)
          .downloadOriginal(task, _safeIndex(task));
      if (!mounted) return;
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile(file.path)],
          text: task.prompt.isEmpty ? '星空云绘作品' : task.prompt,
          title: '分享作品',
          sharePositionOrigin: origin,
        ),
      );
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  Future<void> _submitToGallery(TaskItem task) async {
    setState(() => _busyAction = _TaskAction.submit);
    late List<GalleryCategory> categories;
    try {
      categories = await ref.read(galleryCategoriesProvider.future);
    } catch (error) {
      if (mounted) _showError(error);
      return;
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
    if (!mounted) return;
    final draft = await showGallerySubmissionSheet(
      context,
      previewUrl: task.previewUrls.firstOrNull ?? '',
      initialTitle: defaultGalleryTitle(task.prompt),
      categories: categories,
    );
    if (draft == null || !mounted) return;
    setState(() => _busyAction = _TaskAction.submit);
    try {
      final submission = await ref
          .read(galleryRepositoryProvider)
          .submit(
            taskId: task.id,
            title: draft.title,
            categoryId: draft.categoryId,
          );
      _refreshSubmission(task.id);
      if (!mounted) return;
      final message = submission.isApproved ? '投稿成功，作品已发布到社区' : '投稿成功，正在等待审核';
      AppNotice.success(context, message);
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  Future<void> _openSubmissionStatus(GallerySubmission submission) async {
    final style = gallerySubmissionStyle(submission.status);
    final withdraw = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: Icon(style.icon, color: style.color),
        title: Text(style.panelLabel),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (submission.title.isNotEmpty) Text(submission.title),
            if (submission.rejectReason?.isNotEmpty == true) ...[
              const SizedBox(height: 12),
              Text(
                submission.rejectReason!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 12),
            Text(
              '撤回后作品将从社区移除，之后可以重新投稿。',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('关闭'),
          ),
          TextButton(
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('撤回投稿'),
          ),
        ],
      ),
    );
    if (withdraw != true || !mounted) return;
    setState(() => _busyAction = _TaskAction.deleteSubmission);
    try {
      await ref.read(galleryRepositoryProvider).delete(submission.id);
      _refreshSubmission(submission.taskId);
      if (!mounted) return;
      AppNotice.success(context, '投稿已撤回');
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  void _refreshSubmission(String taskId) {
    ref.invalidate(myGallerySubmissionsProvider);
    ref.invalidate(gallerySubmissionSummaryProvider);
    ref.invalidate(gallerySubmissionForTaskProvider(taskId));
    ref.invalidate(discoverFeedProvider);
    ref.invalidate(discoverGalleryPageProvider);
  }

  int _safeIndex(TaskItem task) {
    if (task.originalUrls.isEmpty) return 0;
    return _pageIndex.clamp(0, task.originalUrls.length - 1);
  }

  Future<void> _openFullscreen(TaskItem task) async {
    final urls = task.previewUrls;
    if (urls.isEmpty) return;
    await showDialog<void>(
      context: context,
      useSafeArea: false,
      builder: (context) => Dialog.fullscreen(
        backgroundColor: Colors.black,
        child: SafeArea(
          child: Stack(
            children: [
              Positioned.fill(
                child: InteractiveViewer(
                  minScale: 0.5,
                  maxScale: 5,
                  child: Center(
                    child: AuthenticatedImage(
                      url: urls[_pageIndex.clamp(0, urls.length - 1)],
                      fit: BoxFit.contain,
                    ),
                  ),
                ),
              ),
              Positioned(
                right: 12,
                top: 8,
                child: IconButton.filled(
                  tooltip: '关闭预览',
                  onPressed: () => Navigator.pop(context),
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.black54,
                    foregroundColor: Colors.white,
                  ),
                  icon: const Icon(Icons.close),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final detail = ref.watch(taskDetailProvider(widget.taskId));
    final submission = ref.watch(
      gallerySubmissionForTaskProvider(widget.taskId),
    );
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('作品详情'),
        fallbackLocation: '/works',
        actions: [
          if (detail.asData?.value.canDelete == true)
            IconButton(
              tooltip: '删除作品',
              onPressed: _busy ? null : () => _delete(detail.requireValue),
              color: Theme.of(context).colorScheme.error,
              icon: _busyAction == _TaskAction.deleteTask
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.delete_outline),
            ),
          IconButton(
            tooltip: '刷新',
            onPressed: () {
              ref.invalidate(taskDetailProvider(widget.taskId));
              ref.invalidate(myGallerySubmissionsProvider);
              ref.invalidate(gallerySubmissionForTaskProvider(widget.taskId));
            },
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: detail.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Center(
          child: OutlinedButton.icon(
            onPressed: () => ref.invalidate(taskDetailProvider(widget.taskId)),
            icon: const Icon(Icons.refresh),
            label: const Text('重新加载'),
          ),
        ),
        data: (task) => _buildContent(task, submission),
      ),
      bottomNavigationBar: detail.asData == null
          ? null
          : _buildActions(detail.requireValue, submission),
    );
  }

  Widget _buildContent(
    TaskItem task,
    AsyncValue<GallerySubmission?> submissionState,
  ) {
    final status = task.hasDeletedOutputs
        ? (label: '文件已移除', color: const Color(0xFF64748B))
        : _taskStatus(task.status);
    final urls = task.previewUrls;
    final submission = submissionState.asData?.value;
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        if (urls.isNotEmpty)
          AspectRatio(
            aspectRatio: 1,
            child: Stack(
              children: [
                PageView.builder(
                  controller: _pageController,
                  itemCount: urls.length,
                  onPageChanged: (index) => setState(() => _pageIndex = index),
                  itemBuilder: (context, index) => ColoredBox(
                    color: Colors.black,
                    child: AuthenticatedImage(
                      url: urls[index],
                      fit: BoxFit.contain,
                    ),
                  ),
                ),
                Positioned(
                  right: 12,
                  top: 12,
                  child: IconButton.filled(
                    tooltip: '全屏预览',
                    onPressed: () => _openFullscreen(task),
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.black54,
                      foregroundColor: Colors.white,
                    ),
                    icon: const Icon(Icons.fullscreen),
                  ),
                ),
                if (urls.length > 1)
                  Positioned(
                    right: 12,
                    bottom: 12,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        '${_pageIndex + 1}/${urls.length}',
                        style: const TextStyle(color: Colors.white),
                      ),
                    ),
                  ),
              ],
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: _TaskOutputPlaceholder(
              task: task,
              onRefresh: taskOutputState(task) == TaskOutputState.missing
                  ? () => ref.invalidate(taskDetailProvider(widget.taskId))
                  : null,
              onRecreate: task.isActive
                  ? null
                  : () => context.go(taskRecreationAction(task).location),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 18, 16, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: status.color.withValues(alpha: 0.13),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      status.label,
                      style: TextStyle(
                        color: status.color,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const Spacer(),
                  if (task.costPoints > 0) Text('${task.costPoints} 积分'),
                ],
              ),
              const SizedBox(height: 18),
              Text(
                task.displayPrompt.isEmpty ? '图片创作' : task.displayPrompt,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  height: 1.5,
                ),
              ),
              if (urls.isNotEmpty && task.errorMessage?.isNotEmpty == true) ...[
                const SizedBox(height: 14),
                Text(
                  task.errorMessage!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              if (submission != null) ...[
                const SizedBox(height: 18),
                GallerySubmissionStatusPanel(submission: submission),
              ],
              const SizedBox(height: 22),
              _InfoRow(label: '模型', value: _modelLabel(task)),
              _InfoRow(
                label: '创建时间',
                value: task.createdAt == null
                    ? '-'
                    : DateFormat('yyyy-MM-dd HH:mm').format(task.createdAt!),
              ),
              if (task.duration != null)
                _InfoRow(label: '生成耗时', value: _durationLabel(task.duration!)),
              if (task.inputKeys.isNotEmpty)
                _InfoRow(label: '参考图', value: '${task.inputKeys.length} 张'),
              if (urls.isNotEmpty) ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () {
                    context.go(taskRecreationAction(task).location);
                  },
                  icon: const Icon(Icons.replay),
                  label: Text(taskRecreationAction(task).label),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget? _buildActions(
    TaskItem task,
    AsyncValue<GallerySubmission?> submissionState,
  ) {
    if (!task.canCancel && (!task.isSucceeded || task.previewUrls.isEmpty)) {
      return null;
    }
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
        child: task.canCancel
            ? FilledButton.icon(
                onPressed: _busy ? null : () => _cancel(task),
                icon: _busy
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.stop_circle_outlined),
                label: const Text('停止生成'),
              )
            : LayoutBuilder(
                builder: (context, constraints) {
                  final textScale = MediaQuery.textScalerOf(context).scale(1);
                  final compact = constraints.maxWidth < 400 || textScale > 1.2;
                  final save = OutlinedButton.icon(
                    onPressed: _busy ? null : () => _save(task),
                    icon: _busyAction == _TaskAction.save
                        ? const _ButtonProgress()
                        : const Icon(Icons.download_outlined),
                    label: const Text('保存'),
                  );
                  final share = Builder(
                    builder: (buttonContext) => OutlinedButton.icon(
                      onPressed: _busy
                          ? null
                          : () => _share(task, buttonContext),
                      icon: _busyAction == _TaskAction.share
                          ? const _ButtonProgress()
                          : const Icon(Icons.share_outlined),
                      label: const Text('分享'),
                    ),
                  );
                  final submit = _buildSubmissionAction(task, submissionState);
                  if (!compact) {
                    return Row(
                      children: [
                        Expanded(child: save),
                        const SizedBox(width: 8),
                        Expanded(child: share),
                        const SizedBox(width: 8),
                        Expanded(child: submit),
                      ],
                    );
                  }
                  final halfWidth = (constraints.maxWidth - 8) / 2;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      submit,
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          SizedBox(width: halfWidth, child: save),
                          const SizedBox(width: 8),
                          SizedBox(width: halfWidth, child: share),
                        ],
                      ),
                    ],
                  );
                },
              ),
      ),
    );
  }

  Widget _buildSubmissionAction(
    TaskItem task,
    AsyncValue<GallerySubmission?> submissionState,
  ) {
    if (_busyAction == _TaskAction.submit ||
        _busyAction == _TaskAction.deleteSubmission) {
      return FilledButton.icon(
        onPressed: null,
        icon: const _ButtonProgress(),
        label: const Text('投稿'),
      );
    }
    return submissionState.when(
      loading: () => OutlinedButton.icon(
        onPressed: null,
        icon: const _ButtonProgress(),
        label: const Text('投稿'),
      ),
      error: (error, stackTrace) => OutlinedButton.icon(
        onPressed: _busy
            ? null
            : () => ref.invalidate(gallerySubmissionForTaskProvider(task.id)),
        icon: const Icon(Icons.refresh),
        label: const Text('重试'),
      ),
      data: (submission) {
        if (submission == null) {
          return FilledButton.icon(
            onPressed: _busy ? null : () => _submitToGallery(task),
            icon: const Icon(Icons.public),
            label: const Text('投稿'),
          );
        }
        final style = gallerySubmissionStyle(submission.status);
        return OutlinedButton.icon(
          onPressed: _busy ? null : () => _openSubmissionStatus(submission),
          style: OutlinedButton.styleFrom(foregroundColor: style.color),
          icon: Icon(style.icon),
          label: Text(style.buttonLabel),
        );
      },
    );
  }
}

CreationPreset creationPresetForTask(TaskItem task) {
  String? parameter(Iterable<String> keys) {
    for (final key in keys) {
      final value = task.params[key]?.toString().trim();
      if (value?.isNotEmpty == true) return value;
    }
    return null;
  }

  return CreationPreset(
    originTaskId: task.id,
    prompt: task.prompt,
    modelId:
        parameter(const ['publicModelKey', 'modelHint']) ??
        (task.model.isEmpty ? null : task.model),
    aspectRatio: parameter(const ['requestedAspectRatio', 'aspectRatio']),
    resolution: parameter(const ['resolutionScale', 'resolution']),
    quality: parameter(const ['quality']),
    count: task.count,
  );
}

({String label, String location}) taskRecreationAction(TaskItem task) {
  final preset = creationPresetForTask(task);
  return (
    label: '再次创作',
    location: Uri(
      path: '/create',
      queryParameters: preset.toQueryParameters(),
    ).toString(),
  );
}

enum _TaskAction { cancel, save, share, submit, deleteSubmission, deleteTask }

enum TaskOutputState { generating, deleted, failed, canceled, missing }

TaskOutputState taskOutputState(TaskItem task) {
  if (task.isActive) return TaskOutputState.generating;
  if (task.hasDeletedOutputs) return TaskOutputState.deleted;
  if (task.status == 'failed') return TaskOutputState.failed;
  if (task.status == 'canceled') return TaskOutputState.canceled;
  return TaskOutputState.missing;
}

class _TaskOutputPlaceholder extends StatelessWidget {
  const _TaskOutputPlaceholder({
    required this.task,
    this.onRefresh,
    this.onRecreate,
  });

  final TaskItem task;
  final VoidCallback? onRefresh;
  final VoidCallback? onRecreate;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final visual = StarCloudsVisualStyle.of(context);
    final state = taskOutputState(task);
    final details = switch (state) {
      TaskOutputState.generating => (
        icon: Icons.auto_awesome_outlined,
        title: task.status == 'queued' ? '正在等待创作' : '正在生成作品',
        message: task.status == 'queued'
            ? '任务已进入队列，开始生成后会自动更新。'
            : '可以先离开此页面，完成后会在作品中保留。',
        color: visual.brandStart,
      ),
      TaskOutputState.deleted => (
        icon: Icons.delete_sweep_outlined,
        title: '作品文件已移除',
        message: task.deletedOutputCount > 0
            ? '已移除 ${task.deletedOutputCount} 个图片文件，仍可沿用原参数再次创作。'
            : '图片文件已被移除，仍可沿用原参数再次创作。',
        color: colors.onSurfaceVariant,
      ),
      TaskOutputState.failed => (
        icon: Icons.error_outline,
        title: '本次创作未完成',
        message: task.errorMessage?.trim().isNotEmpty == true
            ? task.errorMessage!.trim()
            : '生成过程中遇到问题，可以调整参数后再次尝试。',
        color: colors.error,
      ),
      TaskOutputState.canceled => (
        icon: Icons.stop_circle_outlined,
        title: '创作已停止',
        message: '这次任务没有生成图片，可以沿用原参数重新开始。',
        color: colors.onSurfaceVariant,
      ),
      TaskOutputState.missing => (
        icon: Icons.cloud_off_outlined,
        title: '暂未找到作品图片',
        message: '图片可能仍在同步，先刷新看看；如果仍未恢复，可以再次创作。',
        color: colors.primary,
      ),
    };

    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      constraints: const BoxConstraints(minHeight: 244),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: StarCloudsRadii.card,
        border: Border.all(color: visual.hairline),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 54,
            height: 54,
            decoration: BoxDecoration(
              color: details.color.withValues(alpha: .11),
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Icon(details.icon, color: details.color, size: 27),
          ),
          const SizedBox(height: 16),
          Text(
            details.title,
            textAlign: TextAlign.center,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 7),
          Text(
            details.message,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: colors.onSurfaceVariant,
              height: 1.45,
            ),
          ),
          if (state == TaskOutputState.generating) ...[
            const SizedBox(height: 20),
            ClipRRect(
              borderRadius: StarCloudsRadii.pillAll,
              child: LinearProgressIndicator(
                minHeight: 4,
                backgroundColor: colors.surfaceContainerHighest,
              ),
            ),
          ] else if (onRefresh != null || onRecreate != null) ...[
            const SizedBox(height: 20),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 10,
              runSpacing: 10,
              children: [
                if (onRefresh != null)
                  OutlinedButton.icon(
                    onPressed: onRefresh,
                    icon: const Icon(Icons.refresh),
                    label: const Text('刷新图片'),
                  ),
                if (onRecreate != null)
                  FilledButton.icon(
                    onPressed: onRecreate,
                    icon: const Icon(Icons.replay),
                    label: Text(taskRecreationAction(task).label),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _ButtonProgress extends StatelessWidget {
  const _ButtonProgress();

  @override
  Widget build(BuildContext context) {
    return const SizedBox.square(
      dimension: 18,
      child: CircularProgressIndicator(strokeWidth: 2),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 78,
            child: Text(
              label,
              style: TextStyle(color: Theme.of(context).colorScheme.outline),
            ),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}

({String label, Color color}) _taskStatus(String value) => switch (value) {
  'queued' => (label: '排队中', color: const Color(0xFFD97706)),
  'running' => (label: '生成中', color: const Color(0xFF4F67D6)),
  'succeeded' => (label: '已完成', color: const Color(0xFF0F766E)),
  'failed' => (label: '失败', color: const Color(0xFFDC2626)),
  'canceled' => (label: '已取消', color: const Color(0xFF64748B)),
  _ => (label: value, color: const Color(0xFF64748B)),
};

String _modelLabel(TaskItem task) {
  final hint = task.params['modelHint']?.toString() ?? '';
  return task.model.isNotEmpty
      ? task.model
      : hint.isNotEmpty
      ? hint
      : '-';
}

String _durationLabel(Duration duration) {
  if (duration.inMinutes > 0) {
    return '${duration.inMinutes} 分 ${duration.inSeconds.remainder(60)} 秒';
  }
  return '${duration.inSeconds.clamp(1, 59)} 秒';
}

String _galleryError(GalException error) => switch (error.type) {
  GalExceptionType.accessDenied => '没有相册写入权限',
  GalExceptionType.notEnoughSpace => '设备存储空间不足',
  GalExceptionType.notSupportedFormat => '系统相册不支持该图片格式',
  GalExceptionType.unexpected => '保存到相册失败，请稍后重试',
};
