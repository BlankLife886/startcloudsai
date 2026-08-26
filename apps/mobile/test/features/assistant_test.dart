import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/features/assistant/assistant.dart';
import 'package:starcloudsai_mobile/features/assistant/assistant_draft.dart';
import 'package:starcloudsai_mobile/features/assistant/assistant_screen.dart';
import 'package:starcloudsai_mobile/features/create/reference_image_service.dart';
import 'package:starcloudsai_mobile/features/profile/profile.dart';
import 'package:starcloudsai_mobile/features/shell/app_shell.dart';

const _model = AssistantModelOption(
  id: 'chat-pro',
  label: '星云对话 Pro',
  description: '复杂创意分析',
  pricePoints: 8,
  standardPricePoints: 12,
  reasoningEfforts: ['low', 'medium', 'high'],
  defaultReasoningEffort: 'medium',
  isDefault: true,
  reasoningPricePoints: {'low': 5, 'medium': 8, 'high': 14},
  reasoningStandardPricePoints: {'low': 8, 'medium': 12, 'high': 18},
);

const _imageModel = AssistantModelOption(
  id: 'image-pro',
  label: '星云图像 Pro',
  description: '高质量图片生成',
  pricePoints: 12,
  standardPricePoints: 16,
  reasoningEfforts: [],
  defaultReasoningEffort: '',
  isDefault: true,
  maxReferenceImages: 3,
  resolutions: ['2K', '4K'],
  aspectRatios: ['auto', '1:1', '3:4', '16:9'],
  qualities: ['medium', 'high'],
  maxImages: 4,
);

const _config = AssistantConfig(
  models: [_model],
  defaultModelId: 'chat-pro',
  imageModels: [_imageModel],
  defaultImageModelId: 'image-pro',
);

AssistantMessage _message(
  String id,
  String role,
  String content, {
  String kind = 'chat',
  String status = 'complete',
  List<AssistantReferenceImage> referenceImages = const [],
  String reasoning = '',
  AssistantProposal? proposal,
  List<AssistantGeneratedImage> images = const [],
  AssistantUsage? usage,
  AssistantQuotedMessage? quoted,
  int costPoints = 0,
  DateTime? updatedAt,
}) => AssistantMessage(
  id: id,
  role: role,
  content: content,
  kind: kind,
  status: status,
  createdAt: DateTime(2026, 8, 24, 10),
  updatedAt: updatedAt,
  referenceImages: referenceImages,
  reasoning: reasoning,
  proposal: proposal,
  images: images,
  usage: usage,
  quoted: quoted,
  costPoints: costPoints,
);

class _FakeAssistantRepository implements AssistantRepository {
  CreateAssistantRunInput? submitted;
  List<AssistantConversation> initialConversations = const [];
  int createConversationCount = 0;
  int runReads = 0;
  bool returnTerminalRun = true;
  final streamController = StreamController<AssistantStreamEvent>.broadcast();

  Future<void> dispose() => streamController.close();

  @override
  Future<AssistantConfig> config() async => _config;

  @override
  Future<List<AssistantConversation>> conversations() async =>
      initialConversations;

  @override
  Future<List<AssistantRun>> activeRuns() async => const [];

  @override
  Future<AssistantConversation> createConversation() async {
    createConversationCount += 1;
    return const AssistantConversation(
      id: 'conversation-1',
      title: '新对话',
      messages: [],
      updatedAt: null,
    );
  }

  @override
  Future<AssistantConversation> renameConversation(
    String id,
    String title,
  ) async => AssistantConversation(
    id: id,
    title: title,
    messages: const [],
    updatedAt: DateTime(2026, 8, 24, 12),
  );

  @override
  Future<void> deleteConversation(
    String id, {
    bool cancelActive = false,
  }) async {}

  @override
  Future<AssistantRunSnapshot> createRun(CreateAssistantRunInput input) async {
    submitted = input;
    return AssistantRunSnapshot(
      run: const AssistantRun(
        id: 'run-1',
        conversationId: 'conversation-1',
        status: 'queued',
        stage: 'queued',
        errorMessage: '',
        costPoints: 0,
      ),
      userMessage: _message('user-1', 'user', input.prompt),
      assistantMessage: _message(
        'assistant-1',
        'assistant',
        '',
        status: 'queued',
      ),
    );
  }

  @override
  Future<AssistantRunSnapshot> getRun(String id) async {
    runReads += 1;
    if (!returnTerminalRun) {
      return AssistantRunSnapshot(
        run: const AssistantRun(
          id: 'run-1',
          conversationId: 'conversation-1',
          status: 'running',
          stage: 'thinking',
          errorMessage: '',
          costPoints: 0,
          assistantMessageId: 'assistant-1',
        ),
        assistantMessage: _message(
          'assistant-1',
          'assistant',
          '',
          status: 'running',
        ),
      );
    }
    return AssistantRunSnapshot(
      run: const AssistantRun(
        id: 'run-1',
        conversationId: 'conversation-1',
        status: 'succeeded',
        stage: 'complete',
        errorMessage: '',
        costPoints: 8,
      ),
      assistantMessage: _message('assistant-1', 'assistant', '这里是完整回复。'),
    );
  }

  @override
  Future<AssistantRun> cancelRun(String id) async => const AssistantRun(
    id: 'run-1',
    conversationId: 'conversation-1',
    status: 'canceled',
    stage: 'stopped',
    errorMessage: '',
    costPoints: 0,
  );

  @override
  Stream<AssistantStreamEvent> streamRun(String id) => streamController.stream;
}

class _ScreenAssistantController extends AssistantWorkspaceController {
  _ScreenAssistantController(this.initial);

  final AssistantWorkspaceState initial;
  int sendCount = 0;
  int stopCount = 0;
  int newConversationCount = 0;
  String? sentValue;
  List<AssistantReferenceImage> sentReferences = const [];
  AssistantQuotedMessage? sentQuoted;
  String? renamedTitle;
  final deletedIds = <String>[];
  final pinnedToggles = <String>[];
  AssistantProposal? submittedProposal;
  String? proposalSourceMessageId;
  List<AssistantReferenceImage> proposalReferences = const [];
  Completer<void>? newConversationGate;

  @override
  Future<AssistantWorkspaceState> build() async => initial;

  @override
  Future<void> send(
    String value, {
    List<AssistantReferenceImage> referenceImages = const [],
    AssistantQuotedMessage? quoted,
  }) async {
    sendCount += 1;
    sentValue = value;
    sentReferences = referenceImages;
    sentQuoted = quoted;
  }

  @override
  Future<void> executeProposal({
    required String sourceMessageId,
    required AssistantProposal proposal,
    List<AssistantReferenceImage> referenceImages = const [],
  }) async {
    proposalSourceMessageId = sourceMessageId;
    submittedProposal = proposal;
    proposalReferences = referenceImages;
  }

  @override
  Future<void> cancelSelectedRun() async {
    stopCount += 1;
  }

  @override
  Future<void> newConversation() async {
    newConversationCount += 1;
    await newConversationGate?.future;
  }

  @override
  Future<void> renameConversation(String id, String title) async {
    renamedTitle = title.trim();
    final current = state.requireValue;
    state = AsyncData(
      current.copyWith(
        conversations: current.conversations
            .map(
              (item) =>
                  item.id == id ? item.copyWith(title: renamedTitle) : item,
            )
            .toList(),
      ),
    );
  }

  @override
  Future<void> deleteConversation(String id) async {
    deletedIds.add(id);
    final current = state.requireValue;
    final conversations = current.conversations
        .where((item) => item.id != id)
        .toList();
    state = AsyncData(
      current.copyWith(
        conversations: conversations,
        selectedConversationId: current.selectedConversationId == id
            ? conversations.firstOrNull?.id
            : current.selectedConversationId,
        clearSelectedConversation:
            current.selectedConversationId == id && conversations.isEmpty,
        pinnedIds: {...current.pinnedIds}..remove(id),
      ),
    );
  }

  @override
  Future<void> togglePinned(String id) async {
    pinnedToggles.add(id);
    final current = state.requireValue;
    final next = {...current.pinnedIds};
    if (!next.remove(id)) next.add(id);
    state = AsyncData(current.copyWith(pinnedIds: next));
  }
}

class _FakeAssistantDraftStore implements AssistantDraftStore {
  _FakeAssistantDraftStore({this.draft});

  AssistantDraft? draft;
  int readCount = 0;
  int writeCount = 0;
  int clearCount = 0;
  final List<AssistantDraft> writes = [];

  @override
  Future<AssistantDraft?> read() async {
    readCount += 1;
    return draft;
  }

  @override
  Future<void> write(AssistantDraft value) async {
    writeCount += 1;
    writes.add(value);
    draft = value;
  }

  @override
  Future<void> clear() async {
    clearCount += 1;
    draft = null;
  }
}

Widget _screen(
  _ScreenAssistantController Function() controller, {
  double textScale = 1,
  String? initialPrompt,
  int availablePoints = 100,
  AssistantDraftStore? draftStore,
  Brightness brightness = Brightness.light,
}) {
  final resolvedDraftStore = draftStore ?? _FakeAssistantDraftStore();
  return ProviderScope(
    overrides: [
      assistantWorkspaceProvider.overrideWith(controller),
      assistantDraftStoreProvider.overrideWithValue(resolvedDraftStore),
      walletProvider.overrideWith(
        (ref) async => WalletSnapshot(
          availablePoints: availablePoints,
          frozenPoints: 0,
          trialPoints: 0,
        ),
      ),
    ],
    child: MaterialApp(
      theme: StarCloudsTheme.light(),
      darkTheme: StarCloudsTheme.dark(),
      themeMode: brightness == Brightness.dark
          ? ThemeMode.dark
          : ThemeMode.light,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: AssistantScreen(initialPrompt: initialPrompt),
    ),
  );
}

