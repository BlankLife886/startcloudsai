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
import 'model_sheet.dart';
import '../../core/widgets/app_chrome.dart';

enum _ReferenceSource { assets, gallery, camera }

const _modelSheetExamples = <({String label, String prompt})>[
  (label: '机甲角色', prompt: '全身机甲战士角色，硬表面装甲，可动关节结构清晰，冷灰主色配警示橙细节'),
  (label: '国风少女', prompt: '国风水墨风格少女角色，长发束带，襦裙层次分明，服饰纹样与配饰结构完整'),
  (label: '产品设备', prompt: '便携咖啡机产品，铝合金外壳，可拆卸水箱和滤杯，接缝与按键布局清晰'),
];

class ModelSheetScreen extends ConsumerStatefulWidget {
  const ModelSheetScreen({this.initialPrompt, super.key});

  final String? initialPrompt;

  @override
  ConsumerState<ModelSheetScreen> createState() => _ModelSheetScreenState();
}

class _ModelSheetScreenState extends ConsumerState<ModelSheetScreen>
    with WidgetsBindingObserver {
  late final TextEditingController _promptController;
  final List<ReferenceImageDraft> _references = [];
  final Set<String> _views = {'front', 'side', 'back', 'three-quarter'};
  final List<String> _taskIds = [];
  String? _modelId;
  String? _aspectRatio;
  String? _resolution;
  String _subjectType = 'character';
  String _fidelity = 'strict';
  String _background = 'gray';
  String _outputMode = 'board';
  int _detail = 85;
  int _boardCount = 1;
  int _outputIndex = 0;
  bool _selecting = false;
  bool _submitting = false;
  bool _resumed = true;
  String _submissionLabel = '';
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _promptController = TextEditingController(text: widget.initialPrompt ?? '');
    WidgetsBinding.instance.addObserver(this);
    _pollTimer = Timer.periodic(const Duration(seconds: 2), (_) => _poll());
    WidgetsBinding.instance.addPostFrameCallback((_) => _recoverLostImages());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _promptController.dispose();
    for (final image in _references) {
      _deleteLocal(image);
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _resumed = state == AppLifecycleState.resumed;
    if (_resumed) {
      for (final id in _taskIds) {
        ref.invalidate(taskDetailProvider(id));
      }
    }
  }

  void _poll() {
    if (!_resumed || !mounted) return;
    for (final id in _taskIds) {
      final task = ref.read(taskDetailProvider(id)).asData?.value;
      if (task?.isActive == true) ref.invalidate(taskDetailProvider(id));
    }
  }

  Future<void> _recoverLostImages() async {
    try {
      final images = await ref
          .read(referenceImageServiceProvider)
          .recoverLostImages();
      if (!mounted || images.isEmpty) return;
      setState(() => _references.addAll(images.take(4)));
      for (final image in images.skip(4)) {
        _deleteLocal(image);
      }
    } catch (_) {
      // Lost-data recovery is best effort.
    }
  }

  Future<void> _addReferences(ImageModelOption model) async {
    final remaining = model.maxReferenceImages - _references.length;
    if (_selecting || _submitting || remaining <= 0) return;
    final source = await showAppSheet<_ReferenceSource>(
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
                subtitle: const Text('复用角色、产品或材质图'),
                onTap: () => Navigator.pop(context, _ReferenceSource.assets),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('从相册选择'),
                subtitle: const Text('可一次选择多张不同视角'),
                onTap: () => Navigator.pop(context, _ReferenceSource.gallery),
              ),
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined),
                title: const Text('拍照'),
                subtitle: const Text('拍摄主体或材质细节'),
                onTap: () => Navigator.pop(context, _ReferenceSource.camera),
              ),
            ],
          ),
        ),
      ),
    );
    if (source == null || !mounted) return;
    if (source == _ReferenceSource.assets) {
      final existing = _references
          .map((image) => image.remoteKey)
          .whereType<String>()
          .where((key) => key.isNotEmpty)
          .toSet();
      final selected = await showAppSheet<List<UserAsset>>(
        context: context,
        isScrollControlled: true,
        builder: (context) =>
            AssetPickerSheet(maxSelection: remaining, existingKeys: existing),
      );
      if (!mounted || selected?.isNotEmpty != true) return;
      final drafts = selected!.map((asset) {
        final key = asset.inputKey;
        if (key == null || key.isEmpty) return null;
        return ReferenceImageDraft(
          localPath: '',
          filename: asset.title,
          remoteKey: key,
          remoteUrl: asset.url,
          sourceAssetId: asset.id,
        );
      }).whereType<ReferenceImageDraft>();
      setState(() => _references.addAll(drafts.take(remaining)));
      return;
    }
    setState(() => _selecting = true);
    try {
      final service = ref.read(referenceImageServiceProvider);
      final images = source == _ReferenceSource.camera
          ? await service.takePhoto()
          : await service.pickFromGallery(remaining);
      if (!mounted || images.isEmpty) return;
      setState(() => _references.addAll(images.take(remaining)));
    } catch (error) {
      if (mounted) _showError(error, '参考图读取失败，请重新选择');
    } finally {
      if (mounted) setState(() => _selecting = false);
    }
  }

  void _removeReference(int index) {
    final removed = _references.removeAt(index);
    _deleteLocal(removed);
    setState(() {});
  }

  void _deleteLocal(ReferenceImageDraft image) {
    if (image.localPath.isNotEmpty) File(image.localPath).delete().ignore();
  }

  Future<List<String>> _uploadReferences(ImageModelOption model) async {
    final keys = <String>[];
    for (final image in _references.take(model.maxReferenceImages)) {
      var key = image.remoteKey;
      if (key == null || key.isEmpty) {
        key = await ref.read(modelSheetRepositoryProvider).upload(image);
        if (!mounted) return const [];
        final index = _references.indexOf(image);
        if (index >= 0) {
          setState(() => _references[index] = image.withRemoteKey(key!));
        }
      }
      keys.add(key);
    }
    return keys;
  }

  String _quality(ImageModelOption model) {
    final requested = _detail >= 75
        ? 'high'
        : _detail >= 55
        ? 'medium'
        : 'low';
    if (model.qualities.contains(requested)) return requested;
    return model.qualities.first;
  }

  String _selected(String? value, List<String> options) =>
      options.contains(value) ? value! : options.first;

  Future<void> _submit(ImageModelOption model) async {
    if (_submitting) return;
    if (_views.isEmpty) {
      _showMessage('请至少选择一个输出视角');
      return;
    }
    if (_promptController.text.trim().isEmpty && _references.isEmpty) {
      _showMessage('请描述主体或添加参考图');
      return;
    }
    final units = _outputMode == 'separate' ? _views.length : _boardCount;
    final totalCost = model.pricePoints * units;
    final user = ref.read(sessionControllerProvider).asData?.value.user;
    if (totalCost > 0 && user?.requireCostConfirm != false) {
      final confirmed = await _confirmCost(model, units, totalCost);
      if (confirmed != true || !mounted) return;
    }
    setState(() {
      _submitting = true;
      _submissionLabel = _references.isEmpty ? '正在创建任务' : '正在上传参考主体';
      _taskIds.clear();
      _outputIndex = 0;
    });
    final created = <TaskItem>[];
    try {
      final inputKeys = await _uploadReferences(model);
      if (!mounted || (_references.isNotEmpty && inputKeys.isEmpty)) return;
      final views = _views.toList();
      final batchId = newModelSheetBatchId();
      final base = ModelSheetRequest(
        prompt: _promptController.text,
        model: model,
        subjectType: _subjectType,
        fidelity: _fidelity,
        views: views,
        background: _background,
        detail: _detail,
        outputMode: _outputMode,
        aspectRatio: _selected(_aspectRatio, model.aspectRatios),
        resolution: _selected(_resolution, model.resolutions),
        quality: _quality(model),
        inputKeys: inputKeys,
        count: _outputMode == 'board' ? _boardCount : 1,
        batchSize: units,
        batchId: batchId,
      );
      final repository = ref.read(modelSheetRepositoryProvider);
      if (_outputMode == 'board') {
        setState(() => _submissionLabel = '正在创建设定板任务');
        created.add(await repository.create(base));
      } else {
        for (var index = 0; index < views.length; index++) {
          final view = views[index];
          if (mounted) {
            setState(
              () => _submissionLabel = '正在创建 ${index + 1}/${views.length} 个视角',
            );
          }
          created.add(
            await repository.create(
              ModelSheetRequest(
                prompt: base.prompt,
                model: base.model,
                subjectType: base.subjectType,
                fidelity: base.fidelity,
                views: [view],
                background: base.background,
                detail: base.detail,
                outputMode: base.outputMode,
                aspectRatio: base.aspectRatio,
                resolution: base.resolution,
                quality: base.quality,
                inputKeys: base.inputKeys,
                count: 1,
                batchSize: units,
                batchId: base.batchId,
                viewId: view,
                viewLabel: modelSheetViewLabels[view] ?? view,
              ),
            ),
          );
        }
      }
    } catch (error) {
      if (created.isEmpty) {
        if (mounted) _showError(error, '模型设计任务提交失败，请稍后重试');
        return;
      }
      if (mounted) _showMessage('已提交 ${created.length}/$units 个任务，其余提交失败');
    } finally {
      if (mounted) {
        if (created.isNotEmpty) {
          setState(() => _taskIds.addAll(created.map((task) => task.id)));
          for (final task in created) {
            ref.invalidate(taskDetailProvider(task.id));
          }
          ref.invalidate(taskListProvider);
          ref.invalidate(taskCenterControllerProvider);
          ref.invalidate(profileOverviewProvider);
          ref.invalidate(walletProvider);
          if (created.length == units) _showMessage('模型设计任务已提交');
        }
        setState(() {
          _submitting = false;
          _submissionLabel = '';
        });
      }
    }
  }

  Future<bool?> _confirmCost(
    ImageModelOption model,
    int units,
    int total,
  ) async {
    final wallet = ref.read(walletProvider).asData?.value;
    final insufficient = wallet != null && wallet.availablePoints < total;
    return showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.view_in_ar_outlined),
        title: const Text('确认模型设计'),
        content: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _ConfirmRow(
                label: _outputMode == 'board' ? '设定板方案' : '独立视图',
                value: '$units 张',
              ),
              const SizedBox(height: 10),
              _ConfirmRow(
                label: '预计消耗',
                value: '${model.pricePoints} × $units = $total 积分',
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
            icon: const Icon(Icons.view_in_ar),
            label: Text(insufficient ? '积分不足' : '确认生成'),
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
    final config = ref.watch(modelSheetConfigProvider);
    final taskStates = _taskIds
        .map((id) => ref.watch(taskDetailProvider(id)))
        .toList();
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('模型设计'),
        fallbackLocation: '/design',
        actions: [
          IconButton(
            tooltip: '刷新模型',
            onPressed: () => ref.invalidate(modelSheetConfigProvider),
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: config.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _ConfigError(
          onRetry: () => ref.invalidate(modelSheetConfigProvider),
        ),
        data: (value) {
          if (!value.enabled || value.models.isEmpty) {
            return const _UnavailableState();
          }
          final model = value.models.firstWhere(
            (item) => item.id == _modelId,
            orElse: () => value.models.first,
          );
          return _buildContent(value, model, taskStates);
        },
      ),
    );
  }

  Widget _buildContent(
    ModelSheetConfig config,
    ImageModelOption model,
    List<AsyncValue<TaskItem>> taskStates,
  ) {
    final colors = Theme.of(context).colorScheme;
    final ratio = _selected(_aspectRatio, model.aspectRatios);
    final resolution = _selected(_resolution, model.resolutions);
    final units = _outputMode == 'separate' ? _views.length : _boardCount;
    final outputs = <_ModelSheetOutput>[];
    for (final state in taskStates) {
      final task = state.asData?.value;
      if (task == null) continue;
      for (var index = 0; index < task.previewUrls.length; index++) {
        outputs.add(
          _ModelSheetOutput(
            taskId: task.id,
            url: task.previewUrls[index],
            label:
                task.params['viewLabel']?.toString().trim().isNotEmpty == true
                ? task.params['viewLabel'].toString()
                : '方案 ${outputs.length + 1}',
          ),
        );
      }
    }
    final active = taskStates.any(
      (state) => state.asData?.value.isActive == true,
    );
    final failed = taskStates.any(
      (state) => state.asData?.value.status == 'failed',
    );
    final selectedOutput = outputs.isEmpty
        ? null
        : outputs[_outputIndex.clamp(0, outputs.length - 1)];
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: colors.secondaryContainer.withValues(alpha: 0.52),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: colors.outlineVariant),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.view_in_ar_outlined, color: colors.secondary),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '同一主体，多视角生产级参考',
                              style: Theme.of(context).textTheme.titleMedium
                                  ?.copyWith(fontWeight: FontWeight.w900),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '可生成完整设定板，或为每个视角建立独立任务。',
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
                _ModelSheetStage(
                  subjectType: _subjectType,
                  views: _views.toList(),
                  aspectRatio: ratio,
                  background: _background,
                  output: selectedOutput,
                  outputs: outputs,
                  active: active || _submitting,
                  failed: failed,
                  onSelectOutput: (index) =>
                      setState(() => _outputIndex = index),
                ),
                if (taskStates.any((state) => state.hasError)) ...[
                  const SizedBox(height: 10),
                  _InlineError(
                    onRetry: () {
                      for (final id in _taskIds) {
                        ref.invalidate(taskDetailProvider(id));
                      }
                    },
                  ),
                ],
                const SizedBox(height: 14),
                TextField(
                  key: const Key('model-sheet-prompt'),
                  controller: _promptController,
                  minLines: 4,
                  maxLines: 8,
                  maxLength: 4000,
                  decoration: const InputDecoration(
                    labelText: '主体描述',
                    alignLabelWithHint: true,
                    hintText: '描述角色、产品、比例、材质、结构和颜色',
                  ),
                ),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: _modelSheetExamples
                        .map(
                          (example) => Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ActionChip(
                              key: Key('model-sheet-example-${example.label}'),
                              avatar: const Icon(
                                Icons.architecture_outlined,
                                size: 17,
                              ),
                              label: Text(example.label),
                              onPressed: _submitting
                                  ? null
                                  : () =>
                                        _promptController.text = example.prompt,
                            ),
                          ),
                        )
                        .toList(),
                  ),
                ),
                if (model.maxReferenceImages > 0) ...[
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '参考主体 ${_references.length}/${model.maxReferenceImages}',
                          style: Theme.of(context).textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                      ),
                      Text(
                        _references.isEmpty ? '可选' : '第一张为主参考',
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
                          (_references.length < model.maxReferenceImages
                              ? 1
                              : 0),
                      separatorBuilder: (_, _) => const SizedBox(width: 8),
                      itemBuilder: (context, index) {
                        if (index == _references.length) {
                          return SizedBox.square(
                            dimension: 92,
                            child: OutlinedButton(
                              key: const Key('model-sheet-add-reference'),
                              onPressed: _selecting || _submitting
                                  ? null
                                  : () => _addReferences(model),
                              style: OutlinedButton.styleFrom(
                                padding: EdgeInsets.zero,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(18),
                                ),
                              ),
                              child: _selecting
                                  ? const SizedBox.square(
                                      dimension: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : const Icon(
                                      Icons.add_photo_alternate_outlined,
                                    ),
                            ),
                          );
                        }
                        return _ReferenceThumbnail(
                          image: _references[index],
                          primary: index == 0,
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
                                '模型设定',
                                style: Theme.of(context).textTheme.titleMedium
                                    ?.copyWith(fontWeight: FontWeight.w900),
                              ),
                            ),
                            Container(
                              key: const Key('model-sheet-cost'),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 7,
                              ),
                              decoration: BoxDecoration(
                                color: colors.secondaryContainer,
                                borderRadius: BorderRadius.circular(18),
                              ),
                              child: Text(
                                '${model.pricePoints * units} 积分',
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
                          label: '生成模型',
                          prefixIcon: Icons.memory,
                          value: model.id,
                          enabled: !_submitting,
                          options: [
                            for (final item in config.models)
                              AppSelectOption(value: item.id, label: item.name),
                          ],
                          onChanged: (value) {
                            if (value == null) return;
                            final selected = config.models.firstWhere(
                              (item) => item.id == value,
                              orElse: () => config.models.first,
                            );
                            while (_references.length >
                                selected.maxReferenceImages) {
                              _deleteLocal(_references.removeLast());
                            }
                            setState(() {
                              _modelId = value;
                              _aspectRatio = null;
                              _resolution = null;
                              if (!selected.supportsTransparentPng &&
                                  _background == 'transparent') {
                                _background = 'gray';
                              }
                            });
                          },
                        ),
                        const SizedBox(height: 16),
                        Text(
                          '主体类型',
                          style: Theme.of(context).textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        SegmentedButton<String>(
                          showSelectedIcon: false,
                          segments: const [
                            ButtonSegment(
                              value: 'character',
                              icon: Icon(Icons.accessibility_new),
                              label: Text('人物 / 角色'),
                            ),
                            ButtonSegment(
                              value: 'object',
                              icon: Icon(Icons.inventory_2_outlined),
                              label: Text('物体 / 产品'),
                            ),
                          ],
                          selected: {_subjectType},
                          onSelectionChanged: _submitting
                              ? null
                              : (value) =>
                                    setState(() => _subjectType = value.first),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          '输出方式',
                          style: Theme.of(context).textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        SegmentedButton<String>(
                          key: const Key('model-sheet-output-mode'),
                          showSelectedIcon: false,
                          segments: const [
                            ButtonSegment(
                              value: 'board',
                              icon: Icon(Icons.dashboard_outlined),
                              label: Text('单张设定板'),
                            ),
                            ButtonSegment(
                              value: 'separate',
                              icon: Icon(Icons.view_carousel_outlined),
                              label: Text('独立视图'),
                            ),
                          ],
                          selected: {_outputMode},
                          onSelectionChanged: _submitting
                              ? null
                              : (value) =>
                                    setState(() => _outputMode = value.first),
                        ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                '输出视角',
                                style: Theme.of(context).textTheme.titleSmall
                                    ?.copyWith(fontWeight: FontWeight.w800),
                              ),
                            ),
                            Text('${_views.length}/6'),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: modelSheetViewLabels.entries
                              .map(
                                (entry) => FilterChip(
                                  key: Key('model-sheet-view-${entry.key}'),
                                  label: Text(entry.value),
                                  selected: _views.contains(entry.key),
                                  onSelected: _submitting
                                      ? null
                                      : (selected) {
                                          if (!selected && _views.length == 1) {
                                            _showMessage('请至少保留一个视角');
                                            return;
                                          }
                                          setState(() {
                                            if (selected) {
                                              _views.add(entry.key);
                                            } else {
                                              _views.remove(entry.key);
                                            }
                                          });
                                        },
                                ),
                              )
                              .toList(),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          '还原策略',
                          style: Theme.of(context).textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        SegmentedButton<String>(
                          showSelectedIcon: false,
                          segments: const [
                            ButtonSegment(value: 'strict', label: Text('严格还原')),
                            ButtonSegment(
                              value: 'optimized',
                              label: Text('专业优化'),
                            ),
                          ],
                          selected: {_fidelity},
                          onSelectionChanged: _submitting
                              ? null
                              : (value) =>
                                    setState(() => _fidelity = value.first),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          '画面比例',
                          style: Theme.of(context).textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: model.aspectRatios
                              .map(
                                (item) => AppChoicePill(
                                  label: Text(item == 'auto' ? '自动' : item),
                                  selected: ratio == item,
                                  onSelected: _submitting
                                      ? null
                                      : (_) =>
                                            setState(() => _aspectRatio = item),
                                ),
                              )
                              .toList(),
                        ),
                        const SizedBox(height: 16),
                        AppSelectField<String>(
                          key: ValueKey('model-sheet-resolution-${model.id}'),
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
                        const SizedBox(height: 16),
                        Text(
                          '背景',
                          style: Theme.of(context).textTheme.titleSmall
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            _BackgroundChoice(
                              id: 'gray',
                              label: '浅灰',
                              color: const Color(0xFFD1D5DB),
                              selected: _background == 'gray',
                              onTap: () => setState(() => _background = 'gray'),
                            ),
                            _BackgroundChoice(
                              id: 'white',
                              label: '纯白',
                              color: Colors.white,
                              selected: _background == 'white',
                              onTap: () =>
                                  setState(() => _background = 'white'),
                            ),
                            if (model.supportsTransparentPng)
                              _BackgroundChoice(
                                id: 'transparent',
                                label: '透明',
                                color: const Color(0xFF9CA3AF),
                                selected: _background == 'transparent',
                                onTap: () =>
                                    setState(() => _background = 'transparent'),
                              ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                '细节强度',
                                style: Theme.of(context).textTheme.titleSmall
                                    ?.copyWith(fontWeight: FontWeight.w800),
                              ),
                            ),
                            Text(
                              '$_detail · ${_qualityLabel(_quality(model))}',
                            ),
                          ],
                        ),
                        Slider(
                          key: const Key('model-sheet-detail'),
                          min: 40,
                          max: 100,
                          divisions: 12,
                          value: _detail.toDouble(),
                          label: '$_detail',
                          onChanged: _submitting
                              ? null
                              : (value) =>
                                    setState(() => _detail = value.round()),
                        ),
                        if (_outputMode == 'board') ...[
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  '方案数量',
                                  style: Theme.of(context).textTheme.titleSmall
                                      ?.copyWith(fontWeight: FontWeight.w800),
                                ),
                              ),
                              IconButton.filledTonal(
                                tooltip: '减少',
                                onPressed: !_submitting && _boardCount > 1
                                    ? () => setState(() => _boardCount -= 1)
                                    : null,
                                icon: const Icon(Icons.remove),
                              ),
                              SizedBox(
                                width: 42,
                                child: Text(
                                  '$_boardCount',
                                  textAlign: TextAlign.center,
                                  style: Theme.of(
                                    context,
                                  ).textTheme.titleMedium,
                                ),
                              ),
                              IconButton.filledTonal(
                                tooltip: '增加',
                                onPressed:
                                    !_submitting &&
                                        _boardCount < model.maxImages
                                    ? () => setState(() => _boardCount += 1)
                                    : null,
                                icon: const Icon(Icons.add),
                              ),
                            ],
                          ),
                        ],
                        const SizedBox(height: 18),
                        FilledButton.icon(
                          key: const Key('model-sheet-submit'),
                          onPressed: _submitting ? null : () => _submit(model),
                          icon: _submitting
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.view_in_ar),
                          label: Text(
                            _submitting
                                ? _submissionLabel
                                : _outputMode == 'board'
                                ? _boardCount > 1
                                      ? '生成 $_boardCount 个设定板方案'
                                      : '生成模型设定板'
                                : '生成 ${_views.length} 张独立视图',
                          ),
                        ),
                        if (selectedOutput != null) ...[
                          const SizedBox(height: 8),
                          OutlinedButton.icon(
                            onPressed: () =>
                                context.push('/works/${selectedOutput.taskId}'),
                            icon: const Icon(Icons.open_in_new),
                            label: const Text('查看当前作品详情'),
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
    );
  }
}

