import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gal/gal.dart';
import 'package:go_router/go_router.dart';

import '../../app/starclouds_theme.dart';
import '../../core/network/api_exception.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../../core/widgets/authenticated_image.dart';
import '../assets/assets.dart';
import '../assets/assets_screen.dart';
import '../auth/auth.dart';
import '../discover/discover.dart';
import '../gallery/gallery.dart';
import '../profile/profile.dart';
import '../tasks/task_deletion_ui.dart';
import '../tasks/task_detail_screen.dart';
import '../tasks/task_sync.dart';
import '../tasks/tasks.dart';
import 'create.dart';
import 'creation_draft.dart';
import 'reference_image_service.dart';
import '../../core/widgets/app_chrome.dart';

int estimatedCreationCost(ImageModelOption model, int count) =>
    model.pricePoints * count.clamp(1, model.maxImages);

class CreateScreen extends ConsumerStatefulWidget {
  const CreateScreen({this.initialPrompt, this.initialPreset, super.key});

  final String? initialPrompt;
  final CreationPreset? initialPreset;

  @override
  ConsumerState<CreateScreen> createState() => _CreateScreenState();
}

class _CreateScreenState extends ConsumerState<CreateScreen>
    with WidgetsBindingObserver {
  late final TextEditingController _promptController;
  String? _modelId;
  String? _aspectRatio;
  String? _resolution;
  String? _quality;
  final List<String> _pendingTaskIds = [];
  String? _busyTaskId;
  int _count = 1;
  bool _submitting = false;
  bool _selectingImages = false;
  bool _draftLoaded = false;
  bool _restoringDraft = false;
  bool _resumed = true;
  DateTime? _submittedAt;
  Timer? _draftTimer;
  Timer? _pollTimer;
  var _pollInFlight = false;
  String _submissionLabel = '';
  final List<ReferenceImageDraft> _references = [];

  String? get _incomingPrompt =>
      widget.initialPreset?.prompt ?? widget.initialPrompt;

  @override
  void initState() {
    super.initState();
    final preset = widget.initialPreset;
    _promptController = TextEditingController(text: _incomingPrompt ?? '');
    _modelId = preset?.modelId;
    _aspectRatio = preset?.aspectRatio;
    _resolution = preset?.resolution;
    _quality = preset?.quality;
    _count = preset?.count ?? 1;
    _promptController.addListener(_onPromptChanged);
    WidgetsBinding.instance.addObserver(this);
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (_) => _poll());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _recoverLostImages();
      _restoreDraft();
    });
  }

  @override
  void didUpdateWidget(covariant CreateScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialPreset != null &&
        widget.initialPreset != oldWidget.initialPreset) {
      final preset = widget.initialPreset!;
      _restoringDraft = true;
      _promptController.text = preset.prompt;
      setState(() {
        _modelId = preset.modelId;
        _aspectRatio = preset.aspectRatio;
        _resolution = preset.resolution;
        _quality = preset.quality;
        _count = preset.count;
      });
      _restoringDraft = false;
      if (_draftLoaded) unawaited(_persistDraft());
      return;
    }
    if (widget.initialPrompt != null &&
        widget.initialPrompt != oldWidget.initialPrompt) {
      _promptController.text = widget.initialPrompt!;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _resumed = state == AppLifecycleState.resumed;
    if (_resumed && _pendingTaskIds.isNotEmpty) {
      unawaited(_pollPending());
    }
  }

  void _poll() => unawaited(_pollPending());

  Future<void> _pollPending() async {
    if (!_resumed || !mounted || _pendingTaskIds.isEmpty || _pollInFlight) {
      return;
    }
    _pollInFlight = true;
    final ids = List<String>.from(_pendingTaskIds);
    try {
      final tasks = await ref.read(taskRepositoryProvider).getBatch(ids);
      if (!mounted) return;
      final found = {for (final task in tasks) task.id: task};
      final center = ref.read(taskCenterControllerProvider.notifier);
      var stillPending = false;
      for (final id in ids) {
        final task = found[id];
        if (task != null) center.upsert(task);
        if (task == null ||
            task.isActive ||
            (task.isSucceeded && task.previewUrls.isEmpty)) {
          stillPending = true;
        }
      }
      if (!stillPending) {
        setState(() => _pendingTaskIds.removeWhere(ids.contains));
      }
    } catch (_) {
      // The next interval retries; keep the queued turn on screen.
    } finally {
      _pollInFlight = false;
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _draftTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _promptController.removeListener(_onPromptChanged);
    _persistDraft();
    _promptController.dispose();
    for (final image in _references) {
      _deleteLocalReference(image);
    }
    super.dispose();
  }

  Future<void> _restoreDraft() async {
    try {
      final draft = await ref.read(creationDraftStoreProvider).read();
      if (!mounted) return;
      _restoringDraft = true;
      if (draft != null) {
        if (_incomingPrompt?.trim().isNotEmpty != true) {
          _promptController.text = draft.prompt;
        }
        _modelId = draft.modelId;
        _aspectRatio = draft.aspectRatio;
        _resolution = draft.resolution;
        _quality = draft.quality;
        _count = draft.count;
      }
      final preset = widget.initialPreset;
      if (preset != null) {
        _modelId = preset.modelId ?? _modelId;
        _aspectRatio = preset.aspectRatio ?? _aspectRatio;
        _resolution = preset.resolution ?? _resolution;
        _quality = preset.quality ?? _quality;
        _count = preset.count;
      }
      setState(() => _draftLoaded = true);
      _restoringDraft = false;
      if (_incomingPrompt?.trim().isNotEmpty == true) {
        await _persistDraft();
      }
    } catch (_) {
      if (!mounted) return;
      _restoringDraft = false;
      setState(() => _draftLoaded = true);
    }
  }

  void _onPromptChanged() {
    if (_draftLoaded && !_restoringDraft) _scheduleDraftSave();
  }

  void _scheduleDraftSave() {
    if (!_draftLoaded || _restoringDraft) return;
    _draftTimer?.cancel();
    _draftTimer = Timer(
      const Duration(milliseconds: 650),
      () => _persistDraft(),
    );
  }

  CreationDraft _currentDraft() => CreationDraft(
    prompt: _promptController.text,
    modelId: _modelId,
    aspectRatio: _aspectRatio,
    resolution: _resolution,
    quality: _quality,
    count: _count,
    updatedAt: DateTime.now(),
  );

  Future<void> _persistDraft() async {
    _draftTimer?.cancel();
    final draft = _currentDraft();
    try {
      final store = ref.read(creationDraftStoreProvider);
      if (draft.isEmpty) {
        await store.clear();
      } else {
        await store.write(draft);
      }
    } catch (_) {
      // Draft persistence is best effort and stays silent on the create page.
    }
  }

  Future<void> _recoverLostImages() async {
    try {
      final recovered = await ref
          .read(referenceImageServiceProvider)
          .recoverLostImages();
      if (!mounted || recovered.isEmpty) return;
      setState(() => _references.addAll(recovered.take(4)));
    } catch (_) {
      // Lost-data recovery is best effort; normal picking remains available.
    }
  }

  Future<void> _regenerate(
    TaskItem task,
    List<ImageModelOption> models, {
    int? count,
  }) async {
    if (_submitting) return;
    final preset = creationPresetForTask(task);
    final prompt = task.displayPrompt.trim().isNotEmpty
        ? task.displayPrompt.trim()
        : preset.prompt.trim();
    if (prompt.isEmpty) {
      AppNotice.warning(context, '请先输入画面描述');
      return;
    }
    _restoringDraft = true;
    _promptController.text = prompt;
    setState(() {
      _modelId = preset.modelId ?? _modelId;
      _aspectRatio = preset.aspectRatio;
      _resolution = preset.resolution;
      _quality = preset.quality;
      _count = (count ?? preset.count).clamp(1, 4);
    });
    _restoringDraft = false;
    final model = models.firstWhere(
      (item) => item.id == _modelId,
      orElse: () => models.first,
    );
    await _submit(model);
  }

  Future<void> _downloadTurn(TaskItem task, {int? index}) async {
    if (_busyTaskId != null) return;
    if (task.originalUrls.isEmpty) {
      AppNotice.warning(context, '暂无可下载的原图');
      return;
    }
    final indexes = index == null
        ? [for (var i = 0; i < task.originalUrls.length; i++) i]
        : [index.clamp(0, task.originalUrls.length - 1)];
    setState(() => _busyTaskId = task.id);
    try {
      final repository = ref.read(taskRepositoryProvider);
      for (final imageIndex in indexes) {
        final file = await repository.downloadOriginal(task, imageIndex);
        await Gal.putImage(file.path);
      }
      if (!mounted) return;
      AppNotice.success(
        context,
        indexes.length > 1 ? '已保存 ${indexes.length} 张到相册' : '已保存到系统相册',
      );
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _busyTaskId = null);
    }
  }

  Future<void> _openTurnImageActions(
    TaskItem task,
    List<ImageModelOption> models, {
    required String groupId,
    required int slotIndex,
    required bool multi,
    int imageIndex = 0,
  }) async {
    if (_busyTaskId != null || _submitting) return;
    final suffix = multi ? '-$slotIndex' : '';
    final prefix = 'creation-turn-$groupId';
    final action = await showAppSheet<_TurnImageAction>(
      context: context,
      builder: (context) {
        final colors = Theme.of(context).colorScheme;
        return SafeArea(
          child: Padding(
            key: Key('$prefix-sheet$suffix'),
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  key: Key('$prefix-regenerate$suffix'),
                  leading: const Icon(Icons.refresh_rounded),
                  title: const Text('重新生成'),
                  onTap: () =>
                      Navigator.pop(context, _TurnImageAction.regenerate),
                ),
                if (imageIndex < task.originalUrls.length)
                  ListTile(
                    key: Key('$prefix-download$suffix'),
                    leading: const Icon(Icons.download_outlined),
                    title: const Text('下载'),
                    onTap: () =>
                        Navigator.pop(context, _TurnImageAction.download),
                  ),
                if (task.canDelete)
                  ListTile(
                    key: Key('$prefix-delete$suffix'),
                    leading: Icon(Icons.delete_outline, color: colors.error),
                    title: const Text('删除这张'),
                    textColor: colors.error,
                    iconColor: colors.error,
                    onTap: () =>
                        Navigator.pop(context, _TurnImageAction.delete),
                  ),
              ],
            ),
          ),
        );
      },
    );
    if (action == null || !mounted) return;
    switch (action) {
      case _TurnImageAction.regenerate:
        await _regenerate(task, models, count: 1);
      case _TurnImageAction.download:
        await _downloadTurn(task, index: imageIndex);
      case _TurnImageAction.delete:
        await _deleteTurn(task, imageIndex: imageIndex);
    }
  }

  Future<void> _deleteTurnImage(TaskItem task, int imageIndex) async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: Icon(
          Icons.delete_outline,
          color: Theme.of(context).colorScheme.error,
        ),
        title: const Text('删除这张图片？'),
        content: const Text('只删除这张图，同一组里的其他结果会保留，删除后无法恢复。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            onPressed: () => Navigator.pop(context, true),
            icon: const Icon(Icons.delete_outline),
            label: const Text('确认删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busyTaskId = task.id);
    try {
      final result = await ref
          .read(taskRepositoryProvider)
          .deleteTaskOutput(task.id, imageIndex);
      if (!mounted) return;
      if (result.task != null) {
        ref.read(taskCenterControllerProvider.notifier).upsert(result.task!);
        ref.invalidate(taskDetailProvider(task.id));
        AppNotice.success(context, '已删除这张图片');
      } else {
        ref
            .read(taskCenterControllerProvider.notifier)
            .removeIds(result.deletedTaskIds);
        for (final id in result.deletedTaskIds) {
          ref.invalidate(taskDetailProvider(id));
          ref.invalidate(gallerySubmissionForTaskProvider(id));
        }
        AppNotice.success(context, '作品已删除');
      }
      ref.invalidate(taskListProvider);
      ref.invalidate(profileOverviewProvider);
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _busyTaskId = null);
    }
  }

  Future<void> _deleteTurn(TaskItem task, {int? imageIndex}) async {
    if (_busyTaskId != null) return;
    final outputCount = task.originalUrls.isNotEmpty
        ? task.originalUrls.length
        : task.previewUrls.length;
    if (imageIndex != null && outputCount > 1) {
      await _deleteTurnImage(task, imageIndex);
      return;
    }
    try {
      final result = await runTaskDeletionFlow(
        context,
        task: task,
        onDelete: (cascade) => ref
            .read(taskRepositoryProvider)
            .deleteTask(task.id, cascade: cascade),
        onBusyChanged: (busy) {
          if (mounted) setState(() => _busyTaskId = busy ? task.id : null);
        },
      );
      if (result == null || !mounted) return;
      ref
          .read(taskCenterControllerProvider.notifier)
          .removeIds(result.deletedTaskIds);
      ref.invalidate(taskListProvider);
      ref.invalidate(profileOverviewProvider);
      ref.invalidate(myGallerySubmissionsProvider);
      ref.invalidate(gallerySubmissionSummaryProvider);
      ref.invalidate(discoverFeedProvider);
      ref.invalidate(discoverGalleryPageProvider);
      for (final id in result.deletedTaskIds) {
        ref.invalidate(taskDetailProvider(id));
        ref.invalidate(gallerySubmissionForTaskProvider(id));
      }
      if (_pendingTaskIds.any(result.deletedTaskIds.contains)) {
        setState(() {
          _pendingTaskIds.removeWhere(result.deletedTaskIds.contains);
        });
      }
      final count = result.deletedTaskIds.length;
      AppNotice.success(context, count > 1 ? '已删除 $count 件关联作品' : '作品已删除');
    } catch (error) {
      if (mounted) _showError(error);
    }
  }

  void _showError(Object error) {
    final message = error is ApiException
        ? error.message
        : error is FormatException
        ? error.message
        : '任务提交失败，请稍后重试';
    AppNotice.error(context, message);
  }

  Future<void> _submit(ImageModelOption model) async {
    if (_promptController.text.trim().isEmpty) {
      AppNotice.warning(context, '请先输入画面描述');
      return;
    }
    final session = ref.read(sessionControllerProvider).asData?.value;
    if (session?.isAuthenticated != true) {
      await context.push<bool>('/login');
      if (!mounted ||
          ref.read(sessionControllerProvider).asData?.value.isAuthenticated !=
              true) {
        return;
      }
    }
    final user = ref.read(sessionControllerProvider).asData?.value.user;
    final count = _count.clamp(1, model.maxImages);
    final estimatedCost = estimatedCreationCost(model, count);
    WalletSnapshot? wallet;
    if (estimatedCost > 0) {
      wallet = ref.read(walletProvider).asData?.value;
      try {
        wallet = await ref.read(walletProvider.future);
      } catch (_) {
        // The task API remains authoritative when wallet preview is unavailable.
      }
      if (!mounted) return;
      if (wallet != null &&
          !creationAffordability(
            wallet.availablePoints,
            estimatedCost,
          ).sufficient) {
        await _showInsufficientBalance(wallet, estimatedCost);
        return;
      }
    }
    if (estimatedCost > 0 && user?.requireCostConfirm != false) {
      final confirmed = await _confirmCost(
        model: model,
        count: count,
        estimatedCost: estimatedCost,
        wallet: wallet,
      );
      if (confirmed != true || !mounted) return;
    }
    setState(() {
      _submitting = true;
      _submittedAt = DateTime.now();
      _submissionLabel = _references.isEmpty ? '正在提交任务' : '正在上传参考图';
    });
    try {
      final inputKeys = await _uploadReferences(model);
      if (mounted) setState(() => _submissionLabel = '正在提交任务');
      final batch = await ref
          .read(creationRepositoryProvider)
          .createTextToImage(
            prompt: _promptController.text,
            model: model,
            aspectRatio: _selected(_aspectRatio, model.aspectRatios),
            resolution: _selected(_resolution, model.resolutions),
            quality: _selected(_quality, model.qualities),
            count: count,
            inputKeys: inputKeys,
          );
      final createdAt = (_submittedAt ?? DateTime.now()).toUtc();
      final center = ref.read(taskCenterControllerProvider.notifier);
      for (var index = 0; index < batch.taskIds.length; index++) {
        center.upsert(
          TaskItem.fromJson({
            'id': batch.taskIds[index],
            'type': 't2i',
            'status': 'queued',
            'model': model.id,
            'count': 1,
            'createdAt': createdAt.toIso8601String(),
            'params': {
              'userPrompt': _promptController.text.trim(),
              'publicModelKey': model.id,
              'modelHint': model.id,
              'aspectRatio': _selected(_aspectRatio, model.aspectRatios),
              'requestedAspectRatio': _selected(
                _aspectRatio,
                model.aspectRatios,
              ),
              'resolutionScale': _selected(_resolution, model.resolutions),
              'quality': _selected(_quality, model.qualities),
              if (batch.batchId.isNotEmpty) ...{
                'batchId': batch.batchId,
                'batchIndex': index,
                'batchSize': batch.taskIds.length,
              },
            },
          }),
        );
      }
      ref.invalidate(taskListProvider);
      ref.invalidate(profileOverviewProvider);
      ref.invalidate(walletProvider);
      for (final taskId in batch.taskIds) {
        ref.invalidate(taskDetailProvider(taskId));
      }
      _draftTimer?.cancel();
      try {
        await ref.read(creationDraftStoreProvider).clear();
      } catch (_) {
        // The task is already committed; draft cleanup is best effort.
      }
      if (!mounted) return;
      setState(() {
        _pendingTaskIds
          ..clear()
          ..addAll(batch.taskIds);
      });
      unawaited(_pollPending());
      AppNotice.success(context, '任务已提交，生成结果会出现在对话里');
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
          _submissionLabel = '';
        });
      }
    }
  }

  Future<bool?> _confirmCost({
    required ImageModelOption model,
    required int count,
    required int estimatedCost,
    required WalletSnapshot? wallet,
  }) => showAppDialog<bool>(
    context: context,
    builder: (context) => AppDialog(
      icon: const Icon(Icons.price_check_outlined),
      title: const Text('确认本次创作'),
      content: CreationCostPanel(
        modelName: model.name,
        count: count,
        unitCost: model.pricePoints,
        estimatedCost: estimatedCost,
        availablePoints: wallet?.availablePoints,
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: () => Navigator.pop(context, true),
          icon: const Icon(Icons.auto_awesome),
          label: const Text('确认生成'),
        ),
      ],
    ),
  );

  Future<void> _showInsufficientBalance(
    WalletSnapshot wallet,
    int estimatedCost,
  ) async {
    final quote = creationAffordability(wallet.availablePoints, estimatedCost);
    final openWallet = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: Icon(
          Icons.account_balance_wallet_outlined,
          color: Theme.of(context).colorScheme.error,
        ),
        title: const Text('积分不足'),
        content: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.errorContainer,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _ConfirmationRow(
                label: '当前可用',
                value: '${wallet.availablePoints} 积分',
              ),
              const SizedBox(height: 10),
              _ConfirmationRow(label: '本次需要', value: '$estimatedCost 积分'),
              const Divider(height: 24),
              _ConfirmationRow(
                label: '还差',
                value: '${quote.missing} 积分',
                danger: true,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('返回创作'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.pop(context, true),
            icon: const Icon(Icons.account_balance_wallet_outlined),
            label: const Text('查看钱包'),
          ),
        ],
      ),
    );
    if (openWallet == true && mounted) {
      await context.push<void>('/profile/wallet');
    }
  }

  Future<List<String>> _uploadReferences(ImageModelOption model) async {
    final images = _references.take(creationReferenceLimit(model)).toList();
    final keys = <String>[];
    for (final image in images) {
      var key = image.remoteKey;
      if (key == null || key.isEmpty) {
        key = await ref.read(creationRepositoryProvider).uploadReference(image);
        final index = _references.indexOf(image);
        if (index >= 0 && mounted) {
          setState(() => _references[index] = image.withRemoteKey(key!));
        }
      }
      keys.add(key);
    }
    return keys;
  }

  Future<void> _addReferences(
    ImageModelOption model,
    ImageSourceChoice source,
  ) async {
    final remaining = creationReferenceLimit(model) - _references.length;
    if (remaining <= 0 || _selectingImages) return;
    setState(() => _selectingImages = true);
    try {
      final service = ref.read(referenceImageServiceProvider);
      final images = source == ImageSourceChoice.gallery
          ? await service.pickFromGallery(remaining)
          : await service.takePhoto();
      if (!mounted || images.isEmpty) return;
      setState(() => _references.addAll(images.take(remaining)));
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _selectingImages = false);
    }
  }

  Future<void> _addAssetReferences(ImageModelOption model) async {
    final remaining = creationReferenceLimit(model) - _references.length;
    if (remaining <= 0 || _selectingImages) return;
    var session = ref.read(sessionControllerProvider).asData?.value;
    if (session?.isAuthenticated != true) {
      await context.push<bool>('/login');
      if (!mounted) return;
      session = ref.read(sessionControllerProvider).asData?.value;
      if (session?.isAuthenticated != true) return;
    }
    final existingKeys = _references
        .map((image) => image.remoteKey)
        .whereType<String>()
        .where((key) => key.isNotEmpty)
        .toSet();
    final selected = await showAppSheet<List<UserAsset>>(
      context: context,
      isScrollControlled: true,
      builder: (context) =>
          AssetPickerSheet(maxSelection: remaining, existingKeys: existingKeys),
    );
    if (!mounted || selected == null || selected.isEmpty) return;
    final drafts = selected
        .map((asset) {
          final key = asset.inputKey;
          if (key == null || existingKeys.contains(key)) return null;
          existingKeys.add(key);
          return ReferenceImageDraft(
            localPath: '',
            filename: asset.title,
            remoteKey: key,
            remoteUrl: asset.thumbnailUrl,
            sourceAssetId: asset.id,
          );
        })
        .whereType<ReferenceImageDraft>()
        .take(remaining)
        .toList();
    if (drafts.isNotEmpty) setState(() => _references.addAll(drafts));
  }

  Future<void> _showReferenceSource(ImageModelOption model) async {
    final source = await showAppSheet<ImageSourceChoice>(
      context: context,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.collections_outlined),
                title: const Text('从素材库选择'),
                subtitle: const Text('已上传素材无需重复上传'),
                onTap: () => Navigator.pop(context, ImageSourceChoice.assets),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('从相册选择'),
                subtitle: const Text('可一次选择多张图片'),
                onTap: () => Navigator.pop(context, ImageSourceChoice.gallery),
              ),
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined),
                title: const Text('拍照'),
                subtitle: const Text('使用相机添加一张参考图'),
                onTap: () => Navigator.pop(context, ImageSourceChoice.camera),
              ),
            ],
          ),
        ),
      ),
    );
    if (source == null || !mounted) return;
    if (source == ImageSourceChoice.assets) {
      await _addAssetReferences(model);
    } else {
      await _addReferences(model, source);
    }
  }

  void _removeReference(int index) {
    final removed = _references.removeAt(index);
    _deleteLocalReference(removed);
    setState(() {});
  }

  void _reorderReferences(int oldIndex, int newIndex) {
    if (_submitting || _references.length < 2) return;
    final reordered = reorderCreationReferences(
      _references,
      oldIndex,
      newIndex,
    );
    setState(() {
      _references
        ..clear()
        ..addAll(reordered);
    });
  }

  void _deleteLocalReference(ReferenceImageDraft image) {
    if (image.localPath.isNotEmpty) File(image.localPath).delete().ignore();
  }

  String _selected(String? value, List<String> options) {
    return options.contains(value) ? value! : options.first;
  }

  void _applyModel(ImageModelOption selectedModel) {
    setState(() {
      _modelId = selectedModel.id;
      while (_references.length > creationReferenceLimit(selectedModel)) {
        final removed = _references.removeLast();
        _deleteLocalReference(removed);
      }
      _aspectRatio = null;
      _resolution = null;
      _quality = null;
      _count = 1;
    });
    _scheduleDraftSave();
  }

  Future<void> _openSettings(List<ImageModelOption> models) async {
    if (_submitting) return;
    await showAppSheet<void>(
      context: context,
      isScrollControlled: true,
      showCloseButton: false,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            final current = models.firstWhere(
              (item) => item.id == _modelId,
              orElse: () => models.first,
            );
            return SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 2, 20, 20),
              child: _CreationSettingsPanel(
                models: models,
                model: current,
                aspectRatio: _selected(_aspectRatio, current.aspectRatios),
                resolution: _selected(_resolution, current.resolutions),
                quality: _selected(_quality, current.qualities),
                count: _count.clamp(1, current.maxImages),
                enabled: !_submitting,
                onSelectModel: (next) {
                  if (next.id == current.id) return;
                  _applyModel(next);
                  setSheetState(() {});
                },
                onAspectRatio: (value) {
                  setState(() => _aspectRatio = value);
                  _scheduleDraftSave();
                  setSheetState(() {});
                },
                onResolution: (value) {
                  setState(() => _resolution = value);
                  _scheduleDraftSave();
                  setSheetState(() {});
                },
                onQuality: (value) {
                  setState(() => _quality = value);
                  _scheduleDraftSave();
                  setSheetState(() {});
                },
                onCount: (value) {
                  setState(() => _count = value);
                  _scheduleDraftSave();
                  setSheetState(() {});
                },
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<TaskSyncState>(taskSyncControllerProvider, (previous, next) {
      final task = next.lastTask;
      if (task == null || !task.isTextToImage) return;
      if (previous?.lastEventAt == next.lastEventAt &&
          previous?.lastTask?.id == task.id &&
          previous?.lastTask?.status == task.status &&
          previous?.lastTask?.previewUrls.join() == task.previewUrls.join()) {
        return;
      }
      ref.read(taskCenterControllerProvider.notifier).upsert(task);
    });
    for (final id in _pendingTaskIds) {
      ref.listen(taskDetailProvider(id), (previous, next) {
        final task = next.asData?.value;
        if (task == null) return;
        ref.read(taskCenterControllerProvider.notifier).upsert(task);
      });
    }
    final config = ref.watch(runtimeCreationConfigProvider);
    return Scaffold(
      appBar: const AppTopBar(title: Text('文生图'), fallbackLocation: '/design'),
      body: config.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _ConfigError(
          onRetry: () => ref.invalidate(runtimeCreationConfigProvider),
        ),
        data: (data) {
          if (!data.enabled || data.models.isEmpty) {
            return const Center(child: Text('文生图当前未开放'));
          }
          final model = data.models.firstWhere(
            (item) => item.id == _modelId,
            orElse: () => data.models.first,
          );
          final ratio = _selected(_aspectRatio, model.aspectRatios);
          final resolution = _selected(_resolution, model.resolutions);
          final quality = _selected(_quality, model.qualities);
          final count = _count.clamp(1, model.maxImages);
          final estimatedCost = estimatedCreationCost(model, count);
          final refLimit = creationReferenceLimit(model);
          final cardFill = Theme.of(context).brightness == Brightness.dark
              ? const Color(0xFF16181F)
              : const Color(0xFFF5F5F7);
          final authenticated =
              ref
                  .watch(sessionControllerProvider)
                  .valueOrNull
                  ?.isAuthenticated ==
              true;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.initialPreset != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: CreationPresetBanner(
                    modelName: model.name,
                    aspectRatio: ratio,
                    resolution: resolution,
                    quality: _qualityLabel(quality),
                    count: count,
                  ),
                ),
              Expanded(
                child: _CreationConversation(
                  models: data.models,
                  authenticated: authenticated,
                  pendingTaskIds: _pendingTaskIds,
                  submitting: _submitting,
                  busyTaskId: _busyTaskId,
                  submittedAt: _submittedAt,
                  onOpen: (task) {
                    final router = GoRouter.maybeOf(context);
                    if (router != null) {
                      router.push('/works/${task.id}');
                    }
                  },
                  onImageActions: (task, slot) => _openTurnImageActions(
                    task,
                    data.models,
                    groupId: slot.groupId,
                    slotIndex: slot.index,
                    multi: slot.multi,
                    imageIndex: slot.imageIndex,
                  ),
                ),
              ),
              _CreationSettingsDock(
                modelName: model.name,
                aspectRatio: ratio,
                resolution: resolution,
                quality: _qualityLabel(quality),
                count: count,
                enabled: !_submitting,
                onOpen: () => _openSettings(data.models),
              ),
              SafeArea(
                top: false,
                child: _PromptComposer(
                  controller: _promptController,
                  submitting: _submitting,
                  submissionLabel: _submissionLabel,
                  estimatedCost: estimatedCost,
                  onSubmit: () => _submit(model),
                  fill: cardFill,
                  refLimit: refLimit,
                  references: _references,
                  selecting: _selectingImages,
                  onAddReference: () => _showReferenceSource(model),
                  onRemoveReference: _removeReference,
                  onReorderReferences: _reorderReferences,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

enum _TurnImageAction { regenerate, download, delete }

class _CreationImageActionTarget {
  const _CreationImageActionTarget({
    required this.groupId,
    required this.index,
    required this.multi,
    required this.imageIndex,
  });

  final String groupId;
  final int index;
  final bool multi;
  final int imageIndex;
}

class _CreationConversation extends ConsumerStatefulWidget {
  const _CreationConversation({
    required this.models,
    required this.authenticated,
    required this.submitting,
    required this.onOpen,
    required this.onImageActions,
    this.pendingTaskIds = const [],
    this.busyTaskId,
    this.submittedAt,
  });

  final List<ImageModelOption> models;
  final bool authenticated;
  final bool submitting;
  final List<String> pendingTaskIds;
  final String? busyTaskId;
  final DateTime? submittedAt;
  final ValueChanged<TaskItem> onOpen;
  final void Function(TaskItem task, _CreationImageActionTarget slot)
  onImageActions;

  @override
  ConsumerState<_CreationConversation> createState() =>
      _CreationConversationState();
}

class _CreationConversationState extends ConsumerState<_CreationConversation> {
  final _scrollController = ScrollController();
  var _loadMoreInFlight = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_handleScroll);
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_handleScroll)
      ..dispose();
    super.dispose();
  }

  void _handleScroll() {
    final center = ref.read(taskCenterControllerProvider).asData?.value;
    if (!_scrollController.hasClients ||
        _scrollController.position.extentAfter > 320 ||
        _loadMoreInFlight ||
        center == null ||
        !center.hasMore ||
        center.isLoadingMore) {
      return;
    }
    unawaited(_loadMore());
  }

  Future<void> _loadMore() async {
    if (_loadMoreInFlight) return;
    _loadMoreInFlight = true;
    try {
      await ref.read(taskCenterControllerProvider.notifier).loadMore();
    } catch (_) {
      // The next scroll will retry; keep the visible thread intact.
    } finally {
      _loadMoreInFlight = false;
    }
  }

  List<List<TaskItem>> _turns() {
    if (!widget.authenticated) return const [];
    final items =
        ref.watch(taskCenterControllerProvider).asData?.value.items ??
        const <TaskItem>[];
    final turns = groupCreationTurns(items);
    final seen = {
      for (final group in turns)
        for (final task in group) task.id,
    };
    for (final id in widget.pendingTaskIds.reversed) {
      final live = ref.watch(taskDetailProvider(id)).asData?.value;
      if (live == null || !live.isTextToImage) continue;
      if (seen.contains(id)) {
        for (var index = 0; index < turns.length; index++) {
          final member = turns[index].indexWhere((task) => task.id == id);
          if (member < 0) continue;
          final next = [...turns[index]]..[member] = live;
          next.sort(
            (left, right) => left.batchIndex.compareTo(right.batchIndex),
          );
          turns[index] = next;
          break;
        }
        continue;
      }
      final existing = turns.indexWhere(
        (group) => group.first.groupKey == live.groupKey,
      );
      if (existing >= 0) {
        turns[existing] = [...turns[existing], live]
          ..sort((left, right) => left.batchIndex.compareTo(right.batchIndex));
      } else {
        turns.insert(0, [live]);
      }
      seen.add(id);
    }
    return turns;
  }

  @override
  Widget build(BuildContext context) {
    final turns = _turns();
    final center = widget.authenticated
        ? ref.watch(taskCenterControllerProvider).asData?.value
        : null;
    final loadingMore = center?.isLoadingMore == true;
    if (turns.isEmpty) {
      return const Center(
        child: Text(key: Key('creation-thread'), '生成后会出现在这里，往上滑就能看历史'),
      );
    }
    return ListView.builder(
      key: const Key('creation-thread'),
      controller: _scrollController,
      reverse: true,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      physics: const BouncingScrollPhysics(
        parent: AlwaysScrollableScrollPhysics(),
      ),
      itemCount: turns.length + (loadingMore ? 1 : 0),
      itemBuilder: (context, index) {
        if (index >= turns.length) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Center(
              child: SizedBox.square(
                dimension: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        }
        final tasks = turns[index];
        final groupId = tasks.first.groupKey;
        return _CreationTurn(
          key: Key('creation-turn-$groupId'),
          tasks: tasks,
          models: widget.models,
          generating:
              tasks.any((task) => task.isActive) ||
              (widget.submitting &&
                  tasks.any((task) => widget.pendingTaskIds.contains(task.id))),
          submittedAt:
              tasks.any((task) => widget.pendingTaskIds.contains(task.id))
              ? widget.submittedAt
              : null,
          newest: index == 0,
          busy: tasks.any((task) => task.id == widget.busyTaskId),
          onOpen: widget.onOpen,
          onLongPress: widget.busyTaskId == null
              ? (slot) => widget.onImageActions(slot.task, slot.target)
              : null,
        );
      },
    );
  }
}

class _CreationImageSlot {
  const _CreationImageSlot({
    required this.task,
    required this.groupId,
    required this.index,
    required this.multi,
    required this.imageIndex,
    this.url,
  });

  final TaskItem task;
  final String groupId;
  final int index;
  final bool multi;
  final int imageIndex;
  final String? url;

  bool get hasImage => url != null && url!.isNotEmpty;

  _CreationImageActionTarget get target => _CreationImageActionTarget(
    groupId: groupId,
    index: index,
    multi: multi,
    imageIndex: imageIndex,
  );
}

List<_CreationImageSlot> _creationImageSlots(List<TaskItem> tasks) {
  if (tasks.isEmpty) return const [];
  final groupId = tasks.first.groupKey;
  if (tasks.length == 1) {
    final task = tasks.first;
    final urls = task.previewUrls;
    if (urls.length > 1) {
      return [
        for (var index = 0; index < urls.length; index++)
          _CreationImageSlot(
            task: task,
            groupId: groupId,
            index: index,
            multi: true,
            imageIndex: index,
            url: urls[index],
          ),
      ];
    }
    final expected = task.isActive ? task.batchSize.clamp(1, 4) : 1;
    if (urls.isEmpty && expected > 1) {
      return [
        for (var index = 0; index < expected; index++)
          _CreationImageSlot(
            task: task,
            groupId: groupId,
            index: index,
            multi: true,
            imageIndex: 0,
          ),
      ];
    }
    return [
      _CreationImageSlot(
        task: task,
        groupId: groupId,
        index: 0,
        multi: false,
        imageIndex: 0,
        url: urls.firstOrNull,
      ),
    ];
  }
  return [
    for (var index = 0; index < tasks.length; index++)
      _CreationImageSlot(
        task: tasks[index],
        groupId: groupId,
        index: index,
        multi: true,
        imageIndex: 0,
        url: tasks[index].previewUrls.firstOrNull,
      ),
  ];
}

class _CreationTurn extends StatefulWidget {
  const _CreationTurn({
    required this.tasks,
    required this.models,
    required this.generating,
    required this.newest,
    required this.busy,
    required this.onOpen,
    this.onLongPress,
    this.submittedAt,
    super.key,
  });

  final List<TaskItem> tasks;
  final List<ImageModelOption> models;
  final bool generating;
  final bool newest;
  final bool busy;
  final DateTime? submittedAt;
  final ValueChanged<TaskItem> onOpen;
  final ValueChanged<_CreationImageSlot>? onLongPress;

  @override
  State<_CreationTurn> createState() => _CreationTurnState();
}

class _CreationTurnState extends State<_CreationTurn>
    with SingleTickerProviderStateMixin {
  AnimationController? _clock;
  int? _shownSecond;

  @override
  void initState() {
    super.initState();
    _syncClock();
  }

  @override
  void didUpdateWidget(covariant _CreationTurn oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncClock();
  }

  @override
  void dispose() {
    _stopClock();
    super.dispose();
  }

  void _syncClock() {
    if (!widget.generating) {
      _stopClock();
      return;
    }
    if (_clock != null) return;
    _clock = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    );
    _clock!
      ..addListener(_onClockTick)
      ..repeat();
  }

  void _stopClock() {
    _clock?.removeListener(_onClockTick);
    _clock?.dispose();
    _clock = null;
    _shownSecond = null;
  }

  void _onClockTick() {
    if (!mounted) return;
    final second = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    if (_shownSecond == second) return;
    _shownSecond = second;
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final tasks = widget.tasks;
    final models = widget.models;
    final generating = widget.generating;
    final newest = widget.newest;
    final busy = widget.busy;
    final submittedAt = widget.submittedAt;
    final onOpen = widget.onOpen;
    final onLongPress = widget.onLongPress;
    final colors = Theme.of(context).colorScheme;
    final task = tasks.first;
    final slots = _creationImageSlots(tasks);
    final prompt = task.displayPrompt.trim();
    final spec = _creationMetaItems(
      task,
      models,
      slots.isNotEmpty ? slots.length : tasks.length,
    ).join(' · ');
    final groupElapsed = creationGroupElapsedDuration(
      tasks: tasks,
      active: generating,
      submittedAt: submittedAt,
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (prompt.isNotEmpty) ...[
            Align(
              alignment: Alignment.centerRight,
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxWidth: MediaQuery.sizeOf(context).width * 0.78,
                ),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: colors.primaryContainer,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(18),
                      topRight: Radius.circular(18),
                      bottomLeft: Radius.circular(18),
                      bottomRight: Radius.circular(6),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                    child: Text(
                      prompt,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        height: 1.4,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
          ],
          _CreationTurnResult(
            groupId: task.groupKey,
            slots: slots,
            generating: generating,
            submittedAt: submittedAt,
            onOpen: onOpen,
            onLongPress: onLongPress,
          ),
          if (spec.isNotEmpty || groupElapsed != null) ...[
            const SizedBox(height: 8),
            _CreationResultMeta(
              spec: spec,
              elapsed: groupElapsed,
              total: true,
              marked: newest,
            ),
          ],
          if (busy) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: SizedBox.square(
                dimension: 14,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: colors.primary,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _CreationTurnResult extends StatelessWidget {
  const _CreationTurnResult({
    required this.groupId,
    required this.slots,
    required this.generating,
    required this.onOpen,
    this.submittedAt,
    this.onLongPress,
  });

  final String groupId;
  final List<_CreationImageSlot> slots;
  final bool generating;
  final DateTime? submittedAt;
  final ValueChanged<TaskItem> onOpen;
  final ValueChanged<_CreationImageSlot>? onLongPress;

  static const _imageHeight = 220.0;

  Duration? _slotElapsed(_CreationImageSlot slot) => creationElapsedDuration(
    active: slot.task.isActive,
    startedAt: slot.task.startedAt,
    finishedAt: slot.task.finishedAt,
    createdAt: slot.task.createdAt,
    submittedAt: submittedAt,
  );

  @override
  Widget build(BuildContext context) {
    final task = slots.firstOrNull?.task;
    final aspect = task == null ? 1.0 : (_creationAspectRatio(task) ?? 1);
    if (slots.isEmpty ||
        (generating &&
            slots.length == 1 &&
            slots.every((slot) => !slot.hasImage))) {
      final only = slots.firstOrNull;
      return _CreationTurnFrame(
        key: Key('creation-current-$groupId'),
        aspect: aspect,
        child: _CreationGeneratingOverlay(
          compact: false,
          elapsed: only == null ? null : _slotElapsed(only),
          marked: true,
        ),
      );
    }
    if (slots.length == 1 && !slots.first.hasImage) {
      final only = slots.first.task;
      final failed = only.status == 'failed';
      final canceled = only.status == 'canceled';
      return _CreationTurnFrame(
        key: Key('creation-current-$groupId'),
        aspect: aspect,
        child: _CreationOutcomeOverlay(
          failed: failed,
          canceled: canceled,
          message: failed
              ? (only.errorMessage?.trim().isNotEmpty == true
                    ? only.errorMessage!.trim()
                    : '生成过程中遇到问题，请稍后重试')
              : canceled
              ? '这次任务没有生成图片'
              : '暂未找到作品图片',
        ),
      );
    }
    if (slots.length == 1 && slots.first.hasImage) {
      final slot = slots.first;
      return _CreationTurnImage(
        key: Key('creation-current-${slot.task.id}'),
        url: slot.url!,
        aspect: aspect,
        duration: _slotElapsed(slot),
        markedDuration: true,
        onOpen: () => onOpen(slot.task),
        onLongPress: onLongPress == null ? null : () => onLongPress!(slot),
      );
    }
    return SizedBox(
      height: _imageHeight,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        itemCount: slots.length,
        separatorBuilder: (context, index) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final slot = slots[index];
          final key = Key('creation-current-$groupId-$index');
          final elapsed = _slotElapsed(slot);
          if (!slot.hasImage) {
            return SizedBox(
              width: _imageHeight * aspect,
              height: _imageHeight,
              child: _CreationTurnFrame(
                key: key,
                aspect: aspect,
                child: slot.task.isActive
                    ? _CreationGeneratingOverlay(
                        compact: false,
                        elapsed: elapsed,
                        marked: index == 0,
                      )
                    : _CreationOutcomeOverlay(
                        failed: slot.task.status == 'failed',
                        canceled: slot.task.status == 'canceled',
                        message: slot.task.status == 'failed'
                            ? (slot.task.errorMessage?.trim().isNotEmpty == true
                                  ? slot.task.errorMessage!.trim()
                                  : '生成过程中遇到问题，请稍后重试')
                            : '暂未找到作品图片',
                      ),
              ),
            );
          }
          return _CreationTurnImage(
            key: key,
            url: slot.url!,
            aspect: aspect,
            height: _imageHeight,
            duration: elapsed,
            markedDuration: index == 0,
            onOpen: () => onOpen(slot.task),
            onLongPress: onLongPress == null ? null : () => onLongPress!(slot),
          );
        },
      ),
    );
  }
}

class _CreationTurnImage extends StatelessWidget {
  const _CreationTurnImage({
    required this.url,
    required this.aspect,
    required this.onOpen,
    this.onLongPress,
    this.height,
    this.duration,
    this.markedDuration = false,
    super.key,
  });

  final String url;
  final double aspect;
  final double? height;
  final Duration? duration;
  final bool markedDuration;
  final VoidCallback onOpen;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxWidth = height == null
            ? constraints.maxWidth
            : height! * aspect;
        var width = maxWidth;
        var frameHeight = width / aspect;
        if (height != null) {
          frameHeight = height!;
          width = frameHeight * aspect;
        } else if (frameHeight > 520) {
          frameHeight = 520;
          width = frameHeight * aspect;
        }
        return Align(
          alignment: Alignment.centerLeft,
          child: AppPressable(
            onTap: onOpen,
            onLongPress: onLongPress,
            child: ClipRRect(
              borderRadius: StarCloudsRadii.card,
              child: SizedBox(
                width: width,
                height: frameHeight,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    AuthenticatedImage(url: url, fit: BoxFit.cover),
                    if (duration != null)
                      Positioned(
                        left: 8,
                        right: 8,
                        bottom: 8,
                        child: Text(
                          key: markedDuration
                              ? const Key('creation-slot-elapsed')
                              : null,
                          '${duration!.isNegative ? 0 : duration!.inSeconds}s',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.labelLarge
                              ?.copyWith(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                                shadows: const [
                                  Shadow(
                                    color: Color(0x99000000),
                                    blurRadius: 10,
                                  ),
                                ],
                              ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _CreationTurnFrame extends StatelessWidget {
  const _CreationTurnFrame({
    required this.aspect,
    required this.child,
    super.key,
  });

  final double aspect;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        var width = constraints.maxWidth;
        var height = width / aspect;
        if (height > 360) {
          height = 360;
          width = height * aspect;
        }
        return Align(
          alignment: Alignment.centerLeft,
          child: ClipRRect(
            borderRadius: StarCloudsRadii.card,
            child: SizedBox(width: width, height: height, child: child),
          ),
        );
      },
    );
  }
}

class CreationResultStage extends StatefulWidget {
  const CreationResultStage({
    super.key,
    required this.generating,
    required this.fallbackCount,
    required this.onOpen,
    this.task,
    this.submittedAt,
    this.models = const [],
  });

  final TaskItem? task;
  final bool generating;
  final int fallbackCount;
  final DateTime? submittedAt;
  final List<ImageModelOption> models;
  final ValueChanged<TaskItem> onOpen;

  @override
  State<CreationResultStage> createState() => _CreationResultStageState();
}

class _CreationResultStageState extends State<CreationResultStage> {
  var _selected = 0;
  Timer? _elapsedTimer;

  @override
  void initState() {
    super.initState();
    _syncElapsedTimer();
  }

  @override
  void didUpdateWidget(covariant CreationResultStage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.task?.id != widget.task?.id) _selected = 0;
    _syncElapsedTimer();
  }

  @override
  void dispose() {
    _elapsedTimer?.cancel();
    super.dispose();
  }

  void _syncElapsedTimer() {
    if (widget.generating) {
      _elapsedTimer ??= Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
      return;
    }
    _elapsedTimer?.cancel();
    _elapsedTimer = null;
  }

  Duration? get _elapsed => creationElapsedDuration(
    active: widget.generating,
    startedAt: widget.task?.startedAt,
    finishedAt: widget.task?.finishedAt,
    createdAt: widget.task?.createdAt,
    submittedAt: widget.submittedAt,
  );

  @override
  Widget build(BuildContext context) {
    final urls = widget.task?.previewUrls ?? const <String>[];
    final count = urls.isNotEmpty
        ? urls.length
        : (widget.task?.count ?? widget.fallbackCount).clamp(1, 4);
    final selected = _selected.clamp(0, count - 1);
    final spec = widget.task == null
        ? ''
        : _creationMetaItems(widget.task!, widget.models).join(' · ');
    final elapsed = _elapsed;
    final showMeta = spec.isNotEmpty || (!widget.generating && elapsed != null);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Column(
        children: [
          if (showMeta) ...[
            _CreationResultMeta(
              spec: spec,
              elapsed: widget.generating ? null : elapsed,
              marked: true,
            ),
            const SizedBox(height: 8),
          ],
          Expanded(
            child: Center(
              child: Stack(
                alignment: Alignment.bottomCenter,
                children: [
                  _CreationResultTile(
                    key: Key(
                      'creation-current-${widget.task?.id ?? 'pending'}',
                    ),
                    task: widget.task,
                    imageUrl: selected < urls.length ? urls[selected] : null,
                    generating: widget.generating && urls.isEmpty,
                    elapsed: elapsed,
                    expand: true,
                    onTap: widget.task == null
                        ? null
                        : () => widget.onOpen(widget.task!),
                  ),
                  if (count > 1)
                    Positioned(
                      left: 10,
                      right: 10,
                      bottom: 10,
                      child: _CreationVariantStrip(
                        task: widget.task,
                        urls: urls,
                        count: count,
                        selected: selected,
                        generating: widget.generating && urls.isEmpty,
                        onSelect: (index) => setState(() => _selected = index),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CreationResultMeta extends StatelessWidget {
  const _CreationResultMeta({
    required this.spec,
    this.elapsed,
    this.total = false,
    this.marked = false,
  });

  final String spec;
  final Duration? elapsed;
  final bool total;
  final bool marked;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final style = Theme.of(context).textTheme.labelMedium?.copyWith(
      color: colors.onSurfaceVariant,
      fontWeight: FontWeight.w600,
    );
    if (spec.isEmpty && elapsed == null) return const SizedBox.shrink();
    final duration = elapsed == null
        ? null
        : total
        ? '总生成耗时 ${creationDurationLabel(elapsed!)}'
        : creationDurationLabel(elapsed!);
    return Row(
      children: [
        if (spec.isNotEmpty)
          Expanded(
            child: Text(
              key: marked ? const Key('creation-current-meta') : null,
              spec,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: style,
            ),
          )
        else
          const Spacer(),
        if (duration != null)
          Text(
            key: marked ? const Key('creation-current-elapsed') : null,
            duration,
            style: style,
          ),
      ],
    );
  }
}

class _CreationVariantStrip extends StatelessWidget {
  const _CreationVariantStrip({
    required this.urls,
    required this.count,
    required this.selected,
    required this.generating,
    required this.onSelect,
    this.task,
  });

  final TaskItem? task;
  final List<String> urls;
  final int count;
  final int selected;
  final bool generating;
  final ValueChanged<int> onSelect;

  static const _size = 40.0;
  static const _gap = 5.0;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: .38),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white.withValues(alpha: .16)),
            ),
            child: Padding(
              padding: const EdgeInsets.all(4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (var index = 0; index < count; index++) ...[
                    if (index > 0) const SizedBox(width: _gap),
                    _CreationResultTile(
                      key: Key(
                        'creation-current-${task?.id ?? 'pending'}-$index',
                      ),
                      task: task,
                      imageUrl: index < urls.length ? urls[index] : null,
                      generating: generating,
                      size: _size,
                      selected: index == selected,
                      onTap: () => onSelect(index),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CreationResultTile extends StatelessWidget {
  const _CreationResultTile({
    this.task,
    this.imageUrl,
    this.generating = false,
    this.elapsed,
    this.expand = false,
    this.size = 80,
    this.selected = false,
    this.onTap,
    super.key,
  });

  final TaskItem? task;
  final String? imageUrl;
  final bool generating;
  final Duration? elapsed;
  final bool expand;
  final double size;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final preview = imageUrl ?? task?.previewUrls.firstOrNull ?? '';
    final failed = task?.status == 'failed';
    final canceled = task?.status == 'canceled';
    final radius = BorderRadius.circular(
      expand
          ? 22
          : size <= 44
          ? 8
          : 14,
    );
    final overlay = generating
        ? _CreationGeneratingOverlay(
            compact: !expand,
            elapsed: elapsed,
            marked: expand,
          )
        : expand && (failed || canceled || preview.isEmpty)
        ? _CreationOutcomeOverlay(
            failed: failed,
            canceled: canceled,
            message: failed
                ? (task?.errorMessage?.trim().isNotEmpty == true
                      ? task!.errorMessage!.trim()
                      : '生成过程中遇到问题，请稍后重试')
                : canceled
                ? '这次任务没有生成图片'
                : '暂未找到作品图片',
          )
        : null;
    final visual = StarCloudsVisualStyle.of(context);
    final photo = preview.isEmpty
        ? ColoredBox(
            color: colors.surfaceContainerLow,
            child: expand
                ? const SizedBox(width: 240, height: 320)
                : const SizedBox.expand(),
          )
        : AuthenticatedImage(
            url: preview,
            fit: expand ? BoxFit.contain : BoxFit.cover,
          );
    final child = DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        border: selected
            ? Border.all(
                color: size <= 44 ? Colors.white : colors.primary,
                width: size <= 44 ? 1.5 : 2,
              )
            : null,
        boxShadow: expand
            ? [
                BoxShadow(
                  color: visual.shadow.withValues(alpha: .18),
                  blurRadius: 28,
                  offset: const Offset(0, 10),
                ),
              ]
            : null,
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: Stack(
          alignment: Alignment.center,
          fit: expand ? StackFit.loose : StackFit.expand,
          children: [
            photo,
            if (overlay != null)
              expand ? Positioned.fill(child: overlay) : overlay,
          ],
        ),
      ),
    );
    final painted = onTap == null
        ? child
        : AppPressable(onTap: onTap, child: child);
    if (expand) return painted;
    return SizedBox.square(dimension: size, child: painted);
  }
}

class _CreationGeneratingOverlay extends StatefulWidget {
  const _CreationGeneratingOverlay({
    required this.compact,
    this.elapsed,
    this.marked = false,
  });

  final bool compact;
  final Duration? elapsed;
  final bool marked;

  @override
  State<_CreationGeneratingOverlay> createState() =>
      _CreationGeneratingOverlayState();
}

class _CreationGeneratingOverlayState extends State<_CreationGeneratingOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _motion;

  @override
  void initState() {
    super.initState();
    _motion = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 10000),
    )..repeat();
  }

  @override
  void dispose() {
    _motion.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final visual = StarCloudsVisualStyle.of(context);
    final seconds = widget.elapsed == null
        ? 0
        : (widget.elapsed!.isNegative ? 0 : widget.elapsed!.inSeconds);
    return AnimatedBuilder(
      animation: _motion,
      builder: (context, child) {
        return Stack(
          fit: StackFit.expand,
          children: [
            Positioned.fill(
              child: CustomPaint(
                painter: _CinemaParticleGradientPainter(
                  progress: _motion.value,
                  brandStart: visual.brandStart,
                  brandEnd: visual.brandEnd,
                  compact: widget.compact,
                ),
              ),
            ),
            Center(
              child: Text(
                key: widget.marked ? const Key('creation-slot-elapsed') : null,
                '${seconds}s',
                style:
                    (widget.compact
                            ? Theme.of(context).textTheme.labelLarge
                            : Theme.of(context).textTheme.headlineMedium)
                        ?.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          letterSpacing: widget.compact ? 0 : 0.6,
                          shadows: const [
                            Shadow(color: Color(0x66000000), blurRadius: 12),
                          ],
                        ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _CinemaParticleGradientPainter extends CustomPainter {
  const _CinemaParticleGradientPainter({
    required this.progress,
    required this.brandStart,
    required this.brandEnd,
    required this.compact,
  });

  final double progress;
  final Color brandStart;
  final Color brandEnd;
  final bool compact;

  static double _fract(double value) => value - value.floorToDouble();

  static double _hash(double seed) => _fract(math.sin(seed) * 43758.5453123);

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final rect = Offset.zero & size;
    final t = progress * math.pi * 2;

    canvas.drawRect(rect, Paint()..color = const Color(0xFF070510));

    final wash = Offset(
      size.width * (0.38 + 0.28 * math.sin(t * 0.55)),
      size.height * (0.36 + 0.22 * math.cos(t * 0.42)),
    );
    canvas.drawRect(
      rect,
      Paint()
        ..shader =
            RadialGradient(
              colors: [
                Color.lerp(
                  brandStart,
                  Colors.white,
                  0.2,
                )!.withValues(alpha: 0.9),
                brandStart.withValues(alpha: 0.52),
                brandEnd.withValues(alpha: 0.3),
                const Color(0xFF070510).withValues(alpha: 0),
              ],
              stops: const [0, 0.22, 0.56, 1],
            ).createShader(
              Rect.fromCircle(center: wash, radius: size.longestSide * 0.95),
            ),
    );

    final bloom = Offset(
      size.width * (0.74 + 0.14 * math.cos(t * 0.48)),
      size.height * (0.7 + 0.12 * math.sin(t * 0.63)),
    );
    canvas.drawRect(
      rect,
      Paint()
        ..shader =
            RadialGradient(
              colors: [
                brandEnd.withValues(alpha: compact ? 0.28 : 0.4),
                const Color(0x00000000),
              ],
            ).createShader(
              Rect.fromCircle(center: bloom, radius: size.shortestSide * 0.72),
            ),
    );

    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment(-0.85 + 0.35 * math.sin(t * 0.5), -1),
          end: Alignment(0.85 + 0.2 * math.cos(t * 0.4), 1),
          colors: [
            const Color(0x00000000),
            Colors.white.withValues(alpha: 0.08),
            brandStart.withValues(alpha: 0.2),
            Colors.white.withValues(alpha: 0.06),
            const Color(0x00000000),
          ],
          stops: const [0, 0.38, 0.5, 0.64, 1],
        ).createShader(rect),
    );

    final bokehCount = compact ? 2 : 4;
    for (var index = 0; index < bokehCount; index++) {
      final seed = 11.0 + index * 17.3;
      final origin = Offset(
        _hash(seed) * size.width,
        _hash(seed + 2.1) * size.height,
      );
      final center = Offset(
        origin.dx +
            math.sin(t * (0.38 + index * 0.12) + index) * size.width * 0.08,
        origin.dy +
            math.cos(t * (0.3 + index * 0.1) + index * 1.6) *
                size.height *
                0.07,
      );
      final radius =
          size.shortestSide *
          (compact ? 0.2 : 0.24) *
          (0.55 + 0.45 * _hash(seed + 4.4));
      canvas.drawCircle(
        center,
        radius,
        Paint()
          ..shader = RadialGradient(
            colors: [
              Color.lerp(
                brandEnd,
                Colors.white,
                0.32,
              )!.withValues(alpha: compact ? 0.16 : 0.24),
              const Color(0x00000000),
            ],
          ).createShader(Rect.fromCircle(center: center, radius: radius)),
      );
    }

    final count = compact ? 8 : 28;
    for (var index = 0; index < count; index++) {
      final seed = 100.0 + index * 9.13;
      final x = _fract(_hash(seed) + 0.045 * math.sin(t + index * 0.71));
      final y = _fract(
        _hash(seed + 1.9) - progress * (0.12 + 0.36 * _hash(seed + 3.1)),
      );
      final radius = (compact ? 0.7 : 1.2) * (0.55 + 1.7 * _hash(seed + 5.2));
      final twinkle =
          0.22 + 0.78 * (0.5 + 0.5 * math.sin(t * 2.4 + index * 1.35));
      final color = Color.lerp(
        Colors.white,
        brandStart,
        _hash(seed + 8.4),
      )!.withValues(alpha: twinkle * (compact ? 0.5 : 0.88));
      final point = Offset(x * size.width, y * size.height);
      if (!compact && index % 4 == 0) {
        canvas.drawCircle(
          point,
          radius * 3.1,
          Paint()..color = color.withValues(alpha: color.a * 0.2),
        );
      }
      canvas.drawCircle(point, radius, Paint()..color = color);
    }

    canvas.drawRect(
      rect,
      Paint()
        ..shader = RadialGradient(
          colors: [
            const Color(0x00000000),
            Colors.black.withValues(alpha: compact ? 0.26 : 0.4),
          ],
          stops: const [0.55, 1],
        ).createShader(rect),
    );
  }

  @override
  bool shouldRepaint(covariant _CinemaParticleGradientPainter oldDelegate) =>
      oldDelegate.progress != progress ||
      oldDelegate.brandStart != brandStart ||
      oldDelegate.brandEnd != brandEnd ||
      oldDelegate.compact != compact;
}

class _CreationOutcomeOverlay extends StatelessWidget {
  const _CreationOutcomeOverlay({
    required this.failed,
    required this.canceled,
    required this.message,
  });

  final bool failed;
  final bool canceled;
  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final title = failed
        ? '本次创作未完成'
        : canceled
        ? '创作已停止'
        : '暂未找到作品图片';
    return ColoredBox(
      color: colors.surfaceContainerLow.withValues(alpha: .94),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              failed
                  ? Icons.error_outline
                  : canceled
                  ? Icons.stop_circle_outlined
                  : Icons.image_outlined,
              size: 36,
              color: failed ? colors.error : colors.onSurfaceVariant,
            ),
            const SizedBox(height: 12),
            Text(
              key: const Key('creation-current-status'),
              title,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            Text(
              key: const Key('creation-current-error'),
              message,
              textAlign: TextAlign.center,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: failed ? colors.error : colors.onSurfaceVariant,
                height: 1.35,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PromptComposer extends StatelessWidget {
  const _PromptComposer({
    required this.controller,
    required this.submitting,
    required this.submissionLabel,
    required this.estimatedCost,
    required this.onSubmit,
    required this.fill,
    required this.refLimit,
    required this.references,
    required this.selecting,
    required this.onAddReference,
    required this.onRemoveReference,
    required this.onReorderReferences,
  });

  final TextEditingController controller;
  final bool submitting;
  final String submissionLabel;
  final int estimatedCost;
  final VoidCallback onSubmit;
  final Color fill;
  final int refLimit;
  final List<ReferenceImageDraft> references;
  final bool selecting;
  final VoidCallback onAddReference;
  final ValueChanged<int> onRemoveReference;
  final ReorderCallback onReorderReferences;

  Future<void> _openReferencesSheet(BuildContext context) {
    return showAppSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return CreationReferencesSheet(
              references: references,
              maxReferences: refLimit,
              busy: submitting,
              selecting: selecting,
              onAdd: () {
                Navigator.pop(sheetContext);
                onAddReference();
              },
              onRemove: (index) {
                onRemoveReference(index);
                if (references.isEmpty) {
                  Navigator.pop(sheetContext);
                } else {
                  setSheetState(() {});
                }
              },
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: fill,
          borderRadius: StarCloudsRadii.card,
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 8, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                key: const Key('creation-prompt'),
                controller: controller,
                minLines: 3,
                maxLines: 5,
                maxLength: 20000,
                buildCounter:
                    (
                      context, {
                      required currentLength,
                      required isFocused,
                      maxLength,
                    }) => null,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  height: 1.5,
                  letterSpacing: -0.15,
                ),
                textAlignVertical: TextAlignVertical.top,
                textInputAction: TextInputAction.newline,
                decoration: const InputDecoration(
                  hintText: '想画什么，直接写下来',
                  alignLabelWithHint: true,
                  filled: false,
                  contentPadding: EdgeInsets.fromLTRB(14, 4, 10, 8),
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                ),
              ),
              Row(
                children: [
                  if (refLimit > 0 &&
                      references.length < refLimit &&
                      references.length <= 4) ...[
                    _CreateAddReferenceButton(
                      selecting: selecting,
                      enabled: !submitting,
                      onPressed: onAddReference,
                    ),
                    const SizedBox(width: 8),
                  ],
                  if (references.isNotEmpty) ...[
                    CreationReferenceStrip(
                      references: references,
                      maxReferences: refLimit,
                      busy: submitting,
                      selecting: selecting,
                      tileSize: _composerActionSize,
                      includeAddButton: false,
                      maxVisible: 4,
                      onAdd: onAddReference,
                      onRemove: onRemoveReference,
                      onReorder: onReorderReferences,
                      onExpand: () => _openReferencesSheet(context),
                    ),
                    const SizedBox(width: 8),
                  ],
                  const Spacer(),
                  _CreateSubmitButton(
                    submitting: submitting,
                    submissionLabel: submissionLabel,
                    estimatedCost: estimatedCost,
                    onPressed: submitting ? null : onSubmit,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

const _composerActionSize = 40.0;

class _CreateAddReferenceButton extends StatelessWidget {
  const _CreateAddReferenceButton({
    required this.selecting,
    required this.enabled,
    required this.onPressed,
    this.expand = false,
  });

  final bool selecting;
  final bool enabled;
  final VoidCallback onPressed;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final radius = expand ? 16.0 : 14.0;
    final button = Material(
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radius),
        side: BorderSide(color: colors.outlineVariant),
      ),
      child: InkWell(
        key: const Key('creation-add-reference'),
        onTap: enabled && !selecting ? onPressed : null,
        borderRadius: BorderRadius.circular(radius),
        child: Center(
          child: selecting
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Icon(
                  Icons.add_rounded,
                  size: expand ? 28 : 22,
                  color: colors.onSurface,
                ),
        ),
      ),
    );
    return expand
        ? button
        : SizedBox.square(dimension: _composerActionSize, child: button);
  }
}

class _CreateSubmitButton extends StatelessWidget {
  const _CreateSubmitButton({
    required this.submitting,
    required this.submissionLabel,
    required this.estimatedCost,
    required this.onPressed,
  });

  final bool submitting;
  final String submissionLabel;
  final int estimatedCost;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final visual = StarCloudsVisualStyle.of(context);
    final label = submissionLabel.isNotEmpty
        ? submissionLabel
        : estimatedCost > 0
        ? '消耗 $estimatedCost 积分'
        : '生成';
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: onPressed == null ? null : visual.brandGradient,
        color: onPressed == null
            ? Theme.of(context).disabledColor.withValues(alpha: .18)
            : null,
        borderRadius: StarCloudsRadii.pillAll,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          key: const Key('creation-submit'),
          onTap: onPressed,
          borderRadius: StarCloudsRadii.pillAll,
          child: SizedBox(
            height: _composerActionSize,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 16, 0),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (submitting) ...[
                    const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(width: 6),
                  ],
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 168),
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CreationSettingsDock extends StatelessWidget {
  const _CreationSettingsDock({
    required this.modelName,
    required this.aspectRatio,
    required this.resolution,
    required this.quality,
    required this.count,
    required this.onOpen,
    this.enabled = true,
  });

  final String modelName;
  final String aspectRatio;
  final String resolution;
  final String quality;
  final int count;
  final bool enabled;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final items = [
      modelName,
      _ratioLabel(aspectRatio),
      resolution,
      quality,
      '$count 张',
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
      child: Semantics(
        button: true,
        label: '生成设置',
        child: AppPressable(
          key: const Key('creation-settings'),
          onTap: enabled ? onOpen : null,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: dark ? const Color(0xFF16181F) : const Color(0xFFF5F5F7),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
              child: Row(
                children: [
                  Expanded(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          for (var i = 0; i < items.length; i++) ...[
                            if (i > 0)
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                ),
                                child: Text(
                                  '·',
                                  style: TextStyle(
                                    color: colors.onSurfaceVariant.withValues(
                                      alpha: .7,
                                    ),
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            Text(
                              items[i],
                              style: Theme.of(context).textTheme.labelLarge
                                  ?.copyWith(fontWeight: FontWeight.w700),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Icon(
                    Icons.tune_rounded,
                    size: 18,
                    color: colors.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CreationSettingsPanel extends StatelessWidget {
  const _CreationSettingsPanel({
    required this.models,
    required this.model,
    required this.aspectRatio,
    required this.resolution,
    required this.quality,
    required this.count,
    required this.onSelectModel,
    required this.onAspectRatio,
    required this.onResolution,
    required this.onQuality,
    required this.onCount,
    this.enabled = true,
  });

  final List<ImageModelOption> models;
  final ImageModelOption model;
  final String aspectRatio;
  final String resolution;
  final String quality;
  final int count;
  final bool enabled;
  final ValueChanged<ImageModelOption> onSelectModel;
  final ValueChanged<String> onAspectRatio;
  final ValueChanged<String> onResolution;
  final ValueChanged<String> onQuality;
  final ValueChanged<int> onCount;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '生成设置',
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        _SettingsRow(
          title: '模型',
          child: _SettingsChipRail(
            children: [
              for (final item in models)
                _OptionChip(
                  label: item.name,
                  selected: item.id == model.id,
                  onTap: enabled ? () => onSelectModel(item) : null,
                ),
            ],
          ),
        ),
        _SettingsRow(
          title: '画面比例',
          child: _SettingsChipRail(
            children: [
              for (final item in model.aspectRatios)
                _OptionChip(
                  label: _ratioLabel(item),
                  selected: item == aspectRatio,
                  onTap: enabled ? () => onAspectRatio(item) : null,
                ),
            ],
          ),
        ),
        if (model.resolutions.isNotEmpty)
          _SettingsRow(
            title: '清晰度',
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final item in model.resolutions)
                  _OptionChip(
                    label: item,
                    selected: item == resolution,
                    onTap: enabled ? () => onResolution(item) : null,
                  ),
              ],
            ),
          ),
        if (model.qualities.isNotEmpty)
          _SettingsRow(
            title: '质量',
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final item in model.qualities)
                  _OptionChip(
                    label: _qualityLabel(item),
                    selected: item == quality,
                    onTap: enabled ? () => onQuality(item) : null,
                  ),
              ],
            ),
          ),
        _SettingsRow(
          title: '生成数量',
          padded: false,
          child: _CountDock(
            count: count,
            max: model.maxImages,
            enabled: enabled,
            onChanged: onCount,
          ),
        ),
      ],
    );
  }
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({
    required this.title,
    required this.child,
    this.padded = true,
  });

  final String title;
  final Widget child;
  final bool padded;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: padded ? 12 : 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 72,
            child: Padding(
              padding: const EdgeInsets.only(top: 7),
              child: Text(
                title,
                style: Theme.of(
                  context,
                ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
          ),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class _SettingsChipRail extends StatelessWidget {
  const _SettingsChipRail({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      child: Row(
        children: [
          for (var index = 0; index < children.length; index++) ...[
            if (index > 0) const SizedBox(width: 6),
            children[index],
          ],
        ],
      ),
    );
  }
}

class _OptionChip extends StatelessWidget {
  const _OptionChip({required this.label, required this.selected, this.onTap});

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return AppPressable(
      onTap: selected ? null : onTap,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: selected
              ? colors.onSurface
              : dark
              ? const Color(0xFF22242C)
              : const Color(0xFFF2F2F7),
          borderRadius: StarCloudsRadii.pillAll,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? colors.surface : colors.onSurface,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _CountDock extends StatelessWidget {
  const _CountDock({
    required this.count,
    required this.max,
    required this.enabled,
    required this.onChanged,
  });

  final int count;
  final int max;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Align(
      alignment: Alignment.centerLeft,
      child: Material(
        color: dark ? const Color(0xFF22242C) : const Color(0xFFF2F2F7),
        borderRadius: BorderRadius.circular(14),
        child: SizedBox(
          height: 36,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                tooltip: '减少',
                visualDensity: VisualDensity.compact,
                style: IconButton.styleFrom(
                  minimumSize: const Size(36, 36),
                  padding: EdgeInsets.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                onPressed: enabled && count > 1
                    ? () => onChanged(count - 1)
                    : null,
                icon: const Icon(Icons.remove, size: 18),
              ),
              ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 44),
                child: Text(
                  '$count 张',
                  textAlign: TextAlign.center,
                  style: Theme.of(
                    context,
                  ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              IconButton(
                tooltip: '增加',
                visualDensity: VisualDensity.compact,
                style: IconButton.styleFrom(
                  minimumSize: const Size(36, 36),
                  padding: EdgeInsets.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                onPressed: enabled && count < max
                    ? () => onChanged(count + 1)
                    : null,
                icon: const Icon(Icons.add, size: 18),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class CreationReferenceStrip extends StatelessWidget {
  const CreationReferenceStrip({
    required this.references,
    required this.maxReferences,
    required this.busy,
    required this.selecting,
    required this.onAdd,
    required this.onRemove,
    required this.onReorder,
    this.tileSize = 92,
    this.includeAddButton = true,
    this.maxVisible,
    this.onExpand,
    super.key,
  });

  final List<ReferenceImageDraft> references;
  final int maxReferences;
  final bool busy;
  final bool selecting;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;
  final ReorderCallback onReorder;
  final double tileSize;
  final bool includeAddButton;
  final int? maxVisible;
  final VoidCallback? onExpand;

  static const _compactGap = 6.0;
  static const _compactRadius = 12.0;

  Widget _buildCompactRail(BuildContext context) {
    final overflow =
        maxVisible != null &&
        onExpand != null &&
        references.length > maxVisible!;
    final visibleCount = overflow
        ? maxVisible!
        : references.length.clamp(1, maxVisible ?? references.length);
    final slots = visibleCount + (overflow ? 1 : 0);
    final width =
        slots * tileSize + (slots > 1 ? (slots - 1) * _compactGap : 0);
    return SizedBox(
      key: const Key('creation-reference-strip'),
      width: width,
      height: tileSize,
      child: Row(
        children: [
          for (var index = 0; index < visibleCount; index++) ...[
            if (index > 0) const SizedBox(width: _compactGap),
            _CreationReferenceThumb(
              image: references[index],
              index: index,
              size: tileSize,
              radius: _compactRadius,
              busy: busy,
              compact: true,
              onRemove: () => onRemove(index),
            ),
          ],
          if (overflow) ...[
            const SizedBox(width: _compactGap),
            _CreationReferenceOverflowButton(
              size: tileSize,
              radius: _compactRadius,
              onPressed: onExpand,
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final compact = tileSize <= 48;
    if (compact && !includeAddButton) {
      return _buildCompactRail(context);
    }
    final canAdd = includeAddButton && references.length < maxReferences;
    final radius = 18.0;
    final control = 30.0;
    return SizedBox(
      key: const Key('creation-reference-strip'),
      height: tileSize + 8,
      child: ReorderableListView.builder(
        scrollDirection: Axis.horizontal,
        buildDefaultDragHandles: false,
        itemCount: references.length,
        onReorder: onReorder,
        proxyDecorator: (child, index, animation) => Material(
          elevation: 5,
          borderRadius: BorderRadius.circular(radius),
          clipBehavior: Clip.antiAlias,
          child: child,
        ),
        footer: canAdd
            ? Padding(
                padding: const EdgeInsets.only(right: 8),
                child: SizedBox.square(
                  dimension: tileSize,
                  child: OutlinedButton(
                    key: const Key('creation-add-reference'),
                    onPressed: busy || selecting ? null : onAdd,
                    style: OutlinedButton.styleFrom(
                      padding: EdgeInsets.zero,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(radius),
                      ),
                    ),
                    child: selecting
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.add_photo_alternate_outlined),
                  ),
                ),
              )
            : null,
        itemBuilder: (context, index) {
          final image = references[index];
          final tile = SizedBox.square(
            dimension: tileSize,
            child: Stack(
              fit: StackFit.expand,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(radius),
                  child: image.localPath.isNotEmpty
                      ? Image.file(File(image.localPath), fit: BoxFit.cover)
                      : AuthenticatedImage(url: image.remoteUrl ?? ''),
                ),
                if (!compact)
                  Positioned(
                    left: 4,
                    bottom: 4,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.68),
                        borderRadius: BorderRadius.circular(5),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (image.sourceAssetId != null) ...[
                            const Icon(
                              Icons.collections_outlined,
                              size: 11,
                              color: Colors.white,
                            ),
                            const SizedBox(width: 3),
                          ],
                          Text(
                            index == 0 ? '主参考' : '${index + 1}',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                Positioned(
                  right: compact ? 2 : 4,
                  top: compact ? 2 : 4,
                  child: IconButton.filled(
                    tooltip: '移除${index == 0 ? '主参考' : '第 ${index + 1} 张参考图'}',
                    onPressed: busy ? null : () => onRemove(index),
                    icon: Icon(Icons.close, size: compact ? 12 : 16),
                    constraints: BoxConstraints.tightFor(
                      width: control,
                      height: control,
                    ),
                    padding: EdgeInsets.zero,
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.black54,
                      foregroundColor: Colors.white,
                    ),
                  ),
                ),
                if (!compact && !busy && references.length > 1)
                  Positioned(
                    right: 4,
                    bottom: 4,
                    child: Tooltip(
                      message: '拖动调整顺序',
                      child: ReorderableDelayedDragStartListener(
                        index: index,
                        child: Container(
                          width: 30,
                          height: 30,
                          decoration: BoxDecoration(
                            color: Colors.black54,
                            borderRadius: BorderRadius.circular(15),
                          ),
                          child: const Icon(
                            Icons.drag_indicator,
                            size: 18,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          );
          return Padding(
            key: ObjectKey(image),
            padding: EdgeInsets.only(
              right: 8,
              bottom: includeAddButton ? 8 : 0,
            ),
            child: Semantics(
              label: index == 0
                  ? '${image.filename}，主参考'
                  : '${image.filename}，第 ${index + 1} 张参考图',
              child: compact && !busy && references.length > 1
                  ? ReorderableDelayedDragStartListener(
                      index: index,
                      child: tile,
                    )
                  : tile,
            ),
          );
        },
      ),
    );
  }
}

class CreationReferencesSheet extends StatelessWidget {
  const CreationReferencesSheet({
    required this.references,
    required this.maxReferences,
    required this.busy,
    required this.selecting,
    required this.onAdd,
    required this.onRemove,
    super.key,
  });

  final List<ReferenceImageDraft> references;
  final int maxReferences;
  final bool busy;
  final bool selecting;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    final canAdd = references.length < maxReferences;
    final itemCount = references.length + (canAdd ? 1 : 0);
    return Padding(
      key: const Key('creation-references-sheet'),
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '全部参考图',
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 16),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: itemCount,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
            ),
            itemBuilder: (context, index) {
              if (canAdd && index == references.length) {
                return _CreateAddReferenceButton(
                  selecting: selecting,
                  enabled: !busy,
                  expand: true,
                  onPressed: onAdd,
                );
              }
              return _CreationReferenceThumb(
                image: references[index],
                index: index,
                size: double.infinity,
                radius: 16,
                busy: busy,
                compact: false,
                onRemove: () => onRemove(index),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _CreationReferenceThumb extends StatelessWidget {
  const _CreationReferenceThumb({
    required this.image,
    required this.index,
    required this.size,
    required this.radius,
    required this.busy,
    required this.compact,
    required this.onRemove,
  });

  final ReferenceImageDraft image;
  final int index;
  final double size;
  final double radius;
  final bool busy;
  final bool compact;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final tile = Stack(
      fit: StackFit.expand,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(radius),
          child: image.localPath.isNotEmpty
              ? Image.file(File(image.localPath), fit: BoxFit.cover)
              : AuthenticatedImage(url: image.remoteUrl ?? ''),
        ),
        Positioned(
          right: compact ? 2 : 4,
          top: compact ? 2 : 4,
          child: IconButton.filled(
            tooltip: '移除${index == 0 ? '主参考' : '第 ${index + 1} 张参考图'}',
            onPressed: busy ? null : onRemove,
            icon: Icon(Icons.close, size: compact ? 12 : 16),
            constraints: BoxConstraints.tightFor(
              width: compact ? 18 : 28,
              height: compact ? 18 : 28,
            ),
            padding: EdgeInsets.zero,
            style: IconButton.styleFrom(
              backgroundColor: Colors.black54,
              foregroundColor: Colors.white,
            ),
          ),
        ),
      ],
    );
    return Semantics(
      label: index == 0
          ? '${image.filename}，主参考'
          : '${image.filename}，第 ${index + 1} 张参考图',
      child: size.isFinite
          ? SizedBox.square(dimension: size, child: tile)
          : tile,
    );
  }
}

class _CreationReferenceOverflowButton extends StatelessWidget {
  const _CreationReferenceOverflowButton({
    required this.size,
    required this.radius,
    required this.onPressed,
  });

  final double size;
  final double radius;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SizedBox.square(
      dimension: size,
      child: Material(
        color: colors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radius),
          side: BorderSide(color: colors.outlineVariant),
        ),
        clipBehavior: Clip.antiAlias,
        child: Tooltip(
          message: '查看全部参考图',
          child: InkWell(
            key: const Key('creation-reference-expand'),
            onTap: onPressed,
            child: Icon(
              Icons.keyboard_arrow_up_rounded,
              size: 22,
              color: colors.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}

class CreationPresetBanner extends StatelessWidget {
  const CreationPresetBanner({
    required this.modelName,
    required this.aspectRatio,
    required this.resolution,
    required this.quality,
    required this.count,
    super.key,
  });

  final String modelName;
  final String aspectRatio;
  final String resolution;
  final String quality;
  final int count;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return AppSoftCard(
      color: colors.secondaryContainer,
      padding: const EdgeInsets.all(12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.history, color: colors.onSecondaryContainer),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '沿用历史作品参数',
                  style: TextStyle(
                    color: colors.onSecondaryContainer,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  '$modelName · $aspectRatio · $resolution · $quality · $count 张',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSecondaryContainer,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class CreationCostPanel extends StatelessWidget {
  const CreationCostPanel({
    required this.modelName,
    required this.count,
    required this.unitCost,
    required this.estimatedCost,
    required this.availablePoints,
    super.key,
  });

  final String modelName;
  final int count;
  final int unitCost;
  final int estimatedCost;
  final int? availablePoints;

  @override
  Widget build(BuildContext context) {
    final quote = availablePoints == null
        ? null
        : creationAffordability(availablePoints!, estimatedCost);
    return AppSoftCard(
      key: const Key('creation-cost-panel'),
      padding: const EdgeInsets.all(14),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _ConfirmationRow(label: '模型', value: modelName),
          const SizedBox(height: 10),
          _ConfirmationRow(label: '生成数量', value: '$count 张'),
          const SizedBox(height: 10),
          _ConfirmationRow(
            label: '计费',
            value: '$unitCost × $count = $estimatedCost 积分',
            emphasized: true,
          ),
          if (availablePoints != null && quote != null) ...[
            const Divider(height: 24),
            _ConfirmationRow(label: '当前可用', value: '$availablePoints 积分'),
            const SizedBox(height: 10),
            _ConfirmationRow(
              label: quote.sufficient ? '生成后预计' : '还差',
              value: quote.sufficient
                  ? '${quote.remaining} 积分'
                  : '${quote.missing} 积分',
              danger: !quote.sufficient,
            ),
          ],
        ],
      ),
    );
  }
}

class _ConfirmationRow extends StatelessWidget {
  const _ConfirmationRow({
    required this.label,
    required this.value,
    this.emphasized = false,
    this.danger = false,
  });

  final String label;
  final String value;
  final bool emphasized;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: TextStyle(
              color: danger
                  ? Theme.of(context).colorScheme.error
                  : emphasized
                  ? Theme.of(context).colorScheme.primary
                  : null,
              fontWeight: emphasized || danger
                  ? FontWeight.w800
                  : FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }
}

enum ImageSourceChoice { assets, gallery, camera }

bool _isOpaqueModelId(String value) {
  final id = value.trim();
  if (id.startsWith('model-')) return true;
  final uuid = RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  );
  if (uuid.hasMatch(id)) return true;
  return id.length >= 32 && RegExp(r'^[0-9a-fA-F-]+$').hasMatch(id);
}

String? _creationModelLabel(String? raw, List<ImageModelOption> models) {
  final value = raw?.trim();
  if (value == null || value.isEmpty) return null;
  for (final model in models) {
    if (model.id != value && model.name != value) continue;
    final name = model.name.trim();
    if (name.isNotEmpty && !_isOpaqueModelId(name)) return name;
  }
  if (_isOpaqueModelId(value)) return null;
  return value;
}

List<String> _creationMetaItems(
  TaskItem task, [
  List<ImageModelOption> models = const [],
  int? imageCount,
]) {
  String? parameter(List<String> keys) {
    for (final key in keys) {
      final value = task.params[key]?.toString().trim();
      if (value != null && value.isNotEmpty) return value;
    }
    return null;
  }

  final model = _creationModelLabel(
    parameter(const ['modelHint', 'publicModelKey']) ??
        (task.model.isEmpty ? null : task.model),
    models,
  );
  final ratio = parameter(const ['requestedAspectRatio', 'aspectRatio']);
  final resolution = parameter(const ['resolutionScale', 'resolution']);
  final quality = parameter(const ['quality']);
  return [
    if (model != null && model.isNotEmpty) model,
    if (ratio != null) _ratioLabel(ratio),
    ?resolution,
    if (quality != null) _qualityLabel(quality),
    '${imageCount ?? task.count} 张',
  ];
}

String _ratioLabel(String value) => value == 'auto' ? '自动' : value;

double? _creationAspectRatio(TaskItem task) {
  final raw =
      task.params['requestedAspectRatio']?.toString().trim() ??
      task.params['aspectRatio']?.toString().trim();
  if (raw == null || raw.isEmpty || raw == 'auto') return null;
  final parts = raw.split(':');
  if (parts.length != 2) return null;
  final width = double.tryParse(parts[0]);
  final height = double.tryParse(parts[1]);
  if (width == null || height == null || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
}

String _qualityLabel(String value) => switch (value.toLowerCase()) {
  'low' => '快速',
  'medium' || 'standard' => '标准',
  'high' || 'hd' => '高清',
  _ => value,
};

class _ConfigError extends StatelessWidget {
  const _ConfigError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('模型配置加载失败'),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('重试'),
          ),
        ],
      ),
    );
  }
}
