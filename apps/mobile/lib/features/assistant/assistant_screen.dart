import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:gal/gal.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../../app/starclouds_theme.dart';
import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/authenticated_image.dart';
import '../assets/assets.dart';
import '../assets/assets_screen.dart';
import '../create/create.dart';
import '../create/reference_image_service.dart';
import '../profile/profile.dart';
import 'assistant.dart';
import 'assistant_draft.dart';
import '../../core/widgets/app_chrome.dart';

typedef _AssistantQuickTask = ({
  String title,
  String example,
  String prompt,
  IconData icon,
});

Duration _motionDuration(BuildContext context, int milliseconds) =>
    MediaQuery.disableAnimationsOf(context)
    ? Duration.zero
    : Duration(milliseconds: milliseconds);

bool _loopingMotionEnabled(BuildContext context) {
  if (MediaQuery.disableAnimationsOf(context)) return false;
  return WidgetsBinding.instance.runtimeType.toString() !=
      'AutomatedTestWidgetsFlutterBinding';
}

int _replyFallbackCost(
  AssistantMessage message,
  AssistantRun? run,
  AssistantWorkspaceState state,
) {
  if (message.isUser || message.kind == 'image') return 0;
  if (run != null &&
      run.assistantMessageId == message.id &&
      run.costPoints > 0) {
    return run.costPoints;
  }
  return state.selectedModel?.priceFor(state.reasoningEffort) ?? 0;
}

const double _composerControlSize = 36;

ButtonStyle _composerIconStyle({
  required Color background,
  required Color foreground,
  Color? disabledBackground,
  Color? disabledForeground,
}) => IconButton.styleFrom(
  backgroundColor: background,
  foregroundColor: foreground,
  disabledBackgroundColor: disabledBackground ?? background,
  disabledForegroundColor: disabledForeground ?? foreground,
  fixedSize: const Size.square(_composerControlSize),
  minimumSize: const Size.square(_composerControlSize),
  maximumSize: const Size.square(_composerControlSize),
  padding: EdgeInsets.zero,
  visualDensity: VisualDensity.standard,
  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
  alignment: Alignment.center,
);

const List<_AssistantQuickTask> _assistantQuickTasks = [
  (
    title: '优化提示词',
    example: '补全构图、光线与材质',
    prompt: '帮我把这段图片提示词优化得更具体，并补充构图、光线、色彩和材质细节。',
    icon: Icons.tune_rounded,
  ),
  (
    title: '分析画面',
    example: '拆解构图、色彩与层级',
    prompt: '请从构图、色彩、视觉焦点和信息层级四个方面分析这张参考图。',
    icon: Icons.center_focus_strong_outlined,
  ),
  (
    title: '创意方向',
    example: '生成差异明确的视觉方案',
    prompt: '围绕我的创作主题给出 5 个差异明显的视觉创意方向，并说明每个方向的核心画面。',
    icon: Icons.lightbulb_outline_rounded,
  ),
  (
    title: '作品文案',
    example: '生成标题、介绍与发布文案',
    prompt: '根据我的作品内容，写 3 个标题、一段作品介绍和一段简洁的发布文案。',
    icon: Icons.edit_note_rounded,
  ),
];

const List<_AssistantQuickTask> _assistantAgentTasks = [
  (
    title: '海报方案',
    example: '规划主体、场景与视觉气质',
    prompt: '为我的主题规划一套完整海报画面，明确主体、场景、构图、光线和视觉风格。',
    icon: Icons.view_quilt_outlined,
  ),
  (
    title: '社媒封面',
    example: '适配内容平台的醒目画面',
    prompt: '帮我规划一张有点击吸引力的社交媒体封面，画面简洁，主体突出，并给出可直接生成的方案。',
    icon: Icons.web_asset_outlined,
  ),
  (
    title: '角色设定',
    example: '完善外形、服装与氛围',
    prompt: '帮我设计一个原创角色形象，完善外形、服装、动作、场景和整体氛围，并整理成可生成的方案。',
    icon: Icons.face_retouching_natural_outlined,
  ),
  (
    title: '品牌主视觉',
    example: '建立统一且鲜明的视觉方向',
    prompt: '围绕我的品牌主题规划一套主视觉，明确核心意象、构图、色彩、材质和光线，并整理成可生成的方案。',
    icon: Icons.branding_watermark_outlined,
  ),
];

const List<_AssistantQuickTask> _assistantImageTasks = [
  (
    title: '电影海报',
    example: '戏剧光影与强视觉叙事',
    prompt: '生成一张电影感主题海报，主体明确，戏剧性光影，高级配色，画面具有故事张力。',
    icon: Icons.movie_creation_outlined,
  ),
  (
    title: '角色概念',
    example: '完整造型与氛围场景',
    prompt: '生成一张原创角色概念图，完整展示外形、服装和动作，场景氛围统一，细节清晰。',
    icon: Icons.face_retouching_natural_outlined,
  ),
  (
    title: '社媒配图',
    example: '简洁醒目的内容视觉',
    prompt: '生成一张简洁醒目的社交媒体配图，主体突出，留出文字空间，色彩有吸引力。',
    icon: Icons.photo_size_select_actual_outlined,
  ),
  (
    title: '场景壁纸',
    example: '沉浸式空间与丰富细节',
    prompt: '生成一张沉浸式场景壁纸，空间层次丰富，光线自然，细节精致，具有电影级氛围。',
    icon: Icons.landscape_outlined,
  ),
];

List<_AssistantQuickTask> _quickTasksFor(AssistantMode mode) => switch (mode) {
  AssistantMode.agent => _assistantAgentTasks,
  AssistantMode.image => _assistantImageTasks,
  AssistantMode.chat => _assistantQuickTasks,
};

List<AssistantReferenceImage> _agentProposalReferences(
  List<AssistantMessage> messages,
  int proposalIndex,
) {
  for (var index = proposalIndex - 1; index >= 0; index -= 1) {
    if (messages[index].isUser) return messages[index].referenceImages;
  }
  return const [];
}

class _AssistantScrollController extends ScrollController {
  _AssistantScrollController() : super();

  bool pinToLatest = true;

  @override
  ScrollPosition createScrollPosition(
    ScrollPhysics physics,
    ScrollContext context,
    ScrollPosition? oldPosition,
  ) {
    return _AssistantScrollPosition(
      physics: physics,
      context: context,
      oldPosition: oldPosition,
      owner: this,
    );
  }
}

class _AssistantScrollPosition extends ScrollPositionWithSingleContext {
  _AssistantScrollPosition({
    required super.physics,
    required super.context,
    super.oldPosition,
    required this.owner,
  });

  final _AssistantScrollController owner;

  bool _needsPin(double maxScrollExtent) =>
      owner.pinToLatest &&
      maxScrollExtent.isFinite &&
      (pixels - maxScrollExtent).abs() > 0.5;

  @override
  bool applyContentDimensions(double minScrollExtent, double maxScrollExtent) {
    if (!haveDimensions && _needsPin(maxScrollExtent)) {
      correctPixels(maxScrollExtent);
      return false;
    }
    return super.applyContentDimensions(minScrollExtent, maxScrollExtent);
  }

  @override
  bool correctForNewDimensions(
    ScrollMetrics oldPosition,
    ScrollMetrics newPosition,
  ) {
    if (_needsPin(newPosition.maxScrollExtent)) {
      correctPixels(newPosition.maxScrollExtent);
      return false;
    }
    return super.correctForNewDimensions(oldPosition, newPosition);
  }
}

abstract interface class AssistantSpeechInput {
  bool get isListening;

  Future<bool> initialize({
    required SpeechStatusListener onStatus,
    required SpeechErrorListener onError,
  });

  Future<void> listen({
    required SpeechResultListener onResult,
    required SpeechListenOptions listenOptions,
  });

  Future<void> stop();

  Future<void> cancel();
}

class DeviceAssistantSpeechInput implements AssistantSpeechInput {
  DeviceAssistantSpeechInput() : _delegate = SpeechToText();

  final SpeechToText _delegate;

  @override
  bool get isListening => _delegate.isListening;

  @override
  Future<bool> initialize({
    required SpeechStatusListener onStatus,
    required SpeechErrorListener onError,
  }) => _delegate.initialize(onStatus: onStatus, onError: onError);

  @override
  Future<void> listen({
    required SpeechResultListener onResult,
    required SpeechListenOptions listenOptions,
  }) async {
    await _delegate.listen(onResult: onResult, listenOptions: listenOptions);
  }

  @override
  Future<void> stop() => _delegate.stop();

  @override
  Future<void> cancel() => _delegate.cancel();
}

class AssistantScreen extends ConsumerStatefulWidget {
  const AssistantScreen({
    this.initialPrompt,
    this.showBackButton = false,
    this.fallbackLocation = '/discover',
    this.speechInput,
    super.key,
  });

  final String? initialPrompt;
  final bool showBackButton;
  final String fallbackLocation;
  final AssistantSpeechInput? speechInput;

  @override
  ConsumerState<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends ConsumerState<AssistantScreen> {
  late final TextEditingController _composer;
  final _historySearch = TextEditingController();
  final _composerFocus = FocusNode();
  final _scrollController = _AssistantScrollController();
  late final AssistantSpeechInput _speech;
  final List<ReferenceImageDraft> _references = [];
  final Set<String> _persistentDraftPaths = {};
  AssistantQuotedMessage? _quoted;
  bool _selectingImages = false;
  bool _checkingBalance = false;
  bool _uploadingReferences = false;
  bool _draftLoaded = false;
  bool _restoringDraft = false;
  bool _draftSaving = false;
  bool _draftSaveFailed = false;
  bool _draftRestored = false;
  bool _showJumpToLatest = false;
  bool _speechAvailable = false;
  bool _speechInitializing = false;
  bool _speechListening = false;
  bool _disposing = false;
  bool _creatingConversation = false;
  bool _historyDrawerOpen = false;
  String _speechPrefix = '';
  int _speechSession = 0;
  Timer? _draftTimer;
  Future<void> _draftWriteFuture = Future<void>.value();
  int _draftWriteGeneration = 0;

  @override
  void initState() {
    super.initState();
    _speech = widget.speechInput ?? DeviceAssistantSpeechInput();
    _composer = TextEditingController(text: widget.initialPrompt?.trim() ?? '');
    _scrollController.addListener(_handleMessageScroll);
    _restoreDraft();
  }

  @override
  void didUpdateWidget(covariant AssistantScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final next = widget.initialPrompt?.trim() ?? '';
    if (next.isNotEmpty && next != oldWidget.initialPrompt?.trim()) {
      unawaited(_cancelSpeechInput());
      for (final image in _references) {
        _deleteLocalReference(image);
      }
      _composer.value = TextEditingValue(
        text: next,
        selection: TextSelection.collapsed(offset: next.length),
      );
      setState(_references.clear);
      _persistentDraftPaths.clear();
      if (_draftLoaded) _saveDraftNow();
    }
  }

  @override
  void dispose() {
    _disposing = true;
    _draftTimer?.cancel();
    _speechSession += 1;
    unawaited(_speech.cancel());
    _composer.dispose();
    _historySearch.dispose();
    _composerFocus.dispose();
    _scrollController.removeListener(_handleMessageScroll);
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _toggleSpeechInput() async {
    if (_speechInitializing) return;
    if (_speech.isListening || _speechListening) {
      _speechSession += 1;
      await _speech.stop();
      if (mounted) setState(() => _speechListening = false);
      return;
    }
    final session = ++_speechSession;
    setState(() => _speechInitializing = true);
    try {
      if (!_speechAvailable) {
        _speechAvailable = await _speech.initialize(
          onStatus: _handleSpeechStatus,
          onError: _handleSpeechError,
        );
      }
      if (!mounted || session != _speechSession) return;
      if (!_speechAvailable) {
        _showSpeechUnavailable();
        return;
      }
      _speechPrefix = _composer.text.trimRight();
      await _speech.listen(
        onResult: _handleSpeechResult,
        listenOptions: SpeechListenOptions(
          listenMode: ListenMode.dictation,
          partialResults: true,
          cancelOnError: true,
          autoPunctuation: true,
          enableHapticFeedback: true,
        ),
      );
      if (mounted && session == _speechSession) {
        setState(() => _speechListening = _speech.isListening);
      }
    } catch (_) {
      if (mounted && session == _speechSession) _showSpeechUnavailable();
    } finally {
      if (mounted && session == _speechSession) {
        setState(() => _speechInitializing = false);
      }
    }
  }

  Future<void> _cancelSpeechInput() async {
    final shouldCancel = _speechListening || _speech.isListening;
    _speechSession += 1;
    _speechPrefix = '';
    if (mounted && (_speechListening || _speechInitializing)) {
      setState(() {
        _speechListening = false;
        _speechInitializing = false;
      });
    }
    if (shouldCancel) await _speech.cancel();
  }

  void _handleSpeechResult(SpeechRecognitionResult result) {
    if (!mounted || _disposing) return;
    final words = result.recognizedWords.trim();
    if (words.isEmpty) return;
    final separator = _speechPrefix.isEmpty ? '' : ' ';
    final value = '$_speechPrefix$separator$words';
    _composer.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
    _scheduleDraftSave();
  }

  void _handleSpeechStatus(String status) {
    if (!mounted || _disposing) return;
    setState(() => _speechListening = _speech.isListening);
  }

  void _handleSpeechError(SpeechRecognitionError error) {
    if (!mounted || _disposing) return;
    setState(() => _speechListening = false);
    final denied = error.errorMsg.contains('permission') || error.permanent;
    AppNotice.error(context, denied ? '需要开启麦克风和语音识别权限' : '语音输入失败，请稍后重试');
  }

  void _showSpeechUnavailable() {
    AppNotice.warning(context, '当前设备暂不支持语音输入');
  }

  AssistantDraft _currentDraft() => AssistantDraft(
    prompt: _composer.text,
    references: List<ReferenceImageDraft>.of(_references),
    updatedAt: DateTime.now(),
  );

  Future<void> _restoreDraft() async {
    _restoringDraft = true;
    final incoming = widget.initialPrompt?.trim() ?? '';
    try {
      final store = ref.read(assistantDraftStoreProvider);
      final draft = await store.read();
      if (incoming.isNotEmpty) {
        await store.clear();
        if (!mounted) return;
        _persistentDraftPaths.clear();
        setState(() {
          _draftLoaded = true;
          _draftRestored = false;
        });
        _restoringDraft = false;
        _scheduleDraftSave();
        return;
      }
      if (!mounted) return;
      final configuredLimit = ref
          .read(assistantWorkspaceProvider)
          .asData
          ?.value
          .selectedModel
          ?.maxReferenceImages;
      final restoreLimit = configuredLimit == null
          ? maxAssistantDraftReferences
          : configuredLimit < 0
          ? 0
          : configuredLimit > maxAssistantDraftReferences
          ? maxAssistantDraftReferences
          : configuredLimit;
      final references = (draft?.references ?? const <ReferenceImageDraft>[])
          .take(restoreLimit)
          .toList();
      final trimmedReferences =
          draft != null && references.length < draft.references.length;
      _composer.value = TextEditingValue(
        text: draft?.prompt ?? '',
        selection: TextSelection.collapsed(offset: draft?.prompt.length ?? 0),
      );
      _persistentDraftPaths
        ..clear()
        ..addAll(
          references
              .map((item) => item.localPath)
              .where((item) => item.isNotEmpty)
              .map((item) => File(item).absolute.path),
        );
      setState(() {
        _references
          ..clear()
          ..addAll(references);
        _draftLoaded = true;
        _draftRestored = draft != null && !draft.isEmpty;
      });
      if (trimmedReferences) {
        _restoringDraft = false;
        _saveDraftNow();
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _draftLoaded = true;
        _draftSaveFailed = true;
      });
    } finally {
      _restoringDraft = false;
    }
  }

  void _scheduleDraftSave() {
    if (!_draftLoaded || _restoringDraft) return;
    _draftTimer?.cancel();
    final hasDraft = !_currentDraft().isEmpty;
    setState(() {
      _draftSaving = hasDraft;
      _draftSaveFailed = false;
      _draftRestored = false;
    });
    _draftTimer = Timer(
      const Duration(milliseconds: 600),
      () => unawaited(_persistDraft()),
    );
  }

  void _saveDraftNow() {
    if (!_draftLoaded || _restoringDraft) return;
    _draftTimer?.cancel();
    final hasDraft = !_currentDraft().isEmpty;
    setState(() {
      _draftSaving = hasDraft;
      _draftSaveFailed = false;
      _draftRestored = false;
    });
    unawaited(_persistDraft());
  }

  Future<void> _persistDraft() async {
    final draft = _currentDraft();
    final store = ref.read(assistantDraftStoreProvider);
    final generation = ++_draftWriteGeneration;
    _draftWriteFuture = _draftWriteFuture.then((_) async {
      try {
        if (draft.isEmpty) {
          await store.clear();
        } else {
          await store.write(draft);
        }
        if (!mounted || generation != _draftWriteGeneration) return;
        if (draft.isEmpty) {
          _persistentDraftPaths.clear();
        } else {
          final retainedPaths = draft.references
              .map((item) => item.localPath)
              .where((item) => item.isNotEmpty)
              .map((item) => File(item).absolute.path)
              .toSet();
          _persistentDraftPaths.removeWhere(
            (path) => !retainedPaths.contains(path),
          );
        }
        setState(() {
          _draftSaving = false;
          _draftSaveFailed = false;
        });
      } catch (_) {
        if (!mounted || generation != _draftWriteGeneration) return;
        setState(() {
          _draftSaving = false;
          _draftSaveFailed = true;
        });
      }
    });
    await _draftWriteFuture;
  }

  Future<void> _clearDraft() async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.delete_outline),
        title: const Text('清除未发送内容？'),
        content: const Text('输入的文字和参考图将从这台设备移除。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('清除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _cancelSpeechInput();
    if (!mounted) return;
    _draftTimer?.cancel();
    _draftWriteGeneration += 1;
    final references = List<ReferenceImageDraft>.of(_references);
    _composer.clear();
    setState(() {
      _references.clear();
      _quoted = null;
      _draftSaving = false;
      _draftSaveFailed = false;
      _draftRestored = false;
    });
    for (final image in references) {
      _deleteLocalReference(image);
    }
    try {
      await _draftWriteFuture;
      await ref.read(assistantDraftStoreProvider).clear();
      _persistentDraftPaths.clear();
    } catch (_) {
      if (mounted) setState(() => _draftSaveFailed = true);
    }
  }