class _ModelSheetOutput {
  const _ModelSheetOutput({
    required this.taskId,
    required this.url,
    required this.label,
  });

  final String taskId;
  final String url;
  final String label;
}

class _ModelSheetStage extends StatelessWidget {
  const _ModelSheetStage({
    required this.subjectType,
    required this.views,
    required this.aspectRatio,
    required this.background,
    required this.output,
    required this.outputs,
    required this.active,
    required this.failed,
    required this.onSelectOutput,
  });

  final String subjectType;
  final List<String> views;
  final String aspectRatio;
  final String background;
  final _ModelSheetOutput? output;
  final List<_ModelSheetOutput> outputs;
  final bool active;
  final bool failed;
  final ValueChanged<int> onSelectOutput;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
            child: Row(
              children: [
                const Icon(Icons.architecture_outlined, size: 19),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    '模型蓝图预览',
                    style: TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: colors.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(aspectRatio == 'auto' ? 'AUTO' : aspectRatio),
                ),
              ],
            ),
          ),
          LayoutBuilder(
            builder: (context, constraints) {
              final ratio = _ratioValue(aspectRatio);
              final baseHeight = constraints.maxWidth / ratio;
              final height = baseHeight.clamp(220.0, 430.0);
              return SizedBox(
                height: height,
                child: CustomPaint(
                  painter: _BlueprintPainter(colors),
                  child: output != null
                      ? AuthenticatedImage(
                          url: output!.url,
                          fit: BoxFit.contain,
                        )
                      : _BlueprintSilhouettes(
                          subjectType: subjectType,
                          views: views,
                        ),
                ),
              );
            },
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            child: Row(
              children: [
                Icon(
                  output != null
                      ? Icons.check_circle_outline
                      : failed
                      ? Icons.error_outline
                      : Icons.grid_on_outlined,
                  size: 18,
                  color: failed ? colors.error : colors.secondary,
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(
                    active
                        ? '正在建立多视角模型参考'
                        : output != null
                        ? output!.label
                        : failed
                        ? '部分视图生成失败，可进入作品查看'
                        : '${views.length} 个视角 · ${_backgroundLabel(background)}',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                if (active)
                  const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
          ),
          if (outputs.length > 1)
            SizedBox(
              height: 82,
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                scrollDirection: Axis.horizontal,
                itemCount: outputs.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final item = outputs[index];
                  final selected = identical(item, output);
                  return Material(
                    color: selected
                        ? colors.secondaryContainer
                        : colors.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(18),
                    clipBehavior: Clip.antiAlias,
                    child: InkWell(
                      key: Key('model-sheet-output-$index'),
                      onTap: () => onSelectOutput(index),
                      child: SizedBox(
                        width: 116,
                        child: Row(
                          children: [
                            SizedBox(
                              width: 58,
                              child: AuthenticatedImage(url: item.url),
                            ),
                            const SizedBox(width: 7),
                            Expanded(
                              child: Text(
                                item.label,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            const SizedBox(width: 5),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

class _BlueprintPainter extends CustomPainter {
  const _BlueprintPainter(this.colors);

  final ColorScheme colors;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(
      Offset.zero & size,
      Paint()..color = colors.secondaryContainer.withValues(alpha: 0.3),
    );
    final minor = Paint()
      ..color = colors.secondary.withValues(alpha: 0.12)
      ..strokeWidth = 0.7;
    final major = Paint()
      ..color = colors.secondary.withValues(alpha: 0.22)
      ..strokeWidth = 1;
    const step = 18.0;
    for (var x = 0.0, index = 0; x <= size.width; x += step, index++) {
      canvas.drawLine(
        Offset(x, 0),
        Offset(x, size.height),
        index % 4 == 0 ? major : minor,
      );
    }
    for (var y = 0.0, index = 0; y <= size.height; y += step, index++) {
      canvas.drawLine(
        Offset(0, y),
        Offset(size.width, y),
        index % 4 == 0 ? major : minor,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _BlueprintPainter oldDelegate) =>
      oldDelegate.colors != colors;
}

class _BlueprintSilhouettes extends StatelessWidget {
  const _BlueprintSilhouettes({required this.subjectType, required this.views});

  final String subjectType;
  final List<String> views;

  @override
  Widget build(BuildContext context) {
    final visible = views.take(4).toList();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: visible
            .map(
              (view) => Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Expanded(
                      child: FittedBox(
                        fit: BoxFit.contain,
                        child: Icon(
                          subjectType == 'character'
                              ? Icons.accessibility_new
                              : Icons.inventory_2_outlined,
                          color: Theme.of(context).colorScheme.secondary,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      modelSheetViewLabels[view] ?? view,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                  ],
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}

class _ReferenceThumbnail extends StatelessWidget {
  const _ReferenceThumbnail({
    required this.image,
    required this.primary,
    required this.onRemove,
  });

  final ReferenceImageDraft image;
  final bool primary;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: 92,
    child: Stack(
      fit: StackFit.expand,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: image.localPath.isNotEmpty
              ? Image.file(File(image.localPath), fit: BoxFit.cover)
              : AuthenticatedImage(url: image.remoteUrl ?? ''),
        ),
        if (primary)
          const Positioned(left: 5, bottom: 5, child: _PrimaryReferenceBadge()),
        Positioned(
          right: 4,
          top: 4,
          child: IconButton.filled(
            tooltip: '移除参考图',
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

class _PrimaryReferenceBadge extends StatelessWidget {
  const _PrimaryReferenceBadge();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
    decoration: BoxDecoration(
      color: Colors.black54,
      borderRadius: BorderRadius.circular(5),
    ),
    child: const Text(
      '主参考',
      style: TextStyle(
        color: Colors.white,
        fontSize: 10,
        fontWeight: FontWeight.w800,
      ),
    ),
  );
}

class _BackgroundChoice extends StatelessWidget {
  const _BackgroundChoice({
    required this.id,
    required this.label,
    required this.color,
    required this.selected,
    required this.onTap,
  });

  final String id;
  final String label;
  final Color color;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => AppChoicePill(
    key: Key('model-sheet-background-$id'),
    avatar: Container(
      width: 16,
      height: 16,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: Theme.of(context).colorScheme.outline),
      ),
    ),
    label: Text(label),
    selected: selected,
    onSelected: (_) => onTap(),
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
      label: const Text('模型设计配置加载失败，点击重试'),
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
          Text('模型设计暂未开放'),
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
    borderRadius: BorderRadius.circular(18),
    child: ListTile(
      leading: const Icon(Icons.cloud_off_outlined),
      title: const Text('模型设计状态读取失败'),
      trailing: IconButton(
        tooltip: '重试',
        onPressed: onRetry,
        icon: const Icon(Icons.refresh),
      ),
    ),
  );
}

double _ratioValue(String value) {
  if (value == 'auto') return 16 / 9;
  final parts = value.split(':').map(double.tryParse).toList();
  if (parts.length != 2 || parts[0] == null || parts[1] == null) return 16 / 9;
  return (parts[0]! / parts[1]!).clamp(0.6, 2.4);
}

String _backgroundLabel(String value) => switch (value) {
  'white' => '纯白背景',
  'transparent' => '透明背景',
  _ => '浅灰背景',
};

String _qualityLabel(String value) => switch (value) {
  'low' => '快速',
  'high' => '精细',
  _ => '标准',
};
