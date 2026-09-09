import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/authenticated_image.dart';
import '../assets/assets.dart';
import '../assets/assets_screen.dart';
import '../auth/auth.dart';
import '../create/reference_image_service.dart';
import '../profile/profile.dart';
import '../tasks/tasks.dart';
import 'background_remove.dart';
import '../../core/widgets/app_chrome.dart';

enum _ImageSourceChoice { assets, gallery, camera }

class BackgroundRemoveScreen extends ConsumerStatefulWidget {
  const BackgroundRemoveScreen({super.key});

  @override
  ConsumerState<BackgroundRemoveScreen> createState() =>
      _BackgroundRemoveScreenState();
}

class _BackgroundRemoveScreenState extends ConsumerState<BackgroundRemoveScreen>
    with WidgetsBindingObserver {
  ReferenceImageDraft? _source;
  String? _modelId;
  String? _taskId;
  bool _selecting = false;
  bool _submitting = false;
  String _submissionLabel = '';
  Timer? _pollTimer;
  bool _resumed = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (_) => _poll());
    WidgetsBinding.instance.addPostFrameCallback((_) => _recoverLostImage());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _deleteLocal(_source);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _resumed = state == AppLifecycleState.resumed;
    if (_resumed && _taskId != null) {
      ref.invalidate(taskDetailProvider(_taskId!));
    }
  }

  void _poll() {
    final id = _taskId;
    if (!_resumed || !mounted || id == null) return;
    final task = ref.read(taskDetailProvider(id)).asData?.value;
    if (task?.isActive == true) ref.invalidate(taskDetailProvider(id));
  }

  Future<void> _recoverLostImage() async {
    try {
      final images = await ref
          .read(referenceImageServiceProvider)
          .recoverLostImages();
      if (!mounted || images.isEmpty || _source != null) return;
      _replaceSource(images.first);
      for (final image in images.skip(1)) {
        _deleteLocal(image);
      }
    } catch (_) {
      // Lost-data recovery is best effort; the normal picker remains available.
    }
  }

  Future<void> _chooseImage() async {
    if (_selecting || _submitting) return;
    final choice = await showAppSheet<_ImageSourceChoice>(
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
                subtitle: const Text('复用已上传图片，立即开始'),
                onTap: () => Navigator.pop(context, _ImageSourceChoice.assets),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('从相册选择'),
                subtitle: const Text('支持 PNG、JPG、WebP 与 HEIC'),
                onTap: () => Navigator.pop(context, _ImageSourceChoice.gallery),
              ),
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined),
                title: const Text('拍照'),
                subtitle: const Text('拍摄一张主体清晰的照片'),
                onTap: () => Navigator.pop(context, _ImageSourceChoice.camera),
              ),
            ],
          ),
        ),
      ),
    );
    if (choice == null || !mounted) return;
    if (choice == _ImageSourceChoice.assets) {
      final selected = await showAppSheet<List<UserAsset>>(
        context: context,
        isScrollControlled: true,
        builder: (context) => const AssetPickerSheet(maxSelection: 1),
      );
      if (!mounted || selected?.isNotEmpty != true) return;
      final asset = selected!.first;
      final key = asset.inputKey;
      if (key == null) {
        _showMessage('这项素材暂不能用于处理，请重新上传');
        return;
      }
      _replaceSource(
        ReferenceImageDraft(
          localPath: '',
          filename: asset.title,
          remoteKey: key,
          remoteUrl: asset.url,
          sourceAssetId: asset.id,
        ),
      );
      return;
    }

    setState(() => _selecting = true);
    try {
      final service = ref.read(referenceImageServiceProvider);
      final images = choice == _ImageSourceChoice.gallery
          ? await service.pickFromGallery(1)
          : await service.takePhoto();
      if (!mounted || images.isEmpty) return;
      _replaceSource(images.first);
    } catch (error) {
      if (mounted) _showError(error, '图片读取失败，请重新选择');
    } finally {
      if (mounted) setState(() => _selecting = false);
    }
  }

  void _replaceSource(ReferenceImageDraft source) {
    _deleteLocal(_source);
    setState(() {
      _source = source;
      _taskId = null;
    });
  }

  void _clearSource() {
    if (_submitting) return;
    _deleteLocal(_source);
    setState(() {
      _source = null;
      _taskId = null;
    });
  }

  void _deleteLocal(ReferenceImageDraft? image) {
    if (image?.localPath.isNotEmpty == true) {
      File(image!.localPath).delete().ignore();
    }
  }

  Future<void> _submit(BackgroundRemovalModel model) async {
    final source = _source;
    if (source == null || _submitting) return;
    final user = ref.read(sessionControllerProvider).asData?.value.user;
    if (model.pricePoints > 0 && user?.requireCostConfirm != false) {
      final confirmed = await _confirmCost(model);
      if (confirmed != true || !mounted) return;
    }
    setState(() {
      _submitting = true;
      _submissionLabel = source.isRemote ? '正在创建任务' : '正在上传原图';
      _taskId = null;
    });
    try {
      var key = source.remoteKey;
      if (key == null || key.isEmpty) {
        key = await ref
            .read(backgroundRemovalRepositoryProvider)
            .upload(source);
        if (!mounted) return;
        setState(() {
          _source = source.withRemoteKey(key!);
          _submissionLabel = '正在创建任务';
        });
      }
      final task = await ref
          .read(backgroundRemovalRepositoryProvider)
          .create(inputKey: key, model: model);
      ref.invalidate(taskListProvider);
      ref.invalidate(taskCenterControllerProvider);
      ref.invalidate(profileOverviewProvider);
      ref.invalidate(walletProvider);
      if (!mounted) return;
      setState(() => _taskId = task.id);
      ref.invalidate(taskDetailProvider(task.id));
      _showMessage('任务已提交，正在移除背景');
    } catch (error) {
      if (mounted) _showError(error, '任务提交失败，请稍后重试');
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
          _submissionLabel = '';
        });
      }
    }
  }

  Future<bool?> _confirmCost(BackgroundRemovalModel model) async {
    final wallet = ref.read(walletProvider).asData?.value;
    final insufficient =
        wallet != null && wallet.availablePoints < model.pricePoints;
    return showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.auto_fix_high_outlined),
        title: const Text('确认移除背景'),
        content: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _CostRow(label: '处理数量', value: '1 张'),
              const SizedBox(height: 10),
              _CostRow(label: '预计消耗', value: '${model.pricePoints} 积分'),
              if (wallet != null) ...[
                const Divider(height: 24),
                _CostRow(
                  label: '当前可用',
                  value: '${wallet.availablePoints} 积分',
                  danger: insufficient,
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton.icon(
            onPressed: insufficient ? null : () => Navigator.pop(context, true),
            icon: const Icon(Icons.auto_fix_high),
            label: Text(insufficient ? '积分不足' : '确认处理'),
          ),
        ],
      ),
    );
  }

  void _showMessage(String message) {
    AppNotice.info(context, message);
  }

  void _showError(Object error, String fallback) {
    final message = error is ApiException
        ? error.message
        : error is FormatException
        ? error.message
        : fallback;
    AppNotice.error(context, message);
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(backgroundRemovalConfigProvider);
    final task = _taskId == null
        ? null
        : ref.watch(taskDetailProvider(_taskId!));
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('智能去背景'),
        fallbackLocation: '/design',
        actions: [
          IconButton(
            tooltip: '刷新工具配置',
            onPressed: () => ref.invalidate(backgroundRemovalConfigProvider),
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: config.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _ConfigError(
          onRetry: () => ref.invalidate(backgroundRemovalConfigProvider),
        ),
        data: (value) {
          if (!value.enabled) return const _UnavailableState();
          final model = value.models.firstWhere(
            (item) => item.id == _modelId,
            orElse: () => value.defaultModel!,
          );
          return _buildContent(value, model, task);
        },
      ),
    );
  }

  Widget _buildContent(
    BackgroundRemovalConfig config,
    BackgroundRemovalModel model,
    AsyncValue<TaskItem>? task,
  ) {
    final colors = Theme.of(context).colorScheme;
    return SafeArea(
      child: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: colors.primaryContainer.withValues(alpha: 0.45),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: colors.outlineVariant),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.layers_clear_outlined,
                          color: colors.primary,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '主体保留，背景透明',
                                style: Theme.of(context).textTheme.titleMedium
                                    ?.copyWith(fontWeight: FontWeight.w900),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '适合商品图、头像与设计素材，结果以透明 PNG 保存。',
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(color: colors.onSurfaceVariant),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  BackgroundRemovalComparison(
                    source: _source,
                    task: task?.asData?.value,
                    loading: _submitting || task?.isLoading == true,
                    onChoose: _chooseImage,
                    onClear: _source == null ? null : _clearSource,
                  ),
                  if (task?.hasError == true) ...[
                    const SizedBox(height: 10),
                    _InlineError(
                      onRetry: () =>
                          ref.invalidate(taskDetailProvider(_taskId!)),
                    ),
                  ],
                  const SizedBox(height: 14),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '处理配置',
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleMedium
                                          ?.copyWith(
                                            fontWeight: FontWeight.w900,
                                          ),
                                    ),
                                    const SizedBox(height: 3),
                                    Text(
                                      '单张处理 · 透明 PNG',
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodySmall
                                          ?.copyWith(
                                            color: colors.onSurfaceVariant,
                                          ),
                                    ),
                                  ],
                                ),
                              ),
                              Container(
                                key: const Key('background-remove-cost'),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 7,
                                ),
                                decoration: BoxDecoration(
                                  color: colors.secondaryContainer,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  '${model.pricePoints} 积分',
                                  style: TextStyle(
                                    color: colors.onSecondaryContainer,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          if (config.models.length > 1) ...[
                            const SizedBox(height: 14),
                            AppSelectField<String>(
                              label: '处理模型',
                              value: model.id,
                              enabled: !_submitting,
                              options: [
                                for (final item in config.models)
                                  AppSelectOption(
                                    value: item.id,
                                    label: item.label,
                                  ),
                              ],
                              onChanged: (value) =>
                                  setState(() => _modelId = value),
                            ),
                          ],
                          const SizedBox(height: 16),
                          FilledButton.icon(
                            key: const Key('background-remove-submit'),
                            onPressed: _source == null || _submitting
                                ? null
                                : () => _submit(model),
                            icon: _submitting
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.auto_fix_high),
                            label: Text(
                              _submitting
                                  ? _submissionLabel
                                  : task?.asData?.value.isSucceeded == true
                                  ? '重新处理当前图片'
                                  : '移除图片背景',
                            ),
                          ),
                          if (_taskId != null) ...[
                            const SizedBox(height: 8),
                            OutlinedButton.icon(
                              onPressed: () => context.push('/works/$_taskId'),
                              icon: const Icon(Icons.open_in_new),
                              label: const Text('查看作品详情'),
                            ),
                          ],
                        ],
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

