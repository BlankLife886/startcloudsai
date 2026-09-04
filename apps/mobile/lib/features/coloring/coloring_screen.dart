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
import '../create/create.dart';
import '../create/reference_image_service.dart';
import '../profile/profile.dart';
import '../tasks/tasks.dart';
import 'coloring.dart';
import '../../core/widgets/app_chrome.dart';

enum _ColoringImageSource { assets, gallery, camera }

enum _ColoringView { source, result }

const _coloringPresets = <({String label, String prompt})>[
  (label: '清透日系', prompt: '低饱和粉蓝配色，通透空气感，柔和环境光，保持线稿清晰'),
  (label: '电影暖调', prompt: '琥珀金与深青色对比，电影感光影，材质细节完整'),
  (label: '赛博霓虹', prompt: '紫红与电光蓝霓虹配色，冷暖对比，高质感反射'),
];

class ColoringScreen extends ConsumerStatefulWidget {
  const ColoringScreen({this.initialPrompt, super.key});

  final String? initialPrompt;

  @override
  ConsumerState<ColoringScreen> createState() => _ColoringScreenState();
}

class _ColoringScreenState extends ConsumerState<ColoringScreen>
    with WidgetsBindingObserver {
  final _titleController = TextEditingController();
  late final TextEditingController _promptController;
  final List<ReferenceImageDraft> _references = [];
  ReferenceImageDraft? _source;
  String? _modelId;
  String? _aspectRatio;
  String? _resolution;
  String? _quality;
  String? _taskId;
  int _count = 1;
  bool _selecting = false;
  bool _submitting = false;
  bool _resumed = true;
  String _submissionLabel = '';
  _ColoringView _view = _ColoringView.source;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _promptController = TextEditingController(text: widget.initialPrompt ?? '');
    WidgetsBinding.instance.addObserver(this);
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (_) => _poll());
    WidgetsBinding.instance.addPostFrameCallback((_) => _recoverLostImage());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _titleController.dispose();
    _promptController.dispose();
    _deleteLocal(_source);
    for (final image in _references) {
      _deleteLocal(image);
    }
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
      // Lost-data recovery is best effort.
    }
  }

  Future<_ColoringImageSource?> _chooseImageSource({required bool reference}) =>
      showAppSheet<_ColoringImageSource>(
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
                  subtitle: Text(reference ? '复用已上传的配色参考' : '复用已上传的线稿'),
                  onTap: () =>
                      Navigator.pop(context, _ColoringImageSource.assets),
                ),
                ListTile(
                  leading: const Icon(Icons.photo_library_outlined),
                  title: const Text('从相册选择'),
                  subtitle: Text(reference ? '可一次选择多张图片' : '支持常用图片与 HEIC'),
                  onTap: () =>
                      Navigator.pop(context, _ColoringImageSource.gallery),
                ),
                ListTile(
                  leading: const Icon(Icons.photo_camera_outlined),
                  title: const Text('拍照'),
                  subtitle: Text(reference ? '拍摄一张配色参考' : '拍摄纸面线稿'),
                  onTap: () =>
                      Navigator.pop(context, _ColoringImageSource.camera),
                ),
              ],
            ),
          ),
        ),
      );

  Future<void> _chooseSource() async {
    if (_selecting || _submitting) return;
    final choice = await _chooseImageSource(reference: false);
    if (choice == null || !mounted) return;
    if (choice == _ColoringImageSource.assets) {
      final selected = await _pickAssets(1);
      if (!mounted || selected.isEmpty) return;
      final draft = _draftForAsset(selected.first);
      if (draft == null) {
        _showMessage('这项素材暂不能用于处理，请重新上传');
        return;
      }
      _replaceSource(draft);
      return;
    }
    await _pickLocal(
      count: 1,
      camera: choice == _ColoringImageSource.camera,
      onPicked: (images) => _replaceSource(images.first),
    );
  }

  Future<void> _addReferences(ImageModelOption model) async {
    if (_selecting || _submitting) return;
    final remaining = (model.maxReferenceImages - 1 - _references.length).clamp(
      0,
      model.maxReferenceImages,
    );
    if (remaining <= 0) return;
    final choice = await _chooseImageSource(reference: true);
    if (choice == null || !mounted) return;
    if (choice == _ColoringImageSource.assets) {
      final selected = await _pickAssets(remaining);
      if (!mounted || selected.isEmpty) return;
      final drafts = selected
          .map(_draftForAsset)
          .whereType<ReferenceImageDraft>();
      setState(() => _references.addAll(drafts.take(remaining)));
      return;
    }
    await _pickLocal(
      count: remaining,
      camera: choice == _ColoringImageSource.camera,
      onPicked: (images) =>
          setState(() => _references.addAll(images.take(remaining))),
    );
  }

  Future<List<UserAsset>> _pickAssets(int count) async {
    final existing = <String>{
      if (_source?.remoteKey?.isNotEmpty == true) _source!.remoteKey!,
      ..._references
          .map((item) => item.remoteKey)
          .whereType<String>()
          .where((key) => key.isNotEmpty),
    };
    return await showAppSheet<List<UserAsset>>(
          context: context,
          isScrollControlled: true,
          builder: (context) =>
              AssetPickerSheet(maxSelection: count, existingKeys: existing),
        ) ??
        const [];
  }

  ReferenceImageDraft? _draftForAsset(UserAsset asset) {
    final key = asset.inputKey;
    if (key == null || key.isEmpty) return null;
    return ReferenceImageDraft(
      localPath: '',
      filename: asset.title,
      remoteKey: key,
      remoteUrl: asset.url,
      sourceAssetId: asset.id,
    );
  }

  Future<void> _pickLocal({
    required int count,
    required bool camera,
    required ValueChanged<List<ReferenceImageDraft>> onPicked,
  }) async {
    setState(() => _selecting = true);
    try {
      final service = ref.read(referenceImageServiceProvider);
      final images = camera
          ? await service.takePhoto()
          : await service.pickFromGallery(count);
      if (!mounted || images.isEmpty) return;
      onPicked(images);
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
      _view = _ColoringView.source;
    });
  }

  void _removeReference(int index) {
    final removed = _references.removeAt(index);
    _deleteLocal(removed);
    setState(() {});
  }

  void _clearSource() {
    _deleteLocal(_source);
    setState(() {
      _source = null;
      _taskId = null;
      _view = _ColoringView.source;
    });
  }

  void _deleteLocal(ReferenceImageDraft? image) {
    if (image?.localPath.isNotEmpty == true) {
      File(image!.localPath).delete().ignore();
    }
  }

  Future<List<String>> _uploadInputs(ImageModelOption model) async {
    final all = [_source!, ..._references].take(model.maxReferenceImages);
    final keys = <String>[];
    for (final image in all) {
      var key = image.remoteKey;
      if (key == null || key.isEmpty) {
        key = await ref.read(coloringRepositoryProvider).upload(image);
        if (!mounted) return const [];
        if (identical(image, _source)) {
          setState(() => _source = image.withRemoteKey(key!));
        } else {
          final index = _references.indexOf(image);
          if (index >= 0) {
            setState(() => _references[index] = image.withRemoteKey(key!));
          }
        }
      }
      keys.add(key);
    }
    return keys;
  }

  Future<void> _submit(ImageModelOption model) async {
    if (_source == null || _submitting) {
      if (_source == null) _showMessage('请先选择线稿');
      return;
    }
    final count = _count.clamp(1, model.maxImages);
    final estimatedCost = model.pricePoints * count;
    final user = ref.read(sessionControllerProvider).asData?.value.user;
    if (estimatedCost > 0 && user?.requireCostConfirm != false) {
      final confirmed = await _confirmCost(model, count, estimatedCost);
      if (confirmed != true || !mounted) return;
    }
    setState(() {
      _submitting = true;
      _submissionLabel = '正在上传线稿与参考图';
      _taskId = null;
      _view = _ColoringView.result;
    });
    try {
      final inputKeys = await _uploadInputs(model);
      if (!mounted || inputKeys.isEmpty) return;
      setState(() => _submissionLabel = '正在创建染色任务');
      final task = await ref
          .read(coloringRepositoryProvider)
          .create(
            prompt: _promptController.text,
            title: _titleController.text,
            model: model,
            aspectRatio: _selected(_aspectRatio, model.aspectRatios),
            resolution: _selected(_resolution, model.resolutions),
            quality: _selected(_quality, model.qualities),
            count: count,
            inputKeys: inputKeys,
          );
      ref.invalidate(taskListProvider);
      ref.invalidate(taskCenterControllerProvider);
      ref.invalidate(profileOverviewProvider);
      ref.invalidate(walletProvider);
      if (!mounted) return;
      setState(() => _taskId = task.id);
      ref.invalidate(taskDetailProvider(task.id));
      _showMessage('染色任务已提交');
    } catch (error) {
      if (mounted) {
        setState(() => _view = _ColoringView.source);
        _showError(error, '染色任务提交失败，请稍后重试');
      }
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
          _submissionLabel = '';
        });
      }
    }
  }

  Future<bool?> _confirmCost(
    ImageModelOption model,
    int count,
    int total,
  ) async {
    final wallet = ref.read(walletProvider).asData?.value;
    final insufficient = wallet != null && wallet.availablePoints < total;
    return showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.palette_outlined),
        title: const Text('确认插画染色'),
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
              _ConfirmRow(label: '模型', value: model.name),
              const SizedBox(height: 10),
              _ConfirmRow(
                label: '预计消耗',
                value: '${model.pricePoints} × $count = $total 积分',
              ),
              if (wallet != null) ...[
                const Divider(height: 24),
                _ConfirmRow(
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
            icon: const Icon(Icons.palette),
            label: Text(insufficient ? '积分不足' : '确认染色'),
          ),
        ],
      ),
    );
  }

  String _selected(String? value, List<String> options) =>
      options.contains(value) ? value! : options.first;

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
    final config = ref.watch(coloringConfigProvider);
    final task = _taskId == null
        ? null
        : ref.watch(taskDetailProvider(_taskId!));
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('插画染色'),
        fallbackLocation: '/design',
        actions: [
          IconButton(
            tooltip: '刷新模型',
            onPressed: () => ref.invalidate(coloringConfigProvider),
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: config.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) =>
            _ConfigError(onRetry: () => ref.invalidate(coloringConfigProvider)),
        data: (value) {
          if (!value.enabled || value.models.isEmpty) {
            return const _UnavailableState();
          }
          final model = value.models.firstWhere(
            (item) => item.id == _modelId,
            orElse: () => value.models.first,
          );
          return _buildContent(value, model, task);
        },
      ),
    );
  }

  Widget _buildContent(
    ColoringConfig config,
    ImageModelOption model,
    AsyncValue<TaskItem>? task,
  ) {
    final colors = Theme.of(context).colorScheme;
    final ratio = _selected(_aspectRatio, model.aspectRatios);
    final resolution = _selected(_resolution, model.resolutions);
    final quality = _selected(_quality, model.qualities);
    final count = _count.clamp(1, model.maxImages);
    final maxPaletteReferences = (model.maxReferenceImages - 1).clamp(
      0,
      model.maxReferenceImages,
    );
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: colors.tertiaryContainer.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: colors.outlineVariant),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.palette_outlined, color: colors.tertiary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '让线稿保留笔触，获得完整色彩',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '线稿放在第一张，配色参考只影响色调、光影和材质。',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          _ColoringStage(
            source: _source,
            task: task?.asData?.value,
            loading: _submitting || task?.isLoading == true,
            view: _view,
            onViewChanged: (view) => setState(() => _view = view),
            onChoose: _chooseSource,
            onClear: _source == null ? null : _clearSource,
          ),
          if (task?.hasError == true) ...[
            const SizedBox(height: 10),
            _InlineError(
              onRetry: () => ref.invalidate(taskDetailProvider(_taskId!)),
            ),
          ],
          const SizedBox(height: 14),
          TextField(
            controller: _titleController,
            maxLength: 80,
            decoration: const InputDecoration(
              labelText: '作品名称（可选）',
              prefixIcon: Icon(Icons.title),
              hintText: '例如：赛博机甲头像',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _promptController,
            minLines: 3,
            maxLines: 6,
            maxLength: 2000,
            decoration: const InputDecoration(
              labelText: '配色描述',
              alignLabelWithHint: true,
              hintText: '描述主色、阴影、材质与氛围；留空会自动使用协调配色',
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: _coloringPresets
                  .map(
                    (preset) => Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ActionChip(
                        key: Key('coloring-preset-${preset.label}'),
                        avatar: const Icon(Icons.color_lens_outlined, size: 17),
                        label: Text(preset.label),
                        onPressed: _submitting
                            ? null
                            : () => _promptController.text = preset.prompt,
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
          if (maxPaletteReferences > 0) ...[
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: Text(
                    '配色参考 ${_references.length}/$maxPaletteReferences',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Text(
                  '不会复制画面内容',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 92,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount:
                    _references.length +
                    (_references.length < maxPaletteReferences ? 1 : 0),
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  if (index == _references.length) {
                    return SizedBox.square(
                      dimension: 92,
                      child: OutlinedButton(
                        key: const Key('coloring-add-reference'),
                        onPressed: _selecting || _submitting
                            ? null
                            : () => _addReferences(model),
                        style: OutlinedButton.styleFrom(
                          padding: EdgeInsets.zero,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        child: _selecting
                            ? const SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.add_photo_alternate_outlined),
                      ),
                    );
                  }
                  final image = _references[index];
                  return _ReferenceThumbnail(
                    image: image,
                    onRemove: _submitting
                        ? null
                        : () => _removeReference(index),
                  );
                },
              ),
            ),
          ],
          const SizedBox(height: 18),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '输出设置',
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                      ),
                      Container(
                        key: const Key('coloring-cost'),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: colors.secondaryContainer,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '${model.pricePoints * count} 积分',
                          style: TextStyle(
                            color: colors.onSecondaryContainer,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  AppSelectField<String>(
                    label: '染色模型',
                    prefixIcon: Icons.memory,
                    value: model.id,
                    enabled: !_submitting,
                    options: [
                      for (final item in config.models)
                        AppSelectOption(value: item.id, label: item.name),
                    ],
                    onChanged: (value) {
                      final selected = config.models.firstWhere(
                        (item) => item.id == value,
                        orElse: () => config.models.first,
                      );
                      while (_references.length >
                          (selected.maxReferenceImages - 1).clamp(
                            0,
                            selected.maxReferenceImages,
                          )) {
                        _deleteLocal(_references.removeLast());
                      }
                      setState(() {
                        _modelId = value;
                        _aspectRatio = null;
                        _resolution = null;
                        _quality = null;
                        _count = 1;
                      });
                    },
                  ),
                  const SizedBox(height: 16),
                  Text(
                    '画面比例',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: model.aspectRatios
                        .map(
                          (item) => AppChoicePill(
                            label: Text(_ratioLabel(item)),
                            selected: ratio == item,
                            onSelected: _submitting
                                ? null
                                : (_) => setState(() => _aspectRatio = item),
                          ),
                        )
                        .toList(),
                  ),
                  const SizedBox(height: 16),
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final fields = [
                        AppSelectField<String>(
                          key: ValueKey('coloring-resolution-${model.id}'),
                          label: '分辨率',
                          value: resolution,
                          enabled: !_submitting,
                          options: [
                            for (final item in model.resolutions)
                              AppSelectOption(value: item, label: item),
                          ],
                          onChanged: (value) =>
                              setState(() => _resolution = value),
                        ),
                        AppSelectField<String>(
                          key: ValueKey('coloring-quality-${model.id}'),
                          label: '质量',
                          value: quality,
                          enabled: !_submitting,
                          options: [
                            for (final item in model.qualities)
                              AppSelectOption(
                                value: item,
                                label: _qualityLabel(item),
                              ),
                          ],
                          onChanged: (value) =>
                              setState(() => _quality = value),
                        ),
                      ];
                      if (constraints.maxWidth < 380) {
                        return Column(
                          children: [
                            fields[0],
                            const SizedBox(height: 10),
                            fields[1],
                          ],
                        );
                      }
                      return Row(
                        children: [
                          Expanded(child: fields[0]),
                          const SizedBox(width: 10),
                          Expanded(child: fields[1]),
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '生成张数',
                          style: Theme.of(context).textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                      ),
                      IconButton.filledTonal(
                        tooltip: '减少',
                        onPressed: !_submitting && count > 1
                            ? () => setState(() => _count = count - 1)
                            : null,
                        icon: const Icon(Icons.remove),
                      ),
                      SizedBox(
                        width: 42,
                        child: Text(
                          '$count',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      IconButton.filledTonal(
                        tooltip: '增加',
                        onPressed: !_submitting && count < model.maxImages
                            ? () => setState(() => _count = count + 1)
                            : null,
                        icon: const Icon(Icons.add),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    key: const Key('coloring-submit'),
                    onPressed: _submitting ? null : () => _submit(model),
                    icon: _submitting
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.palette),
                    label: Text(
                      _submitting
                          ? _submissionLabel
                          : count > 1
                          ? '开始 AI 染色 · $count 张'
                          : '开始 AI 染色',
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
    );
  }
}

class _ColoringStage extends StatelessWidget {
  const _ColoringStage({
    required this.source,
    required this.task,
    required this.loading,
    required this.view,
    required this.onViewChanged,
    required this.onChoose,
    this.onClear,
  });

  final ReferenceImageDraft? source;
  final TaskItem? task;
  final bool loading;
  final _ColoringView view;
  final ValueChanged<_ColoringView> onViewChanged;
  final VoidCallback onChoose;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final resultUrl = task?.previewUrls.firstOrNull;
    final showingResult = view == _ColoringView.result;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            LayoutBuilder(
              builder: (context, constraints) {
                final selector = SegmentedButton<_ColoringView>(
                  showSelectedIcon: false,
                  segments: const [
                    ButtonSegment(
                      value: _ColoringView.source,
                      icon: Icon(Icons.draw_outlined),
                      label: Text('线稿'),
                    ),
                    ButtonSegment(
                      value: _ColoringView.result,
                      icon: Icon(Icons.image_outlined),
                      label: Text('结果'),
                    ),
                  ],
                  selected: {view},
                  onSelectionChanged: (value) => onViewChanged(value.first),
                );
                final actions = Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      tooltip: '更换线稿',
                      onPressed: onChoose,
                      icon: const Icon(Icons.swap_horiz),
                    ),
                    if (source != null)
                      IconButton(
                        tooltip: '移除线稿',
                        onPressed: onClear,
                        icon: const Icon(Icons.delete_outline),
                      ),
                  ],
                );
                if (constraints.maxWidth < 400) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      selector,
                      Align(alignment: Alignment.centerRight, child: actions),
                    ],
                  );
                }
                return Row(
                  children: [
                    Expanded(child: selector),
                    const SizedBox(width: 8),
                    actions,
                  ],
                );
              },
            ),
            const SizedBox(height: 10),
            LayoutBuilder(
              builder: (context, constraints) {
                final textScale =
                    MediaQuery.textScalerOf(context).scale(16) / 16;
                final extraHeight = (textScale - 1).clamp(0, 1) * 56;
                return SizedBox(
                  height: constraints.maxWidth * 0.75 + extraHeight,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: Theme.of(
                          context,
                        ).colorScheme.surfaceContainerLow,
                        border: Border.all(
                          color: Theme.of(context).colorScheme.outlineVariant,
                        ),
                      ),
                      child: showingResult
                          ? resultUrl?.isNotEmpty == true
                                ? AuthenticatedImage(
                                    url: resultUrl!,
                                    fit: BoxFit.contain,
                                  )
                                : _ResultPlaceholder(
                                    task: task,
                                    loading: loading,
                                  )
                          : source == null
                          ? _EmptySource(onChoose: onChoose)
                          : _SourcePreview(source: source!),
                    ),
                  ),
                );
              },
            ),
            const SizedBox(height: 10),
            _StageStatus(
              sourceSelected: source != null,
              task: task,
              loading: loading,
            ),
          ],
        ),
      ),
    );
  }
}

