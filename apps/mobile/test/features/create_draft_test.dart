import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/widgets/app_chrome.dart';
import 'package:starcloudsai_mobile/core/widgets/authenticated_image.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/create/create.dart';
import 'package:starcloudsai_mobile/features/create/create_screen.dart';
import 'package:starcloudsai_mobile/features/create/creation_draft.dart';
import 'package:starcloudsai_mobile/features/create/reference_image_service.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';

class _FakeSessionController extends SessionController {
  _FakeSessionController({this.authenticated = false});

  final bool authenticated;

  @override
  SessionState build() => SessionState(
    user: authenticated
        ? const AppUser(
            id: 'user-1',
            email: 'mobileqa@gmail.com',
            username: '星空用户',
          )
        : null,
  );
}

class _FakeDraftStore implements CreationDraftStore {
  _FakeDraftStore([this.draft]);

  CreationDraft? draft;
  final List<CreationDraft> writes = [];
  int clearCount = 0;

  @override
  Future<CreationDraft?> read() async => draft;

  @override
  Future<void> write(CreationDraft draft) async {
    this.draft = draft;
    writes.add(draft);
  }

  @override
  Future<void> clear() async {
    draft = null;
    clearCount += 1;
  }
}

const _models = [
  ImageModelOption(
    id: 'fast',
    name: '快速模型',
    description: '',
    resolutions: ['1K'],
    aspectRatios: ['auto', '1:1'],
    qualities: ['medium'],
    maxImages: 2,
    maxReferenceImages: 0,
    pricePoints: 0,
  ),
  ImageModelOption(
    id: 'pro',
    name: '高级模型',
    description: '',
    resolutions: ['1K', '2K'],
    aspectRatios: ['auto', '16:9'],
    qualities: ['medium', 'high'],
    maxImages: 4,
    maxReferenceImages: 0,
    pricePoints: 3,
  ),
];

class _FakeCreateTaskCenter extends TaskCenterController {
  _FakeCreateTaskCenter(this.items);

  final List<TaskItem> items;

  @override
  Future<TaskCenterState> build() async => TaskCenterState(items: items);
}

Widget _app(
  _FakeDraftStore store, {
  String? initialPrompt,
  CreationPreset? initialPreset,
  ReferenceImageDraft? initialReference,
  List<ImageModelOption> models = _models,
  List<TaskItem> tasks = const [],
  bool authenticated = false,
  double textScale = 1,
  TaskCenterController Function()? taskCenter,
}) => ProviderScope(
  overrides: [
    creationDraftStoreProvider.overrideWithValue(store),
    runtimeCreationConfigProvider.overrideWith(
      (ref) async => RuntimeCreationConfig(enabled: true, models: models),
    ),
    sessionControllerProvider.overrideWith(
      () => _FakeSessionController(authenticated: authenticated),
    ),
    taskListProvider.overrideWith((ref) async => tasks),
    taskCenterControllerProvider.overrideWith(
      () => taskCenter?.call() ?? _FakeCreateTaskCenter(tasks),
    ),
  ],
  child: MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: CreateScreen(
      initialPrompt: initialPrompt,
      initialPreset: initialPreset,
      initialReference: initialReference,
    ),
  ),
);

CreationDraft _draft({String prompt = '保存在安全存储中的海报草稿'}) => CreationDraft(
  prompt: prompt,
  modelId: 'pro',
  aspectRatio: '16:9',
  resolution: '2K',
  quality: 'high',
  count: 3,
  updatedAt: DateTime(2026, 8, 24, 10),
);