class BackgroundRemovalComparison extends StatelessWidget {
  const BackgroundRemovalComparison({
    required this.source,
    required this.task,
    required this.loading,
    required this.onChoose,
    this.onClear,
    super.key,
  });

  final ReferenceImageDraft? source;
  final TaskItem? task;
  final bool loading;
  final VoidCallback onChoose;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final resultUrl = task?.previewUrls.firstOrNull;
    return LayoutBuilder(
      builder: (context, constraints) {
        final panels = [
          _ComparisonPanel(
            label: '原图',
            child: source == null
                ? _EmptySource(onChoose: onChoose)
                : _SourcePreview(source: source!),
          ),
          _ComparisonPanel(
            label: '透明结果',
            checkerboard: true,
            child: resultUrl?.isNotEmpty == true
                ? AuthenticatedImage(url: resultUrl!, fit: BoxFit.contain)
                : _ResultPlaceholder(task: task, loading: loading),
          ),
        ];
        final narrow = constraints.maxWidth < 520;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (narrow)
              ...panels.expand((panel) => [panel, const SizedBox(height: 10)])
            else
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: panels[0]),
                  const SizedBox(width: 12),
                  Expanded(child: panels[1]),
                ],
              ),
            if (source != null)
              Align(
                alignment: Alignment.centerRight,
                child: Wrap(
                  spacing: 4,
                  children: [
                    TextButton.icon(
                      onPressed: onChoose,
                      icon: const Icon(Icons.swap_horiz),
                      label: const Text('更换图片'),
                    ),
                    IconButton(
                      tooltip: '移除图片',
                      onPressed: onClear,
                      icon: const Icon(Icons.delete_outline),
                    ),
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}

class _ComparisonPanel extends StatelessWidget {
  const _ComparisonPanel({
    required this.label,
    required this.child,
    this.checkerboard = false,
  });

  final String label;
  final Widget child;
  final bool checkerboard;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 2, bottom: 7),
          child: Text(
            label,
            style: Theme.of(
              context,
            ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
        ),
        AspectRatio(
          aspectRatio: 4 / 3,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: colors.surfaceContainerLow,
                border: Border.all(color: colors.outlineVariant),
              ),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (checkerboard)
                    CustomPaint(painter: _CheckerboardPainter(colors)),
                  child,
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _CheckerboardPainter extends CustomPainter {
  const _CheckerboardPainter(this.colors);

  final ColorScheme colors;

  @override
  void paint(Canvas canvas, Size size) {
    const tile = 16.0;
    final light = Paint()..color = colors.surface;
    final dark = Paint()..color = colors.surfaceContainerHighest;
    for (var y = 0.0, row = 0; y < size.height; y += tile, row++) {
      for (var x = 0.0, column = 0; x < size.width; x += tile, column++) {
        canvas.drawRect(
          Rect.fromLTWH(x, y, tile, tile),
          (row + column).isEven ? light : dark,
        );
      }
    }
  }

  @override
  bool shouldRepaint(covariant _CheckerboardPainter oldDelegate) =>
      oldDelegate.colors != colors;
}

class _SourcePreview extends StatelessWidget {
  const _SourcePreview({required this.source});

  final ReferenceImageDraft source;

  @override
  Widget build(BuildContext context) => source.remoteUrl?.isNotEmpty == true
      ? AuthenticatedImage(url: source.remoteUrl!, fit: BoxFit.contain)
      : Image.file(
          File(source.localPath),
          fit: BoxFit.contain,
          errorBuilder: (_, _, _) =>
              const Center(child: Icon(Icons.broken_image_outlined, size: 36)),
        );
}

class _EmptySource extends StatelessWidget {
  const _EmptySource({required this.onChoose});

  final VoidCallback onChoose;

  @override
  Widget build(BuildContext context) => InkWell(
    key: const Key('background-remove-picker'),
    onTap: onChoose,
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.add_photo_alternate_outlined, size: 36),
            const SizedBox(height: 10),
            Text(
              '选择一张图片',
              style: Theme.of(
                context,
              ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
    ),
  );
}

class _ResultPlaceholder extends StatelessWidget {
  const _ResultPlaceholder({required this.task, required this.loading});

  final TaskItem? task;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final failed = task != null && !task!.isActive && !task!.isSucceeded;
    final label = failed
        ? task!.errorMessage?.trim().isNotEmpty == true
              ? task!.errorMessage!
              : '处理失败，请重试'
        : task?.status == 'running'
        ? '正在分离主体'
        : task?.status == 'queued'
        ? '正在排队'
        : '完成后在这里预览';
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (loading || task?.isActive == true)
              const CircularProgressIndicator(strokeWidth: 2)
            else
              Icon(
                failed ? Icons.error_outline : Icons.layers_clear_outlined,
                size: 36,
                color: failed
                    ? Theme.of(context).colorScheme.error
                    : Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            const SizedBox(height: 10),
            Text(label, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}

class _CostRow extends StatelessWidget {
  const _CostRow({
    required this.label,
    required this.value,
    this.danger = false,
  });

  final String label;
  final String value;
  final bool danger;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(child: Text(label)),
      const SizedBox(width: 12),
      Text(
        value,
        style: TextStyle(
          fontWeight: FontWeight.w900,
          color: danger ? Theme.of(context).colorScheme.error : null,
        ),
      ),
    ],
  );
}

class _ConfigError extends StatelessWidget {
  const _ConfigError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: OutlinedButton.icon(
      onPressed: onRetry,
      icon: const Icon(Icons.refresh),
      label: const Text('工具配置加载失败，点击重试'),
    ),
  );
}

class _UnavailableState extends StatelessWidget {
  const _UnavailableState();

  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(
      padding: EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.hourglass_empty, size: 42),
          SizedBox(height: 12),
          Text('智能去背景暂未开放'),
        ],
      ),
    ),
  );
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Material(
    color: Theme.of(context).colorScheme.errorContainer,
    borderRadius: BorderRadius.circular(8),
    child: ListTile(
      leading: const Icon(Icons.cloud_off_outlined),
      title: const Text('任务状态读取失败'),
      trailing: IconButton(
        tooltip: '重试',
        onPressed: onRetry,
        icon: const Icon(Icons.refresh),
      ),
    ),
  );
}