  void _scrollToBottom({bool animated = true}) {
    _scrollController.pinToLatest = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      final position = _scrollController.position;
      final target = position.maxScrollExtent;
      if ((position.pixels - target).abs() < 1) return;
      if (!animated || MediaQuery.disableAnimationsOf(context)) {
        _scrollController.jumpTo(target);
        return;
      }
      _scrollController.animateTo(
        target,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  void _handleMessageScroll() {
    if (!_scrollController.hasClients) return;
    final shouldShow =
        _scrollController.position.maxScrollExtent -
            _scrollController.position.pixels >
        180;
    _scrollController.pinToLatest = !shouldShow;
    if (shouldShow != _showJumpToLatest && mounted) {
      setState(() => _showJumpToLatest = shouldShow);
    }
  }

  Future<void> _copyReply(String content) async {
    await _run(() async {
      await Clipboard.setData(ClipboardData(text: content.trim()));
      if (!mounted) return;
      AppNotice.success(context, '已复制助手回复');
    });
  }

  Future<void> _shareReply(String content) async {
    await _run(() async {
      await SharePlus.instance.share(
        ShareParams(text: content.trim(), title: 'AI 助手回复'),
      );
    });
  }

  Future<File> _downloadGeneratedImage(AssistantGeneratedImage image) async {
    final bytes = await ref
        .read(apiClientProvider)
        .getBytes(
          image.downloadUrl,
          invalidUrlMessage: '图片文件地址无效',
          downloadFailedMessage: '图片下载失败',
        );
    final directory = await getTemporaryDirectory();
    final extension = _generatedImageExtension(image.downloadUrl);
    final safeId = image.id.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '-');
    final file = File(
      '${directory.path}/starclouds-assistant-${safeId.isEmpty ? 'image' : safeId}.$extension',
    );
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  Future<void> _saveGeneratedImage(AssistantGeneratedImage image) =>
      _run(() async {
        final file = await _downloadGeneratedImage(image);
        await Gal.putImage(file.path);
        if (mounted) AppNotice.success(context, '图片已保存到系统相册');
      });

  Future<void> _shareGeneratedImage(
    AssistantGeneratedImage image,
    BuildContext buttonContext,
  ) => _run(() async {
    final box = buttonContext.findRenderObject() as RenderBox?;
    final origin = box == null
        ? null
        : box.localToGlobal(Offset.zero) & box.size;
    final file = await _downloadGeneratedImage(image);
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile(file.path)],
        text: image.revisedPrompt.isEmpty ? null : image.revisedPrompt,
        title: '分享 AI 图片',
        sharePositionOrigin: origin,
      ),
    );
  });

  Future<bool> _useGeneratedImageAsReference(
    AssistantGeneratedImage image,
  ) async {
    final workspace = ref.read(assistantWorkspaceProvider).asData?.value;
    if (workspace == null) return false;
    if (workspace.selectedRun != null || workspace.isSending) {
      AppNotice.info(context, '请先等待当前回复完成');
      return false;
    }
    final key = image.fileKey.trim();
    if (key.isEmpty) {
      AppNotice.error(context, '这张图片暂时无法继续编辑');
      return false;
    }
    final imageModel =
        workspace.config.imageModel(workspace.selectedImageModelId) ??
        workspace.config.imageModel(workspace.config.defaultImageModelId) ??
        workspace.config.imageModels.firstOrNull;
    final limit = imageModel?.maxReferenceImages ?? 0;
    if (imageModel == null || limit <= 0) {
      AppNotice.info(context, '当前图片模型不支持参考图');
      return false;
    }
    if (_references.any((item) => item.remoteKey == key)) {
      ref
          .read(assistantWorkspaceProvider.notifier)
          .selectMode(AssistantMode.image);
      AppNotice.info(context, '图片已在参考图中');
      _composerFocus.requestFocus();
      return true;
    }
    if (_references.length >= limit) {
      AppNotice.info(context, '最多添加 $limit 张参考图');
      return false;
    }

    ref
        .read(assistantWorkspaceProvider.notifier)
        .selectMode(AssistantMode.image);
    final filename = key.split('/').last.trim();
    setState(() {
      _references.add(
        ReferenceImageDraft(
          localPath: '',
          filename: filename.isEmpty ? 'AI 生成图片' : filename,
          remoteKey: key,
          remoteUrl: image.thumbnailUrl.isNotEmpty
              ? image.thumbnailUrl
              : image.url,
        ),
      );
    });
    _saveDraftNow();
    _composerFocus.requestFocus();
    _scrollToBottom();
    AppNotice.success(context, '已加入参考图，可输入修改要求');
    return true;
  }

  void _quoteReply(AssistantMessage message) {
    setState(() => _quoted = assistantQuoteFrom(message));
    _composerFocus.requestFocus();
  }

  Future<void> _executeAgentProposal(
    AssistantMessage message,
    AssistantProposal proposal,
    List<AssistantReferenceImage> references,
  ) async {
    if (_checkingBalance) return;
    final workspace = ref.read(assistantWorkspaceProvider).asData?.value;
    if (workspace == null) return;
    final model =
        workspace.config.imageModel(proposal.modelId) ??
        workspace.config.imageModels
            .where((item) => item.label == proposal.modelName)
            .firstOrNull ??
        workspace.config.imageModel(workspace.config.defaultImageModelId) ??
        workspace.config.imageModels.firstOrNull;
    final estimatedCost = (model?.pricePoints ?? 0) * proposal.count;
    setState(() => _checkingBalance = true);
    if (estimatedCost > 0) {
      WalletSnapshot? wallet = ref.read(walletProvider).asData?.value;
      try {
        wallet = await ref.read(walletProvider.future);
      } catch (_) {
        // The run endpoint remains authoritative if the preview cannot load.
      }
      if (!mounted) return;
      if (wallet != null &&
          !creationAffordability(
            wallet.availablePoints,
            estimatedCost,
          ).sufficient) {
        setState(() => _checkingBalance = false);
        await _showInsufficientBalance(wallet, estimatedCost);
        return;
      }
    }
    var submitted = false;
    await _run(() async {
      await ref
          .read(assistantWorkspaceProvider.notifier)
          .executeProposal(
            sourceMessageId: message.id,
            proposal: proposal,
            referenceImages: references,
          );
      submitted = true;
    });
    if (!mounted) return;
    setState(() => _checkingBalance = false);
    if (!submitted) return;
    ref.invalidate(walletProvider);
    ref.invalidate(profileOverviewProvider);
    _scrollToBottom();
  }

  Future<void> _restoreMessage(
    AssistantMessage message,
    int maxReferences,
  ) async {
    final hasDraft = _composer.text.trim().isNotEmpty || _references.isNotEmpty;
    if (hasDraft) {
      final confirmed = await showAppDialog<bool>(
        context: context,
        builder: (context) => AppDialog(
          icon: const Icon(Icons.restore_outlined),
          title: const Text('替换当前输入？'),
          content: const Text('当前输入文字和参考图将替换为上一次提问。'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('替换'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
    }
    await _cancelSpeechInput();
    if (!mounted) return;
    for (final image in _references) {
      _deleteLocalReference(image);
    }
    final references = message.referenceImages
        .where((item) => item.fileKey.isNotEmpty)
        .take(maxReferences)
        .map(
          (item) => ReferenceImageDraft(
            localPath: '',
            filename: item.name,
            remoteKey: item.fileKey,
            remoteUrl: item.url,
            sourceAssetId: item.id.isEmpty ? null : item.id,
          ),
        )
        .toList();
    _composer.value = TextEditingValue(
      text: message.content.trim(),
      selection: TextSelection.collapsed(offset: message.content.trim().length),
    );
    setState(() {
      _references
        ..clear()
        ..addAll(references);
    });
    _composerFocus.requestFocus();
    _scrollToBottom();
    _saveDraftNow();
    AppNotice.info(context, '已恢复上一次提问');
  }

  Future<void> _run(Future<void> Function() action) async {
    try {
      await action();
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException ? error.message : '操作失败，请稍后重试';
      AppNotice.error(context, message);
    }
  }

  Future<void> _send() async {
    final value = _composer.text.trim();
    if (value.isEmpty || _checkingBalance || _uploadingReferences) return;
    unawaited(HapticFeedback.lightImpact());
    final workspace = ref.read(assistantWorkspaceProvider).asData?.value;
    final estimatedCost = workspace == null
        ? 0
        : workspace.selectedMode == AssistantMode.image
        ? (workspace.selectedModel?.pricePoints ?? 0) * workspace.imageCount
        : workspace.selectedModel?.priceFor(workspace.reasoningEffort) ?? 0;
    setState(() => _checkingBalance = true);
    WalletSnapshot? wallet;
    if (estimatedCost > 0) {
      wallet = ref.read(walletProvider).asData?.value;
      try {
        wallet = await ref.read(walletProvider.future);
      } catch (_) {
        // The assistant run API remains authoritative when preview fails.
      }
      if (!mounted) return;
      if (wallet != null &&
          !creationAffordability(
            wallet.availablePoints,
            estimatedCost,
          ).sufficient) {
        setState(() => _checkingBalance = false);
        await _showInsufficientBalance(wallet, estimatedCost);
        return;
      }
    }
    if (!mounted) return;
    var sent = false;
    await _run(() async {
      setState(() {
        _checkingBalance = false;
        _uploadingReferences = true;
      });
      final references = await _prepareReferences();
      await ref
          .read(assistantWorkspaceProvider.notifier)
          .send(value, referenceImages: references, quoted: _quoted);
      sent = true;
    });
    if (mounted) {
      setState(() {
        _checkingBalance = false;
        _uploadingReferences = false;
      });
    }
    if (!sent || !mounted) {
      if (mounted) _saveDraftNow();
      return;
    }
    ref.invalidate(walletProvider);
    ref.invalidate(profileOverviewProvider);
    _draftTimer?.cancel();
    _draftWriteGeneration += 1;
    var clearedDraft = true;
    try {
      await _draftWriteFuture;
      await ref.read(assistantDraftStoreProvider).clear();
      _persistentDraftPaths.clear();
    } catch (_) {
      clearedDraft = false;
    }
    if (!mounted) return;
    _composer.clear();
    for (final image in _references) {
      _deleteLocalReference(image);
    }
    setState(() {
      _references.clear();
      _quoted = null;
      _draftSaving = false;
      _draftSaveFailed = false;
      _draftRestored = false;
    });
    if (!clearedDraft) {
      AppNotice.warning(context, '消息已发送，但本地草稿清理失败');
    }
    _scrollToBottom();
  }

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
        title: const Text('本次对话积分不足'),
        content: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.errorContainer,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _AssistantCostRow(
                label: '当前可用',
                value: '${wallet.availablePoints} 积分',
              ),
              const SizedBox(height: 10),
              _AssistantCostRow(label: '本次需要', value: '$estimatedCost 积分'),
              const Divider(height: 24),
              _AssistantCostRow(
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
            child: const Text('返回对话'),
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

  Future<List<AssistantReferenceImage>> _prepareReferences() async {
    final result = <AssistantReferenceImage>[];
    for (var index = 0; index < _references.length; index += 1) {
      var image = _references[index];
      var key = image.remoteKey;
      if (key == null || key.isEmpty) {
        key = await ref.read(creationRepositoryProvider).uploadReference(image);
        image = image.withRemoteKey(key);
        if (mounted && index < _references.length) {
          setState(() => _references[index] = image);
        }
      }
      result.add(
        AssistantReferenceImage(
          id: image.sourceAssetId ?? '',
          name: image.filename,
          fileKey: key,
          url: image.remoteUrl ?? '',
        ),
      );
    }
    return result;
  }

  Future<void> _addFromGallery(int limit) async {
    if (limit <= 0 || _selectingImages) return;
    setState(() => _selectingImages = true);
    try {
      final images = await ref
          .read(referenceImageServiceProvider)
          .pickFromGallery(limit);
      if (!mounted || images.isEmpty) return;
      setState(() => _references.addAll(images.take(limit)));
      _saveDraftNow();
    } catch (error) {
      if (!mounted) return;
      final message = error is FormatException ? error.message : '图片读取失败，请重新选择';
      AppNotice.error(context, message);
    } finally {
      if (mounted) setState(() => _selectingImages = false);
    }
  }

  Future<void> _addFromAssets(int limit) async {
    if (limit <= 0 || _selectingImages) return;
    final existingKeys = _references
        .map((item) => item.remoteKey)
        .whereType<String>()
        .where((item) => item.isNotEmpty)
        .toSet();
    final selected = await showAppSheet<List<UserAsset>>(
      context: context,
      isScrollControlled: true,
      builder: (context) =>
          AssetPickerSheet(maxSelection: limit, existingKeys: existingKeys),
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
        .take(limit)
        .toList();
    if (drafts.isNotEmpty) {
      setState(() => _references.addAll(drafts));
      _saveDraftNow();
    }
  }

  Future<void> _showReferenceSource(AssistantWorkspaceState state) async {
    final maxReferences = state.selectedModel?.maxReferenceImages ?? 0;
    final remaining = maxReferences - _references.length;
    if (remaining <= 0 || _selectingImages || _uploadingReferences) return;
    final source = await showAppSheet<_AssistantImageSource>(
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
                subtitle: const Text('使用已上传的个人图片'),
                onTap: () =>
                    Navigator.pop(context, _AssistantImageSource.assets),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('从相册选择'),
                subtitle: const Text('支持 PNG、JPG、WebP 与 HEIC'),
                onTap: () =>
                    Navigator.pop(context, _AssistantImageSource.gallery),
              ),
            ],
          ),
        ),
      ),
    );
    if (source == _AssistantImageSource.assets) {
      await _addFromAssets(remaining);
    } else if (source == _AssistantImageSource.gallery) {
      await _addFromGallery(remaining);
    }
  }

  void _removeReference(int index) {
    if (index < 0 || index >= _references.length) return;
    final removed = _references.removeAt(index);
    _deleteLocalReference(removed);
    setState(() {});
    _saveDraftNow();
  }

  void _trimReferences(int maxReferences) {
    var changed = false;
    while (_references.length > maxReferences) {
      _deleteLocalReference(_references.removeLast());
      changed = true;
    }
    if (mounted && changed) {
      setState(() {});
      _saveDraftNow();
    }
  }

  void _deleteLocalReference(ReferenceImageDraft image) {
    if (image.localPath.isEmpty) return;
    final path = File(image.localPath).absolute.path;
    if (_persistentDraftPaths.contains(path)) return;
    File(path).delete().ignore();
  }

  Future<void> _newConversation() async {
    if (_creatingConversation) return;
    unawaited(HapticFeedback.lightImpact());
    await _cancelSpeechInput();
    if (!mounted) return;
    setState(() => _creatingConversation = true);
    try {
      await _run(
        () => ref.read(assistantWorkspaceProvider.notifier).newConversation(),
      );
    } finally {
      if (mounted) setState(() => _creatingConversation = false);
    }
  }

  Future<void> _applyQuickTask(String value) async {
    await _cancelSpeechInput();
    if (!mounted) return;
    unawaited(HapticFeedback.selectionClick());
    _composer.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
    _composerFocus.requestFocus();
    _scheduleDraftSave();
  }

  Future<void> _showQuickTasks() async {
    final mode =
        ref.read(assistantWorkspaceProvider).asData?.value.selectedMode ??
        AssistantMode.chat;
    final tasks = _quickTasksFor(mode);
    final selected = await showAppSheet<_AssistantQuickTask>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: FractionallySizedBox(
          heightFactor: .62,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 0, 4, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        switch (mode) {
                          AssistantMode.agent => 'Agent 创作任务',
                          AssistantMode.image => '图片灵感',
                          AssistantMode.chat => '快捷指令',
                        },
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '选择一个起点，内容会自动填入输入框',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: tasks.length,
                    itemBuilder: (context, index) {
                      final task = tasks[index];
                      final colors = Theme.of(context).colorScheme;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Material(
                          color: colors.surfaceContainerLow,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(18),
                            side: BorderSide(
                              color: colors.outlineVariant.withValues(
                                alpha: .55,
                              ),
                            ),
                          ),
                          clipBehavior: Clip.antiAlias,
                          child: ListTile(
                            key: Key('assistant-quick-task-$index'),
                            minTileHeight: 66,
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 2,
                            ),
                            leading: Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(
                                color: colors.surfaceContainerHighest,
                                shape: BoxShape.circle,
                              ),
                              child: Icon(task.icon, size: 18),
                            ),
                            title: Text(
                              task.title,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            subtitle: Text(task.example),
                            trailing: const Icon(
                              Icons.north_east_rounded,
                              size: 19,
                            ),
                            onTap: () => Navigator.pop(context, task),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (selected != null && mounted) await _applyQuickTask(selected.prompt);
  }

  Future<void> _renameConversation(AssistantConversation conversation) async {
    final title = await showAppDialog<String>(
      context: context,
      builder: (dialogContext) =>
          _RenameConversationDialog(initialTitle: conversation.title),
    );
    if (title == null || title.trim() == conversation.title || !mounted) return;
    await _run(
      () => ref
          .read(assistantWorkspaceProvider.notifier)
          .renameConversation(conversation.id, title),
    );
  }

  Future<void> _confirmDelete(AssistantConversation conversation) async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        title: const Text('删除这段对话？'),
        content: Text('“${conversation.title}”中的消息将一并删除。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _run(
      () => ref
          .read(assistantWorkspaceProvider.notifier)
          .deleteConversation(conversation.id),
    );
  }

  Future<void> _confirmDeleteMany(
    List<AssistantConversation> conversations,
  ) async {
    if (conversations.isEmpty) return;
    if (conversations.length == 1) {
      await _confirmDelete(conversations.first);
      return;
    }
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        title: Text('删除这 ${conversations.length} 段对话？'),
        content: const Text('选中对话中的消息将一并删除。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final notifier = ref.read(assistantWorkspaceProvider.notifier);
    await _run(() async {
      for (final conversation in conversations) {
        await notifier.deleteConversation(conversation.id);
      }
    });
  }

  Future<void> _showConversations() async {
    if (_historyDrawerOpen || !mounted) return;
    await _cancelSpeechInput();
    if (!mounted) return;
    _historyDrawerOpen = true;
    try {
      await showAppDrawer<void>(
        context: context,
        barrierLabel: '关闭对话记录',
        builder: (context) => _AssistantHistoryDrawer(
          searchController: _historySearch,
          onNewConversation: () async {
            Navigator.pop(context);
            await _newConversation();
          },
          onSelect: (item) {
            ref
                .read(assistantWorkspaceProvider.notifier)
                .selectConversation(item.id);
            Navigator.pop(context);
          },
          onRename: (item) => unawaited(_renameConversation(item)),
          onPin: (item) => unawaited(
            ref.read(assistantWorkspaceProvider.notifier).togglePinned(item.id),
          ),
          onDelete: (item) => unawaited(_confirmDelete(item)),
          onDeleteMany: (items) => unawaited(_confirmDeleteMany(items)),
        ),
      );
    } finally {
      _historyDrawerOpen = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(assistantWorkspaceProvider, (previous, next) {
      final previousState = previous?.asData?.value;
      final nextState = next.asData?.value;
      final oldCount =
          previousState?.selectedConversation?.messages.length ?? 0;
      final newCount = nextState?.selectedConversation?.messages.length ?? 0;
      if (previousState?.selectedConversationId !=
          nextState?.selectedConversationId) {
        _showJumpToLatest = false;
        _scrollController.pinToLatest = true;
      } else if (newCount != oldCount && !_showJumpToLatest) {
        _scrollToBottom();
      }
      final nextLimit = next.asData?.value.selectedModel?.maxReferenceImages;
      if (nextLimit != null && _references.length > nextLimit) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && _references.length > nextLimit) {
            _trimReferences(nextLimit);
          }
        });
      }
    });
    final workspace = ref.watch(assistantWorkspaceProvider);
    final state = workspace.asData?.value;
    final colors = Theme.of(context).colorScheme;
    final historyButton = IconButton(
      key: const Key('assistant-history'),
      tooltip: '历史对话',
      style: IconButton.styleFrom(
        backgroundColor: colors.surfaceContainerLowest.withValues(alpha: .72),
        foregroundColor: colors.onSurface,
        minimumSize: const Size.square(40),
        maximumSize: const Size.square(40),
        padding: EdgeInsets.zero,
      ),
      onPressed: state == null
          ? null
          : () {
              unawaited(HapticFeedback.selectionClick());
              _showConversations();
            },
      icon: const Icon(Icons.history_rounded, size: 21),
    );
    return Stack(
      children: [
        Scaffold(
          backgroundColor: colors.surface,
          appBar: AppTopBar(
            backgroundColor: colors.surface,
            leading: widget.showBackButton
                ? null
                : Padding(
                    padding: const EdgeInsets.only(left: 12),
                    child: historyButton,
                  ),
            leadingWidth: widget.showBackButton ? null : 64,
            centerTitle: true,
            title: _AssistantHeaderMenu(
              state: state,
              onSelectMode: state == null
                  ? null
                  : (mode) => _selectModeFromHeader(state, mode),
              onSelectModel: state == null
                  ? null
                  : (modelId) => _selectModelFromHeader(state, modelId),
              onSelectReasoning: state == null
                  ? null
                  : (effort) => ref
                        .read(assistantWorkspaceProvider.notifier)
                        .selectReasoningEffort(effort),
            ),
            showBackButton: widget.showBackButton,
            fallbackLocation: widget.fallbackLocation,
            actions: [
              if (widget.showBackButton) historyButton,
              Padding(
                padding: EdgeInsets.fromLTRB(
                  widget.showBackButton ? 4 : 0,
                  0,
                  12,
                  0,
                ),
                child: SizedBox.square(
                  dimension: 40,
                  child: IconButton.filled(
                    key: const Key('assistant-new'),
                    tooltip: '新对话',
                    style: IconButton.styleFrom(
                      backgroundColor: colors.onSurface,
                      foregroundColor: colors.surface,
                      disabledBackgroundColor: colors.onSurface,
                      disabledForegroundColor: colors.surface,
                      minimumSize: const Size.square(40),
                      maximumSize: const Size.square(40),
                      padding: EdgeInsets.zero,
                    ),
                    onPressed:
                        state == null ||
                            _creatingConversation ||
                            !state.canStartNewConversation
                        ? null
                        : _newConversation,
                    padding: EdgeInsets.zero,
                    icon: AnimatedSwitcher(
                      duration: _motionDuration(context, 180),
                      switchInCurve: Curves.easeOutBack,
                      transitionBuilder: (child, animation) => FadeTransition(
                        opacity: animation,
                        child: ScaleTransition(scale: animation, child: child),
                      ),
                      child: _creatingConversation
                          ? SizedBox.square(
                              key: const Key('assistant-new-loading'),
                              dimension: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: colors.surface,
                              ),
                            )
                          : const Icon(
                              Icons.add_rounded,
                              key: Key('assistant-new-icon'),
                              size: 22,
                            ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          body: workspace.when(
            skipLoadingOnReload: true,
            skipLoadingOnRefresh: true,
            loading: () => const _AssistantWorkspaceSkeleton(),
            error: (error, stackTrace) => _AssistantError(
              onRetry: () => ref.invalidate(assistantWorkspaceProvider),
            ),
            data: _buildWorkspace,
          ),
        ),
        if (state != null)
          Positioned(
            left: 0,
            top: MediaQuery.paddingOf(context).top + 56,
            bottom: 0,
            width: 28,
            child: GestureDetector(
              key: const Key('assistant-history-edge'),
              behavior: HitTestBehavior.translucent,
              onHorizontalDragEnd: (details) {
                if ((details.primaryVelocity ?? 0) <= 240) return;
                unawaited(HapticFeedback.selectionClick());
                unawaited(_showConversations());
              },
            ),
          ),
      ],
    );
  }

  Widget _buildWorkspace(AssistantWorkspaceState state) {
    final conversation = state.selectedConversation;
    return Column(
      children: [
        Expanded(
          child: Stack(
            children: [
              Positioned.fill(
                child: conversation == null || conversation.messages.isEmpty
                    ? _AssistantWelcome(mode: state.selectedMode)
                    : _buildMessageThread(state, conversation),
              ),
              if (_showJumpToLatest &&
                  conversation != null &&
                  conversation.messages.isNotEmpty)
                Positioned(
                  right: 16,
                  bottom: 10,
                  child: _JumpToLatestButton(onPressed: _scrollToBottom),
                ),
            ],
          ),
        ),
        if (state.syncError != null)
          _AssistantSyncError(
            message: state.syncError!,
            onRetry: () =>
                ref.read(assistantWorkspaceProvider.notifier).retrySync(),
          ),
        if (_draftLoaded && !_currentDraft().isEmpty && _draftSaveFailed)
          AssistantDraftStatusBar(
            saving: _draftSaving,
            failed: _draftSaveFailed,
            restored: _draftRestored,
            onClear: _clearDraft,
          ),
        _AssistantComposer(
          controller: _composer,
          focusNode: _composerFocus,
          enabled:
              state.canSend &&
              !_selectingImages &&
              !_checkingBalance &&
              !_uploadingReferences,
          sending: state.isSending || _checkingBalance || _uploadingReferences,
          busyLabel: _checkingBalance
              ? '正在检查积分'
              : _uploadingReferences
              ? '正在上传参考图'
              : state.isSending
              ? '正在发送'
              : '',
          mode: state.selectedMode,
          modelAvailable: state.selectedModel != null,
          quoted: _quoted,
          onClearQuote: () => setState(() => _quoted = null),
          references: _references,
          maxReferences: state.selectedModel?.maxReferenceImages ?? 0,
          speechInitializing: _speechInitializing,
          speechListening: _speechListening,
          onChanged: _scheduleDraftSave,
          onOpenTools: () async {
            await _cancelSpeechInput();
            if (mounted) _showModePicker(state);
          },
          onRemoveReference: _removeReference,
          onToggleSpeech: _toggleSpeechInput,
          onStop: state.selectedRun == null
              ? null
              : () => _run(
                  () => ref
                      .read(assistantWorkspaceProvider.notifier)
                      .cancelSelectedRun(),
                ),
          onSend: _send,
        ),
      ],
    );
  }

  Widget _buildMessageThread(
    AssistantWorkspaceState state,
    AssistantConversation conversation,
  ) {
    return KeyedSubtree(
      key: ValueKey(conversation.id),
      child: ListView.builder(
        key: const Key('assistant-messages'),
        controller: _scrollController,
        cacheExtent: 480,
        padding: const EdgeInsets.fromLTRB(18, 10, 18, 36),
        itemCount: conversation.messages.length,
        itemBuilder: (context, index) {
          final message = conversation.messages[index];
          final retrySource = assistantRetrySource(
            conversation.messages,
            index,
          );
          final isLastAssistant =
              conversation.messages.lastIndexWhere((item) => !item.isUser) ==
              index;
          final canRetry =
              retrySource != null && (message.canRetry || isLastAssistant);
          final proposalReferences = _agentProposalReferences(
            conversation.messages,
            index,
          );
          final proposalExecuted = conversation.messages.any(
            (item) => item.proposalSourceMessageId == message.id,
          );
          return RepaintBoundary(
            child: _MessageBubble(
              key: ValueKey('assistant-msg-${message.id}'),
              message: message,
              fallbackCostPoints: _replyFallbackCost(
                message,
                state.activeRuns[conversation.id],
                state,
              ),
              onReuse: message.isUser && !state.isSending
                  ? () => _restoreMessage(
                      message,
                      state.selectedModel?.maxReferenceImages ?? 0,
                    )
                  : null,
              onCopy: message.canUseAsCreationPrompt
                  ? () => _copyReply(message.content)
                  : null,
              onShare: message.canUseAsCreationPrompt
                  ? () => _shareReply(message.content)
                  : null,
              onQuote: message.canQuote ? () => _quoteReply(message) : null,
              onSaveImage: _saveGeneratedImage,
              onShareImage: _shareGeneratedImage,
              onUseImage: _useGeneratedImageAsReference,
              imageModels: state.config.imageModels,
              proposalGenerating: state.isSending || state.selectedRun != null,
              proposalExecuted: proposalExecuted,
              onApproveProposal: message.proposal?.isUsable == true
                  ? (proposal) => _executeAgentProposal(
                      message,
                      proposal,
                      proposalReferences,
                    )
                  : null,
              onRetry: canRetry
                  ? () => _restoreMessage(
                      retrySource,
                      state.selectedModel?.maxReferenceImages ?? 0,
                    )
                  : null,
            ),
          );
        },
      ),
    );
  }

  void _showModePicker(AssistantWorkspaceState state) {
    showAppSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 18),
          child: _AssistantToolGroup(
            children: [
              _AssistantToolRow(
                tileKey: const Key('assistant-add-reference'),
                icon: Icons.add_photo_alternate_outlined,
                title: '添加图片',
                subtitle: state.selectedModel?.maxReferenceImages == 0
                    ? '当前模型不支持参考图'
                    : '从相册、相机或素材库选择',
                enabled:
                    state.selectedModel?.maxReferenceImages != 0 &&
                    _references.length <
                        (state.selectedModel?.maxReferenceImages ?? 0),
                onTap: () {
                  Navigator.pop(context);
                  unawaited(
                    Future<void>.delayed(Duration.zero, () {
                      if (mounted) _showReferenceSource(state);
                    }),
                  );
                },
              ),
              _AssistantToolRow(
                tileKey: const Key('assistant-open-quick-tasks'),
                icon: Icons.bolt_outlined,
                title: '快捷指令',
                subtitle: '从常用任务快速开始',
                accent: Theme.of(context).colorScheme.secondary,
                onTap: () {
                  Navigator.pop(context);
                  unawaited(
                    Future<void>.delayed(Duration.zero, () {
                      if (mounted) _showQuickTasks();
                    }),
                  );
                },
              ),
              if (state.selectedMode == AssistantMode.image)
                _AssistantToolRow(
                  tileKey: const Key('assistant-mode-settings'),
                  icon: Icons.aspect_ratio_rounded,
                  title: '图片参数',
                  subtitle:
                      '${state.imageResolution} · ${state.imageRatio == 'auto' ? '自动比例' : state.imageRatio} · ${state.imageCount} 张',
                  accent: Theme.of(context).colorScheme.tertiary,
                  onTap: () {
                    Navigator.pop(context);
                    unawaited(
                      Future<void>.delayed(Duration.zero, () {
                        if (mounted) _showImageSettings(state);
                      }),
                    );
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  void _selectModeFromHeader(
    AssistantWorkspaceState state,
    AssistantMode mode,
  ) {
    ref.read(assistantWorkspaceProvider.notifier).selectMode(mode);
    final model = mode == AssistantMode.image
        ? state.config.imageModel(state.selectedImageModelId)
        : state.config.model(state.selectedModelId);
    _trimReferences(model?.maxReferenceImages ?? 0);
  }

  void _selectModelFromHeader(AssistantWorkspaceState state, String modelId) {
    final imageMode = state.selectedMode == AssistantMode.image;
    ref.read(assistantWorkspaceProvider.notifier).selectModel(modelId);
    _trimReferences(
      (imageMode
                  ? state.config.imageModel(modelId)
                  : state.config.model(modelId))
              ?.maxReferenceImages ??
          0,
    );
  }

  void _showImageSettings(AssistantWorkspaceState state) {
    final model = state.selectedModel;
    if (model == null) return;
    var resolution = state.imageResolution;
    var ratio = state.imageRatio;
    var quality = state.imageQuality;
    var count = state.imageCount;
    showAppSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) {
          final ratios = model.ratiosFor(resolution);
          return SafeArea(
            child: FractionallySizedBox(
              heightFactor: .78,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 0, 18, 20),
                children: [
                  Text(
                    '图片参数',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    model.label,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (model.resolutions.isNotEmpty) ...[
                    const SizedBox(height: 20),
                    const _ImageSettingLabel(label: '分辨率'),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final item in model.resolutions)
                          AppChoicePill(
                            label: Text(item),
                            selected: resolution == item,
                            onSelected: (_) {
                              ref
                                  .read(assistantWorkspaceProvider.notifier)
                                  .selectImageResolution(item);
                              final nextRatios = model.ratiosFor(item);
                              setSheetState(() {
                                resolution = item;
                                if (!nextRatios.contains(ratio)) {
                                  ratio = nextRatios.contains('auto')
                                      ? 'auto'
                                      : nextRatios.firstOrNull ?? '';
                                }
                              });
                            },
                          ),
                      ],
                    ),
                  ],
                  if (ratios.isNotEmpty) ...[
                    const SizedBox(height: 20),
                    const _ImageSettingLabel(label: '画面比例'),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final item in ratios)
                          AppChoicePill(
                            label: Text(item == 'auto' ? '自动' : item),
                            selected: ratio == item,
                            onSelected: (_) {
                              ref
                                  .read(assistantWorkspaceProvider.notifier)
                                  .selectImageRatio(item);
                              setSheetState(() => ratio = item);
                            },
                          ),
                      ],
                    ),
                  ],
                  if (model.qualities.isNotEmpty) ...[
                    const SizedBox(height: 20),
                    const _ImageSettingLabel(label: '质量'),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final item in model.qualities)
                          AppChoicePill(
                            label: Text(_imageQualityLabel(item)),
                            selected: quality == item,
                            onSelected: (_) {
                              ref
                                  .read(assistantWorkspaceProvider.notifier)
                                  .selectImageQuality(item);
                              setSheetState(() => quality = item);
                            },
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 20),
                  const _ImageSettingLabel(label: '生成张数'),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      IconButton.outlined(
                        key: const Key('assistant-image-count-minus'),
                        tooltip: '减少张数',
                        onPressed: count > 1
                            ? () {
                                count -= 1;
                                ref
                                    .read(assistantWorkspaceProvider.notifier)
                                    .selectImageCount(count);
                                setSheetState(() {});
                              }
                            : null,
                        icon: const Icon(Icons.remove),
                      ),
                      SizedBox(
                        width: 72,
                        child: Text(
                          '$count 张',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                      ),
                      IconButton.outlined(
                        key: const Key('assistant-image-count-plus'),
                        tooltip: '增加张数',
                        onPressed: count < model.maxImages
                            ? () {
                                count += 1;
                                ref
                                    .read(assistantWorkspaceProvider.notifier)
                                    .selectImageCount(count);
                                setSheetState(() {});
                              }
                            : null,
                        icon: const Icon(Icons.add),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _AssistantToolGroup extends StatelessWidget {
  const _AssistantToolGroup({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerLow,
      borderRadius: StarCloudsRadii.card,
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var index = 0; index < children.length; index++) ...[
            if (index > 0)
              Divider(
                height: 1,
                thickness: 1,
                indent: 74,
                endIndent: 16,
                color: colors.outlineVariant.withValues(alpha: .28),
              ),
            children[index],
          ],
        ],
      ),
    );
  }
}

class _AssistantToolIcon extends StatelessWidget {
  const _AssistantToolIcon({required this.icon, this.accent});

  final IconData icon;
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final color = accent ?? colors.primary;
    return SizedBox.square(
      dimension: 44,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: color.withValues(
            alpha: colors.brightness == Brightness.dark ? .22 : .12,
          ),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Icon(icon, size: 22, color: color),
      ),
    );
  }
}

class _AssistantToolRow extends StatelessWidget {
  const _AssistantToolRow({
    required this.tileKey,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.accent,
    this.enabled = true,
  });

  final Key tileKey;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final Color? accent;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Opacity(
      opacity: enabled ? 1 : .45,
      child: InkWell(
        key: tileKey,
        onTap: enabled ? onTap : null,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 12, 14),
          child: Row(
            children: [
              _AssistantToolIcon(icon: icon, accent: accent),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.2,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                Icons.chevron_right_rounded,
                size: 20,
                color: colors.onSurfaceVariant.withValues(alpha: .46),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ImageSettingLabel extends StatelessWidget {
  const _ImageSettingLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Text(
    label,
    style: Theme.of(
      context,
    ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w800),
  );
}

String _imageQualityLabel(String value) => switch (value) {
  'low' => '快速',
  'medium' => '标准',
  'high' => '高清',
  _ => value,
};

String _assistantModeLabel(AssistantMode mode) => switch (mode) {
  AssistantMode.chat => '问答',
  AssistantMode.agent => 'Agent',
  AssistantMode.image => '图片',
};

double _assistantHeaderMenuWidth(double screenWidth) =>
    (screenWidth * 0.6).clamp(204.0, 236.0);

const _assistantMenuOverlayStyle = MenuStyle(
  padding: WidgetStatePropertyAll(EdgeInsets.zero),
  backgroundColor: WidgetStatePropertyAll(Colors.transparent),
  surfaceTintColor: WidgetStatePropertyAll(Colors.transparent),
  shadowColor: WidgetStatePropertyAll(Colors.transparent),
  elevation: WidgetStatePropertyAll(0),
  side: WidgetStatePropertyAll(BorderSide.none),
  shape: WidgetStatePropertyAll(
    RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(StarCloudsRadii.sm)),
      side: BorderSide.none,
    ),
  ),
);

class _AssistantHeaderMenu extends StatefulWidget {
  const _AssistantHeaderMenu({
    required this.state,
    required this.onSelectMode,
    required this.onSelectModel,
    required this.onSelectReasoning,
  });

  final AssistantWorkspaceState? state;
  final ValueChanged<AssistantMode>? onSelectMode;
  final ValueChanged<String>? onSelectModel;
  final ValueChanged<String>? onSelectReasoning;

  @override
  State<_AssistantHeaderMenu> createState() => _AssistantHeaderMenuState();
}

class _AssistantHeaderMenuState extends State<_AssistantHeaderMenu>
    with SingleTickerProviderStateMixin {
  final _overlay = OverlayPortalController();
  AnimationController? _motion;
  Animation<double>? _fade;
  Animation<Offset>? _slide;
  var _open = false;

  AnimationController get _motionController {
    _ensureMotion();
    return _motion!;
  }

  Animation<double> get _fadeAnimation {
    _ensureMotion();
    return _fade!;
  }

  Animation<Offset> get _slideAnimation {
    _ensureMotion();
    return _slide!;
  }

  void _ensureMotion() {
    if (_motion != null) return;
    _motion = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 220),
      reverseDuration: const Duration(milliseconds: 180),
    );
    final appear = CurvedAnimation(
      parent: _motion!,
      curve: Curves.easeOutCubic,
      reverseCurve: Curves.easeInCubic,
    );
    _fade = appear;
    _slide = Tween<Offset>(
      begin: const Offset(0, -0.06),
      end: Offset.zero,
    ).animate(appear);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _motionController.duration = _motionDuration(context, 220);
    _motionController.reverseDuration = _motionDuration(context, 180);
  }

  @override
  void dispose() {
    _motion?.dispose();
    super.dispose();
  }

  Future<void> _showMenu() async {
    if (_open) return;
    setState(() => _open = true);
    _overlay.show();
    await _motionController.forward(from: 0);
  }

  Future<void> _hideMenu() async {
    if (!_open) return;
    setState(() => _open = false);
    await _motionController.reverse();
    if (mounted) _overlay.hide();
  }

  @override
  Widget build(BuildContext context) {
    final current = widget.state;
    final mode = current?.selectedMode ?? AssistantMode.chat;
    final model = current?.selectedModel;
    final colors = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.center,
      child: OverlayPortal.overlayChildLayoutBuilder(
        controller: _overlay,
        overlayChildBuilder: (context, info) {
          final origin = MatrixUtils.transformPoint(
            info.childPaintTransform,
            Offset.zero,
          );
          final size = MediaQuery.sizeOf(context);
          final panelWidth = _assistantHeaderMenuWidth(size.width);
          final maxLeft = (size.width - panelWidth - 12).clamp(
            12.0,
            size.width,
          );
          final left = (origin.dx + info.childSize.width / 2 - panelWidth / 2)
              .clamp(12.0, maxLeft);
          return Stack(
            children: [
              Positioned.fill(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => unawaited(_hideMenu()),
                ),
              ),
              Positioned(
                left: left,
                top: origin.dy + info.childSize.height + 6,
                width: panelWidth,
                child: FadeTransition(
                  opacity: _fadeAnimation,
                  child: SlideTransition(
                    position: _slideAnimation,
                    child: _AssistantHeaderMenuPanel(
                      state: current,
                      onSelectMode: (value) => widget.onSelectMode?.call(value),
                      onSelectModel: (value) =>
                          widget.onSelectModel?.call(value),
                      onSelectReasoning: (value) =>
                          widget.onSelectReasoning?.call(value),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
        child: TextButton(
          key: const Key('assistant-model'),
          onPressed: current == null
              ? null
              : () {
                  unawaited(HapticFeedback.selectionClick());
                  if (_open) {
                    unawaited(_hideMenu());
                  } else {
                    unawaited(_showMenu());
                  }
                },
          style: TextButton.styleFrom(
            foregroundColor: colors.onSurface,
            minimumSize: const Size(0, 56),
            maximumSize: const Size(double.infinity, 56),
            padding: EdgeInsets.zero,
            alignment: Alignment.center,
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.standard,
            backgroundColor: Colors.transparent,
            disabledBackgroundColor: Colors.transparent,
            overlayColor: Colors.transparent,
            splashFactory: NoSplash.splashFactory,
            surfaceTintColor: Colors.transparent,
            shape: const RoundedRectangleBorder(),
          ),
          child: Row(
            key: const Key('assistant-header-summary'),
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Flexible(
                child: AnimatedSize(
                  duration: _motionDuration(context, 280),
                  curve: Curves.easeOutCubic,
                  alignment: Alignment.center,
                  child: _AssistantHeaderTicker(
                    value:
                        '${_assistantModeLabel(mode)} · ${model?.label ?? 'AI 助手'}',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 2),
              AnimatedRotation(
                turns: _open ? .5 : 0,
                duration: _motionDuration(context, 160),
                curve: Curves.easeOutCubic,
                child: Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 18,
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AssistantHeaderTicker extends StatelessWidget {
  const _AssistantHeaderTicker({
    required this.value,
    required this.style,
    this.textAlign = TextAlign.start,
  });

  final String value;
  final TextStyle? style;
  final TextAlign textAlign;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ClipRect(
      child: AnimatedSwitcher(
        duration: _motionDuration(context, 320),
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInCubic,
        layoutBuilder: (current, previous) => Stack(
          alignment: switch (textAlign) {
            TextAlign.end => Alignment.centerRight,
            TextAlign.center => Alignment.center,
            _ => Alignment.centerLeft,
          },
          clipBehavior: Clip.hardEdge,
          children: [...previous, ?current],
        ),
        transitionBuilder: (child, animation) {
          final slide = Tween<Offset>(
            begin: const Offset(0, 0.55),
            end: Offset.zero,
          ).animate(animation);
          return FadeTransition(
            opacity: animation,
            child: SlideTransition(position: slide, child: child),
          );
        },
        child: AnimatedDefaultTextStyle(
          key: ValueKey(value),
          duration: _motionDuration(context, 240),
          curve: Curves.easeOutCubic,
          style: (style ?? DefaultTextStyle.of(context).style).copyWith(
            color: colors.onSurface,
            height: 1,
            leadingDistribution: TextLeadingDistribution.even,
          ),
          child: Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: textAlign,
            strutStyle: StrutStyle(
              fontSize: style?.fontSize,
              height: 1,
              forceStrutHeight: true,
              leadingDistribution: TextLeadingDistribution.even,
            ),
          ),
        ),
      ),
    );
  }
}

class _AssistantHeaderMenuPanel extends StatelessWidget {
  const _AssistantHeaderMenuPanel({
    required this.state,
    required this.onSelectMode,
    required this.onSelectModel,
    required this.onSelectReasoning,
  });

  final AssistantWorkspaceState? state;
  final ValueChanged<AssistantMode> onSelectMode;
  final ValueChanged<String> onSelectModel;
  final ValueChanged<String> onSelectReasoning;

  @override
  Widget build(BuildContext context) {
    final current = state;
    final mode = current?.selectedMode ?? AssistantMode.chat;
    final model = current?.selectedModel;
    final reasoningEfforts = model?.reasoningEfforts ?? const <String>[];
    final canConfigure = current != null && current.selectedRun == null;
    final showReasoning =
        mode != AssistantMode.image && reasoningEfforts.isNotEmpty;
    final reasoningLabel = current?.reasoningEffort.isNotEmpty == true
        ? assistantReasoningLabel(current!.reasoningEffort)
        : '默认';
    return Align(
      alignment: Alignment.topCenter,
      widthFactor: 1,
      heightFactor: 1,
      child: _AssistantMenuSurface(
        key: const Key('assistant-header-menu-panel'),
        compact: true,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(6, 6, 6, 6),
          child: AnimatedSize(
            duration: _motionDuration(context, 180),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _AssistantHeaderDropdownSection(
                  tileKey: const Key('assistant-header-mode'),
                  label: '模式',
                  value: _assistantModeLabel(mode),
                  options: (dismissSubmenu) => [
                    for (final option in const [
                      AssistantMode.agent,
                      AssistantMode.chat,
                      AssistantMode.image,
                    ])
                      _AssistantHeaderOption(
                        key: ValueKey(
                          'assistant-header-mode-${option.wireValue}',
                        ),
                        label: _assistantModeLabel(option),
                        selected: mode == option,
                        enabled:
                            canConfigure &&
                            (option != AssistantMode.image ||
                                current.config.imageModels.isNotEmpty),
                        onTap: () {
                          unawaited(HapticFeedback.selectionClick());
                          onSelectMode(option);
                          dismissSubmenu();
                        },
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                _AssistantHeaderDropdownSection(
                  tileKey: const Key('assistant-header-model'),
                  label: '模型',
                  value: model?.label ?? '暂无可用模型',
                  options: (dismissSubmenu) =>
                      current == null || current.availableModels.isEmpty
                      ? const [_AssistantHeaderEmptyOption(label: '暂无可用模型')]
                      : [
                          for (final option in current.availableModels)
                            _AssistantHeaderOption(
                              key: ValueKey(
                                'assistant-header-model-${option.id}',
                              ),
                              label: option.label,
                              selected: model?.id == option.id,
                              enabled: canConfigure,
                              onTap: () {
                                unawaited(HapticFeedback.selectionClick());
                                onSelectModel(option.id);
                                dismissSubmenu();
                              },
                            ),
                        ],
                ),
                if (showReasoning) ...[
                  const SizedBox(height: 4),
                  _AssistantHeaderDropdownSection(
                    tileKey: const Key('assistant-header-reasoning'),
                    label: '推理强度',
                    value: reasoningLabel,
                    options: (dismissSubmenu) => [
                      for (final effort in reasoningEfforts)
                        _AssistantHeaderOption(
                          key: ValueKey('assistant-header-reasoning-$effort'),
                          label: assistantReasoningLabel(effort),
                          selected: current?.reasoningEffort == effort,
                          enabled: canConfigure,
                          onTap: () {
                            unawaited(HapticFeedback.selectionClick());
                            onSelectReasoning(effort);
                            dismissSubmenu();
                          },
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AssistantHeaderDropdownSection extends StatefulWidget {
  const _AssistantHeaderDropdownSection({
    required this.tileKey,
    required this.label,
    required this.value,
    required this.options,
  });

  final Key tileKey;
  final String label;
  final String value;
  final List<Widget> Function(VoidCallback dismissSubmenu) options;

  @override
  State<_AssistantHeaderDropdownSection> createState() =>
      _AssistantHeaderDropdownSectionState();
}

class _AssistantHeaderDropdownSectionState
    extends State<_AssistantHeaderDropdownSection> {
  final _submenu = MenuController();

  void _dismissSubmenu() {
    if (_submenu.isOpen) _submenu.close();
  }

  @override
  Widget build(BuildContext context) {
    return MenuAnchor(
      controller: _submenu,
      alignmentOffset: const Offset(0, 6),
      consumeOutsideTap: true,
      crossAxisUnconstrained: false,
      useRootOverlay: true,
      style: _assistantMenuOverlayStyle.copyWith(
        alignment: AlignmentDirectional.bottomStart,
      ),
      menuChildren: [
        _AssistantMenuAppear(
          kind: _AssistantMenuAppearKind.submenu,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 132, maxWidth: 200),
            child: _AssistantMenuSurface(
              compact: true,
              child: Padding(
                padding: const EdgeInsets.all(4),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 240),
                  child: SingleChildScrollView(
                    primary: false,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: widget.options(_dismissSubmenu),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
      builder: (context, controller, child) => _AssistantHeaderSectionTile(
        key: widget.tileKey,
        label: widget.label,
        value: widget.value,
        expanded: controller.isOpen,
        onTap: () {
          unawaited(HapticFeedback.selectionClick());
          if (controller.isOpen) {
            controller.close();
          } else {
            controller.open();
          }
        },
      ),
    );
  }
}

enum _AssistantMenuAppearKind { panel, submenu }

class _AssistantMenuAppear extends StatelessWidget {
  const _AssistantMenuAppear({
    required this.child,
    this.kind = _AssistantMenuAppearKind.panel,
  });

  final Widget child;
  final _AssistantMenuAppearKind kind;
  static final _appear = Tween<double>(begin: 0, end: 1);

  @override
  Widget build(BuildContext context) {
    final submenu = kind == _AssistantMenuAppearKind.submenu;
    return TweenAnimationBuilder<double>(
      duration: _motionDuration(context, submenu ? 260 : 200),
      curve: submenu ? Curves.easeOutCubic : Curves.easeOutQuad,
      tween: _appear,
      builder: (context, value, child) {
        final t = value.clamp(0.0, 1.0);
        if (t >= 1) return child!;
        final fade = submenu
            ? Curves.easeOut.transform((t / .72).clamp(0.0, 1.0))
            : t;
        return Opacity(
          opacity: fade,
          child: Transform.translate(
            offset: Offset(0, (submenu ? 10 : 6) * (1 - t)),
            child: child,
          ),
        );
      },
      child: child,
    );
  }
}

class _AssistantMenuSurface extends StatelessWidget {
  const _AssistantMenuSurface({
    required this.child,
    this.compact = false,
    super.key,
  });

  final Widget child;
  final bool compact;

  static double radiusFor({required bool compact}) =>
      compact ? StarCloudsRadii.sm : StarCloudsRadii.md;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final visual = StarCloudsVisualStyle.of(context);
    final radius = BorderRadius.circular(radiusFor(compact: compact));
    return Material(
      color: dark
          ? const Color(0xF51C1E28)
          : Colors.white.withValues(alpha: .98),
      elevation: compact ? 8 : 10,
      shadowColor: visual.shadow.withValues(alpha: dark ? .42 : .18),
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: BorderSide.none,
      ),
      clipBehavior: Clip.antiAlias,
      child: child,
    );
  }
}

class _AssistantHeaderSectionTile extends StatelessWidget {
  const _AssistantHeaderSectionTile({
    required this.label,
    required this.value,
    required this.expanded,
    required this.onTap,
    super.key,
  });

  final String label;
  final String value;
  final bool expanded;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                label,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  color: colors.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                  height: 1,
                  leadingDistribution: TextLeadingDistribution.even,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _AssistantHeaderTicker(
                  value: value,
                  textAlign: TextAlign.end,
                  style: Theme.of(
                    context,
                  ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              AnimatedRotation(
                turns: expanded ? .5 : 0,
                duration: _motionDuration(context, 180),
                curve: Curves.easeOutCubic,
                child: Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 16,
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AssistantHeaderOption extends StatelessWidget {
  const _AssistantHeaderOption({
    required this.label,
    required this.selected,
    required this.enabled,
    required this.onTap,
    super.key,
  });

  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 2),
        child: Opacity(
          opacity: enabled ? 1 : .42,
          child: Material(
            color: selected
                ? colors.primary.withValues(alpha: .08)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(StarCloudsRadii.sm),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: enabled ? onTap : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        label,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: selected
                              ? FontWeight.w700
                              : FontWeight.w500,
                        ),
                      ),
                    ),
                    if (selected)
                      Icon(
                        Icons.check_rounded,
                        size: 16,
                        color: colors.primary,
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AssistantHeaderEmptyOption extends StatelessWidget {
  const _AssistantHeaderEmptyOption({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(10, 9, 10, 10),
    child: Align(
      alignment: Alignment.centerLeft,
      child: Text(
        label,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    ),
  );
}

class AssistantPageSkeleton extends StatelessWidget {
  const AssistantPageSkeleton({
    this.showBackButton = false,
    this.fallbackLocation = '/discover',
    super.key,
  });

  final bool showBackButton;
  final String fallbackLocation;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: AppTopBar(
        backgroundColor: colors.surface,
        leading: showBackButton
            ? null
            : Padding(
                padding: const EdgeInsets.only(left: 12),
                child: IconButton(
                  tooltip: '历史对话',
                  style: IconButton.styleFrom(
                    backgroundColor: colors.surfaceContainerLowest.withValues(
                      alpha: .72,
                    ),
                    foregroundColor: colors.onSurface,
                    minimumSize: const Size.square(40),
                    maximumSize: const Size.square(40),
                    padding: EdgeInsets.zero,
                  ),
                  onPressed: null,
                  icon: const Icon(Icons.history_rounded, size: 21),
                ),
              ),
        leadingWidth: showBackButton ? null : 64,
        centerTitle: true,
        title: const _AssistantHeaderMenu(
          state: null,
          onSelectMode: null,
          onSelectModel: null,
          onSelectReasoning: null,
        ),
        showBackButton: showBackButton,
        fallbackLocation: fallbackLocation,
        actions: [
          Padding(
            padding: EdgeInsets.fromLTRB(showBackButton ? 4 : 0, 0, 12, 0),
            child: SizedBox.square(
              dimension: 40,
              child: IconButton.filled(
                tooltip: '新对话',
                style: IconButton.styleFrom(
                  backgroundColor: colors.onSurface,
                  foregroundColor: colors.surface,
                  disabledBackgroundColor: colors.onSurface,
                  disabledForegroundColor: colors.surface,
                  minimumSize: const Size.square(40),
                  maximumSize: const Size.square(40),
                  padding: EdgeInsets.zero,
                ),
                onPressed: null,
                icon: const Icon(Icons.add_rounded, size: 22),
              ),
            ),
          ),
        ],
      ),
      body: const _AssistantWorkspaceSkeleton(),
    );
  }
}

class _AssistantWorkspaceSkeleton extends StatelessWidget {
  const _AssistantWorkspaceSkeleton();

  @override
  Widget build(BuildContext context) {
    return const _AssistantSkeletonPulse(
      child: Column(
        key: Key('assistant-workspace-skeleton'),
        children: [
          Expanded(child: _AssistantWelcomeSkeleton()),
          _AssistantComposerSkeleton(),
        ],
      ),
    );
  }
}

class _AssistantWelcomeSkeleton extends StatelessWidget {
  const _AssistantWelcomeSkeleton();

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, viewport) => SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        physics: const NeverScrollableScrollPhysics(),
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: 520,
              minHeight: viewport.maxHeight > 48 ? viewport.maxHeight - 48 : 0,
            ),
            child: const Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _AssistantBone(width: 118, height: 118, radius: 999),
                SizedBox(height: 18),
                _AssistantBone(width: 168, height: 22, radius: 8),
                SizedBox(height: 10),
                _AssistantBone(width: 200, height: 14, radius: 6),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AssistantComposerSkeleton extends StatelessWidget {
  const _AssistantComposerSkeleton();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 6, 14, 12),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: Theme.of(context).brightness == Brightness.dark
                ? colors.surfaceContainerHigh
                : const Color(0xFFF3F4F6),
            borderRadius: BorderRadius.circular(999),
          ),
          child: const Padding(
            padding: EdgeInsets.all(4),
            child: SizedBox(
              height: 36,
              child: Row(
                children: [
                  _AssistantBone(width: 28, height: 28, radius: 999),
                  SizedBox(width: 10),
                  Expanded(child: _AssistantBone(height: 10, radius: 6)),
                  SizedBox(width: 10),
                  _AssistantBone(width: 28, height: 28, radius: 999),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AssistantBone extends StatelessWidget {
  const _AssistantBone({this.width, required this.height, this.radius = 8});

  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(
          context,
        ).colorScheme.surfaceContainerHighest.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(radius),
      ),
      child: SizedBox(width: width ?? double.infinity, height: height),
    );
  }
}

class _AssistantSkeletonPulse extends StatefulWidget {
  const _AssistantSkeletonPulse({required this.child});

  final Widget child;

  @override
  State<_AssistantSkeletonPulse> createState() =>
      _AssistantSkeletonPulseState();
}

class _AssistantSkeletonPulseState extends State<_AssistantSkeletonPulse>
    with SingleTickerProviderStateMixin {
  AnimationController? _motion;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_loopingMotionEnabled(context)) {
      _motion?.stop();
      return;
    }
    _motion ??= AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _motion?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final motion = _motion;
    if (motion == null) return widget.child;
    return FadeTransition(
      opacity: Tween<double>(
        begin: 0.58,
        end: 1,
      ).animate(CurvedAnimation(parent: motion, curve: Curves.easeInOut)),
      child: widget.child,
    );
  }
}

class _AssistantWelcome extends StatelessWidget {
  const _AssistantWelcome({required this.mode});

  final AssistantMode mode;
  static final _appear = Tween<double>(begin: 0, end: 1);

  @override
  Widget build(BuildContext context) {
    final title = switch (mode) {
      AssistantMode.chat => '有什么可以帮你？',
      AssistantMode.agent => '交给 Agent 来完成',
      AssistantMode.image => '想生成什么图片？',
    };
    final subtitle = switch (mode) {
      AssistantMode.chat => '描述你的想法，开始对话',
      AssistantMode.agent => '说清目标，Agent 会帮你规划并生成',
      AssistantMode.image => '用一句话描述画面，马上开始生成',
    };
    return LayoutBuilder(
      builder: (context, viewport) => SingleChildScrollView(
        key: const Key('assistant-welcome'),
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: 520,
              minHeight: viewport.maxHeight > 48 ? viewport.maxHeight - 48 : 0,
            ),
            child: TweenAnimationBuilder<double>(
              duration: _motionDuration(context, 480),
              curve: Curves.easeOutCubic,
              tween: _appear,
              builder: (context, value, child) => Transform.translate(
                offset: Offset(0, 14 * (1 - value)),
                child: child,
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const _AssistantOrb(size: 118),
                  const SizedBox(height: 18),
                  _WelcomeHeadline(title: title),
                  const SizedBox(height: 10),
                  Text(
                    subtitle,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      height: 1.45,
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

class _WelcomeHeadline extends StatelessWidget {
  const _WelcomeHeadline({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final visual = StarCloudsVisualStyle.of(context);
    final accentLength = switch (title) {
      '有什么可以帮你？' => 3,
      '交给 Agent 来完成' => 2,
      '想生成什么图片？' => 3,
      _ => 0,
    };
    final style = Theme.of(context).textTheme.headlineSmall?.copyWith(
      fontWeight: FontWeight.w800,
      letterSpacing: -0.5,
      height: 1.15,
    );
    if (accentLength == 0 || accentLength >= title.length) {
      return Text(title, textAlign: TextAlign.center, style: style);
    }
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: title.substring(0, title.length - accentLength),
            style: style,
          ),
          TextSpan(
            text: title.substring(title.length - accentLength),
            style: style?.copyWith(color: visual.brandEnd),
          ),
        ],
      ),
      textAlign: TextAlign.center,
    );
  }
}

class _AssistantOrb extends StatelessWidget {
  const _AssistantOrb({this.size = 72});

  final double size;

  @override
  Widget build(BuildContext context) {
    final visual = StarCloudsVisualStyle.of(context);
    final core = size > 28 ? size * 0.62 : size;
    return SizedBox.square(
      dimension: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (size > 28)
            Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    visual.brandStart.withValues(alpha: .28),
                    visual.brandEnd.withValues(alpha: .08),
                    visual.brandEnd.withValues(alpha: 0),
                  ],
                  stops: const [0.35, 0.68, 1],
                ),
              ),
            ),
          Container(
            width: core,
            height: core,
            decoration: BoxDecoration(
              gradient: visual.brandGradient,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: visual.brandStart.withValues(
                    alpha: size > 28 ? .38 : .2,
                  ),
                  blurRadius: size > 28 ? 22 : 6,
                  offset: Offset(0, size > 28 ? 10 : 2),
                ),
              ],
            ),
            child: Icon(
              Icons.auto_awesome_rounded,
              color: Colors.white,
              size: core * 0.42,
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.message,
    required this.fallbackCostPoints,
    required this.onReuse,
    required this.onCopy,
    required this.onShare,
    required this.onQuote,
    required this.onSaveImage,
    required this.onShareImage,
    required this.onUseImage,
    required this.imageModels,
    required this.proposalGenerating,
    required this.proposalExecuted,
    required this.onApproveProposal,
    required this.onRetry,
    super.key,
  });

  final AssistantMessage message;
  final int fallbackCostPoints;
  final VoidCallback? onReuse;
  final VoidCallback? onCopy;
  final VoidCallback? onShare;
  final VoidCallback? onQuote;
  final Future<void> Function(AssistantGeneratedImage) onSaveImage;
  final Future<void> Function(AssistantGeneratedImage, BuildContext)
  onShareImage;
  final Future<bool> Function(AssistantGeneratedImage) onUseImage;
  final List<AssistantModelOption> imageModels;
  final bool proposalGenerating;
  final bool proposalExecuted;
  final Future<void> Function(AssistantProposal)? onApproveProposal;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final user = message.isUser;
    final colors = Theme.of(context).colorScheme;
    final content = message.content.trim();
    final metrics = assistantReplyMetricsLabel(
      message,
      fallbackCostPoints: fallbackCostPoints,
    );
    final hasActions =
        onCopy != null ||
        onShare != null ||
        onQuote != null ||
        onRetry != null ||
        onReuse != null;
    final time = message.createdAt == null
        ? null
        : DateFormat('HH:mm').format(message.createdAt!);
    final bubbleText = Theme.of(context).textTheme.bodyMedium?.copyWith(
      height: 1.28,
      letterSpacing: -0.15,
      leadingDistribution: TextLeadingDistribution.even,
      color: user ? colors.onPrimaryContainer : colors.onSurface,
    );
    if (user) {
      final visual = StarCloudsVisualStyle.of(context);
      return Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Align(
          alignment: Alignment.centerRight,
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.sizeOf(context).width * .76,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (message.quoted != null) ...[
                  _SentQuote(quote: message.quoted!),
                  const SizedBox(height: 6),
                ],
                if (message.referenceImages.isNotEmpty) ...[
                  _MessageReferenceStrip(items: message.referenceImages),
                  const SizedBox(height: 8),
                ],
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: visual.brandSoft,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(18),
                      topRight: Radius.circular(18),
                      bottomLeft: Radius.circular(18),
                      bottomRight: Radius.circular(6),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    child: DefaultSelectionStyle(
                      selectionColor: colors.primary.withValues(alpha: .16),
                      child: SelectableText(
                        content.isEmpty ? '未生成回复' : content,
                        style: bubbleText,
                      ),
                    ),
                  ),
                ),
                if (time != null || onReuse != null) ...[
                  const SizedBox(height: 4),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (onReuse != null)
                        _MessageAction(
                          key: ValueKey('assistant-reuse-${message.id}'),
                          tooltip: '重新编辑',
                          icon: Icons.edit_outlined,
                          onPressed: onReuse!,
                        ),
                      if (time != null)
                        Padding(
                          padding: EdgeInsets.only(
                            left: onReuse != null ? 2 : 0,
                          ),
                          child: Text(
                            time,
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(color: colors.onSurfaceVariant),
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Align(
        alignment: Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.sizeOf(context).width * .86,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DefaultSelectionStyle(
                selectionColor: colors.primary.withValues(alpha: .16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (message.referenceImages.isNotEmpty) ...[
                      _MessageReferenceStrip(items: message.referenceImages),
                      const SizedBox(height: 10),
                    ],
                    if (message.reasoning.trim().isNotEmpty) ...[
                      _MessageReasoning(message: message),
                      const SizedBox(height: 6),
                    ],
                    if (message.images.isNotEmpty) ...[
                      _GeneratedImageGrid(
                        images: message.images,
                        onSave: onSaveImage,
                        onShare: onShareImage,
                        onUse: onUseImage,
                      ),
                      if (content.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(
                          content,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: colors.onSurfaceVariant),
                        ),
                      ],
                    ] else if (message.proposal case final proposal?)
                      _AgentProposalPanel(
                        proposal: proposal,
                        imageModels: imageModels,
                        generating: proposalGenerating,
                        executed: proposalExecuted,
                        onApprove: onApproveProposal,
                      )
                    else if (content.isEmpty && message.isPending)
                      const _TypingIndicator()
                    else
                      AssistantMarkdownContent(
                        key: Key('assistant-markdown-${message.id}'),
                        data: content.isEmpty ? '未生成回复' : content,
                      ),
                  ],
                ),
              ),
              if (metrics.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  metrics,
                  key: Key('assistant-reply-metrics-${message.id}'),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: colors.onSurfaceVariant,
                    height: 1.25,
                  ),
                ),
              ],
              if (hasActions || time != null) ...[
                const SizedBox(height: 4),
                _MessageActions(
                  onCopy: onCopy,
                  onShare: onShare,
                  onQuote: onQuote,
                  onRetry: onRetry,
                  time: time,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _GeneratedImageGrid extends StatelessWidget {
  const _GeneratedImageGrid({
    required this.images,
    required this.onSave,
    required this.onShare,
    required this.onUse,
  });

  final List<AssistantGeneratedImage> images;
  final Future<void> Function(AssistantGeneratedImage) onSave;
  final Future<void> Function(AssistantGeneratedImage, BuildContext) onShare;
  final Future<bool> Function(AssistantGeneratedImage) onUse;

  @override
  Widget build(BuildContext context) {
    final spacing = images.length == 1 ? 0.0 : 6.0;
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = images.length == 1
            ? constraints.maxWidth
            : (constraints.maxWidth - spacing) / 2;
        return Wrap(
          spacing: spacing,
          runSpacing: 6,
          children: [
            for (var index = 0; index < images.length; index += 1)
              SizedBox(
                width: width,
                child: _GeneratedImageTile(
                  image: images[index],
                  index: index,
                  onSave: onSave,
                  onShare: onShare,
                  onUse: onUse,
                ),
              ),
          ],
        );
      },
    );
  }
}

class _GeneratedImageTile extends StatelessWidget {
  const _GeneratedImageTile({
    required this.image,
    required this.index,
    required this.onSave,
    required this.onShare,
    required this.onUse,
  });

  final AssistantGeneratedImage image;
  final int index;
  final Future<void> Function(AssistantGeneratedImage) onSave;
  final Future<void> Function(AssistantGeneratedImage, BuildContext) onShare;
  final Future<bool> Function(AssistantGeneratedImage) onUse;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      label: '查看生成图片 ${index + 1}',
      child: Material(
        key: ValueKey('assistant-generated-image-${image.id}'),
        color: colors.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(22),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => _showGeneratedImage(
            context,
            image,
            onSave: onSave,
            onShare: onShare,
            onUse: onUse,
          ),
          child: AspectRatio(
            aspectRatio: 1,
            child: Stack(
              fit: StackFit.expand,
              children: [
                AuthenticatedImage(
                  url: image.thumbnailUrl.isNotEmpty
                      ? image.thumbnailUrl
                      : image.url,
                ),
                Positioned(
                  top: 8,
                  right: 8,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: colors.scrim.withValues(alpha: .58),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 4,
                      ),
                      child: Text(
                        '${index + 1}',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
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

void _showGeneratedImage(
  BuildContext context,
  AssistantGeneratedImage image, {
  required Future<void> Function(AssistantGeneratedImage) onSave,
  required Future<void> Function(AssistantGeneratedImage, BuildContext) onShare,
  required Future<bool> Function(AssistantGeneratedImage) onUse,
}) {
  showDialog<void>(
    context: context,
    builder: (context) => Dialog.fullscreen(
      backgroundColor: Colors.black,
      child: _GeneratedImagePreview(
        image: image,
        onSave: onSave,
        onShare: onShare,
        onUse: onUse,
      ),
    ),
  );
}

enum _GeneratedImageAction { use, save, share }

class _GeneratedImagePreview extends StatefulWidget {
  const _GeneratedImagePreview({
    required this.image,
    required this.onSave,
    required this.onShare,
    required this.onUse,
  });

  final AssistantGeneratedImage image;
  final Future<void> Function(AssistantGeneratedImage) onSave;
  final Future<void> Function(AssistantGeneratedImage, BuildContext) onShare;
  final Future<bool> Function(AssistantGeneratedImage) onUse;

  @override
  State<_GeneratedImagePreview> createState() => _GeneratedImagePreviewState();
}

class _GeneratedImagePreviewState extends State<_GeneratedImagePreview> {
  _GeneratedImageAction? _busyAction;

  Future<void> _runAction(
    _GeneratedImageAction action,
    Future<void> Function() callback,
  ) async {
    if (_busyAction != null) return;
    setState(() => _busyAction = action);
    try {
      await callback();
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Stack(
        children: [
          Positioned.fill(
            child: InteractiveViewer(
              minScale: 1,
              maxScale: 4,
              child: Center(
                child: AuthenticatedImage(
                  url: widget.image.url,
                  fit: BoxFit.contain,
                ),
              ),
            ),
          ),
          Positioned(
            top: 8,
            left: 8,
            child: IconButton.filledTonal(
              tooltip: '关闭图片',
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.close),
            ),
          ),
          Positioned(
            right: 12,
            bottom: 12,
            child: Material(
              color: Colors.black.withValues(alpha: .66),
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.all(4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      tooltip: '继续编辑',
                      color: Colors.white,
                      onPressed: _busyAction == null
                          ? () =>
                                _runAction(_GeneratedImageAction.use, () async {
                                  final used = await widget.onUse(widget.image);
                                  if (used && context.mounted) {
                                    Navigator.pop(context);
                                  }
                                })
                          : null,
                      icon: _busyAction == _GeneratedImageAction.use
                          ? const _PreviewActionProgress()
                          : const Icon(Icons.edit_outlined),
                    ),
                    IconButton(
                      tooltip: '保存图片',
                      color: Colors.white,
                      onPressed: _busyAction == null
                          ? () => _runAction(
                              _GeneratedImageAction.save,
                              () => widget.onSave(widget.image),
                            )
                          : null,
                      icon: _busyAction == _GeneratedImageAction.save
                          ? const _PreviewActionProgress()
                          : const Icon(Icons.download_outlined),
                    ),
                    Builder(
                      builder: (buttonContext) => IconButton(
                        tooltip: '分享图片',
                        color: Colors.white,
                        onPressed: _busyAction == null
                            ? () => _runAction(
                                _GeneratedImageAction.share,
                                () =>
                                    widget.onShare(widget.image, buttonContext),
                              )
                            : null,
                        icon: _busyAction == _GeneratedImageAction.share
                            ? const _PreviewActionProgress()
                            : const Icon(Icons.share_outlined),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PreviewActionProgress extends StatelessWidget {
  const _PreviewActionProgress();

  @override
  Widget build(BuildContext context) => const SizedBox.square(
    dimension: 18,
    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
  );
}

String _generatedImageExtension(String url) {
  final path = Uri.tryParse(url)?.path.toLowerCase() ?? '';
  if (path.endsWith('.webp')) return 'webp';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'jpg';
  return 'png';
}

class _AgentProposalPanel extends StatefulWidget {
  const _AgentProposalPanel({
    required this.proposal,
    required this.imageModels,
    required this.generating,
    required this.executed,
    required this.onApprove,
  });

  final AssistantProposal proposal;
  final List<AssistantModelOption> imageModels;
  final bool generating;
  final bool executed;
  final Future<void> Function(AssistantProposal)? onApprove;

  @override
  State<_AgentProposalPanel> createState() => _AgentProposalPanelState();
}

class _AgentProposalPanelState extends State<_AgentProposalPanel> {
  late AssistantProposal _draft;
  bool _dismissed = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _draft = _normalized(widget.proposal);
  }

  @override
  void didUpdateWidget(covariant _AgentProposalPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.proposal != widget.proposal && !_submitting) {
      _draft = _normalized(widget.proposal);
    }
  }

  AssistantModelOption? get _model =>
      widget.imageModels
          .where((item) => item.id == _draft.modelId)
          .firstOrNull ??
      widget.imageModels
          .where((item) => item.label == _draft.modelName)
          .firstOrNull ??
      widget.imageModels.firstOrNull;

  AssistantProposal _normalized(AssistantProposal value) {
    final model =
        widget.imageModels
            .where((item) => item.id == value.modelId)
            .firstOrNull ??
        widget.imageModels
            .where((item) => item.label == value.modelName)
            .firstOrNull ??
        widget.imageModels.firstOrNull;
    if (model == null) return value;
    final resolution = model.resolutions.contains(value.resolution)
        ? value.resolution
        : model.resolutions.firstOrNull ?? value.resolution;
    final ratios = model.ratiosFor(resolution);
    final ratio = ratios.contains(value.ratio)
        ? value.ratio
        : ratios.contains('auto')
        ? 'auto'
        : ratios.firstOrNull ?? value.ratio;
    final quality = model.qualities.contains(value.quality)
        ? value.quality
        : model.qualities.contains('high')
        ? 'high'
        : model.qualities.firstOrNull ?? value.quality;
    return value.copyWith(
      modelId: model.id,
      modelName: model.label,
      resolution: resolution,
      ratio: ratio,
      quality: quality,
      count: value.count.clamp(1, model.maxImages),
    );
  }

  Future<String?> _pickOption({
    required String title,
    required String current,
    required List<({String id, String label, String detail})> options,
  }) => showAppSheet<String>(
    context: context,
    useSafeArea: true,
    builder: (context) => ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 520),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 10),
            child: Text(
              title,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
          ),
          ListView.builder(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
            itemCount: options.length,
            itemBuilder: (context, index) {
              final option = options[index];
              final selected = option.id == current;
              return ListTile(
                minTileHeight: 52,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18),
                ),
                selected: selected,
                title: Text(option.label),
                subtitle: option.detail.isEmpty ? null : Text(option.detail),
                trailing: selected
                    ? Icon(
                        Icons.check_circle_rounded,
                        color: Theme.of(context).colorScheme.primary,
                      )
                    : null,
                onTap: () => Navigator.pop(context, option.id),
              );
            },
          ),
        ],
      ),
    ),
  );

  Future<void> _editPrompt() async {
    final value = await showAppSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) =>
          _ProposalPromptEditorSheet(initialValue: _draft.prompt),
    );
    if (value != null && mounted) {
      setState(() => _draft = _draft.copyWith(prompt: value));
    }
  }

  Future<void> _selectModel() async {
    final selected = await _pickOption(
      title: '选择图片模型',
      current: _model?.id ?? '',
      options: widget.imageModels
          .map(
            (item) => (
              id: item.id,
              label: item.label,
              detail: item.pricePoints > 0
                  ? '${item.pricePoints} 积分 / 张'
                  : item.description,
            ),
          )
          .toList(),
    );
    if (selected == null || !mounted) return;
    final model = widget.imageModels.firstWhere((item) => item.id == selected);
    setState(() {
      _draft = _normalized(
        _draft.copyWith(modelId: model.id, modelName: model.label),
      );
    });
  }

  Future<void> _selectResolution() async {
    final model = _model;
    if (model == null) return;
    final selected = await _pickOption(
      title: '选择清晰度',
      current: _draft.resolution,
      options: model.resolutions
          .map((item) => (id: item, label: item, detail: '输出清晰度'))
          .toList(),
    );
    if (selected == null || !mounted) return;
    setState(() => _draft = _normalized(_draft.copyWith(resolution: selected)));
  }

  Future<void> _selectRatio() async {
    final ratios = _model?.ratiosFor(_draft.resolution) ?? const <String>[];
    final selected = await _pickOption(
      title: '选择画面比例',
      current: _draft.ratio,
      options: ratios
          .map(
            (item) => (
              id: item,
              label: item == 'auto' ? '自动判断' : item,
              detail: item == 'auto' ? '根据提示词匹配构图' : '',
            ),
          )
          .toList(),
    );
    if (selected != null && mounted) {
      setState(() => _draft = _draft.copyWith(ratio: selected));
    }
  }

  Future<void> _selectCount() async {
    final maxImages = _model?.maxImages ?? 1;
    final selected = await _pickOption(
      title: '选择生成数量',
      current: '${_draft.count}',
      options: [
        for (var count = 1; count <= maxImages; count += 1)
          (id: '$count', label: '$count 张', detail: ''),
      ],
    );
    if (selected != null && mounted) {
      setState(() => _draft = _draft.copyWith(count: int.parse(selected)));
    }
  }

  Future<void> _approve() async {
    if (_submitting || widget.generating || widget.onApprove == null) return;
    setState(() => _submitting = true);
    try {
      await widget.onApprove!(_draft);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final busy = _submitting || widget.generating;
    if (_dismissed) {
      return Material(
        key: const Key('assistant-agent-proposal'),
        color: colors.surfaceContainerLow,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: colors.outlineVariant),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => setState(() => _dismissed = false),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Icon(Icons.auto_awesome_rounded, color: colors.primary),
                const SizedBox(width: 10),
                const Expanded(child: Text('创作方案已收起')),
                const Icon(Icons.keyboard_arrow_down_rounded),
              ],
            ),
          ),
        ),
      );
    }
    final model = _model;
    final price = (model?.pricePoints ?? 0) * _draft.count;
    final status = busy
        ? '生成中'
        : widget.executed
        ? '已执行'
        : '待确认';
    return Material(
      key: const Key('assistant-agent-proposal'),
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: colors.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: colors.primaryContainer,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.auto_awesome_rounded,
                    size: 18,
                    color: colors.onPrimaryContainer,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _draft.action == 'edit' ? '图片编辑方案' : '图片生成方案',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (_draft.summary.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          _draft.summary,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: colors.onSurfaceVariant,
                                height: 1.35,
                              ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: busy
                        ? colors.secondaryContainer
                        : widget.executed
                        ? colors.primaryContainer
                        : colors.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    status,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Material(
              color: colors.surfaceContainerLow,
              borderRadius: BorderRadius.circular(18),
              child: InkWell(
                key: const Key('assistant-edit-agent-prompt'),
                borderRadius: BorderRadius.circular(18),
                onTap: busy ? null : _editPrompt,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 10, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            '生成提示词',
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(
                                  color: colors.onSurfaceVariant,
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                          const Spacer(),
                          Icon(
                            Icons.edit_outlined,
                            size: 17,
                            color: colors.onSurfaceVariant,
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _draft.prompt,
                        maxLines: 5,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          height: 1.5,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            LayoutBuilder(
              builder: (context, constraints) {
                final textScale = MediaQuery.textScalerOf(context).scale(1);
                final singleColumn = constraints.maxWidth / textScale < 280;
                final width = singleColumn
                    ? constraints.maxWidth
                    : (constraints.maxWidth - 8) / 2;
                return Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    SizedBox(
                      width: width,
                      child: _ProposalControl(
                        icon: Icons.view_in_ar_outlined,
                        label: '模型',
                        value: model?.label ?? '暂无可用模型',
                        onTap: busy || widget.imageModels.isEmpty
                            ? null
                            : _selectModel,
                      ),
                    ),
                    SizedBox(
                      width: width,
                      child: _ProposalControl(
                        icon: Icons.aspect_ratio_outlined,
                        label: '画面比例',
                        value: _draft.ratio == 'auto' ? '自动判断' : _draft.ratio,
                        onTap: busy ? null : _selectRatio,
                      ),
                    ),
                    SizedBox(
                      width: width,
                      child: _ProposalControl(
                        icon: Icons.hd_outlined,
                        label: '清晰度',
                        value: _draft.resolution,
                        onTap: busy ? null : _selectResolution,
                      ),
                    ),
                    SizedBox(
                      width: width,
                      child: _ProposalControl(
                        icon: Icons.filter_none_rounded,
                        label: '生成数量',
                        value: '${_draft.count} 张',
                        onTap: busy ? null : _selectCount,
                      ),
                    ),
                  ],
                );
              },
            ),
            const SizedBox(height: 14),
            LayoutBuilder(
              builder: (context, constraints) {
                final textScale = MediaQuery.textScalerOf(context).scale(1);
                final stacked = constraints.maxWidth / textScale < 280;
                final generateButton = FilledButton.icon(
                  key: const Key('assistant-use-agent-proposal'),
                  onPressed: busy || _draft.prompt.trim().isEmpty
                      ? null
                      : _approve,
                  icon: busy
                      ? SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: colors.onPrimary,
                          ),
                        )
                      : const Icon(Icons.auto_awesome_rounded, size: 18),
                  label: Text(
                    busy
                        ? '正在生成'
                        : widget.executed
                        ? '再生成一组'
                        : '开始生成',
                  ),
                );
                final summary = Row(
                  children: [
                    TextButton(
                      onPressed: busy
                          ? null
                          : () => setState(() => _dismissed = true),
                      child: const Text('收起'),
                    ),
                    const Spacer(),
                    if (price > 0)
                      Flexible(
                        child: Text(
                          '预计 $price 积分',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(color: colors.onSurfaceVariant),
                        ),
                      ),
                  ],
                );
                if (stacked) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      summary,
                      const SizedBox(height: 6),
                      generateButton,
                    ],
                  );
                }
                return Row(
                  children: [
                    Expanded(child: summary),
                    const SizedBox(width: 10),
                    generateButton,
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ProposalPromptEditorSheet extends StatefulWidget {
  const _ProposalPromptEditorSheet({required this.initialValue});

  final String initialValue;

  @override
  State<_ProposalPromptEditorSheet> createState() =>
      _ProposalPromptEditorSheetState();
}

class _ProposalPromptEditorSheetState
    extends State<_ProposalPromptEditorSheet> {
  late final TextEditingController _controller;
  late int _count;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialValue);
    _count = widget.initialValue.runes.length;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      20,
      2,
      20,
      16 + MediaQuery.viewInsetsOf(context).bottom,
    ),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '编辑生成提示词',
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        TextField(
          key: const Key('assistant-proposal-prompt-editor'),
          controller: _controller,
          autofocus: true,
          minLines: 5,
          maxLines: 9,
          maxLength: 12000,
          decoration: const InputDecoration(
            hintText: '描述主体、环境、构图、光线和风格',
            counterText: '',
          ),
          onChanged: (text) => setState(() => _count = text.runes.length),
        ),
        const SizedBox(height: 8),
        Text(
          '$_count / 12000',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton(
              key: const Key('assistant-cancel-proposal-prompt'),
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            const SizedBox(width: 8),
            FilledButton(
              onPressed: _controller.text.trim().isEmpty
                  ? null
                  : () => Navigator.pop(context, _controller.text.trim()),
              child: const Text('完成'),
            ),
          ],
        ),
      ],
    ),
  );
}

class _ProposalControl extends StatelessWidget {
  const _ProposalControl({
    required this.icon,
    required this.label,
    required this.value,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerLow,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 62),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
            child: Row(
              children: [
                Icon(icon, size: 18, color: colors.onSurfaceVariant),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 4),
                Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 18,
                  color: onTap == null
                      ? colors.onSurface.withValues(alpha: .3)
                      : colors.onSurfaceVariant,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class AssistantMarkdownContent extends StatelessWidget {
  const AssistantMarkdownContent({required this.data, super.key});

  final String data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final body = theme.textTheme.bodyMedium?.copyWith(
      height: 1.28,
      letterSpacing: -0.15,
      leadingDistribution: TextLeadingDistribution.even,
    );
    final styleSheet = MarkdownStyleSheet.fromTheme(theme).copyWith(
      p: body,
      pPadding: EdgeInsets.zero,
      h1: theme.textTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w800,
        height: 1.2,
        letterSpacing: -0.2,
      ),
      h1Padding: const EdgeInsets.only(bottom: 2),
      h2: theme.textTheme.titleSmall?.copyWith(
        fontWeight: FontWeight.w800,
        height: 1.22,
        letterSpacing: -0.15,
      ),
      h2Padding: const EdgeInsets.only(bottom: 2),
      h3: theme.textTheme.titleSmall?.copyWith(
        fontWeight: FontWeight.w700,
        height: 1.22,
        letterSpacing: -0.1,
      ),
      h3Padding: const EdgeInsets.only(bottom: 2),
      strong: const TextStyle(fontWeight: FontWeight.w700),
      a: TextStyle(color: colors.primary, decoration: TextDecoration.underline),
      code: body?.copyWith(
        fontFamily: 'monospace',
        fontSize: 12,
        height: 1.3,
        color: colors.onSurface,
        backgroundColor: colors.surfaceContainerHighest,
      ),
      blockSpacing: 6,
      listIndent: 16,
      listBullet: body?.copyWith(height: 1.28),
      listBulletPadding: const EdgeInsets.only(right: 6),
      blockquote: body?.copyWith(color: colors.onSurfaceVariant),
      blockquotePadding: const EdgeInsets.fromLTRB(12, 8, 10, 8),
      blockquoteDecoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(6),
        border: Border(left: BorderSide(color: colors.primary, width: 3)),
      ),
      codeblockPadding: const EdgeInsets.all(12),
      codeblockDecoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: colors.outlineVariant),
      ),
      horizontalRuleDecoration: BoxDecoration(
        border: Border(top: BorderSide(color: colors.outlineVariant)),
      ),
    );
    return MarkdownBody(
      data: data,
      selectable: true,
      softLineBreak: true,
      fitContent: false,
      styleSheet: styleSheet,
      imageBuilder: (uri, title, alt) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: colors.surfaceContainerLow,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: colors.outlineVariant),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.image_not_supported_outlined, size: 18),
            const SizedBox(width: 7),
            Flexible(
              child: Text(alt?.trim().isNotEmpty == true ? alt! : '图片链接'),
            ),
          ],
        ),
      ),
    );
  }
}

class _MessageActions extends StatelessWidget {
  const _MessageActions({
    required this.onCopy,
    required this.onShare,
    required this.onQuote,
    required this.onRetry,
    this.time,
  });

  final VoidCallback? onCopy;
  final VoidCallback? onShare;
  final VoidCallback? onQuote;
  final VoidCallback? onRetry;
  final String? time;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      children: [
        if (onRetry != null)
          _MessageAction(
            key: const Key('assistant-retry-message'),
            tooltip: '重新提问',
            icon: Icons.refresh,
            onPressed: onRetry!,
          ),
        if (onCopy != null)
          _MessageAction(
            key: const Key('assistant-copy-reply'),
            tooltip: '复制回复',
            icon: Icons.copy_outlined,
            onPressed: onCopy!,
          ),
        if (onShare != null)
          _MessageAction(
            key: const Key('assistant-share-reply'),
            tooltip: '分享回复',
            icon: Icons.ios_share_outlined,
            onPressed: onShare!,
          ),
        if (onQuote != null)
          _MessageAction(
            key: const Key('assistant-quote-reply'),
            tooltip: '引用',
            icon: Icons.format_quote_rounded,
            onPressed: onQuote!,
          ),
        if (time != null)
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Text(
              time!,
              style: Theme.of(
                context,
              ).textTheme.labelSmall?.copyWith(color: colors.onSurfaceVariant),
            ),
          ),
      ],
    );
  }
}

class _SentQuote extends StatelessWidget {
  const _SentQuote({required this.quote});

  final AssistantQuotedMessage quote;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      key: const Key('assistant-sent-quote'),
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: colors.outlineVariant, width: 2),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.only(left: 8),
        child: Text(
          '[${quote.kind}] ${quote.content}',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: colors.onSurfaceVariant,
            height: 1.3,
          ),
        ),
      ),
    );
  }
}

class _MessageAction extends StatelessWidget {
  const _MessageAction({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    super.key,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      style: IconButton.styleFrom(
        backgroundColor: Colors.transparent,
        foregroundColor: colors.onSurfaceVariant,
        overlayColor: Colors.transparent,
        splashFactory: NoSplash.splashFactory,
        minimumSize: const Size.square(32),
        maximumSize: const Size.square(32),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        padding: EdgeInsets.zero,
        visualDensity: VisualDensity.standard,
      ),
      iconSize: 18,
      icon: Icon(icon),
    );
  }
}

class _TypingIndicator extends StatefulWidget {
  const _TypingIndicator();

  @override
  State<_TypingIndicator> createState() => _TypingIndicatorState();
}

class _TypingIndicatorState extends State<_TypingIndicator>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 920),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_loopingMotionEnabled(context)) {
      _controller.stop();
      _controller.value = 0.45;
      return;
    }
    if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var index = 0; index < 3; index += 1)
          AnimatedBuilder(
            animation: _controller,
            builder: (context, child) {
              final t = (_controller.value + index * 0.18) % 1;
              final bounce = 1 - (2 * t - 1).abs();
              return Padding(
                padding: const EdgeInsets.only(right: 5),
                child: Transform.translate(
                  offset: Offset(0, -5 * bounce),
                  child: Opacity(opacity: 0.35 + 0.65 * bounce, child: child),
                ),
              );
            },
            child: Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                color: colors.primary,
                shape: BoxShape.circle,
              ),
            ),
          ),
        const SizedBox(width: 6),
        Text(
          '正在生成回复',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: colors.onSurfaceVariant,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _MessageReferenceStrip extends StatelessWidget {
  const _MessageReferenceStrip({required this.items});

  final List<AssistantReferenceImage> items;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 92,
    child: ListView.separated(
      scrollDirection: Axis.horizontal,
      itemCount: items.length,
      separatorBuilder: (_, _) => const SizedBox(width: 7),
      itemBuilder: (context, index) => Semantics(
        label: items[index].name,
        image: true,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: SizedBox(
            width: 92,
            child: AuthenticatedImage(url: items[index].url),
          ),
        ),
      ),
    ),
  );
}

class _MessageReasoning extends StatelessWidget {
  const _MessageReasoning({required this.message});

  final AssistantMessage message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerLow,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          key: Key('assistant-reasoning-${message.id}'),
          initiallyExpanded: message.isPending,
          maintainState: true,
          dense: true,
          visualDensity: VisualDensity.compact,
          tilePadding: const EdgeInsets.symmetric(horizontal: 10),
          childrenPadding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
          leading: message.isPending
              ? (_loopingMotionEnabled(context)
                    ? SizedBox.square(
                        dimension: 17,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: colors.primary,
                        ),
                      )
                    : Icon(
                        Icons.psychology_outlined,
                        size: 18,
                        color: colors.primary,
                      ))
              : Icon(
                  Icons.psychology_outlined,
                  size: 18,
                  color: colors.onSurfaceVariant,
                ),
          title: Text(
            message.isPending ? '正在思考' : '思考过程',
            style: Theme.of(
              context,
            ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
          ),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: SelectableText(
                message.reasoning.trim(),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  height: 1.32,
                  letterSpacing: -0.1,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AssistantSyncError extends StatelessWidget {
  const _AssistantSyncError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Material(
    color: Theme.of(context).colorScheme.errorContainer,
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      child: Row(
        children: [
          const Icon(Icons.sync_problem_outlined, size: 20),
          const SizedBox(width: 8),
          Expanded(child: Text(message)),
          TextButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('重试'),
          ),
        ],
      ),
    ),
  );
}

class AssistantDraftStatusBar extends StatelessWidget {
  const AssistantDraftStatusBar({
    required this.saving,
    required this.failed,
    required this.restored,
    required this.onClear,
    super.key,
  });

  final bool saving;
  final bool failed;
  final bool restored;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final (icon, label, foreground) = failed
        ? (Icons.error_outline, '草稿保存失败', colors.error)
        : saving
        ? (Icons.sync, '正在保存草稿', colors.onSurfaceVariant)
        : restored
        ? (Icons.restore_outlined, '已恢复未发送内容', colors.primary)
        : (Icons.cloud_done_outlined, '未发送内容已保存', colors.primary);
    return Material(
      key: const Key('assistant-draft-status'),
      color: colors.surfaceContainerLowest,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 0),
        child: Row(
          children: [
            Icon(icon, size: 14, color: foreground),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: foreground,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            IconButton(
              key: const Key('assistant-clear-draft'),
              tooltip: '清除未发送内容',
              visualDensity: VisualDensity.compact,
              constraints: const BoxConstraints.tightFor(width: 32, height: 30),
              onPressed: onClear,
              icon: const Icon(Icons.close, size: 16),
            ),
          ],
        ),
      ),
    );
  }
}

class _ComposerQuote extends StatelessWidget {
  const _ComposerQuote({required this.quote, required this.onClear});

  final AssistantQuotedMessage quote;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      key: const Key('assistant-composer-quote'),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(10, 8, 4, 8),
        child: Row(
          children: [
            Icon(
              Icons.format_quote_rounded,
              size: 16,
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                '[${quote.kind}] ${quote.content}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: colors.onSurfaceVariant,
                  height: 1.3,
                ),
              ),
            ),
            IconButton(
              key: const Key('assistant-composer-quote-clear'),
              tooltip: '移除引用',
              onPressed: onClear,
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.close_rounded, size: 16),
            ),
          ],
        ),
      ),
    );
  }
}