class _StageStatus extends StatelessWidget {
  const _StageStatus({
    required this.sourceSelected,
    required this.task,
    required this.loading,
  });

  final bool sourceSelected;
  final TaskItem? task;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final failed = task != null && !task!.isActive && !task!.isSucceeded;
    final label = loading
        ? '正在同步任务'
        : task?.status == 'queued'
        ? '排队中'
        : task?.status == 'running'
        ? 'AI 染色中'
        : task?.isSucceeded == true
        ? '染色完成'
        : failed
        ? '处理失败'
        : sourceSelected
        ? '线稿已就绪'
        : '等待选择线稿';
    final icon = task?.isSucceeded == true
        ? Icons.check_circle_outline
        : failed
        ? Icons.error_outline
        : sourceSelected
        ? Icons.palette_outlined
        : Icons.upload_file_outlined;
    return Row(
      children: [
        Icon(icon, size: 18, color: failed ? colors.error : colors.primary),
        const SizedBox(width: 7),
        Expanded(
          child: Text(
            label,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ),
        if (task?.isActive == true)
          const SizedBox.square(
            dimension: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
      ],
    );
  }
}

class _EmptySource extends StatelessWidget {
  const _EmptySource({required this.onChoose});

  final VoidCallback onChoose;

  @override
  Widget build(BuildContext context) => InkWell(
    key: const Key('coloring-source-picker'),
    onTap: onChoose,
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.draw_outlined, size: 38),
            const SizedBox(height: 10),
            Text(
              '选择线稿或未上色插画',
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 4),
            Text(
              '主体边缘清晰时效果更稳定',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    ),
  );
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
              const Center(child: Icon(Icons.broken_image_outlined, size: 38)),
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
              : '处理失败，请调整配色描述后重试'
        : task?.status == 'running'
        ? '正在保留线稿并渲染色彩'
        : task?.status == 'queued'
        ? '任务正在排队'
        : '提交后在这里查看染色结果';
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
                failed ? Icons.error_outline : Icons.auto_fix_high_outlined,
                size: 38,
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

class _ReferenceThumbnail extends StatelessWidget {
  const _ReferenceThumbnail({required this.image, required this.onRemove});

