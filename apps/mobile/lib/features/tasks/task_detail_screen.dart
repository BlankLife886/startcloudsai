import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
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
  const TaskDetailScreen({required this.taskId, this.initialTask, super.key});

  final String taskId;
  final TaskItem? initialTask;

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
      final count = task.originalUrls.length;
      final repository = ref.read(taskRepositoryProvider);
      final result = await saveTaskImages(
        count: count,
        downloadPath: (index) async =>
            (await repository.downloadOriginal(task, index)).path,
        savePath: Gal.putImage,
      );
      if (!mounted) return;
      if (result.isComplete) {
        AppNotice.success(
          context,
          count > 1 ? '已保存 $count 张到系统相册' : '已保存到系统相册',
        );
      } else if (result.savedCount > 0) {
        AppNotice.warning(context, '已保存 ${result.savedCount} 张，其余图片保存失败');
      } else {
        _showError(result.error!);
      }
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
      final repository = ref.read(taskRepositoryProvider);
      final imageCount = task.originalUrls.length;
      final result = await prepareTaskImagesForShare(
        count: imageCount,
        downloadPath: (index) async =>
            (await repository.downloadOriginal(task, index)).path,
      );
      if (!mounted) return;
      if (result.paths.isEmpty) {
        _showError(result.error ?? const FormatException('作品原图不存在'));
        return;
      }
      await SharePlus.instance.share(
        ShareParams(
          files: [for (final path in result.paths) XFile(path)],
          text: task.prompt.isEmpty ? '星空云绘作品' : task.prompt,
          title: '分享作品',
          sharePositionOrigin: origin,
        ),
      );
      if (mounted && result.failedCount > 0) {
        AppNotice.warning(
          context,
          '已准备 ${result.paths.length} 张，${result.failedCount} 张下载失败',
        );
      }
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  Future<void> _copyPrompt(TaskItem task) async {
    final prompt = task.displayPrompt.trim();
    if (prompt.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: prompt));
    if (!mounted) return;
    AppNotice.success(context, '提示词已复制');
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

  void _selectImage(int index) {
    if (index == _pageIndex || !_pageController.hasClients) return;
    setState(() => _pageIndex = index);
    _pageController.animateToPage(
      index,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
    );
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
    final liveTask = switch (detail) {
      AsyncData<TaskItem>(:final value) => value,
      _ => null,
    };
    final task = liveTask ?? widget.initialTask;
    final usingCachedTask = liveTask == null && widget.initialTask != null;
    final cachedState = usingCachedTask
        ? detail.hasError
              ? _CachedTaskState.failed
              : _CachedTaskState.syncing
        : null;
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
      body: task != null
          ? Column(
              children: [
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 180),
                  child: cachedState == null
                      ? const SizedBox.shrink()
                      : _CachedTaskNotice(
                          state: cachedState,
                          onRetry: () =>
                              ref.invalidate(taskDetailProvider(widget.taskId)),
                        ),
                ),
                Expanded(child: _buildContent(task, submission)),
              ],
            )
          : detail.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, stackTrace) => Center(
                child: OutlinedButton.icon(
                  onPressed: () =>
                      ref.invalidate(taskDetailProvider(widget.taskId)),
                  icon: const Icon(Icons.refresh),
                  label: const Text('重新加载'),
                ),
              ),
              data: (_) => const SizedBox.shrink(),
            ),
      bottomNavigationBar: task == null
          ? null
          : _buildActions(task, submission, serverAvailable: !usingCachedTask),
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
          _TaskImageGallery(
            urls: urls,
            pageController: _pageController,
            selectedIndex: _pageIndex,
            onPageChanged: (index) => setState(() => _pageIndex = index),
            onSelect: _selectImage,
            onFullscreen: () => _openFullscreen(task),
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
              _TaskPromptPanel(
                prompt: task.displayPrompt,
                onCopy: task.displayPrompt.trim().isEmpty
                    ? null
                    : () => _copyPrompt(task),
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
              _TaskParametersPanel(items: taskGenerationParameters(task)),
              const SizedBox(height: 12),
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
    AsyncValue<GallerySubmission?> submissionState, {
    bool serverAvailable = true,
  }) {
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
            : Builder(
                builder: (context) {
                  final save = OutlinedButton.icon(
                    key: const Key('task-save-images'),
                    onPressed: _busy ? null : () => _save(task),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                    icon: _busyAction == _TaskAction.save
                        ? const _ButtonProgress()
                        : const Icon(Icons.download_outlined),
                    label: Text(task.originalUrls.length > 1 ? '保存全部' : '保存'),
                  );
                  final share = Builder(
                    builder: (buttonContext) => OutlinedButton.icon(
                      key: const Key('task-share-images'),
                      onPressed: _busy
                          ? null
                          : () => _share(task, buttonContext),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                      icon: _busyAction == _TaskAction.share
                          ? const _ButtonProgress()
                          : const Icon(Icons.share_outlined),
                      label: Text(task.originalUrls.length > 1 ? '分享全部' : '分享'),
                    ),
                  );
                  final submit = serverAvailable
                      ? _buildSubmissionAction(task, submissionState)
                      : OutlinedButton.icon(
                          onPressed: null,
                          icon: const Icon(Icons.cloud_off_outlined),
                          label: const Text('详情未同步'),
                        );
                  return Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      submit,
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(child: save),
                          const SizedBox(width: 8),
                          Expanded(child: share),
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

List<({String label, String value})> taskGenerationParameters(TaskItem task) {
  String? parameter(Iterable<String> keys) {
    for (final key in keys) {
      final value = task.params[key]?.toString().trim();
      if (value?.isNotEmpty == true) return value;
    }
    return null;
  }

  final ratio = parameter(const ['requestedAspectRatio', 'aspectRatio']);
  final resolution = parameter(const ['resolutionScale', 'resolution']);
  final quality = parameter(const ['quality']);
  return [
    (label: '模型', value: _modelLabel(task)),
    if (ratio != null)
      (label: '画幅', value: ratio.toLowerCase() == 'auto' ? '自动' : ratio),
    if (resolution != null) (label: '清晰度', value: resolution),
    if (quality != null)
      (
        label: '质量',
        value: switch (quality.toLowerCase()) {
          'low' => '快速',
          'medium' || 'standard' => '标准',
          'high' || 'hd' => '高清',
          _ => quality,
        },
      ),
    (label: '张数', value: '${task.batchSize} 张'),
  ];
}

class TaskImageSaveResult {
  const TaskImageSaveResult({
    required this.savedCount,
    required this.totalCount,
    this.error,
  });

  final int savedCount;
  final int totalCount;
  final Object? error;

  bool get isComplete => savedCount == totalCount && error == null;
}

class TaskImageShareResult {
  const TaskImageShareResult({
    required this.paths,
    required this.totalCount,
    this.error,
  });

  final List<String> paths;
  final int totalCount;
  final Object? error;

  int get failedCount => totalCount - paths.length;
}

Future<TaskImageShareResult> prepareTaskImagesForShare({
  required int count,
  required Future<String> Function(int index) downloadPath,
}) async {
  final total = count.clamp(0, 100);
  if (total == 0) {
    return const TaskImageShareResult(
      paths: [],
      totalCount: 0,
      error: FormatException('作品原图不存在'),
    );
  }
  final paths = <String>[];
  Object? firstError;
  for (var index = 0; index < total; index += 1) {
    try {
      paths.add(await downloadPath(index));
    } catch (error) {
      firstError ??= error;
    }
  }
  return TaskImageShareResult(
    paths: paths,
    totalCount: total,
    error: firstError,
  );
}

Future<TaskImageSaveResult> saveTaskImages({
  required int count,
  required Future<String> Function(int index) downloadPath,
  required Future<void> Function(String path) savePath,
}) async {
  final total = count.clamp(0, 100);
  if (total == 0) {
    return const TaskImageSaveResult(
      savedCount: 0,
      totalCount: 0,
      error: FormatException('作品原图不存在'),
    );
  }
  var saved = 0;
  for (var index = 0; index < total; index++) {
    try {
      final path = await downloadPath(index);
      await savePath(path);
      saved += 1;
    } catch (error) {
      return TaskImageSaveResult(
        savedCount: saved,
        totalCount: total,
        error: error,
      );
    }
  }
  return TaskImageSaveResult(savedCount: saved, totalCount: total);
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

enum _CachedTaskState { syncing, failed }

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

class _TaskImageGallery extends StatelessWidget {
  const _TaskImageGallery({
    required this.urls,
    required this.pageController,
    required this.selectedIndex,
    required this.onPageChanged,
    required this.onSelect,
    required this.onFullscreen,
  });

  final List<String> urls;
  final PageController pageController;
  final int selectedIndex;
  final ValueChanged<int> onPageChanged;
  final ValueChanged<int> onSelect;
  final VoidCallback onFullscreen;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AspectRatio(
          aspectRatio: 1,
          child: Stack(
            children: [
              PageView.builder(
                controller: pageController,
                itemCount: urls.length,
                onPageChanged: onPageChanged,
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
                  onPressed: onFullscreen,
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
                    key: const Key('task-image-page-indicator'),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black54,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '${selectedIndex + 1}/${urls.length}',
                      style: const TextStyle(color: Colors.white),
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (urls.length > 1)
          Container(
            key: const Key('task-image-thumbnails'),
            height: 78,
            color: colors.surface,
            alignment: Alignment.centerLeft,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  for (var index = 0; index < urls.length; index++) ...[
                    if (index > 0) const SizedBox(width: 8),
                    Builder(
                      builder: (context) {
                        final selected = index == selectedIndex;
                        return Semantics(
                          label: '查看第 ${index + 1} 张图片',
                          button: true,
                          selected: selected,
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 180),
                            curve: Curves.easeOutCubic,
                            width: 62,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: selected
                                    ? colors.primary
                                    : colors.outlineVariant,
                                width: selected ? 2 : 1,
                              ),
                            ),
                            padding: EdgeInsets.all(selected ? 2 : 3),
                            child: Material(
                              color: colors.surfaceContainerLow,
                              borderRadius: BorderRadius.circular(5),
                              clipBehavior: Clip.antiAlias,
                              child: InkWell(
                                key: Key('task-image-thumbnail-$index'),
                                onTap: () => onSelect(index),
                                child: AuthenticatedImage(
                                  url: urls[index],
                                  fit: BoxFit.cover,
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ],
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _CachedTaskNotice extends StatelessWidget {
  const _CachedTaskNotice({required this.state, required this.onRetry});

  final _CachedTaskState state;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final failed = state == _CachedTaskState.failed;
    return Container(
      key: const Key('task-detail-cache-notice'),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        border: Border(bottom: BorderSide(color: colors.outlineVariant)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      child: Row(
        children: [
          if (failed)
            Icon(Icons.cloud_off_outlined, size: 18, color: colors.error)
          else
            const SizedBox.square(
              dimension: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              failed ? '详情同步失败，已显示列表中的作品数据' : '正在同步作品详情',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          if (failed)
            IconButton(
              key: const Key('task-detail-cache-retry'),
              tooltip: '重试同步作品详情',
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 19),
            ),
        ],
      ),
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

class _TaskParametersPanel extends StatelessWidget {
  const _TaskParametersPanel({required this.items});

  final List<({String label, String value})> items;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      key: const Key('task-parameters-panel'),
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 13, 14, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '生成参数',
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: colors.onSurfaceVariant,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 7),
            for (var index = 0; index < items.length; index++) ...[
              _InfoRow(label: items[index].label, value: items[index].value),
              if (index != items.length - 1)
                Divider(height: 1, color: colors.outlineVariant),
            ],
          ],
        ),
      ),
    );
  }
}

class _TaskPromptPanel extends StatelessWidget {
  const _TaskPromptPanel({required this.prompt, required this.onCopy});

  final String prompt;
  final VoidCallback? onCopy;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      key: const Key('task-prompt-panel'),
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 8, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '提示词',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (onCopy != null)
                  IconButton(
                    key: const Key('copy-task-prompt'),
                    tooltip: '复制提示词',
                    constraints: const BoxConstraints.tightFor(
                      width: 40,
                      height: 40,
                    ),
                    visualDensity: VisualDensity.compact,
                    onPressed: onCopy,
                    icon: const Icon(Icons.copy_outlined, size: 18),
                  ),
              ],
            ),
            SelectableText(
              prompt.trim().isEmpty ? '图片创作' : prompt.trim(),
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                fontWeight: FontWeight.w600,
                height: 1.5,
              ),
            ),
          ],
        ),
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