class _AssistantComposer extends StatefulWidget {
  const _AssistantComposer({
    required this.controller,
    required this.focusNode,
    required this.enabled,
    required this.sending,
    required this.busyLabel,
    required this.mode,
    required this.modelAvailable,
    required this.quoted,
    required this.onClearQuote,
    required this.references,
    required this.maxReferences,
    required this.speechInitializing,
    required this.speechListening,
    required this.onChanged,
    required this.onOpenTools,
    required this.onRemoveReference,
    required this.onToggleSpeech,
    required this.onStop,
    required this.onSend,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool enabled;
  final bool sending;
  final String busyLabel;
  final AssistantMode mode;
  final bool modelAvailable;
  final AssistantQuotedMessage? quoted;
  final VoidCallback onClearQuote;
  final List<ReferenceImageDraft> references;
  final int maxReferences;
  final bool speechInitializing;
  final bool speechListening;
  final VoidCallback onChanged;
  final VoidCallback onOpenTools;
  final ValueChanged<int> onRemoveReference;
  final VoidCallback onToggleSpeech;
  final VoidCallback? onStop;
  final VoidCallback onSend;

  @override
  State<_AssistantComposer> createState() => _AssistantComposerState();
}

class _AssistantComposerState extends State<_AssistantComposer> {
  final _fieldHostKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    widget.focusNode.addListener(_onComposerTick);
    widget.controller.addListener(_onComposerTick);
  }

  @override
  void didUpdateWidget(covariant _AssistantComposer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.focusNode != widget.focusNode) {
      oldWidget.focusNode.removeListener(_onComposerTick);
      widget.focusNode.addListener(_onComposerTick);
    }
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_onComposerTick);
      widget.controller.addListener(_onComposerTick);
    }
  }

  @override
  void dispose() {
    widget.focusNode.removeListener(_onComposerTick);
    widget.controller.removeListener(_onComposerTick);
    super.dispose();
  }

  void _onComposerTick() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final visual = StarCloudsVisualStyle.of(context);
    final expanded = widget.focusNode.hasFocus;
    final canSubmit =
        widget.enabled &&
        !widget.speechInitializing &&
        !widget.speechListening &&
        widget.controller.text.trim().isNotEmpty;
    final showVoice = widget.onStop == null && !widget.sending;
    final textStyle = Theme.of(context).textTheme.bodyMedium?.copyWith(
      height: 1,
      leadingDistribution: TextLeadingDistribution.even,
    );
    final hintStyle = textStyle?.copyWith(
      color: colors.onSurfaceVariant.withValues(alpha: .48),
    );
    final tools = _ComposerIconButton(
      key: const Key('assistant-tools'),
      tooltip: '更多工具',
      onPressed: widget.enabled ? widget.onOpenTools : null,
      icon: const Icon(Icons.add, size: 22),
    );
    final voice = showVoice
        ? _ComposerIconButton(
            key: const Key('assistant-voice'),
            tooltip: widget.speechListening ? '停止语音输入' : '语音输入',
            active: widget.speechListening,
            onPressed: widget.enabled || widget.speechListening
                ? widget.onToggleSpeech
                : null,
            icon: widget.speechInitializing
                ? (_loopingMotionEnabled(context)
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.mic_none_rounded, size: 20))
                : Icon(
                    widget.speechListening
                        ? Icons.graphic_eq_rounded
                        : Icons.mic_none_outlined,
                    size: 22,
                  ),
          )
        : null;
    final send = _ComposerActionButton(
      onStop: widget.onStop,
      sending: widget.sending,
      canSubmit: canSubmit,
      busyLabel: widget.busyLabel,
      onSend: widget.onSend,
    );
    final field = TextField(
      key: const Key('assistant-composer'),
      controller: widget.controller,
      focusNode: widget.focusNode,
      enabled: widget.enabled,
      minLines: expanded ? 3 : 1,
      maxLines: expanded ? 6 : 1,
      maxLength: 12000,
      cursorHeight: 16,
      scrollPadding: EdgeInsets.zero,
      textAlignVertical: expanded
          ? TextAlignVertical.top
          : TextAlignVertical.center,
      style: textStyle,
      strutStyle: StrutStyle(
        fontSize: textStyle?.fontSize,
        height: 1,
        forceStrutHeight: true,
        leadingDistribution: TextLeadingDistribution.even,
      ),
      buildCounter:
          (
            _, {
            required currentLength,
            required isFocused,
            required maxLength,
          }) =>
              currentLength >= 10000 ? Text('$currentLength/$maxLength') : null,
      decoration: InputDecoration(
        hintText: !widget.modelAvailable
            ? '暂无可用模型'
            : widget.sending
            ? widget.busyLabel
            : widget.enabled
            ? switch (widget.mode) {
                AssistantMode.chat => '问点什么…',
                AssistantMode.agent => '描述任务目标',
                AssistantMode.image => '描述想生成的图片',
              }
            : '等待当前回复完成',
        hintStyle: hintStyle,
        filled: false,
        isDense: true,
        isCollapsed: true,
        border: InputBorder.none,
        enabledBorder: InputBorder.none,
        focusedBorder: InputBorder.none,
        disabledBorder: InputBorder.none,
        contentPadding: expanded
            ? const EdgeInsets.fromLTRB(0, 2, 0, 8)
            : EdgeInsets.zero,
      ),
      textInputAction: TextInputAction.newline,
      onChanged: (_) => widget.onChanged(),
    );
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 6, 14, 12),
        child: TapRegion(
          onTapOutside: (_) {
            if (widget.focusNode.hasFocus) widget.focusNode.unfocus();
          },
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.quoted != null) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(2, 0, 2, 8),
                  child: _ComposerQuote(
                    quote: widget.quoted!,
                    onClear: widget.onClearQuote,
                  ),
                ),
              ],
              if (widget.references.isNotEmpty) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '参考图 ${widget.references.length}/${widget.maxReferences}',
                          style: Theme.of(context).textTheme.labelMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ),
                      if (widget.sending)
                        Text(
                          widget.busyLabel,
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(color: colors.onSurfaceVariant),
                        ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(0, 0, 0, 8),
                  child: AssistantReferenceStrip(
                    references: widget.references,
                    busy: widget.sending,
                    onRemove: widget.onRemoveReference,
                  ),
                ),
              ],
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () {
                  if (widget.enabled) widget.focusNode.requestFocus();
                },
                child: AnimatedContainer(
                  duration: _motionDuration(context, 280),
                  curve: Curves.easeOutCubic,
                  padding: const EdgeInsets.fromLTRB(4, 4, 4, 4),
                  decoration: BoxDecoration(
                    color: Theme.of(context).brightness == Brightness.dark
                        ? colors.surfaceContainerHigh
                        : const Color(0xFFF3F4F6),
                    borderRadius: BorderRadius.circular(expanded ? 22 : 999),
                    boxShadow: [
                      BoxShadow(
                        color: widget.speechListening
                            ? colors.error.withValues(alpha: .16)
                            : visual.shadow.withValues(alpha: .06),
                        blurRadius: expanded ? 16 : 10,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: AnimatedSize(
                    duration: _motionDuration(context, 280),
                    curve: Curves.easeOutCubic,
                    alignment: Alignment.bottomCenter,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (expanded)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(2, 2, 2, 8),
                            child: ConstrainedBox(
                              constraints: const BoxConstraints(
                                minHeight: 72,
                                maxHeight: 112,
                              ),
                              child: KeyedSubtree(
                                key: _fieldHostKey,
                                child: field,
                              ),
                            ),
                          ),
                        SizedBox(
                          height: 36,
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              tools,
                              if (expanded)
                                const Spacer()
                              else
                                Expanded(
                                  child: KeyedSubtree(
                                    key: _fieldHostKey,
                                    child: field,
                                  ),
                                ),
                              ?voice,
                              send,
                            ],
                          ),
                        ),
                      ],
                    ),
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