void main() {
  test('creation draft normalizes values and isolates environment keys', () {
    final oversized = List.filled(20001, '图').join();
    final draft = CreationDraft.fromJson({
      'prompt': oversized,
      'modelId': ' pro ',
      'count': 99,
      'updatedAt': '2026-08-24T02:00:00Z',
    });

    expect(draft.prompt.runes.length, 20000);
    expect(draft.modelId, 'pro');
    expect(draft.count, 4);
    expect(CreationDraft.fromJson('invalid').count, 1);
    expect(
      SecureCreationDraftStore.keyFor('development'),
      isNot(SecureCreationDraftStore.keyFor('production')),
    );
    final assistantLocation = Uri.parse(
      creationPromptAssistantLocation('  雨夜霓虹街道\n电影感构图  '),
    );
    expect(assistantLocation.path, '/assistant');
    expect(
      assistantLocation.queryParameters['prompt'],
      contains('雨夜霓虹街道\n电影感构图'),
    );
    expect(
      assistantLocation.queryParameters['prompt'],
      startsWith('请优化以下文生图提示词'),
    );
    expect(reorderCreationReferences(['主', '侧', '细节'], 0, 3), ['侧', '细节', '主']);
    expect(reorderCreationReferences(['主', '侧', '细节'], 2, 0), ['细节', '主', '侧']);
    expect(reorderCreationReferences(['主'], 4, 0), ['主']);
    expect(creationAffordability(88, 12), (
      sufficient: true,
      remaining: 76,
      missing: 0,
    ));
    expect(creationAffordability(8, 12), (
      sufficient: false,
      remaining: 0,
      missing: 4,
    ));
    expect(creationDurationLabel(const Duration(seconds: 42)), '42 秒');
    expect(
      creationDurationLabel(const Duration(minutes: 1, seconds: 8)),
      '68 秒',
    );
    expect(
      creationElapsedDuration(
        active: false,
        startedAt: DateTime.utc(2026, 8, 23, 12),
        finishedAt: DateTime.utc(2026, 8, 23, 12, 0, 42),
      ),
      const Duration(seconds: 42),
    );
    expect(
      creationElapsedDuration(
        active: true,
        startedAt: DateTime.utc(2026, 8, 23, 12),
        now: DateTime.utc(2026, 8, 23, 12, 0, 9),
      ),
      const Duration(seconds: 9),
    );
    expect(
      creationGroupElapsedDuration(
        tasks: [
          TaskItem.fromJson({
            'id': 'a',
            'type': 't2i',
            'status': 'succeeded',
            'startedAt': '2026-08-23T12:00:00Z',
            'finishedAt': '2026-08-23T12:00:10Z',
          }),
          TaskItem.fromJson({
            'id': 'b',
            'type': 't2i',
            'status': 'succeeded',
            'startedAt': '2026-08-23T12:00:02Z',
            'finishedAt': '2026-08-23T12:00:25Z',
          }),
        ],
        active: false,
      ),
      const Duration(seconds: 25),
    );
  });

  testWidgets('create screen restores prompt and model options', (
    tester,
  ) async {
    final store = _FakeDraftStore(_draft());
    await tester.pumpWidget(
      _app(
        store,
        models: const [
          ImageModelOption(
            id: 'fast',
            name: '快速模型',
            description: '简短说明',
            resolutions: ['1K'],
            aspectRatios: ['auto', '1:1'],
            qualities: ['medium'],
            maxImages: 2,
            maxReferenceImages: 0,
            pricePoints: 0,
          ),
          ImageModelOption(
            id: 'pro',
            name: '高级模型',
            description: '简短说明',
            resolutions: ['1K', '2K'],
            aspectRatios: ['auto', '16:9', '9:16', '1:1', '3:2', '4:3', '21:9'],
            qualities: ['medium', 'high'],
            maxImages: 4,
            maxReferenceImages: 0,
            pricePoints: 3,
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    final prompt = tester.widget<TextField>(find.byType(TextField)).controller!;
    expect(prompt.text, '保存在安全存储中的海报草稿');
    expect(find.text('已恢复草稿'), findsNothing);
    expect(find.text('草稿已保存'), findsNothing);
    expect(find.text('高级模型'), findsOneWidget);
    expect(find.textContaining('3 张'), findsOneWidget);
    expect(find.byKey(const Key('creation-settings')), findsOneWidget);
    expect(find.bySemanticsLabel('生成设置'), findsOneWidget);
    expect(find.text('快速模型'), findsNothing);

    await tester.tap(find.byKey(const Key('creation-settings')));
    await tester.pumpAndSettle();
    expect(find.text('生成设置'), findsOneWidget);
    expect(find.byKey(const Key('app-sheet-close')), findsNothing);
    expect(find.byKey(const Key('app-sheet-handle')), findsOneWidget);
    expect(find.text('画面比例'), findsOneWidget);
    expect(find.text('清晰度'), findsOneWidget);
    expect(find.text('质量'), findsOneWidget);
    expect(find.text('生成数量'), findsOneWidget);
    expect(find.text('快速模型'), findsOneWidget);
    expect(find.text('简短说明'), findsNothing);
    expect(
      tester.getRect(find.text('自动')).center.dy,
      closeTo(tester.getRect(find.text('21:9')).center.dy, 1),
    );
    expect(tester.getSize(find.byType(AppSheetScaffold)).height, lessThan(420));
  });

  testWidgets('incoming prompt wins while saved model preference is retained', (
    tester,
  ) async {
    final store = _FakeDraftStore(_draft(prompt: '旧草稿'));
    await tester.pumpWidget(_app(store, initialPrompt: '从灵感页带入的新提示词'));
    await tester.pumpAndSettle();

    final prompt = tester.widget<TextField>(find.byType(TextField)).controller!;
    expect(prompt.text, '从灵感页带入的新提示词');
    expect(find.text('高级模型'), findsOneWidget);
    expect(store.writes.last.prompt, '从灵感页带入的新提示词');
    expect(store.writes.last.modelId, 'pro');
  });

  testWidgets('historical preset overrides saved prompt and model options', (
    tester,
  ) async {
    final store = _FakeDraftStore(
      CreationDraft(
        prompt: '旧草稿',
        modelId: 'fast',
        aspectRatio: '1:1',
        resolution: '1K',
        quality: 'medium',
        count: 1,
        updatedAt: DateTime(2026, 8, 24, 9),
      ),
    );
    const preset = CreationPreset(
      originTaskId: 'task-1',
      prompt: '历史作品提示词',
      modelId: 'pro',
      aspectRatio: '16:9',
      resolution: '2K',
      quality: 'high',
      count: 3,
    );
    await tester.pumpWidget(_app(store, initialPreset: preset));
    await tester.pumpAndSettle();

    final prompt = tester.widget<TextField>(find.byType(TextField)).controller!;
    expect(prompt.text, '历史作品提示词');
    expect(find.text('沿用历史作品参数'), findsOneWidget);
    expect(find.text('高级模型 · 16:9 · 2K · 高清 · 3 张'), findsOneWidget);
    expect(find.text('高级模型'), findsOneWidget);
    expect(store.writes.last.modelId, 'pro');
    expect(store.writes.last.aspectRatio, '16:9');
    expect(store.writes.last.resolution, '2K');
    expect(store.writes.last.quality, 'high');
    expect(store.writes.last.count, 3);
  });

  testWidgets('prompt edits are debounced and can be cleared', (tester) async {
    final store = _FakeDraftStore();
    await tester.pumpWidget(_app(store));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '正在编辑的产品海报');
    await tester.pump(const Duration(milliseconds: 400));
    expect(store.writes, isEmpty);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(store.writes.single.prompt, '正在编辑的产品海报');
    expect(find.text('草稿已保存'), findsNothing);
    expect(find.text('清除'), findsNothing);

    await tester.enterText(find.byType(TextField), '');
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pump();

    final prompt = tester.widget<TextField>(find.byType(TextField)).controller!;
    expect(prompt.text, isEmpty);
    expect(store.clearCount, greaterThan(0));
  });

  testWidgets('historical preset banner fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 220));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: const Scaffold(
          body: Padding(
            padding: EdgeInsets.all(16),
            child: CreationPresetBanner(
              modelName: '高质量商业视觉创作模型',
              aspectRatio: '16:9',
              resolution: '2K',
              quality: '高清',
              count: 4,
            ),
          ),
        ),
      ),
    );

    expect(find.text('沿用历史作品参数'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reference-heavy model exposes the server-safe task limit', (
    tester,
  ) async {
    const referenceModel = ImageModelOption(
      id: 'reference-heavy',
      name: '多参考图模型',
      description: '',
      resolutions: ['1K'],
      aspectRatios: ['1:1'],
      qualities: ['medium'],
      maxImages: 1,
      maxReferenceImages: 8,
      pricePoints: 3,
    );
    await tester.binding.setSurfaceSize(const Size(360, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(_FakeDraftStore(), models: const [referenceModel]),
    );
    await tester.pumpAndSettle();

    expect(find.text('参考图 0/6'), findsNothing);
    expect(find.text('参考图 0/8'), findsNothing);
    expect(find.text('清空'), findsNothing);
    expect(find.text('当前任务最多使用 6 张参考图'), findsNothing);
    expect(find.byKey(const Key('creation-reference-api-limit')), findsNothing);
    expect(find.byKey(const Key('creation-add-reference')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('incoming asset becomes a reference on a capable model', (
    tester,
  ) async {
    const referenceModel = ImageModelOption(
      id: 'reference-model',
      name: '参考图模型',
      description: '',
      resolutions: ['1K'],
      aspectRatios: ['1:1'],
      qualities: ['medium'],
      maxImages: 1,
      maxReferenceImages: 4,
      pricePoints: 3,
    );
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        textScale: 1.6,
        models: [_models.first, referenceModel],
        initialReference: const ReferenceImageDraft(
          localPath: '',
          filename: '产品主图',
          remoteKey: 'uploads/user/product.png',
          remoteUrl: '/api/v1/files/uploads/user/product-thumb.webp',
          sourceAssetId: 'asset-product',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('creation-reference-strip')), findsOneWidget);
    expect(find.text('参考图模型'), findsWidgets);
    expect(find.byTooltip('移除主参考'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('create composer sits at the bottom without optimize', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        initialPrompt: '雨夜霓虹街道，湿润地面倒影，电影感构图',
        textScale: 1.6,
        models: const [
          ImageModelOption(
            id: 'pro',
            name: '高级模型',
            description: '',
            resolutions: ['1K'],
            aspectRatios: ['1:1'],
            qualities: ['medium'],
            maxImages: 1,
            maxReferenceImages: 4,
            pricePoints: 3,
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('creation-optimize-prompt')), findsNothing);
    expect(find.byTooltip('让 AI 助手优化提示词'), findsNothing);
    expect(find.text('优化'), findsNothing);
    expect(find.byKey(const Key('creation-prompt')), findsOneWidget);
    expect(find.byKey(const Key('creation-submit')), findsOneWidget);
    expect(find.byKey(const Key('creation-add-reference')), findsOneWidget);
    expect(find.text('消耗 3 积分'), findsOneWidget);
    expect(find.text('参考图 0/4'), findsNothing);
    expect(find.text('清空'), findsNothing);
    final prompt = tester.getRect(find.byKey(const Key('creation-prompt')));
    final submit = tester.getRect(find.byKey(const Key('creation-submit')));
    final add = tester.getRect(find.byKey(const Key('creation-add-reference')));
    expect(submit.bottom, greaterThan(prompt.bottom - 8));
    expect(submit.right, greaterThan(prompt.center.dx));
    expect(add.right, lessThan(submit.left));
    expect(add.height, closeTo(submit.height, 1));
    expect((add.center.dy - submit.center.dy).abs(), lessThan(2));
    expect(tester.takeException(), isNull);
  });

  testWidgets('overflow reference tile opens a sheet with every image', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 720));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final references = List.generate(
      6,
      (index) => ReferenceImageDraft(
        localPath: '',
        filename: '参考图 ${index + 1}',
        remoteKey: 'uploads/user/reference-$index.jpg',
        remoteUrl: '',
      ),
    );
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: Align(
              alignment: Alignment.centerLeft,
              child: Builder(
                builder: (context) {
                  return CreationReferenceStrip(
                    references: references,
                    maxReferences: 6,
                    busy: false,
                    selecting: false,
                    tileSize: 40,
                    includeAddButton: false,
                    maxVisible: 4,
                    onAdd: () {},
                    onRemove: (_) {},
                    onReorder: (_, _) {},
                    onExpand: () {
                      showAppSheet<void>(
                        context: context,
                        isScrollControlled: true,
                        builder: (_) => CreationReferencesSheet(
                          references: references,
                          maxReferences: 6,
                          busy: false,
                          selecting: false,
                          onAdd: () {},
                          onRemove: (_) {},
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    final strip = tester.getRect(
      find.byKey(const Key('creation-reference-strip')),
    );
    expect(strip.height, 40);
    expect(strip.width, 40 * 5 + 6 * 4);
    expect(find.byTooltip('移除第 5 张参考图'), findsNothing);
    expect(find.byTooltip('移除第 6 张参考图'), findsNothing);
    expect(find.byKey(const Key('creation-reference-expand')), findsOneWidget);
    await tester.tap(find.byKey(const Key('creation-reference-expand')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('creation-references-sheet')), findsOneWidget);
    expect(find.text('全部参考图'), findsOneWidget);
    expect(find.byTooltip('移除第 6 张参考图'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reference ordering exposes primary semantics and drag handles', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 180));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final references = List.generate(
      3,
      (index) => ReferenceImageDraft(
        localPath: '',
        filename: '参考图 ${index + 1}',
        remoteKey: 'uploads/user/reference-$index.jpg',
        remoteUrl: '',
      ),
    );
    var reordered = <ReferenceImageDraft>[];
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
              child: CreationReferenceStrip(
                references: references,
                maxReferences: 6,
                busy: false,
                selecting: false,
                onAdd: () {},
                onRemove: (_) {},
                onReorder: (oldIndex, newIndex) {
                  reordered = reorderCreationReferences(
                    references,
                    oldIndex,
                    newIndex,
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Semantics && widget.properties.label == '参考图 1，主参考',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Semantics && widget.properties.label == '参考图 2，第 2 张参考图',
      ),
      findsOneWidget,
    );
    expect(find.text('主参考'), findsOneWidget);
    expect(find.byTooltip('拖动调整顺序'), findsNWidgets(3));
    await tester.drag(
      find.byKey(const Key('creation-reference-strip')),
      const Offset(-260, 0),
    );
    await tester.pump();
    expect(find.byKey(const Key('creation-add-reference')), findsOneWidget);
    expect(tester.takeException(), isNull);

    tester
        .widget<ReorderableListView>(find.byType(ReorderableListView))
        .onReorder(0, 3);
    expect(reordered.map((item) => item.filename), ['参考图 2', '参考图 3', '参考图 1']);
  });

  testWidgets('cost preview exposes exact shortage on narrow large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 420));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: const Scaffold(
          body: Padding(
            padding: EdgeInsets.all(16),
            child: CreationCostPanel(
              modelName: '高质量商业视觉创作模型',
              count: 4,
              unitCost: 3,
              estimatedCost: 12,
              availablePoints: 8,
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('3 × 4 = 12 积分'), findsOneWidget);
    expect(find.text('当前可用'), findsOneWidget);
    expect(find.text('还差'), findsOneWidget);
    expect(find.text('4 积分'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('latest text-to-image result appears as a conversation turn', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        authenticated: true,
        tasks: [
          TaskItem.fromJson({
            'id': 'task-t2i-1',
            'type': 't2i',
            'status': 'succeeded',
            'count': 1,
            'originalUrls': ['https://cdn.example/valley.png'],
            'params': {
              'userPrompt': '绿色山谷',
              'modelHint': 'gpt-image-2',
              'aspectRatio': 'auto',
              'resolutionScale': '1K',
              'quality': 'low',
            },
          }),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('creation-results')), findsNothing);
    expect(find.text('最近生成'), findsNothing);
    expect(find.byKey(const Key('creation-history')), findsNothing);
    expect(find.byKey(const Key('creation-thread')), findsOneWidget);
    expect(find.byKey(const Key('creation-turn-task-t2i-1')), findsOneWidget);
    expect(
      find.byKey(const Key('creation-current-task-t2i-1')),
      findsOneWidget,
    );
    expect(find.text('绿色山谷'), findsOneWidget);
    expect(find.byKey(const Key('creation-current-meta')), findsOneWidget);
    expect(find.text('gpt-image-2 · 自动 · 1K · 快速 · 1 张'), findsOneWidget);
    expect(find.textContaining('model-'), findsNothing);
    expect(
      find.byKey(const Key('creation-turn-task-t2i-1-regenerate')),
      findsNothing,
    );
    await tester.longPress(
      find.byKey(const Key('creation-current-task-t2i-1')),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('creation-turn-task-t2i-1-sheet')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('creation-turn-task-t2i-1-regenerate')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('creation-turn-task-t2i-1-reference')),
      findsOneWidget,
    );
    expect(find.text('作为参考图'), findsOneWidget);
    expect(
      find.byKey(const Key('creation-turn-task-t2i-1-download')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('creation-turn-task-t2i-1-delete')),
      findsOneWidget,
    );
    expect(find.text('删除这张'), findsOneWidget);
    await tester.tap(find.byKey(const Key('creation-turn-task-t2i-1-delete')));
    await tester.pumpAndSettle();
    expect(find.text('删除这件作品？'), findsOneWidget);
    expect(find.text('确认删除'), findsOneWidget);
    expect(
      tester
          .getRect(find.byKey(const Key('creation-current-task-t2i-1')))
          .bottom,
      lessThanOrEqualTo(
        tester.getRect(find.byKey(const Key('creation-current-meta'))).top,
      ),
    );
    expect(
      tester.getRect(find.byKey(const Key('creation-thread'))).bottom,
      lessThanOrEqualTo(
        tester.getRect(find.byKey(const Key('creation-settings'))).top,
      ),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('long-press can add a generated image as a reference', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        authenticated: true,
        models: const [
          ImageModelOption(
            id: 'pro-ref',
            name: '参考模型',
            description: '',
            resolutions: ['1K'],
            aspectRatios: ['auto', '1:1'],
            qualities: ['medium'],
            maxImages: 2,
            maxReferenceImages: 2,
            pricePoints: 3,
          ),
        ],
        tasks: [
          TaskItem.fromJson({
            'id': 'task-ref',
            'type': 't2i',
            'status': 'succeeded',
            'count': 1,
            'originalUrls': [
              '/api/v1/files/tasks/user/task-ref/original/0.png',
            ],
            'outputKeys': ['tasks/user/task-ref/original/0.png'],
            'params': {
              'userPrompt': '青色草地图',
              'modelHint': '参考模型',
              'aspectRatio': 'auto',
              'resolutionScale': '1K',
              'quality': 'medium',
            },
          }),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(const Key('creation-current-task-ref')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('creation-turn-task-ref-reference')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('creation-turn-task-ref-reference')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('creation-reference-strip')), findsOneWidget);
    expect(find.text('已添加到参考图'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('preview spec uses the model name instead of a raw id', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    const modelId = 'model-aa4b0b5f-e0f4-4a00-b859-4371670c6264';
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        authenticated: true,
        models: const [
          ImageModelOption(
            id: modelId,
            name: 'gpt-image-2',
            description: '',
            resolutions: ['1K'],
            aspectRatios: ['auto', '1:1'],
            qualities: ['low', 'medium'],
            maxImages: 2,
            maxReferenceImages: 0,
            pricePoints: 3,
          ),
        ],
        tasks: [
          TaskItem.fromJson({
            'id': 'task-t2i-uuid',
            'type': 't2i',
            'status': 'succeeded',
            'count': 1,
            'model': modelId,
            'params': {
              'modelHint': modelId,
              'publicModelKey': modelId,
              'aspectRatio': 'auto',
              'resolutionScale': '1K',
              'quality': 'low',
            },
          }),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('creation-current-meta')), findsOneWidget);
    expect(find.text('gpt-image-2 · 自动 · 1K · 快速 · 1 张'), findsOneWidget);
    expect(find.textContaining(modelId), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('conversation lists generated turns instead of a history rail', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        authenticated: true,
        tasks: [
          for (var index = 1; index <= 9; index++)
            TaskItem.fromJson({
              'id': 'task-t2i-$index',
              'type': 't2i',
              'status': 'succeeded',
              'params': {'userPrompt': '提示词 $index'},
            }),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('creation-history')), findsNothing);
    expect(find.byKey(const Key('creation-thread')), findsOneWidget);
    expect(find.byKey(const Key('creation-turn-task-t2i-1')), findsOneWidget);
    expect(find.byKey(const Key('creation-turn-task-t2i-2')), findsOneWidget);
    expect(find.text('提示词 1'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('conversation can target one image in a multi-image turn', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        authenticated: true,
        tasks: [
          TaskItem.fromJson({
            'id': 'task-t2i-batch',
            'type': 't2i',
            'status': 'succeeded',
            'count': 3,
            'originalUrls': [
              'https://cdn.example/a.png',
              'https://cdn.example/b.png',
              'https://cdn.example/c.png',
            ],
            'params': {
              'userPrompt': '三张山谷',
              'modelHint': 'gpt-image-2',
              'aspectRatio': '1:1',
              'resolutionScale': '1K',
              'quality': 'low',
            },
          }),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const Key('creation-current-task-t2i-batch-1')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('creation-turn-task-t2i-batch-regenerate-1')),
      findsNothing,
    );
    await tester.longPress(
      find.byKey(const Key('creation-current-task-t2i-batch-1')),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('creation-turn-task-t2i-batch-sheet-1')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('creation-turn-task-t2i-batch-regenerate-1')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('creation-turn-task-t2i-batch-reference-1')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('creation-turn-task-t2i-batch-download-1')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('creation-turn-task-t2i-batch-delete-1')),
      findsOneWidget,
    );
    expect(find.text('删除这张'), findsOneWidget);
    await tester.tap(
      find.byKey(const Key('creation-turn-task-t2i-batch-delete-1')),
    );
    await tester.pumpAndSettle();
    expect(find.text('删除这张图片？'), findsOneWidget);
    expect(find.text('只删除这张图，同一组里的其他结果会保留，删除后无法恢复。'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('conversation groups batched tasks so one image can be deleted', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        authenticated: true,
        tasks: [
          for (var index = 0; index < 3; index++)
            TaskItem.fromJson({
              'id': 'task-batch-$index',
              'type': 't2i',
              'status': 'succeeded',
              'count': 1,
              'originalUrls': ['https://cdn.example/$index.png'],
              'params': {
                'userPrompt': '三张山谷',
                'modelHint': 'gpt-image-2',
                'batchId': 'batch-1',
                'batchIndex': index,
                'batchSize': 3,
                'aspectRatio': '1:1',
                'resolutionScale': '1K',
                'quality': 'low',
              },
            }),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('creation-turn-batch-1')), findsOneWidget);
    expect(find.byKey(const Key('creation-turn-task-batch-0')), findsNothing);
    expect(find.byKey(const Key('creation-current-batch-1-1')), findsOneWidget);
    expect(find.text('gpt-image-2 · 1:1 · 1K · 快速 · 3 张'), findsOneWidget);
    await tester.longPress(find.byKey(const Key('creation-current-batch-1-1')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('creation-turn-batch-1-sheet-1')),
      findsOneWidget,
    );
    expect(find.text('删除这张'), findsOneWidget);
    await tester.tap(find.byKey(const Key('creation-turn-batch-1-delete-1')));
    await tester.pumpAndSettle();
    expect(find.text('删除这件作品？'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('each image shows its own time and the row shows the total', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        authenticated: true,
        tasks: [
          TaskItem.fromJson({
            'id': 'task-time-0',
            'type': 't2i',
            'status': 'succeeded',
            'count': 1,
            'startedAt': '2026-08-23T12:00:00Z',
            'finishedAt': '2026-08-23T12:00:10Z',
            'originalUrls': ['https://cdn.example/0.png'],
            'params': {
              'userPrompt': '两张海面',
              'modelHint': 'gpt-image-2',
              'batchId': 'batch-time',
              'batchIndex': 0,
              'batchSize': 2,
              'aspectRatio': '1:1',
              'resolutionScale': '1K',
              'quality': 'low',
            },
          }),
          TaskItem.fromJson({
            'id': 'task-time-1',
            'type': 't2i',
            'status': 'succeeded',
            'count': 1,
            'startedAt': '2026-08-23T12:00:02Z',
            'finishedAt': '2026-08-23T12:00:25Z',
            'originalUrls': ['https://cdn.example/1.png'],
            'params': {
              'userPrompt': '两张海面',
              'modelHint': 'gpt-image-2',
              'batchId': 'batch-time',
              'batchIndex': 1,
              'batchSize': 2,
              'aspectRatio': '1:1',
              'resolutionScale': '1K',
              'quality': 'low',
            },
          }),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('10s'), findsOneWidget);
    expect(find.text('23s'), findsOneWidget);
    expect(find.text('总生成耗时 25 秒'), findsOneWidget);
    expect(find.byKey(const Key('creation-slot-elapsed')), findsOneWidget);
    expect(find.byKey(const Key('creation-current-elapsed')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a multi-image generation shows a compact square row', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 720));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final task = TaskItem.fromJson({
      'id': 'task-t2i-multi',
      'type': 't2i',
      'status': 'running',
      'count': 4,
    });
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CreationResultStage(
            task: task,
            generating: true,
            fallbackCount: 4,
            onOpen: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();

    final hero = tester.getRect(
      find.byKey(const Key('creation-current-task-t2i-multi')),
    );
    final first = tester.getRect(
      find.byKey(const Key('creation-current-task-t2i-multi-0')),
    );
    final last = tester.getRect(
      find.byKey(const Key('creation-current-task-t2i-multi-3')),
    );
    expect(hero.width, greaterThan(first.width));
    expect(first.bottom, lessThanOrEqualTo(hero.bottom));
    expect(first.top, greaterThan(hero.top));
    expect(first.height, closeTo(first.width, 1));
    expect(first.width, 40);
    expect(first.center.dy, closeTo(last.center.dy, 1));
    expect(last.left, greaterThan(first.right));
    expect(find.textContaining('正在生成'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('generating preview shows elapsed time', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 720));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final started = DateTime.now().toUtc().subtract(const Duration(seconds: 8));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CreationResultStage(
            task: TaskItem.fromJson({
              'id': 'task-running',
              'type': 't2i',
              'status': 'running',
              'startedAt': started.toIso8601String(),
            }),
            generating: true,
            fallbackCount: 1,
            onOpen: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('creation-current-status')), findsNothing);
    expect(find.textContaining('正在生成'), findsNothing);
    expect(find.byKey(const Key('creation-slot-elapsed')), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('creation-slot-elapsed'))).data,
      matches(RegExp(r'^\d+s$')),
    );
    expect(find.textContaining('已用时'), findsNothing);
    expect(find.textContaining('生成耗时'), findsNothing);
    final card = tester.getRect(
      find.byKey(const Key('creation-current-task-running')),
    );
    final elapsed = tester.getRect(
      find.byKey(const Key('creation-slot-elapsed')),
    );
    expect(elapsed.center.dy, greaterThan(card.top));
    expect(elapsed.center.dy, lessThan(card.bottom));
    expect(tester.takeException(), isNull);
  });

  testWidgets('failed preview shows the error message and duration', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 720));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CreationResultStage(
            task: TaskItem.fromJson({
              'id': 'task-failed',
              'type': 't2i',
              'status': 'failed',
              'errorMessage': '模型服务暂时不可用',
              'startedAt': '2026-08-23T12:00:00Z',
              'finishedAt': '2026-08-23T12:00:42Z',
            }),
            generating: false,
            fallbackCount: 1,
            onOpen: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('本次创作未完成'), findsOneWidget);
    expect(find.byKey(const Key('creation-current-error')), findsOneWidget);
    expect(find.text('模型服务暂时不可用'), findsOneWidget);
    expect(find.textContaining('42 秒'), findsOneWidget);
    expect(find.textContaining('生成耗时'), findsNothing);
    expect(
      tester.getRect(find.byKey(const Key('creation-current-elapsed'))).bottom,
      lessThanOrEqualTo(
        tester
            .getRect(find.byKey(const Key('creation-current-task-failed')))
            .top,
      ),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('queued conversation turn shows status, seconds, and particles', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final created = DateTime.now().subtract(const Duration(seconds: 4));
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        authenticated: true,
        tasks: [
          TaskItem.fromJson({
            'id': 'task-queued',
            'type': 't2i',
            'status': 'queued',
            'count': 1,
            'createdAt': created.toUtc().toIso8601String(),
            'params': {
              'userPrompt': '青色草地图',
              'modelHint': 'gpt-image-2',
              'aspectRatio': 'auto',
              'resolutionScale': '1K',
              'quality': 'low',
            },
          }),
        ],
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('creation-turn-task-queued')), findsOneWidget);
    expect(find.byKey(const Key('creation-current-status')), findsNothing);
    expect(find.textContaining('正在排队'), findsNothing);
    expect(find.text('任务已进入队列，开始后会自动更新'), findsNothing);
    expect(find.byIcon(Icons.auto_awesome_rounded), findsNothing);
    expect(find.byKey(const Key('creation-slot-elapsed')), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('creation-slot-elapsed'))).data,
      matches(RegExp(r'^\d+s$')),
    );
    expect(find.byKey(const Key('creation-current-elapsed')), findsOneWidget);
    expect(
      tester
          .widget<Text>(find.byKey(const Key('creation-current-elapsed')))
          .data,
      contains('总生成耗时'),
    );
    expect(find.byType(CustomPaint), findsWidgets);
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const Key('creation-slot-elapsed')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('multi queued batch shows a generating card for each image', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final created = DateTime.now().subtract(const Duration(seconds: 2));
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        authenticated: true,
        tasks: [
          for (var index = 0; index < 2; index++)
            TaskItem.fromJson({
              'id': 'task-queued-$index',
              'type': 't2i',
              'status': 'queued',
              'count': 1,
              'createdAt': created.toUtc().toIso8601String(),
              'params': {
                'userPrompt': '青色草地图',
                'modelHint': 'gpt-image-2',
                'batchId': 'batch-queued',
                'batchIndex': index,
                'batchSize': 2,
                'aspectRatio': 'auto',
                'resolutionScale': '1K',
                'quality': 'low',
              },
            }),
        ],
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('creation-turn-batch-queued')), findsOneWidget);
    expect(
      find.byKey(const Key('creation-current-batch-queued-0')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('creation-current-batch-queued-1')),
      findsOneWidget,
    );
    expect(find.textContaining('正在排队'), findsNothing);
    expect(find.text('任务已进入队列，开始后会自动更新'), findsNothing);
    expect(find.byIcon(Icons.auto_awesome_rounded), findsNothing);
    expect(find.byKey(const Key('creation-current-status')), findsNothing);
    expect(find.byKey(const Key('creation-slot-elapsed')), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('creation-slot-elapsed'))).data,
      matches(RegExp(r'^\d+s$')),
    );
    expect(find.byKey(const Key('creation-current-elapsed')), findsOneWidget);
    expect(
      tester
          .widget<Text>(find.byKey(const Key('creation-current-elapsed')))
          .data,
      contains('总生成耗时'),
    );
    expect(find.text('gpt-image-2 · 自动 · 1K · 快速 · 2 张'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('conversation shows the image after a queued turn completes', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _FakeCreateTaskCenter center;
    final queued = TaskItem.fromJson({
      'id': 'task-live',
      'type': 't2i',
      'status': 'queued',
      'count': 1,
      'createdAt': DateTime.now()
          .subtract(const Duration(seconds: 3))
          .toUtc()
          .toIso8601String(),
      'params': {
        'userPrompt': '青色草地图',
        'modelHint': 'gpt-image-2',
        'aspectRatio': 'auto',
        'resolutionScale': '1K',
        'quality': 'low',
      },
    });
    await tester.pumpWidget(
      _app(
        _FakeDraftStore(),
        authenticated: true,
        tasks: [queued],
        taskCenter: () {
          center = _FakeCreateTaskCenter([queued]);
          return center;
        },
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('creation-current-elapsed')), findsOneWidget);
    expect(find.byType(AuthenticatedImage), findsNothing);

    center.upsert(
      TaskItem.fromJson({
        'id': 'task-live',
        'type': 't2i',
        'status': 'succeeded',
        'count': 1,
        'originalUrls': ['https://cdn.example/done.png'],
        'displayUrls': ['https://cdn.example/done.png'],
        'params': {
          'userPrompt': '青色草地图',
          'modelHint': 'gpt-image-2',
          'aspectRatio': 'auto',
          'resolutionScale': '1K',
          'quality': 'low',
        },
      }),
    );
    await tester.pump();

    expect(find.byKey(const Key('creation-current-elapsed')), findsNothing);
    expect(find.byType(AuthenticatedImage), findsOneWidget);
    expect(find.byKey(const Key('creation-current-task-live')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