  final ReferenceImageDraft image;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: 92,
    child: Stack(
      fit: StackFit.expand,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: image.localPath.isNotEmpty
              ? Image.file(File(image.localPath), fit: BoxFit.cover)
              : AuthenticatedImage(url: image.remoteUrl ?? ''),
        ),
        Positioned(
          right: 4,
          top: 4,
          child: IconButton.filled(
            tooltip: '移除配色参考',
            onPressed: onRemove,
            icon: const Icon(Icons.close, size: 16),
            constraints: const BoxConstraints.tightFor(width: 30, height: 30),
            padding: EdgeInsets.zero,
            style: IconButton.styleFrom(
              backgroundColor: Colors.black54,
              foregroundColor: Colors.white,
            ),
          ),
        ),
      ],
    ),
  );
}

class _ConfirmRow extends StatelessWidget {
  const _ConfirmRow({
    required this.label,
    required this.value,
    this.danger = false,
  });

  final String label;
  final String value;
  final bool danger;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(child: Text(label)),
      const SizedBox(width: 12),
      Flexible(
        child: Text(
          value,
          textAlign: TextAlign.end,
          style: TextStyle(
            fontWeight: FontWeight.w900,
            color: danger ? Theme.of(context).colorScheme.error : null,
          ),
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
      label: const Text('染色模型加载失败，点击重试'),
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
          Text('插画染色暂未开放'),
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
      title: const Text('染色状态读取失败'),
      trailing: IconButton(
        tooltip: '重试',
        onPressed: onRetry,
        icon: const Icon(Icons.refresh),
      ),
    ),
  );
}

String _ratioLabel(String value) => value == 'auto' ? '跟随线稿' : value;

String _qualityLabel(String value) => switch (value) {
  'low' => '快速',
  'high' => '精细',
  _ => '标准',
};