class _ComposerIconButton extends StatelessWidget {
  const _ComposerIconButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.active = false,
    super.key,
  });

  final String tooltip;
  final Widget icon;
  final VoidCallback? onPressed;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      label: tooltip,
      button: true,
      selected: active,
      enabled: onPressed != null,
      onTap: onPressed,
      liveRegion: active,
      child: ExcludeSemantics(
        child: AnimatedScale(
          scale: active ? 1.04 : 1,
          duration: _motionDuration(context, 180),
          curve: Curves.easeOutCubic,
          child: AnimatedContainer(
            duration: _motionDuration(context, 180),
            curve: Curves.easeOutCubic,
            decoration: BoxDecoration(
              color: active ? colors.primaryContainer : Colors.transparent,
              shape: BoxShape.circle,
            ),
            child: SizedBox.square(
              dimension: _composerControlSize,
              child: IconButton(
                tooltip: tooltip,
                onPressed: onPressed,
                style: _composerIconStyle(
                  background: Colors.transparent,
                  foreground: active ? colors.primary : colors.onSurface,
                  disabledBackground: Colors.transparent,
                ),
                icon: icon,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ComposerActionButton extends StatelessWidget {
  const _ComposerActionButton({
    required this.onStop,
    required this.sending,
    required this.canSubmit,
    required this.busyLabel,
    required this.onSend,
  });

  final VoidCallback? onStop;
  final bool sending;
  final bool canSubmit;
  final String busyLabel;
  final VoidCallback onSend;

  static ButtonStyle _style({
    required Color background,
    required Color foreground,
    Color? disabledBackground,
    Color? disabledForeground,
  }) => _composerIconStyle(
    background: background,
    foreground: foreground,
    disabledBackground: disabledBackground ?? background,
    disabledForeground: disabledForeground ?? foreground,
  );

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final busyIcon = _loopingMotionEnabled(context)
        ? SizedBox.square(
            dimension: 17,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: colors.surface,
            ),
          )
        : Icon(Icons.hourglass_top_rounded, size: 20, color: colors.surface);
    final Widget button;
    if (onStop != null) {
      button = IconButton.filled(
        key: const Key('assistant-stop'),
        tooltip: '停止生成',
        style: _style(background: colors.onSurface, foreground: colors.surface),
        onPressed: onStop,
        icon: const Icon(Icons.stop_rounded, size: 20),
      );
    } else if (sending) {
      button = IconButton.filled(
        key: const Key('assistant-send-busy'),
        tooltip: busyLabel,
        style: _style(background: colors.onSurface, foreground: colors.surface),
        onPressed: null,
        icon: busyIcon,
      );
    } else {
      final idle = Theme.of(context).brightness == Brightness.dark
          ? colors.outline
          : const Color(0xFFC7C7CC);
      final ready = Theme.of(context).brightness == Brightness.dark
          ? colors.onSurfaceVariant
          : const Color(0xFF8E8E93);
      button = IconButton.filled(
        key: const Key('assistant-send'),
        tooltip: '发送',
        style: _style(
          background: canSubmit ? ready : idle,
          foreground: Colors.white,
          disabledBackground: idle,
          disabledForeground: Colors.white,
        ),
        onPressed: canSubmit ? onSend : null,
        icon: const Icon(Icons.send_rounded, size: 18),
      );
    }
    return SizedBox.square(dimension: _composerControlSize, child: button);
  }
}

class _JumpToLatestButton extends StatelessWidget {
  const _JumpToLatestButton({required this.onPressed});

  final VoidCallback onPressed;
  static final _scale = Tween<double>(begin: 0.86, end: 1);

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final visual = StarCloudsVisualStyle.of(context);
    return TweenAnimationBuilder<double>(
      duration: _motionDuration(context, 240),
      curve: Curves.easeOutCubic,
      tween: _scale,
      builder: (context, value, child) =>
          Transform.scale(scale: value, child: child),
      child: Material(
        key: const Key('assistant-jump-latest'),
        color: colors.surfaceContainerLowest,
        elevation: 0,
        shape: StadiumBorder(side: BorderSide(color: visual.hairline)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onPressed,
          child: Tooltip(
            message: '回到最新消息',
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 14, 8),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.keyboard_arrow_down_rounded,
                    size: 20,
                    color: colors.primary,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '最新',
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w800,
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

class _AssistantCostRow extends StatelessWidget {
  const _AssistantCostRow({
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
      Text(
        label,
        style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer),
      ),
      const SizedBox(width: 16),
      Expanded(
        child: Text(
          value,
          textAlign: TextAlign.end,
          style: TextStyle(
            color: danger
                ? Theme.of(context).colorScheme.error
                : Theme.of(context).colorScheme.onErrorContainer,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    ],
  );
}

class AssistantReferenceStrip extends StatelessWidget {
  const AssistantReferenceStrip({
    required this.references,
    required this.busy,
    required this.onRemove,
    super.key,
  });

  final List<ReferenceImageDraft> references;
  final bool busy;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) => SizedBox(
    key: const Key('assistant-reference-strip'),
    height: 72,
    child: ListView.separated(
      scrollDirection: Axis.horizontal,
      itemCount: references.length,
      separatorBuilder: (_, _) => const SizedBox(width: 8),
      itemBuilder: (context, index) {
        final image = references[index];
        return SizedBox.square(
          dimension: 72,
          child: Stack(
            fit: StackFit.expand,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: image.localPath.isNotEmpty
                    ? Image.file(File(image.localPath), fit: BoxFit.cover)
                    : AuthenticatedImage(url: image.remoteUrl ?? ''),
              ),
              Positioned(
                right: 3,
                top: 3,
                child: IconButton.filled(
                  key: Key('assistant-remove-reference-$index'),
                  tooltip: '移除${image.filename}',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints.tightFor(
                    width: 30,
                    height: 30,
                  ),
                  padding: EdgeInsets.zero,
                  onPressed: busy ? null : () => onRemove(index),
                  icon: const Icon(Icons.close, size: 17),
                ),
              ),
              if (image.sourceAssetId != null)
                Positioned(
                  left: 4,
                  bottom: 4,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: .68),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                      child: Icon(
                        Icons.collections_outlined,
                        size: 13,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    ),
  );
}

class _AssistantError extends StatelessWidget {
  const _AssistantError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.cloud_off_outlined,
            size: 42,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          const SizedBox(height: 12),
          const Text('助手暂时无法连接'),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('重新加载'),
          ),
        ],
      ),
    ),
  );
}

Color _historySheetColor(BuildContext context) {
  final colors = Theme.of(context).colorScheme;
  return Theme.of(context).brightness == Brightness.dark
      ? colors.surface
      : Colors.white;
}

Color _historyQuietFill(BuildContext context) {
  final colors = Theme.of(context).colorScheme;
  return Theme.of(context).brightness == Brightness.dark
      ? colors.surfaceContainerHigh
      : const Color(0xFFF5F5F5);
}

class _AssistantHistoryDrawer extends ConsumerStatefulWidget {
  const _AssistantHistoryDrawer({
    required this.searchController,
    required this.onNewConversation,
    required this.onSelect,
    required this.onRename,
    required this.onPin,
    required this.onDelete,
    required this.onDeleteMany,
  });

  final TextEditingController searchController;
  final VoidCallback onNewConversation;
  final ValueChanged<AssistantConversation> onSelect;
  final ValueChanged<AssistantConversation> onRename;
  final ValueChanged<AssistantConversation> onPin;
  final ValueChanged<AssistantConversation> onDelete;
  final ValueChanged<List<AssistantConversation>> onDeleteMany;

  @override
  ConsumerState<_AssistantHistoryDrawer> createState() =>
      _AssistantHistoryDrawerState();
}

class _AssistantHistoryDrawerState
    extends ConsumerState<_AssistantHistoryDrawer> {
  var _query = '';
  String? _menuId;
  var _selecting = false;
  var _filter = assistantHistoryFilterAll;
  final _selectedIds = <String>{};

  void _setQuery(String value) {
    setState(() {
      _query = value;
      _menuId = null;
    });
  }

  void _setFilter(String filter) {
    if (_filter == filter) return;
    setState(() {
      _filter = filter;
      _menuId = null;
    });
  }

  void _closeMenu() {
    if (_menuId != null) setState(() => _menuId = null);
  }

  void _exitSelect() {
    setState(() {
      _selecting = false;
      _selectedIds.clear();
      _menuId = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final width = (media.size.width - 48).clamp(280.0, media.size.width);
    final state = ref.watch(assistantWorkspaceProvider).asData?.value;
    if (state == null) return const SizedBox.shrink();
    final grouped = filterAssistantConversationGroups(
      groupAssistantConversations(
        filterAssistantConversations(state.conversations, _query),
        state.pinnedIds,
      ),
      _filter,
    );
    final visibleItems = [for (final group in grouped) ...group.items];
    final historyRows = <Object>[
      for (final group in grouped) ...[
        if (_filter == assistantHistoryFilterAll) group.label,
        ...group.items,
      ],
    ];
    final existingIds = {for (final item in state.conversations) item.id};
    final selectedCount = _selectedIds.where(existingIds.contains).length;
    final selectedConversations = [
      for (final item in visibleItems)
        if (_selectedIds.contains(item.id)) item,
    ];
    final sheetColor = _historySheetColor(context);
    return Align(
      alignment: Alignment.topLeft,
      child: Material(
        key: const Key('assistant-history-drawer'),
        color: sheetColor,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.horizontal(right: Radius.circular(18)),
        ),
        clipBehavior: Clip.antiAlias,
        child: SizedBox(
          width: width,
          height: double.infinity,
          child: ColoredBox(
            color: sheetColor,
            child: SafeArea(
              bottom: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _HistoryDrawerEnter(
                    begin: .04,
                    slide: const Offset(0, -0.05),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 8, 4),
                      child: SizedBox(
                        height: 44,
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                _selecting ? '已选 $selectedCount 项' : '历史',
                                style: Theme.of(context).textTheme.titleLarge
                                    ?.copyWith(fontWeight: FontWeight.w800),
                              ),
                            ),
                            if (_selecting)
                              TextButton(
                                key: const Key(
                                  'assistant-history-select-cancel',
                                ),
                                onPressed: _exitSelect,
                                child: const Text('取消'),
                              )
                            else ...[
                              IconButton(
                                key: const Key('assistant-sheet-new'),
                                tooltip: '新对话',
                                visualDensity: VisualDensity.compact,
                                style: IconButton.styleFrom(
                                  backgroundColor: Colors.transparent,
                                  minimumSize: const Size.square(36),
                                  maximumSize: const Size.square(36),
                                  padding: EdgeInsets.zero,
                                ),
                                onPressed: state.canStartNewConversation
                                    ? () {
                                        unawaited(
                                          HapticFeedback.selectionClick(),
                                        );
                                        widget.onNewConversation();
                                      }
                                    : null,
                                icon: Icon(
                                  Icons.add_rounded,
                                  size: 22,
                                  color: Theme.of(context).colorScheme.onSurface
                                      .withValues(
                                        alpha: state.canStartNewConversation
                                            ? 1
                                            : .38,
                                      ),
                                ),
                              ),
                              IconButton(
                                tooltip: '关闭',
                                visualDensity: VisualDensity.compact,
                                style: IconButton.styleFrom(
                                  backgroundColor: Colors.transparent,
                                  minimumSize: const Size.square(36),
                                  maximumSize: const Size.square(36),
                                  padding: EdgeInsets.zero,
                                ),
                                onPressed: () => Navigator.pop(context),
                                icon: const Icon(Icons.close_rounded, size: 20),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                  if (!_selecting) ...[
                    _HistoryDrawerEnter(
                      begin: .1,
                      slide: const Offset(0, -0.04),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 6, 16, 8),
                        child: TextField(
                          key: const Key('assistant-history-search'),
                          controller: widget.searchController,
                          textInputAction: TextInputAction.search,
                          decoration: InputDecoration(
                            hintText: '搜索...',
                            prefixIcon: const Icon(
                              Icons.search_rounded,
                              size: 20,
                            ),
                            isDense: true,
                            suffixIcon: _query.isEmpty
                                ? null
                                : IconButton(
                                    key: const Key(
                                      'assistant-history-search-clear',
                                    ),
                                    tooltip: '清除搜索',
                                    onPressed: () {
                                      widget.searchController.clear();
                                      _setQuery('');
                                    },
                                    icon: const Icon(
                                      Icons.close_rounded,
                                      size: 18,
                                    ),
                                  ),
                            filled: true,
                            fillColor: _historyQuietFill(context),
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 10,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide.none,
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide.none,
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide.none,
                            ),
                          ),
                          onChanged: _setQuery,
                        ),
                      ),
                    ),
                    if (state.conversations.isNotEmpty)
                      _HistoryDrawerEnter(
                        begin: .12,
                        slide: const Offset(0, -0.03),
                        child: SizedBox(
                          height: 36,
                          child: ListView.separated(
                            key: const Key('assistant-history-filters'),
                            scrollDirection: Axis.horizontal,
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
                            itemCount: assistantHistoryFilters.length,
                            separatorBuilder: (context, index) =>
                                const SizedBox(width: 8),
                            itemBuilder: (context, index) {
                              final label = assistantHistoryFilters[index];
                              return _HistoryFilterChip(
                                key: Key('assistant-history-filter-$label'),
                                label: label,
                                selected: _filter == label,
                                onTap: () => _setFilter(label),
                              );
                            },
                          ),
                        ),
                      ),
                  ],
                  Expanded(
                    child: ColoredBox(
                      color: sheetColor,
                      child: _HistoryDrawerEnter(
                        begin: .16,
                        slide: const Offset(-0.04, 0),
                        fill: true,
                        child: state.conversations.isEmpty
                            ? const _ConversationEmpty()
                            : visibleItems.isEmpty
                            ? _ConversationSearchEmpty(query: _query.trim())
                            : NotificationListener<UserScrollNotification>(
                                onNotification: (notification) {
                                  _closeMenu();
                                  return false;
                                },
                                child: CustomScrollView(
                                  physics: const AlwaysScrollableScrollPhysics(
                                    parent: BouncingScrollPhysics(),
                                  ),
                                  slivers: [
                                    SliverPadding(
                                      padding: const EdgeInsets.fromLTRB(
                                        8,
                                        4,
                                        8,
                                        20,
                                      ),
                                      sliver: SliverList(
                                        delegate: SliverChildBuilderDelegate((
                                          context,
                                          index,
                                        ) {
                                          final row = historyRows[index];
                                          if (row is String) {
                                            return _HistoryGroupHeader(
                                              label: row,
                                            );
                                          }
                                          final item =
                                              row as AssistantConversation;
                                          return _HistoryConversationTile(
                                            key: ValueKey(
                                              'assistant-history-menu-${item.id}',
                                            ),
                                            conversationId: item.id,
                                            title: item.title,
                                            timeLabel:
                                                assistantConversationRelativeTime(
                                                  item.updatedAt,
                                                ),
                                            thumbnailUrl:
                                                assistantConversationThumbnailUrl(
                                                  item,
                                                ),
                                            selected:
                                                item.id ==
                                                state.selectedConversationId,
                                            pinned: state.pinnedIds.contains(
                                              item.id,
                                            ),
                                            menuOpen: _menuId == item.id,
                                            selecting: _selecting,
                                            checked: _selectedIds.contains(
                                              item.id,
                                            ),
                                            onSelect: () =>
                                                widget.onSelect(item),
                                            onMenuOpen: () {
                                              unawaited(
                                                HapticFeedback.mediumImpact(),
                                              );
                                              setState(() => _menuId = item.id);
                                            },
                                            onMenuClose: _closeMenu,
                                            onRename: () {
                                              _closeMenu();
                                              widget.onRename(item);
                                            },
                                            onPin: () {
                                              _closeMenu();
                                              widget.onPin(item);
                                            },
                                            onEnterSelect: () {
                                              setState(() {
                                                _menuId = null;
                                                _selecting = true;
                                                _selectedIds
                                                  ..clear()
                                                  ..add(item.id);
                                              });
                                            },
                                            onToggleChecked: () {
                                              setState(() {
                                                if (!_selectedIds.remove(
                                                  item.id,
                                                )) {
                                                  _selectedIds.add(item.id);
                                                }
                                              });
                                            },
                                            onDelete: () {
                                              _closeMenu();
                                              widget.onDelete(item);
                                            },
                                          );
                                        }, childCount: historyRows.length),
                                      ),
                                    ),
                                    const SliverFillRemaining(
                                      hasScrollBody: false,
                                      child: SizedBox.expand(),
                                    ),
                                  ],
                                ),
                              ),
                      ),
                    ),
                  ),
                  if (_selecting)
                    _HistoryDrawerEnter(
                      begin: .22,
                      slide: const Offset(0, 0.18),
                      child: _HistoryDrawerFooter(
                        selectedCount: selectedConversations.length,
                        onDeleteSelected: selectedConversations.isEmpty
                            ? null
                            : () => widget.onDeleteMany(selectedConversations),
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

class _HistoryFilterChip extends StatelessWidget {
  const _HistoryFilterChip({
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
      color: selected ? colors.onSurface : _historyQuietFill(context),
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

class _HistoryDrawerEnter extends StatelessWidget {
  const _HistoryDrawerEnter({
    required this.child,
    required this.begin,
    required this.slide,
    this.fill = false,
  });

  final Widget child;
  final double begin;
  final Offset slide;
  final bool fill;

  @override
  Widget build(BuildContext context) {
    Widget content = child;
    if (MediaQuery.disableAnimationsOf(context)) {
      return fill ? SizedBox.expand(child: content) : content;
    }
    final animation = ModalRoute.of(context)?.animation;
    if (animation == null) {
      return fill ? SizedBox.expand(child: content) : content;
    }
    final appear = CurvedAnimation(
      parent: animation,
      curve: Interval(begin, 1, curve: Curves.easeOutCubic),
      reverseCurve: Curves.easeInCubic,
    );
    content = FadeTransition(
      opacity: appear,
      child: SlideTransition(
        position: Tween<Offset>(begin: slide, end: Offset.zero).animate(appear),
        child: child,
      ),
    );
    return fill ? SizedBox.expand(child: content) : content;
  }
}

class _HistoryDrawerFooter extends StatelessWidget {
  const _HistoryDrawerFooter({
    required this.selectedCount,
    required this.onDeleteSelected,
  });

  final int selectedCount;
  final VoidCallback? onDeleteSelected;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final visual = StarCloudsVisualStyle.of(context);
    return Material(
      color: _historySheetColor(context),
      surfaceTintColor: Colors.transparent,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Divider(
            height: 1,
            color: Theme.of(context).brightness == Brightness.dark
                ? visual.hairline
                : const Color(0xFFE5E5EA),
          ),
          SafeArea(
            top: false,
            child: InkWell(
              key: const Key('assistant-history-batch-delete'),
              onTap: onDeleteSelected,
              child: SizedBox(
                height: 56,
                width: double.infinity,
                child: Opacity(
                  opacity: onDeleteSelected == null ? .4 : 1,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.delete_outline_rounded,
                        size: 20,
                        color: colors.error,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        selectedCount <= 1 ? '删除' : '删除 $selectedCount 段',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: colors.error,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoryGroupHeader extends StatelessWidget {
  const _HistoryGroupHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: ValueKey('assistant-history-group-$label'),
      padding: const EdgeInsets.fromLTRB(12, 16, 12, 6),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.2,
        ),
      ),
    );
  }
}

class _HistoryConversationThumb extends StatelessWidget {
  const _HistoryConversationThumb({required this.url, required this.mark});

  final String url;
  final String mark;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: SizedBox.square(
        dimension: 40,
        child: url.isEmpty
            ? ColoredBox(
                color: colors.surfaceContainerHigh,
                child: Center(
                  child: Text(
                    mark,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: colors.onSurfaceVariant,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              )
            : AuthenticatedImage(url: url, fit: BoxFit.cover),
      ),
    );
  }
}

class _HistoryConversationTile extends StatefulWidget {
  const _HistoryConversationTile({
    required this.conversationId,
    required this.title,
    required this.timeLabel,
    required this.thumbnailUrl,
    required this.selected,
    required this.pinned,
    required this.menuOpen,
    required this.selecting,
    required this.checked,
    required this.onSelect,
    required this.onMenuOpen,
    required this.onMenuClose,
    required this.onRename,
    required this.onPin,
    required this.onEnterSelect,
    required this.onToggleChecked,
    required this.onDelete,
    super.key,
  });

  final String conversationId;
  final String title;
  final String timeLabel;
  final String thumbnailUrl;
  final bool selected;
  final bool pinned;
  final bool menuOpen;
  final bool selecting;
  final bool checked;
  final VoidCallback onSelect;
  final VoidCallback onMenuOpen;
  final VoidCallback onMenuClose;
  final VoidCallback onRename;
  final VoidCallback onPin;
  final VoidCallback onEnterSelect;
  final VoidCallback onToggleChecked;
  final VoidCallback onDelete;

  @override
  State<_HistoryConversationTile> createState() =>
      _HistoryConversationTileState();
}

class _HistoryConversationTileState extends State<_HistoryConversationTile> {
  final _overlay = OverlayPortalController();

  void _syncOverlay() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (widget.menuOpen) {
        if (!_overlay.isShowing) _overlay.show();
      } else if (_overlay.isShowing) {
        _overlay.hide();
      }
    });
  }

  @override
  void didUpdateWidget(covariant _HistoryConversationTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.menuOpen != widget.menuOpen) _syncOverlay();
  }

  void _openMenu() {
    widget.onMenuOpen();
    if (!_overlay.isShowing) _overlay.show();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return OverlayPortal.overlayChildLayoutBuilder(
      controller: _overlay,
      overlayChildBuilder: (context, info) {
        const menuWidth = 176.0;
        const menuHeight = 196.0;
        final origin = MatrixUtils.transformPoint(
          info.childPaintTransform,
          Offset.zero,
        );
        var left = origin.dx + (info.childSize.width - menuWidth) / 2;
        left = left.clamp(12.0, info.overlaySize.width - menuWidth - 12);
        var top = origin.dy - 8;
        if (top + menuHeight > info.overlaySize.height - 16) {
          top = origin.dy + info.childSize.height - menuHeight + 8;
        }
        if (top < 12) top = origin.dy + info.childSize.height + 6;
        top = top.clamp(12.0, info.overlaySize.height - menuHeight - 12);
        return Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: widget.onMenuClose,
              ),
            ),
            Positioned(
              left: left,
              top: top,
              width: menuWidth,
              child: _HistoryConversationMenu(
                conversationId: widget.conversationId,
                pinned: widget.pinned,
                onRename: widget.onRename,
                onPin: widget.onPin,
                onSelect: widget.onEnterSelect,
                onDelete: widget.onDelete,
              ),
            ),
          ],
        );
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
        child: Material(
          color: widget.menuOpen || (widget.selected && !widget.selecting)
              ? _historyQuietFill(context)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: widget.selecting
                ? widget.onToggleChecked
                : widget.menuOpen
                ? widget.onMenuClose
                : widget.onSelect,
            onLongPress: widget.selecting ? widget.onToggleChecked : _openMenu,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 4, 8),
              child: Row(
                children: [
                  if (widget.selecting) ...[
                    Icon(
                      widget.checked
                          ? Icons.check_circle_rounded
                          : Icons.circle_outlined,
                      size: 22,
                      color: widget.checked
                          ? colors.primary
                          : colors.onSurfaceVariant,
                    ),
                    const SizedBox(width: 8),
                  ],
                  _HistoryConversationThumb(
                    url: widget.thumbnailUrl,
                    mark: assistantConversationMark(widget.title),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                        if (widget.timeLabel.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            widget.timeLabel,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(
                                  color: colors.onSurfaceVariant,
                                  fontWeight: FontWeight.w500,
                                ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (widget.pinned)
                    Padding(
                      padding: const EdgeInsets.only(left: 4),
                      child: Icon(
                        Icons.push_pin_rounded,
                        size: 14,
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  if (!widget.selecting)
                    IconButton(
                      key: ValueKey(
                        'assistant-history-more-${widget.conversationId}',
                      ),
                      tooltip: '更多',
                      visualDensity: VisualDensity.compact,
                      style: IconButton.styleFrom(
                        backgroundColor: Colors.transparent,
                        minimumSize: const Size.square(32),
                        maximumSize: const Size.square(32),
                        padding: EdgeInsets.zero,
                      ),
                      onPressed: widget.menuOpen
                          ? widget.onMenuClose
                          : _openMenu,
                      icon: Icon(
                        Icons.more_horiz_rounded,
                        size: 20,
                        color: colors.onSurfaceVariant,
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

class _HistoryConversationMenu extends StatelessWidget {
  const _HistoryConversationMenu({
    required this.conversationId,
    required this.pinned,
    required this.onRename,
    required this.onPin,
    required this.onSelect,
    required this.onDelete,
  });

  final String conversationId;
  final bool pinned;
  final VoidCallback onRename;
  final VoidCallback onPin;
  final VoidCallback onSelect;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return _AssistantMenuSurface(
      compact: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _HistoryConversationMenuItem(
              key: ValueKey('assistant-history-rename-$conversationId'),
              icon: Icons.edit_outlined,
              label: '重命名',
              onTap: onRename,
            ),
            _HistoryConversationMenuItem(
              key: ValueKey('assistant-history-pin-$conversationId'),
              icon: pinned ? Icons.push_pin_rounded : Icons.push_pin_outlined,
              label: pinned ? '取消置顶' : '置顶',
              onTap: onPin,
            ),
            _HistoryConversationMenuItem(
              key: ValueKey('assistant-history-select-$conversationId'),
              icon: Icons.checklist_rounded,
              label: '多选',
              onTap: onSelect,
            ),
            _HistoryConversationMenuItem(
              key: ValueKey('assistant-history-delete-$conversationId'),
              icon: Icons.delete_outline_rounded,
              label: '删除',
              danger: true,
              onTap: onDelete,
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryConversationMenuItem extends StatelessWidget {
  const _HistoryConversationMenuItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.danger = false,
    super.key,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final color = danger ? colors.error : colors.onSurface;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              Icon(icon, size: 18, color: color),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w600,
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

class _ConversationEmpty extends StatelessWidget {
  const _ConversationEmpty();

  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(padding: EdgeInsets.all(24), child: Text('暂无对话记录')),
  );
}

class _ConversationSearchEmpty extends StatelessWidget {
  const _ConversationSearchEmpty({required this.query});

  final String query;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.search_off_outlined,
            size: 38,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          const SizedBox(height: 10),
          Text(
            query.isEmpty ? '暂无记录' : '没有匹配的对话',
            style: Theme.of(
              context,
            ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          if (query.isNotEmpty) ...[
            const SizedBox(height: 5),
            Text(
              '“$query”',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    ),
  );
}

class _RenameConversationDialog extends StatefulWidget {
  const _RenameConversationDialog({required this.initialTitle});

  final String initialTitle;

  @override
  State<_RenameConversationDialog> createState() =>
      _RenameConversationDialogState();
}

class _RenameConversationDialogState extends State<_RenameConversationDialog> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialTitle);
    _controller.addListener(_rebuild);
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_rebuild)
      ..dispose();
    super.dispose();
  }

  void _rebuild() => setState(() {});

  void _submit() {
    final value = _controller.text.trim();
    if (value.isNotEmpty) Navigator.pop(context, value);
  }

  @override
  Widget build(BuildContext context) => AppDialog(
    icon: const Icon(Icons.edit_outlined),
    title: const Text('重命名对话'),
    content: TextField(
      key: const Key('assistant-rename-field'),
      controller: _controller,
      autofocus: true,
      maxLength: 60,
      textInputAction: TextInputAction.done,
      decoration: const InputDecoration(hintText: '输入对话名称'),
      onSubmitted: (_) => _submit(),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('取消'),
      ),
      FilledButton(
        key: const Key('assistant-rename-confirm'),
        onPressed: _controller.text.trim().isEmpty ? null : _submit,
        child: const Text('保存'),
      ),
    ],
  );
}

enum _AssistantImageSource { assets, gallery }