void main() {
  test('pinned conversations stay at the top of history', () {
    const first = AssistantConversation(
      id: 'a',
      title: 'A',
      messages: [],
      updatedAt: null,
    );
    const second = AssistantConversation(
      id: 'b',
      title: 'B',
      messages: [],
      updatedAt: null,
    );
    expect(
      sortAssistantConversations(
        [first, second],
        const {'b'},
      ).map((item) => item.id),
      ['b', 'a'],
    );
    final now = DateTime(2026, 8, 25, 15);
    final today = AssistantConversation(
      id: 'today',
      title: '创建一张星空云绘网站',
      messages: const [],
      updatedAt: DateTime(2026, 8, 25, 10),
    );
    final earlier = AssistantConversation(
      id: 'earlier',
      title: 'ai生图 每张低至4分',
      messages: [
        _message(
          'img-1',
          'assistant',
          '',
          kind: 'image',
          images: const [
            AssistantGeneratedImage(
              id: 'g1',
              fileKey: 'uploads/cover.png',
              url: '/api/v1/files/uploads/cover.png',
              thumbnailUrl: '/api/v1/files/uploads/cover-thumb.png',
              revisedPrompt: '',
            ),
          ],
        ),
      ],
      updatedAt: DateTime(2026, 8, 20, 10),
    );
    final groups = groupAssistantConversations(
      [today, earlier, first],
      const {},
      now: now,
    );
    expect(groups.map((item) => item.label), ['今天', '较早']);
    expect(groups.first.items.single.id, 'today');
    expect(groups.last.items.map((item) => item.id), ['earlier', 'a']);
    expect(
      filterAssistantConversationGroups(groups, '今天').map((item) => item.label),
      ['今天'],
    );
    expect(
      filterAssistantConversationGroups(groups, assistantHistoryFilterAll),
      groups,
    );
    final clock = DateTime(2026, 8, 25, 15, 30);
    expect(assistantConversationRelativeTime(clock, now: clock), '刚刚');
    expect(
      assistantConversationRelativeTime(
        clock.subtract(const Duration(minutes: 5)),
        now: clock,
      ),
      '5 分钟前',
    );
    expect(
      assistantConversationRelativeTime(
        clock.subtract(const Duration(hours: 3)),
        now: clock,
      ),
      '3 小时前',
    );
    expect(
      assistantConversationRelativeTime(
        clock.subtract(const Duration(days: 2)),
        now: clock,
      ),
      '2 天前',
    );
    expect(
      assistantConversationRelativeTime(DateTime(2026, 8, 1, 10), now: clock),
      '8月1日',
    );
    expect(
      assistantConversationThumbnailUrl(earlier),
      '/api/v1/files/uploads/cover-thumb.png',
    );
    expect(assistantConversationMark('画一张星空'), '画');
    expect(assistantConversationMark(''), '新');
    final pinnedGroups = groupAssistantConversations(
      [today, earlier],
      {'today'},
      now: now,
    );
    expect(pinnedGroups.map((item) => item.label), ['已置顶', '较早']);
    expect(pinnedGroups.first.items.single.id, 'today');
  });

  testWidgets('assistant workbench renders in light and dark themes', (
    tester,
  ) async {
    for (final brightness in Brightness.values) {
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await tester.pumpWidget(
        _screen(
          brightness: brightness,
          () => _ScreenAssistantController(
            const AssistantWorkspaceState(
              config: _config,
              conversations: [],
              selectedConversationId: null,
              selectedModelId: 'chat-pro',
              reasoningEffort: 'medium',
              activeRuns: {},
            ),
          ),
        ),
      );
      await tester.pump();

      final model = find.byKey(const Key('assistant-model'));
      expect(Theme.of(tester.element(model)).brightness, brightness);
      expect(find.byKey(const Key('assistant-history')), findsOneWidget);
      expect(find.byKey(const Key('assistant-new')), findsOneWidget);
      expect(find.byKey(const Key('assistant-tools')), findsOneWidget);
      expect(find.byKey(const Key('assistant-voice')), findsOneWidget);
      expect(model, findsOneWidget);
      expect(find.textContaining('问答 · 星云对话 Pro'), findsOneWidget);
      expect(find.text('标准'), findsNothing);
      expect(find.text('标准推理'), findsNothing);
      final header = tester.widget<TextButton>(
        find.byKey(const Key('assistant-model')),
      );
      expect(
        header.style?.backgroundColor?.resolve(<WidgetState>{}),
        Colors.transparent,
      );
      expect(find.byKey(const Key('assistant-header-summary')), findsOneWidget);
      expect(find.text('有什么可以帮你？'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('header dropdown selects reasoning without a bottom sheet', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _ScreenAssistantController controller;
    await tester.pumpWidget(
      _screen(
        textScale: 1.6,
        () => controller = _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('assistant-model')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('assistant-header-mode')), findsOneWidget);
    expect(find.byKey(const Key('assistant-header-model')), findsOneWidget);
    expect(find.byKey(const Key('assistant-header-reasoning')), findsOneWidget);
    final title = tester.getRect(find.byKey(const Key('assistant-model')));
    final panel = tester.getRect(
      find.byKey(const Key('assistant-header-menu-panel')),
    );
    expect((title.center.dx - panel.center.dx).abs(), lessThan(12));
    expect(panel.height, lessThan(240));
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.byType(SubmenuButton), findsNothing);
    expect(
      find.byKey(const ValueKey('assistant-header-reasoning-high')),
      findsNothing,
    );

    await tester.tap(find.byKey(const Key('assistant-header-reasoning')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('assistant-header-reasoning-high')),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(const ValueKey('assistant-header-reasoning-high')),
    );
    await tester.pumpAndSettle();

    expect(controller.state.requireValue.reasoningEffort, 'high');
    expect(find.text('深入'), findsAtLeastNWidgets(1));
    expect(find.text('深入推理'), findsNothing);
    expect(find.byKey(const Key('assistant-header-mode')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('new conversation button shows progress and blocks repeats', (
    tester,
  ) async {
    late _ScreenAssistantController controller;
    await tester.pumpWidget(
      _screen(
        () => controller = _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pump();
    controller.newConversationGate = Completer<void>();

    await tester.tap(find.byKey(const Key('assistant-new')));
    await tester.pump();

    expect(controller.newConversationCount, 1);
    expect(find.byKey(const Key('assistant-new-loading')), findsOneWidget);
    expect(
      tester
          .widget<IconButton>(find.byKey(const Key('assistant-new')))
          .onPressed,
      isNull,
    );

    controller.newConversationGate!.complete();
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('assistant-new-icon')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('parses assistant models, conversations and runs defensively', () {
    final config = AssistantConfig.fromJson({
      'chatModel': 'missing-default',
      'conversationModels': [
        {
          'model': 'chat-pro',
          'label': '星云对话 Pro',
          'description': '复杂创意分析',
          'pricePoints': 8,
          'standardPricePoints': 12,
          'supportedReasoningEfforts': ['low', 'medium', 'high'],
          'defaultReasoningEffort': 'unsupported',
          'reasoningEfforts': [
            {'id': 'medium', 'pricePoints': 9, 'standardPricePoints': 13},
          ],
          'default': true,
          'maxReferenceImages': 3,
        },
        {'model': ''},
        'invalid',
      ],
      'imageModel': 'image-pro',
      'imageModels': [
        {
          'model': 'image-pro',
          'label': '星云图像 Pro',
          'pricePoints': 12,
          'standardPricePoints': 16,
          'resolutions': ['2K', '4K'],
          'aspectRatios': ['auto', '1:1'],
          'aspectRatiosByResolution': {
            '4K': ['16:9'],
          },
          'qualities': ['medium', 'high'],
          'maxImages': 4,
          'maxReferenceImages': 3,
        },
      ],
    });
    final conversation = AssistantConversation.fromJson({
      'id': 'conversation-1',
      'title': '',
      'updatedAt': '2026-08-24T02:00:00Z',
      'messages': [
        {
          'id': 'message-1',
          'role': 'assistant',
          'content': '回复',
          'status': 'running',
          'createdAt': '2026-08-24T02:00:00Z',
        },
        {'id': ''},
      ],
    });
    final snapshot = AssistantRunSnapshot.fromJson({
      'run': {
        'id': 'run-1',
        'conversationId': 'conversation-1',
        'status': 'succeeded',
        'costCents': 8,
      },
      'assistantMessage': {'id': 'message-1', 'content': '完整回复'},
    });

    expect(config.models, hasLength(1));
    expect(config.defaultModelId, 'chat-pro');
    expect(config.models.single.isDiscounted, isTrue);
    expect(config.models.single.defaultReasoningEffort, 'medium');
    expect(config.models.single.priceFor('medium'), 9);
    expect(config.models.single.standardPriceFor('medium'), 13);
    expect(config.models.single.maxReferenceImages, 3);
    expect(config.imageModels, hasLength(1));
    expect(config.defaultImageModelId, 'image-pro');
    expect(config.imageModels.single.resolutions, ['2K', '4K']);
    expect(config.imageModels.single.ratiosFor('4K'), ['16:9']);
    expect(config.imageModels.single.maxImages, 4);
    expect(
      AssistantModelOption.fromJson({
        'model': 'legacy-chat',
        'maxReferenceImages': 0,
      }).maxReferenceImages,
      4,
    );
    expect(conversation.title, '新对话');
    expect(conversation.messages.single.isPending, isTrue);
    expect(conversation.messages.single.canUseAsCreationPrompt, isFalse);
    expect(snapshot.run.isTerminal, isTrue);
    expect(snapshot.run.costPoints, 8);
    expect(snapshot.assistantMessage.content, '完整回复');
    final usageMessage = AssistantMessage.fromJson({
      'id': 'usage-1',
      'role': 'assistant',
      'content': '这是完成的回答。',
      'status': 'complete',
      'createdAt': '2026-08-24T02:00:00Z',
      'updatedAt': '2026-08-24T02:00:12.400Z',
      'usage': {
        'inputTokens': 3812,
        'outputTokens': 1204,
        'firstTokenMs': 620,
        'durationMs': 12400,
      },
      'costCents': 8,
    });
    expect(usageMessage.usage?.inputTokens, 3812);
    expect(usageMessage.costPoints, 8);
    expect(
      assistantReplyMetricsLabel(usageMessage),
      '消耗 1.2K · 输入 3.8K · 首字 0.6s · 8 积分 · 12.4s',
    );
    expect(formatAssistantTokens(4), '4');
    expect(formatAssistantDurationMs(5000), '5s');
    expect(assistantQuoteFrom(usageMessage).toJson(), {
      'id': 'usage-1',
      'kind': '回复',
      'content': '这是完成的回答。',
    });
    final quotedUser = AssistantMessage.fromJson({
      'id': 'quote-user',
      'role': 'user',
      'content': '继续解释',
      'quoted': {'id': 'usage-1', 'kind': '回复', 'content': '这是完成的回答。'},
    });
    expect(quotedUser.quoted?.kind, '回复');
    expect(quotedUser.quoted?.content, '这是完成的回答。');
    final event = AssistantStreamEvent.fromJson({
      'content': '累计回复',
      'reasoning': '先分析构图',
      'kind': 'chat',
      'stage': 'answering',
    });
    expect(event.hasUpdate, isTrue);
    expect(event.reasoning, '先分析构图');
    final retryUser = _message(
      'retry-user',
      'user',
      '继续分析这张参考图',
      referenceImages: const [
        AssistantReferenceImage(
          id: 'asset-1',
          name: '参考图',
          fileKey: 'uploads/user/reference.jpg',
          url: '/api/v1/files/uploads/user/reference.jpg',
        ),
      ],
    );
    final stopped = _message(
      'retry-assistant',
      'assistant',
      '用户已主动停止生成',
      status: 'stopped',
    );
    expect(stopped.canRetry, isTrue);
    expect(assistantRetrySource([retryUser, stopped], 1)?.id, 'retry-user');
    expect(assistantRetrySource([retryUser, stopped], 0), isNull);
    final completed = _message('retry-complete', 'assistant', '可以再试一次。');
    expect(completed.canRetry, isFalse);
    expect(assistantRetrySource([retryUser, completed], 1)?.id, 'retry-user');
    final location = Uri.parse(
      assistantReplyCreationLocation('  中文提示词\n保留换行  '),
    );
    expect(location.path, '/create');
    expect(location.queryParameters['prompt'], '中文提示词\n保留换行');
  });

  test('serializes uploaded image references in a chat run request', () {
    const reference = AssistantReferenceImage(
      id: 'asset-1',
      name: '产品正面图',
      fileKey: 'uploads/user-1/original/product.jpg',
      url: '/api/v1/files/uploads/user-1/thumb/product.jpg',
    );
    const input = CreateAssistantRunInput(
      conversationId: 'conversation-1',
      prompt: '分析这张图片',
      modelId: 'chat-pro',
      reasoningEffort: 'medium',
      idempotencyKey: 'request-1',
      referenceImages: [reference],
    );

    final json = input.toJson();
    expect(json['mode'], 'chat');
    expect(json['workspace'], 'assistant');
    expect(json.containsKey('quoted'), isFalse);
    expect(json['referenceImages'], [
      {
        'id': 'asset-1',
        'name': '产品正面图',
        'fileKey': 'uploads/user-1/original/product.jpg',
        'thumbnailUrl': '/api/v1/files/uploads/user-1/thumb/product.jpg',
      },
    ]);
  });

  test('serializes quoted reply in a chat run request', () {
    const input = CreateAssistantRunInput(
      conversationId: 'conversation-1',
      prompt: '继续解释',
      modelId: 'chat-pro',
      reasoningEffort: 'medium',
      idempotencyKey: 'request-2',
      quoted: AssistantQuotedMessage(
        id: 'assistant-1',
        kind: '回复',
        content: '这是一段可引用的回答',
      ),
    );

    expect(input.toJson()['quoted'], {
      'id': 'assistant-1',
      'kind': '回复',
      'content': '这是一段可引用的回答',
    });
  });

  test('serializes Agent mode and parses a creation proposal', () {
    const input = CreateAssistantRunInput(
      conversationId: 'conversation-agent',
      prompt: '规划一张未来城市海报',
      modelId: 'chat-pro',
      reasoningEffort: 'high',
      idempotencyKey: 'request-agent',
      mode: AssistantMode.agent,
    );
    final message = AssistantMessage.fromJson({
      'id': 'proposal-1',
      'role': 'assistant',
      'content': '方案已经整理完成',
      'kind': 'proposal',
      'status': 'complete',
      'proposal': {
        'action': 'generate',
        'prompt': '未来城市，雨夜，高对比电影光效',
        'planningSummary': '以纵深街道建立空间层次',
        'ratio': '3:4',
        'resolution': '2K',
        'count': 2,
        'modelName': '星云图像 Pro',
      },
    });

    expect(input.toJson()['mode'], 'agent');
    expect(message.kind, 'proposal');
    expect(message.proposal?.prompt, '未来城市，雨夜，高对比电影光效');
    expect(message.proposal?.summary, '以纵深街道建立空间层次');
    expect(message.proposal?.ratio, '3:4');
    expect(message.proposal?.resolution, '2K');
    expect(message.proposal?.count, 2);
    expect(message.proposal?.isUsable, isTrue);
  });

  testWidgets('Agent mode changes the task experience', (tester) async {
    late _ScreenAssistantController controller;
    await tester.pumpWidget(
      _screen(
        () => controller = _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('有什么可以帮你？'), findsOneWidget);
    await tester.tap(find.byKey(const Key('assistant-model')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-header-mode')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('assistant-header-mode-agent')));
    await tester.pumpAndSettle();

    expect(controller.state.requireValue.selectedMode, AssistantMode.agent);
    expect(find.text('交给 Agent 来完成'), findsOneWidget);
    await tester.tap(find.byKey(const Key('assistant-model')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-tools')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-open-quick-tasks')));
    await tester.pumpAndSettle();
    expect(find.text('海报方案'), findsWidgets);
    expect(find.text('品牌主视觉'), findsWidgets);
    expect(find.textContaining('文档'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  test('serializes a complete image run request and parses image output', () {
    const input = CreateAssistantRunInput(
      conversationId: 'conversation-image',
      prompt: '雨夜未来城市',
      modelId: 'image-pro',
      reasoningEffort: '',
      idempotencyKey: 'request-image',
      mode: AssistantMode.image,
      ratio: '3:4',
      resolution: '2K',
      count: 2,
      quality: 'high',
    );
    final message = AssistantMessage.fromJson({
      'id': 'image-message',
      'role': 'assistant',
      'content': '图片已生成',
      'kind': 'image',
      'status': 'complete',
      'images': [
        {
          'id': 'image-1',
          'fileKey': 'tasks/user/assistant/run/1.png',
          'dataUrl': '/api/v1/files/tasks/user/assistant/run/1.png',
          'displayUrl': '/api/v1/files/tasks/user/assistant/run/display/1.webp',
          'thumbUrl': '/api/v1/files/tasks/user/assistant/run/thumb/1.webp',
          'revisedPrompt': '雨夜未来城市，电影光效',
        },
      ],
    });

    expect(input.toJson(), containsPair('mode', 'image'));
    expect(input.toJson(), containsPair('model', 'image-pro'));
    expect(input.toJson(), containsPair('ratio', '3:4'));
    expect(input.toJson(), containsPair('resolution', '2K'));
    expect(input.toJson(), containsPair('count', 2));
    expect(input.toJson(), containsPair('quality', 'high'));
    expect(message.images, hasLength(1));
    expect(message.images.single.id, 'image-1');
    expect(message.images.single.thumbnailUrl, contains('/thumb/1.webp'));
    expect(message.images.single.downloadUrl, contains('/run/1.png'));
    expect(message.canUseAsCreationPrompt, isFalse);
  });

  testWidgets('image mode exposes model and generation settings', (
    tester,
  ) async {
    late _ScreenAssistantController controller;
    await tester.pumpWidget(
      _screen(
        () => controller = _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            selectedImageModelId: 'image-pro',
            imageResolution: '2K',
            imageRatio: 'auto',
            imageQuality: 'high',
            imageCount: 2,
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('assistant-model')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-header-mode')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('assistant-header-mode-image')));
    await tester.pumpAndSettle();
    expect(controller.state.requireValue.selectedMode, AssistantMode.image);
    expect(controller.state.requireValue.selectedModel?.id, 'image-pro');
    expect(find.byKey(const Key('assistant-header-reasoning')), findsNothing);
    expect(find.text('不适用'), findsNothing);
    expect(find.text('想生成什么图片？'), findsOneWidget);
    expect(find.textContaining('图片 · 星云图像 Pro'), findsOneWidget);

    await tester.tap(find.byKey(const Key('assistant-model')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-tools')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-mode-settings')));
    await tester.pumpAndSettle();
    expect(find.text('图片参数'), findsOneWidget);
    expect(find.text('分辨率'), findsOneWidget);
    expect(find.text('画面比例'), findsOneWidget);
    expect(find.text('生成张数'), findsOneWidget);
    expect(find.text('2 张'), findsOneWidget);
    await tester.ensureVisible(
      find.byKey(const Key('assistant-image-count-plus')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-image-count-plus')));
    await tester.pump();
    expect(controller.state.requireValue.imageCount, 3);
    expect(find.text('3 张'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('generated images render as an interactive result grid', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    const image = AssistantGeneratedImage(
      id: 'image-1',
      fileKey: 'tasks/user/assistant/run/1.png',
      url: '/api/v1/files/tasks/user/assistant/run/display/1.webp',
      thumbnailUrl: '/api/v1/files/tasks/user/assistant/run/thumb/1.webp',
      revisedPrompt: '雨夜未来城市，电影光效',
    );
    final conversation = AssistantConversation(
      id: 'conversation-image',
      title: '雨夜未来城市',
      messages: [
        _message('user-image', 'user', '生成雨夜未来城市'),
        _message(
          'assistant-image',
          'assistant',
          '图片已生成',
          kind: 'image',
          images: const [image],
        ),
      ],
      updatedAt: DateTime(2026, 8, 24, 10),
    );
    late _ScreenAssistantController controller;
    await tester.pumpWidget(
      _screen(
        textScale: 1.6,
        () => controller = _ScreenAssistantController(
          AssistantWorkspaceState(
            config: _config,
            conversations: [conversation],
            selectedConversationId: conversation.id,
            selectedModelId: 'chat-pro',
            selectedImageModelId: 'image-pro',
            imageResolution: '2K',
            imageRatio: 'auto',
            imageQuality: 'high',
            imageCount: 1,
            reasoningEffort: 'medium',
            activeRuns: const {},
            selectedMode: AssistantMode.chat,
          ),
        ),
      ),
    );
    await tester.pump();

    expect(
      find.byKey(const ValueKey('assistant-generated-image-image-1')),
      findsOneWidget,
    );
    final tile = find.byKey(
      const ValueKey('assistant-generated-image-image-1'),
    );
    tester
        .widget<InkWell>(
          find.descendant(of: tile, matching: find.byType(InkWell)),
        )
        .onTap!();
    await tester.pumpAndSettle();
    expect(find.byTooltip('关闭图片'), findsOneWidget);
    expect(find.byTooltip('继续编辑'), findsOneWidget);
    expect(find.byTooltip('保存图片'), findsOneWidget);
    expect(find.byTooltip('分享图片'), findsOneWidget);
    expect(find.byKey(const Key('assistant-use-for-creation')), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byTooltip('继续编辑'));
    await tester.pumpAndSettle();
    expect(controller.state.requireValue.selectedMode, AssistantMode.image);
    expect(find.byTooltip('关闭图片'), findsNothing);
    expect(find.byKey(const Key('assistant-reference-strip')), findsOneWidget);
    expect(
      find.byKey(const Key('assistant-remove-reference-0')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);

    controller.selectMode(AssistantMode.chat);
    await tester.pump();
    tester
        .widget<InkWell>(
          find.descendant(of: tile, matching: find.byType(InkWell)),
        )
        .onTap!();
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('继续编辑'));
    await tester.pumpAndSettle();
    expect(controller.state.requireValue.selectedMode, AssistantMode.image);
    expect(find.text('图片已在参考图中'), findsOneWidget);
    expect(
      find.byKey(const Key('assistant-remove-reference-0')),
      findsOneWidget,
    );
    expect(find.byKey(const Key('assistant-remove-reference-1')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Agent proposal is readable on a narrow large-text screen', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 780));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    const proposal = AssistantProposal(
      action: 'generate',
      prompt: '未来城市，雨夜，高对比电影光效',
      summary: '以纵深街道建立空间层次',
      ratio: '3:4',
      resolution: '2K',
      count: 2,
      modelName: '星云图像 Pro',
    );
    final conversation = AssistantConversation(
      id: 'conversation-agent',
      title: '未来城市海报',
      messages: [
        _message('user-agent', 'user', '规划一张未来城市海报'),
        _message(
          'assistant-agent',
          'assistant',
          '方案已经整理完成',
          kind: 'proposal',
          proposal: proposal,
        ),
      ],
      updatedAt: DateTime(2026, 8, 24, 10),
    );
    late _ScreenAssistantController controller;
    await tester.pumpWidget(
      _screen(
        textScale: 1.4,
        () => controller = _ScreenAssistantController(
          AssistantWorkspaceState(
            config: _config,
            conversations: [conversation],
            selectedConversationId: conversation.id,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: const {},
            selectedMode: AssistantMode.agent,
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('assistant-agent-proposal')), findsOneWidget);
    expect(
      find.byKey(const Key('assistant-use-agent-proposal')),
      findsOneWidget,
    );
    expect(find.text('未来城市，雨夜，高对比电影光效'), findsOneWidget);
    expect(find.textContaining('Agent · 星云对话 Pro'), findsOneWidget);
    expect(find.text('3:4'), findsOneWidget);
    expect(find.text('2K'), findsOneWidget);
    expect(find.text('2 张'), findsOneWidget);
    expect(find.byTooltip('复制回复'), findsNothing);
    expect(find.byTooltip('分享回复'), findsNothing);
    expect(find.byTooltip('带入文生图'), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.ensureVisible(
      find.byKey(const Key('assistant-edit-agent-prompt')),
    );
    await tester.tap(find.byKey(const Key('assistant-edit-agent-prompt')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('assistant-proposal-prompt-editor')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('assistant-cancel-proposal-prompt')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    final generate = find.byKey(const Key('assistant-use-agent-proposal'));
    await tester.ensureVisible(generate);
    await tester.pumpAndSettle();
    await tester.tap(generate);
    await tester.pumpAndSettle();
    expect(controller.proposalSourceMessageId, 'assistant-agent');
    expect(controller.submittedProposal?.prompt, proposal.prompt);
    expect(controller.submittedProposal?.modelId, 'image-pro');
    expect(tester.takeException(), isNull);
  });

  test('conversation search matches title and message terms together', () {
    final conversations = [
      AssistantConversation(
        id: 'product',
        title: '产品视觉分析',
        messages: [_message('m1', 'assistant', '建议强化色彩对比与包装层级')],
        updatedAt: DateTime(2026, 8, 24, 10),
      ),
      AssistantConversation(
        id: 'travel',
        title: 'Travel Poster',
        messages: [_message('m2', 'assistant', '海边日落构图')],
        updatedAt: DateTime(2026, 8, 24, 9),
      ),
    ];

    expect(
      filterAssistantConversations(
        conversations,
        ' 产品   色彩 ',
      ).map((item) => item.id),
      ['product'],
    );
    expect(
      filterAssistantConversations(
        conversations,
        'TRAVEL',
      ).map((item) => item.id),
      ['travel'],
    );
    expect(filterAssistantConversations(conversations, ''), conversations);
  });

  test(
    'first message creates conversation and polls to terminal reply',
    () async {
      final repository = _FakeAssistantRepository();
      addTearDown(repository.dispose);
      final container = ProviderContainer(
        overrides: [
          assistantRepositoryProvider.overrideWithValue(repository),
          assistantPollIntervalProvider.overrideWithValue(
            const Duration(milliseconds: 1),
          ),
        ],
      );
      addTearDown(container.dispose);
      final subscription = container.listen(
        assistantWorkspaceProvider,
        (_, _) {},
        fireImmediately: true,
      );
      addTearDown(subscription.close);

      await container.read(assistantWorkspaceProvider.future);
      await container
          .read(assistantWorkspaceProvider.notifier)
          .send('  帮我完善海报提示词  ');
      await Future<void>.delayed(const Duration(milliseconds: 20));

      final state = container.read(assistantWorkspaceProvider).requireValue;
      expect(repository.createConversationCount, 1);
      expect(repository.submitted?.conversationId, 'conversation-1');
      expect(repository.submitted?.prompt, '帮我完善海报提示词');
      expect(repository.submitted?.modelId, 'chat-pro');
      expect(repository.submitted?.reasoningEffort, 'medium');
      expect(repository.submitted?.idempotencyKey, isNotEmpty);
      expect(repository.runReads, 1);
      expect(state.selectedConversation?.title, '帮我完善海报提示词');
      expect(state.selectedConversation?.messages, hasLength(2));
      expect(state.selectedConversation?.messages.last.content, '这里是完整回复。');
      expect(state.activeRuns, isEmpty);
      expect(state.isSending, isFalse);
    },
  );

  test('new conversation reuses an unused empty thread', () async {
    final repository = _FakeAssistantRepository()
      ..initialConversations = [
        const AssistantConversation(
          id: 'empty-1',
          title: '新对话',
          messages: [],
          updatedAt: null,
        ),
        AssistantConversation(
          id: 'used-1',
          title: '海报讨论',
          messages: [_message('user-1', 'user', '你好')],
          updatedAt: DateTime(2026, 8, 25, 13),
        ),
      ];
    addTearDown(repository.dispose);
    final container = ProviderContainer(
      overrides: [assistantRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    final subscription = container.listen(
      assistantWorkspaceProvider,
      (_, _) {},
      fireImmediately: true,
    );
    addTearDown(subscription.close);

    await container.read(assistantWorkspaceProvider.future);
    final controller = container.read(assistantWorkspaceProvider.notifier);
    await controller.newConversation();
    await controller.newConversation();
    controller.selectConversation('used-1');
    await controller.newConversation();

    expect(repository.createConversationCount, 0);
    expect(
      container
          .read(assistantWorkspaceProvider)
          .requireValue
          .selectedConversationId,
      'empty-1',
    );
  });

  test('image mode submits selected image model and parameters', () async {
    final repository = _FakeAssistantRepository();
    addTearDown(repository.dispose);
    final container = ProviderContainer(
      overrides: [
        assistantRepositoryProvider.overrideWithValue(repository),
        assistantPollIntervalProvider.overrideWithValue(
          const Duration(days: 1),
        ),
      ],
    );
    addTearDown(container.dispose);
    final subscription = container.listen(
      assistantWorkspaceProvider,
      (_, _) {},
      fireImmediately: true,
    );
    addTearDown(subscription.close);

    await container.read(assistantWorkspaceProvider.future);
    final controller = container.read(assistantWorkspaceProvider.notifier);
    controller.selectMode(AssistantMode.image);
    controller.selectImageResolution('4K');
    controller.selectImageRatio('16:9');
    controller.selectImageQuality('high');
    controller.selectImageCount(3);
    await controller.send('生成一张雨夜未来城市');

    expect(repository.submitted?.mode, AssistantMode.image);
    expect(repository.submitted?.modelId, 'image-pro');
    expect(repository.submitted?.resolution, '4K');
    expect(repository.submitted?.ratio, '16:9');
    expect(repository.submitted?.quality, 'high');
    expect(repository.submitted?.count, 3);
  });

  test(
    'Agent proposal executes an image run in the current conversation',
    () async {
      const reference = AssistantReferenceImage(
        id: 'asset-1',
        name: '构图参考',
        fileKey: 'uploads/user/reference.jpg',
        url: '/api/v1/files/uploads/user/reference.jpg',
      );
      final repository = _FakeAssistantRepository()
        ..initialConversations = [
          AssistantConversation(
            id: 'conversation-1',
            title: '蓝天白云',
            messages: [
              _message(
                'user-source',
                'user',
                '生成一张蓝天白云图',
                referenceImages: const [reference],
              ),
              _message(
                'proposal-source',
                'assistant',
                '方案已准备好',
                kind: 'proposal',
                proposal: const AssistantProposal(
                  action: 'generate',
                  prompt: '晴朗蓝天，柔软白云，自然日光，通透空气感',
                  summary: '清爽自然的天空画面',
                  ratio: '16:9',
                  resolution: '4K',
                  count: 3,
                  modelId: 'image-pro',
                  modelName: '星云图像 Pro',
                  quality: 'high',
                ),
              ),
            ],
            updatedAt: DateTime(2026, 8, 24, 10),
          ),
        ];
      addTearDown(repository.dispose);
      final container = ProviderContainer(
        overrides: [
          assistantRepositoryProvider.overrideWithValue(repository),
          assistantPollIntervalProvider.overrideWithValue(
            const Duration(days: 1),
          ),
        ],
      );
      addTearDown(container.dispose);
      final subscription = container.listen(
        assistantWorkspaceProvider,
        (_, _) {},
        fireImmediately: true,
      );
      addTearDown(subscription.close);

      await container.read(assistantWorkspaceProvider.future);
      await container
          .read(assistantWorkspaceProvider.notifier)
          .executeProposal(
            sourceMessageId: 'proposal-source',
            proposal:
                repository.initialConversations.single.messages.last.proposal!,
            referenceImages: const [reference],
          );

      final input = repository.submitted!;
      expect(input.conversationId, 'conversation-1');
      expect(input.mode, AssistantMode.image);
      expect(input.modelId, 'image-pro');
      expect(input.ratio, '16:9');
      expect(input.resolution, '4K');
      expect(input.quality, 'high');
      expect(input.count, 3);
      expect(input.referenceImages, const [reference]);
      expect(input.toJson()['userMessageContent'], '执行这个创作方案');
      expect(input.toJson()['proposalSourceMessageId'], 'proposal-source');
    },
  );

  test(
    'SSE updates visible content before terminal polling snapshot',
    () async {
      final repository = _FakeAssistantRepository()..returnTerminalRun = false;
      addTearDown(repository.dispose);
      final container = ProviderContainer(
        overrides: [
          assistantRepositoryProvider.overrideWithValue(repository),
          assistantPollIntervalProvider.overrideWithValue(
            const Duration(days: 1),
          ),
        ],
      );
      addTearDown(container.dispose);
      final subscription = container.listen(
        assistantWorkspaceProvider,
        (_, _) {},
        fireImmediately: true,
      );
      addTearDown(subscription.close);

      await container.read(assistantWorkspaceProvider.future);
      await container
          .read(assistantWorkspaceProvider.notifier)
          .send('实时分析这张图片');
      repository.streamController.add(
        const AssistantStreamEvent(
          content: '正在形成第一段回复',
          reasoning: '先识别画面主体',
          kind: 'chat',
          stage: 'answering',
          done: false,
          status: '',
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 10));

      var state = container.read(assistantWorkspaceProvider).requireValue;
      expect(state.selectedConversation?.messages.last.content, '正在形成第一段回复');
      expect(state.selectedConversation?.messages.last.reasoning, '先识别画面主体');
      expect(state.selectedRun?.stage, 'answering');
      expect(state.selectedRunIsLive, isTrue);

      repository.streamController.add(
        const AssistantStreamEvent(
          content: '旧',
          reasoning: '',
          kind: 'chat',
          stage: 'answering',
          done: false,
          status: '',
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 10));
      state = container.read(assistantWorkspaceProvider).requireValue;
      expect(state.selectedConversation?.messages.last.content, '正在形成第一段回复');

      repository.returnTerminalRun = true;
      repository.streamController.add(
        const AssistantStreamEvent(
          content: '这是最终的完整回复。',
          reasoning: '先识别画面主体，再整理视觉建议。',
          kind: 'chat',
          stage: 'answering',
          done: true,
          status: 'succeeded',
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 20));

      state = container.read(assistantWorkspaceProvider).requireValue;
      expect(state.activeRuns, isEmpty);
      expect(state.liveRunIds, isEmpty);
      expect(state.selectedConversation?.messages.last.content, '这是最终的完整回复。');
    },
  );

  testWidgets('empty assistant suggestion fills and sends composer', (
    tester,
  ) async {
    late _ScreenAssistantController controller;
    await tester.pumpWidget(
      _screen(
        () => controller = _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('有什么可以帮你？'), findsOneWidget);
    await tester.tap(find.byKey(const Key('assistant-tools')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-open-quick-tasks')));
    await tester.pumpAndSettle();
    expect(find.text('优化提示词'), findsWidgets);
    expect(find.text('分析画面'), findsWidgets);
    expect(find.text('创意方向'), findsWidgets);
    expect(find.text('作品文案'), findsWidgets);
    expect(find.byKey(const Key('assistant-history')), findsOneWidget);
    expect(find.byKey(const Key('assistant-new')), findsOneWidget);
    await tester.tap(find.byKey(const Key('assistant-quick-task-0')));
    await tester.pump();
    const suggestedPrompt = '帮我把这段图片提示词优化得更具体，并补充构图、光线、色彩和材质细节。';
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('assistant-composer')))
          .controller
          ?.text,
      suggestedPrompt,
    );
    await tester.tap(find.byKey(const Key('assistant-send')));
    await tester.pumpAndSettle();

    expect(controller.sendCount, 1);
    expect(controller.sentValue, suggestedPrompt);
  });

  testWidgets('incoming creation prompt is prefilled without sending', (
    tester,
  ) async {
    late _ScreenAssistantController controller;
    const prompt = '请优化以下文生图提示词：\n\n雨夜霓虹街道，电影感构图';
    await tester.pumpWidget(
      _screen(
        () => controller = _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
        initialPrompt: prompt,
      ),
    );
    await tester.pump();

    final composer = tester.widget<TextField>(
      find.byKey(const Key('assistant-composer')),
    );
    expect(composer.controller?.text, prompt);
    expect(find.byKey(const Key('assistant-send')), findsOneWidget);
    expect(controller.sendCount, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('conversation history searches and clears on narrow large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final conversations = [
      AssistantConversation(
        id: 'active',
        title: '正在分析海报创意',
        messages: [_message('active-user', 'user', '分析构图层次')],
        updatedAt: DateTime(2026, 8, 24, 11),
      ),
      AssistantConversation(
        id: 'product',
        title: '产品视觉分析',
        messages: [_message('product-reply', 'assistant', '建议强化色彩对比')],
        updatedAt: DateTime(2026, 8, 24, 10),
      ),
      AssistantConversation(
        id: 'travel',
        title: '旅行文案',
        messages: [_message('travel-reply', 'assistant', '海边日落')],
        updatedAt: DateTime(2026, 8, 24, 9),
      ),
    ];
    const activeRun = AssistantRun(
      id: 'run-active',
      conversationId: 'active',
      status: 'queued',
      stage: 'queued',
      errorMessage: '',
      costPoints: 0,
    );
    await tester.pumpWidget(
      _screen(
        textScale: 1.6,
        () => _ScreenAssistantController(
          AssistantWorkspaceState(
            config: _config,
            conversations: conversations,
            selectedConversationId: 'active',
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: const {'active': activeRun},
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-history')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.byKey(const Key('assistant-history-search')), findsOneWidget);
    expect(find.text('历史'), findsOneWidget);
    expect(find.text('资料库'), findsNothing);
    expect(find.byKey(const Key('assistant-history-filters')), findsOneWidget);
    expect(
      find.byKey(const Key('assistant-history-filter-全部')),
      findsOneWidget,
    );
    expect(find.text('对话记录'), findsNothing);
    expect(find.text('3 段对话'), findsNothing);
    expect(find.text('产品视觉分析'), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('assistant-history-search')),
      '产品 色彩',
    );
    await tester.pump();
    expect(find.text('产品视觉分析'), findsOneWidget);
    final historyDrawer = find.byKey(const Key('assistant-history-drawer'));
    expect(historyDrawer, findsOneWidget);
    expect(find.byType(BottomSheet), findsNothing);
    expect(
      find.descendant(of: historyDrawer, matching: find.text('正在分析海报创意')),
      findsNothing,
    );
    expect(
      find.descendant(of: historyDrawer, matching: find.text('旅行文案')),
      findsNothing,
    );

    await tester.tap(find.byKey(const Key('assistant-history-search-clear')));
    await tester.pump();
    expect(find.text('旅行文案'), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('assistant-history-search')),
      '不存在的会话',
    );
    await tester.pump();
    expect(find.text('没有匹配的对话'), findsOneWidget);
    expect(find.text('“不存在的会话”'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('history filters conversations by date group', (tester) async {
    final now = DateTime.now();
    await tester.pumpWidget(
      _screen(
        () => _ScreenAssistantController(
          AssistantWorkspaceState(
            config: _config,
            conversations: [
              AssistantConversation(
                id: 'today',
                title: '今日海报方案',
                messages: [_message('today-msg', 'user', '做一张海报')],
                updatedAt: now,
              ),
              AssistantConversation(
                id: 'earlier',
                title: '上周配色讨论',
                messages: [_message('earlier-msg', 'user', '调整配色')],
                updatedAt: now.subtract(const Duration(days: 10)),
              ),
            ],
            selectedConversationId: 'today',
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: const {},
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-history')));
    await tester.pumpAndSettle();

    expect(find.text('今日海报方案'), findsOneWidget);
    expect(find.text('上周配色讨论'), findsOneWidget);

    await tester.tap(find.byKey(const Key('assistant-history-filter-较早')));
    await tester.pump();
    expect(find.text('今日海报方案'), findsNothing);
    expect(find.text('上周配色讨论'), findsOneWidget);

    await tester.tap(find.byKey(const Key('assistant-history-filter-今天')));
    await tester.pump();
    expect(find.text('今日海报方案'), findsOneWidget);
    expect(find.text('上周配色讨论'), findsNothing);

    await tester.tap(find.byKey(const Key('assistant-history-filter-已置顶')));
    await tester.pump();
    expect(find.text('暂无记录'), findsOneWidget);

    await tester.tap(find.byKey(const Key('assistant-history-filter-全部')));
    await tester.pump();
    expect(find.text('今日海报方案'), findsOneWidget);
    expect(find.text('上周配色讨论'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('history drawer can be pulled open from the left edge', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _screen(
        () => _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.flingFrom(const Offset(8, 360), const Offset(280, 0), 1200);
    await tester.pumpAndSettle();

    final drawer = find.byKey(const Key('assistant-history-drawer'));
    expect(drawer, findsOneWidget);
    expect(tester.getTopLeft(drawer).dx, closeTo(0, 1));
    expect(find.byKey(const Key('assistant-history-search')), findsOneWidget);
    expect(find.byKey(const Key('assistant-sheet-new')), findsOneWidget);
    expect(find.text('历史'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('history drawer covers the shell bottom navigation', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          assistantWorkspaceProvider.overrideWith(
            () => _ScreenAssistantController(
              const AssistantWorkspaceState(
                config: _config,
                conversations: [],
                selectedConversationId: null,
                selectedModelId: 'chat-pro',
                reasoningEffort: 'medium',
                activeRuns: {},
              ),
            ),
          ),
          assistantDraftStoreProvider.overrideWithValue(
            _FakeAssistantDraftStore(),
          ),
          walletProvider.overrideWith(
            (ref) async => const WalletSnapshot(
              availablePoints: 100,
              frozenPoints: 0,
              trialPoints: 0,
            ),
          ),
        ],
        child: MaterialApp(
          theme: StarCloudsTheme.light(),
          home: const AppSidebarScaffold(
            drawerEnabled: false,
            body: AssistantScreen(),
            bottomNavigationBar: SizedBox(
              key: Key('test-bottom-navigation'),
              height: 64,
              width: double.infinity,
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-history')));
    await tester.pumpAndSettle();

    final drawer = tester.getRect(
      find.byKey(const Key('assistant-history-drawer')),
    );
    final navigation = tester.getRect(
      find.byKey(const Key('test-bottom-navigation')),
    );
    expect(drawer.bottom, greaterThanOrEqualTo(navigation.bottom));
    expect(tester.takeException(), isNull);
  });

  testWidgets('switching conversations does not animate the thread', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _ScreenAssistantController controller;
    const body = '一段足够长的对话内容，用来撑开消息列表并避免切换时整页滚动。';
    AssistantConversation thread(String id) => AssistantConversation(
      id: id,
      title: id,
      messages: [
        for (var index = 0; index < 10; index += 1)
          _message('$id-$index', index.isEven ? 'user' : 'assistant', body),
      ],
      updatedAt: DateTime(2026, 8, 25, 13),
    );
    await tester.pumpWidget(
      _screen(
        () => controller = _ScreenAssistantController(
          AssistantWorkspaceState(
            config: _config,
            conversations: [thread('first'), thread('second')],
            selectedConversationId: 'first',
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: const {},
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    controller.selectConversation('second');
    await tester.pump();
    await tester.pump();

    final position = tester
        .widget<ListView>(find.byKey(const Key('assistant-messages')))
        .controller!
        .position;
    expect(position.activity?.isScrolling, isNot(isTrue));
    expect(position.pixels, greaterThan(position.maxScrollExtent - 8));
    expect(tester.takeException(), isNull);
  });

  testWidgets('current conversation can be renamed from history', (
    tester,
  ) async {
    late _ScreenAssistantController controller;
    const conversation = AssistantConversation(
      id: 'conversation-rename',
      title: '视觉方案讨论',
      messages: [
        AssistantMessage(
          id: 'rename-message',
          role: 'user',
          content: '继续讨论视觉方案',
          kind: 'chat',
          status: 'complete',
          createdAt: null,
        ),
      ],
      updatedAt: null,
    );
    await tester.pumpWidget(
      _screen(
        () => controller = _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [conversation],
            selectedConversationId: 'conversation-rename',
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('assistant-history')));
    await tester.pumpAndSettle();
    await tester.longPress(find.text('视觉方案讨论'));
    await tester.pumpAndSettle();
    expect(find.text('重命名'), findsOneWidget);
    expect(find.text('置顶'), findsOneWidget);
    expect(find.text('多选'), findsOneWidget);
    expect(find.text('删除'), findsOneWidget);
    await tester.tap(
      find.byKey(
        const ValueKey('assistant-history-rename-conversation-rename'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('assistant-rename-field')),
      '秋季新品创意',
    );
    await tester.tap(find.byKey(const Key('assistant-rename-confirm')));
    await tester.pumpAndSettle();

    expect(controller.renamedTitle, '秋季新品创意');
    expect(find.text('秋季新品创意'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('history long-press can pin and multi-select conversations', (
    tester,
  ) async {
    late _ScreenAssistantController controller;
    const older = AssistantConversation(
      id: 'older',
      title: '旅行文案',
      messages: [
        AssistantMessage(
          id: 'older-msg',
          role: 'user',
          content: '写一段旅行文案',
          kind: 'chat',
          status: 'complete',
          createdAt: null,
        ),
      ],
      updatedAt: null,
    );
    const newer = AssistantConversation(
      id: 'newer',
      title: '视觉方案讨论',
      messages: [
        AssistantMessage(
          id: 'newer-msg',
          role: 'user',
          content: '继续讨论视觉方案',
          kind: 'chat',
          status: 'complete',
          createdAt: null,
        ),
      ],
      updatedAt: null,
    );
    await tester.pumpWidget(
      _screen(
        () => controller = _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [older, newer],
            selectedConversationId: 'older',
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-history')));
    await tester.pumpAndSettle();
    expect(
      tester.getTopLeft(find.text('旅行文案')).dy <
          tester.getTopLeft(find.text('视觉方案讨论')).dy,
      isTrue,
    );

    await tester.longPress(find.text('视觉方案讨论'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('assistant-history-pin-newer')));
    await tester.pumpAndSettle();
    expect(controller.pinnedToggles, ['newer']);
    expect(
      tester.getTopLeft(find.text('视觉方案讨论')).dy <
          tester.getTopLeft(find.text('旅行文案')).dy,
      isTrue,
    );

    await tester.longPress(find.text('旅行文案'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('assistant-history-select-older')),
    );
    await tester.pumpAndSettle();
    expect(find.text('已选 1 项'), findsOneWidget);
    expect(find.byKey(const Key('assistant-history-search')), findsNothing);
    await tester.tap(find.text('视觉方案讨论'));
    await tester.pump();
    expect(find.text('已选 2 项'), findsOneWidget);
    await tester.tap(find.byKey(const Key('assistant-history-batch-delete')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '删除'));
    await tester.pumpAndSettle();
    expect(controller.deletedIds, ['newer', 'older']);
    expect(find.text('暂无对话记录'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('insufficient balance blocks assistant send before submission', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _ScreenAssistantController controller;
    await tester.pumpWidget(
      _screen(
        textScale: 1.6,
        availablePoints: 4,
        () => controller = _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.enterText(
      find.byKey(const Key('assistant-composer')),
      '帮我优化这段提示词',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-send')));
    await tester.pumpAndSettle();

    expect(find.text('本次对话积分不足'), findsOneWidget);
    expect(find.text('当前可用'), findsOneWidget);
    expect(find.text('4 积分'), findsNWidgets(2));
    expect(find.text('本次需要'), findsOneWidget);
    expect(find.text('8 积分'), findsOneWidget);
    expect(find.text('还差'), findsOneWidget);
    expect(find.text('查看钱包'), findsOneWidget);
    expect(controller.sendCount, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('active conversation fits narrow large text and can stop', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _ScreenAssistantController controller;
    final conversation = AssistantConversation(
      id: 'conversation-1',
      title: '海报创意分析',
      messages: [
        _message(
          'user-1',
          'user',
          '请分析这个海报创意。',
          referenceImages: const [
            AssistantReferenceImage(
              name: '海报参考图',
              fileKey: 'uploads/user-1/original/poster.jpg',
              url: '',
            ),
          ],
        ),
        _message(
          'assistant-1',
          'assistant',
          '我正在从构图、颜色和信息层级三个方向整理建议。',
          status: 'running',
          reasoning: '先确认信息层级，再比较视觉焦点。',
        ),
      ],
      updatedAt: DateTime(2026, 8, 24, 10),
    );
    const run = AssistantRun(
      id: 'run-1',
      conversationId: 'conversation-1',
      status: 'running',
      stage: 'thinking',
      errorMessage: '',
      costPoints: 0,
    );
    await tester.pumpWidget(
      _screen(
        textScale: 1.6,
        () => controller = _ScreenAssistantController(
          AssistantWorkspaceState(
            config: _config,
            conversations: [conversation],
            selectedConversationId: 'conversation-1',
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: const {'conversation-1': run},
            liveRunIds: const {'run-1'},
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.textContaining('问答 · 星云对话 Pro'), findsOneWidget);
    expect(find.text('正在思考'), findsWidgets);
    expect(find.text('实时'), findsNothing);
    expect(find.byKey(const Key('assistant-stop')), findsOneWidget);
    expect(find.byKey(const Key('assistant-send-busy')), findsNothing);
    expect(find.byKey(const Key('assistant-voice')), findsNothing);
    await tester.drag(
      find.byKey(const Key('assistant-messages')),
      const Offset(0, -180),
    );
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('先确认信息层级'), findsOneWidget);
    expect(find.text('请分析这个海报创意。'), findsOneWidget);
    expect(find.textContaining('构图、颜色和信息层级'), findsOneWidget);
    expect(find.bySemanticsLabel('海报参考图'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const Key('assistant-stop')));
    await tester.pump();
    expect(controller.stopCount, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reference strip fits narrow large text and removes one image', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 220));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var removed = -1;
    final references = List.generate(
      4,
      (index) => ReferenceImageDraft(
        localPath: '',
        filename: '参考图片 ${index + 1}',
        remoteKey: 'uploads/user/reference-$index.jpg',
        remoteUrl: '',
      ),
    );
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(12),
              child: AssistantReferenceStrip(
                references: references,
                busy: false,
                onRemove: (index) => removed = index,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('assistant-reference-strip')), findsOneWidget);
    expect(find.byTooltip('移除参考图片 1'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byKey(const Key('assistant-remove-reference-0')));
    expect(removed, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('completed reply actions fit narrow text and copy content', (
    tester,
  ) async {
    String? clipboardText;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          clipboardText = (call.arguments as Map)['text']?.toString();
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final conversation = AssistantConversation(
      id: 'conversation-1',
      title: '完善创作提示词',
      messages: [
        _message('user-1', 'user', '请完善这段图片提示词。'),
        _message(
          'assistant-1',
          'assistant',
          '**电影感产品摄影**\n\n- 柔和侧光\n- 主体居中\n- 细节清晰',
          usage: const AssistantUsage(
            inputTokens: 3812,
            outputTokens: 1204,
            firstTokenMs: 620,
            durationMs: 12400,
          ),
          costPoints: 8,
        ),
      ],
      updatedAt: DateTime(2026, 8, 24, 10),
    );
    await tester.pumpWidget(
      _screen(
        textScale: 1.6,
        () => _ScreenAssistantController(
          AssistantWorkspaceState(
            config: _config,
            conversations: [conversation],
            selectedConversationId: 'conversation-1',
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: const {},
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byTooltip('复制回复'), findsOneWidget);
    expect(find.byTooltip('分享回复'), findsOneWidget);
    expect(find.byTooltip('重新提问'), findsOneWidget);
    expect(find.byTooltip('引用'), findsOneWidget);
    expect(find.byTooltip('带入文生图'), findsNothing);
    expect(find.byKey(const Key('assistant-copy-reply')), findsOneWidget);
    expect(find.byKey(const Key('assistant-share-reply')), findsOneWidget);
    expect(find.byKey(const Key('assistant-retry-message')), findsOneWidget);
    expect(find.byKey(const Key('assistant-quote-reply')), findsOneWidget);
    expect(find.byKey(const Key('assistant-use-for-creation')), findsNothing);
    expect(
      find.byKey(const Key('assistant-reply-metrics-assistant-1')),
      findsOneWidget,
    );
    expect(find.textContaining('消耗 1.2K'), findsOneWidget);
    expect(find.textContaining('输入 3.8K'), findsOneWidget);
    expect(find.textContaining('8 积分'), findsOneWidget);
    expect(find.textContaining('12.4s'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.ensureVisible(find.byKey(const Key('assistant-copy-reply')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-copy-reply')));
    await tester.pumpAndSettle();
    expect(clipboardText, '**电影感产品摄影**\n\n- 柔和侧光\n- 主体居中\n- 细节清晰');
    expect(find.text('已复制助手回复'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('quoting a reply sends the quote with the next message', (
    tester,
  ) async {
    late _ScreenAssistantController controller;
    final conversation = AssistantConversation(
      id: 'conversation-quote',
      title: '引用测试',
      messages: [
        _message('quote-user', 'user', '原始问题'),
        _message('quote-assistant', 'assistant', '这是一段可引用的回答'),
      ],
      updatedAt: DateTime(2026, 8, 24, 10),
    );
    await tester.pumpWidget(
      _screen(
        () => controller = _ScreenAssistantController(
          AssistantWorkspaceState(
            config: _config,
            conversations: [conversation],
            selectedConversationId: conversation.id,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: const {},
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.ensureVisible(find.byKey(const Key('assistant-quote-reply')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-quote-reply')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('assistant-composer-quote')), findsOneWidget);
    expect(find.textContaining('[回复] 这是一段可引用的回答'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('assistant-composer')), '继续解释');
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-send')));
    await tester.pumpAndSettle();

    expect(controller.sendCount, 1);
    expect(controller.sentValue, '继续解释');
    expect(controller.sentQuoted?.id, 'quote-assistant');
    expect(controller.sentQuoted?.kind, '回复');
    expect(controller.sentQuoted?.content, '这是一段可引用的回答');
    expect(tester.takeException(), isNull);
  });

  testWidgets('conversation quick task and user reuse refill the composer', (
    tester,
  ) async {
    final conversation = AssistantConversation(
      id: 'conversation-tools',
      title: '品牌海报讨论',
      messages: [
        _message('user-tools', 'user', '帮我分析这张品牌海报。'),
        _message('assistant-tools', 'assistant', '可以先从视觉焦点开始。'),
      ],
      updatedAt: DateTime(2026, 8, 24, 10),
    );
    await tester.pumpWidget(
      _screen(
        () => _ScreenAssistantController(
          AssistantWorkspaceState(
            config: _config,
            conversations: [conversation],
            selectedConversationId: conversation.id,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: const {},
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('assistant-tools')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-open-quick-tasks')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-quick-task-0')));
    await tester.pumpAndSettle();
    var composer = tester.widget<TextField>(
      find.byKey(const Key('assistant-composer')),
    );
    expect(composer.controller?.text, contains('补充构图、光线、色彩和材质'));

    await tester.enterText(find.byKey(const Key('assistant-composer')), '');
    await tester.pump();
    await tester.ensureVisible(
      find.byKey(const Key('assistant-reuse-user-tools')),
    );
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.byKey(const Key('assistant-reuse-user-tools')));
    await tester.pumpAndSettle();
    composer = tester.widget<TextField>(
      find.byKey(const Key('assistant-composer')),
    );
    expect(composer.controller?.text, '帮我分析这张品牌海报。');
    expect(find.text('已恢复上一次提问'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'assistant markdown is selectable and safe on narrow large text',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 780));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final conversation = AssistantConversation(
        id: 'conversation-markdown',
        title: '结构化视觉建议',
        messages: [
          _message('user-markdown', 'user', '请给出结构化建议。'),
          _message(
            'assistant-markdown',
            'assistant',
            '## 优化方向\n\n'
                '- **主体**：保持清晰\n'
                '- **光线**：使用柔和侧光\n\n'
                '> 保留品牌文字与产品结构\n\n'
                '```text\nnegative_prompt: blur\n```\n\n'
                '![外部预览](https://example.com/preview.png)',
          ),
        ],
        updatedAt: DateTime(2026, 8, 24, 10),
      );
      await tester.pumpWidget(
        _screen(
          textScale: 1.6,
          () => _ScreenAssistantController(
            AssistantWorkspaceState(
              config: _config,
              conversations: [conversation],
              selectedConversationId: conversation.id,
              selectedModelId: 'chat-pro',
              reasoningEffort: 'medium',
              activeRuns: const {},
            ),
          ),
        ),
      );
      await tester.pump();

      final markdown = tester.widget<MarkdownBody>(find.byType(MarkdownBody));
      expect(markdown.selectable, isTrue);
      expect(markdown.fitContent, isFalse);
      expect(markdown.styleSheet?.codeblockDecoration, isNotNull);
      expect(find.text('**主体**：保持清晰'), findsNothing);
      expect(find.text('优化方向', findRichText: true), findsOneWidget);
      expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
      expect(find.text('外部预览'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('stopped reply restores the last user prompt and references', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _ScreenAssistantController controller;
    final draftStore = _FakeAssistantDraftStore();
    final conversation = AssistantConversation(
      id: 'conversation-1',
      title: '分析产品视觉',
      messages: [
        _message(
          'user-1',
          'user',
          '分析参考图并给出三条视觉建议。',
          referenceImages: const [
            AssistantReferenceImage(
              id: 'asset-1',
              name: '产品正面图',
              fileKey: 'uploads/user/product.jpg',
              url: '/api/v1/files/uploads/user/product-thumb.jpg',
            ),
          ],
        ),
        _message('assistant-1', 'assistant', '用户已主动停止生成', status: 'stopped'),
      ],
      updatedAt: DateTime(2026, 8, 24, 10),
    );
    await tester.pumpWidget(
      _screen(
        textScale: 1.6,
        draftStore: draftStore,
        () => controller = _ScreenAssistantController(
          AssistantWorkspaceState(
            config: _config,
            conversations: [conversation],
            selectedConversationId: 'conversation-1',
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: const {},
          ),
        ),
      ),
    );
    await tester.pump();

    await tester.drag(
      find.byKey(const Key('assistant-messages')),
      const Offset(0, -180),
    );
    await tester.pumpAndSettle();
    expect(find.byTooltip('重新提问'), findsOneWidget);
    expect(find.byTooltip('复制回复'), findsNothing);
    expect(find.byTooltip('带入文生图'), findsNothing);
    await tester.ensureVisible(
      find.byKey(const Key('assistant-retry-message')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('assistant-retry-message')));
    await tester.pumpAndSettle();

    final composer = tester.widget<TextField>(
      find.byKey(const Key('assistant-composer')),
    );
    expect(composer.controller?.text, '分析参考图并给出三条视觉建议。');
    expect(find.text('参考图 1/4'), findsOneWidget);
    expect(find.text('已恢复上一次提问'), findsOneWidget);
    expect(draftStore.writeCount, 1);
    expect(draftStore.draft?.prompt, '分析参考图并给出三条视觉建议。');
    expect(
      draftStore.draft?.references.single.remoteKey,
      'uploads/user/product.jpg',
    );
    expect(controller.sendCount, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('restores an unsent draft and fits narrow large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final draftStore = _FakeAssistantDraftStore(
      draft: AssistantDraft(
        prompt: '继续完善这段产品摄影提示词',
        references: const [
          ReferenceImageDraft(
            localPath: '',
            filename: '产品正面图',
            remoteKey: 'uploads/user/product.jpg',
            remoteUrl: '',
          ),
        ],
        updatedAt: DateTime(2026, 8, 24, 12),
      ),
    );

    await tester.pumpWidget(
      _screen(
        textScale: 1.6,
        draftStore: draftStore,
        () => _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();

    final composer = tester.widget<TextField>(
      find.byKey(const Key('assistant-composer')),
    );
    expect(composer.controller?.text, '继续完善这段产品摄影提示词');
    expect(find.text('参考图 1/4'), findsOneWidget);
    expect(find.byKey(const Key('assistant-draft-status')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('composer text saves after the draft debounce', (tester) async {
    final draftStore = _FakeAssistantDraftStore();
    await tester.pumpWidget(
      _screen(
        draftStore: draftStore,
        () => _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('assistant-composer')),
      '一段尚未发送的提示词',
    );
    await tester.pump();
    expect(find.byKey(const Key('assistant-draft-status')), findsNothing);
    await tester.pump(const Duration(milliseconds: 599));
    expect(draftStore.writeCount, 0);
    await tester.pump(const Duration(milliseconds: 1));
    await tester.pump();

    expect(draftStore.writeCount, 1);
    expect(draftStore.draft?.prompt, '一段尚未发送的提示词');
    expect(find.byKey(const Key('assistant-draft-status')), findsNothing);
  });

  testWidgets('restored references follow the selected model limit', (
    tester,
  ) async {
    const limitedModel = AssistantModelOption(
      id: 'chat-limited',
      label: '单参考图模型',
      description: '',
      pricePoints: 3,
      standardPricePoints: 3,
      reasoningEfforts: [],
      defaultReasoningEffort: '',
      isDefault: true,
      maxReferenceImages: 1,
    );
    final draftStore = _FakeAssistantDraftStore(
      draft: AssistantDraft(
        prompt: '只保留模型允许的参考图',
        references: const [
          ReferenceImageDraft(
            localPath: '',
            filename: '参考图一',
            remoteKey: 'uploads/user/one.jpg',
          ),
          ReferenceImageDraft(
            localPath: '',
            filename: '参考图二',
            remoteKey: 'uploads/user/two.jpg',
          ),
        ],
        updatedAt: DateTime(2026, 8, 24, 12),
      ),
    );
    await tester.pumpWidget(
      _screen(
        draftStore: draftStore,
        () => _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: AssistantConfig(
              models: [limitedModel],
              defaultModelId: 'chat-limited',
            ),
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-limited',
            reasoningEffort: '',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('参考图 1/1'), findsOneWidget);
    expect(draftStore.draft?.references, hasLength(1));
    expect(draftStore.draft?.references.single.filename, '参考图一');
  });

  testWidgets('incoming creation prompt replaces an older assistant draft', (
    tester,
  ) async {
    final draftStore = _FakeAssistantDraftStore(
      draft: AssistantDraft(
        prompt: '旧草稿',
        references: const [
          ReferenceImageDraft(
            localPath: '',
            filename: '旧参考图',
            remoteKey: 'uploads/user/old.jpg',
          ),
        ],
        updatedAt: DateTime(2026, 8, 24, 11),
      ),
    );
    await tester.pumpWidget(
      _screen(
        initialPrompt: '从文生图带入的新提示词',
        draftStore: draftStore,
        () => _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();

    final composer = tester.widget<TextField>(
      find.byKey(const Key('assistant-composer')),
    );
    expect(composer.controller?.text, '从文生图带入的新提示词');
    expect(find.byKey(const Key('assistant-reference-strip')), findsNothing);
    expect(draftStore.clearCount, 1);
    expect(draftStore.draft?.prompt, '从文生图带入的新提示词');
    expect(draftStore.draft?.references, isEmpty);
  });

  testWidgets('erasing a restored draft clears local unsent content', (
    tester,
  ) async {
    final draftStore = _FakeAssistantDraftStore(
      draft: AssistantDraft(
        prompt: '准备清除的草稿',
        references: const [],
        updatedAt: DateTime(2026, 8, 24, 12),
      ),
    );
    await tester.pumpWidget(
      _screen(
        draftStore: draftStore,
        () => _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('assistant-composer')), '');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump();

    final composer = tester.widget<TextField>(
      find.byKey(const Key('assistant-composer')),
    );
    expect(composer.controller?.text, isEmpty);
    expect(find.byKey(const Key('assistant-draft-status')), findsNothing);
    expect(draftStore.clearCount, 1);
  });

  testWidgets('successful assistant send clears the unsent draft', (
    tester,
  ) async {
    final draftStore = _FakeAssistantDraftStore();
    late _ScreenAssistantController controller;
    await tester.pumpWidget(
      _screen(
        draftStore: draftStore,
        () => controller = _ScreenAssistantController(
          const AssistantWorkspaceState(
            config: _config,
            conversations: [],
            selectedConversationId: null,
            selectedModelId: 'chat-pro',
            reasoningEffort: 'medium',
            activeRuns: {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('assistant-composer')),
      '发送后不应恢复这条消息',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('assistant-send')));
    await tester.pumpAndSettle();

    expect(controller.sendCount, 1);
    expect(draftStore.clearCount, 1);
    expect(draftStore.draft, isNull);
    expect(find.byKey(const Key('assistant-draft-status')), findsNothing);
  });
}
