import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';
import 'package:starcloudsai_mobile/features/assets/assets.dart';
import 'package:starcloudsai_mobile/features/assets/assets_screen.dart';
import 'package:starcloudsai_mobile/features/create/reference_image_service.dart';

const _group = UserAssetGroup(
  id: 'group-1',
  name: '参考图',
  sort: 10,
  assetCount: 1,
);

const _asset = UserAsset(
  id: 'asset-1',
  title: '人像参考',
  url: '',
  thumbnailUrl: '',
  contentType: 'image/jpeg',
  sizeBytes: 1536 * 1024,
  groupId: 'group-1',
);

class _NoopApiClient extends ApiClient {
  _NoopApiClient()
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'http://localhost:8000',
        ),
        sessionStore: SessionStore(namespace: 'asset-test'),
      );

  @override
  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) => throw UnimplementedError();
}

class _QueuedAssetRepository extends AssetRepository {
  _QueuedAssetRepository(this.pages) : super(_NoopApiClient());

  final List<FutureOr<UserAssetPage> Function()> pages;

  @override
  Future<UserAssetGroupSummary> groups() async => const UserAssetGroupSummary(
    items: [_group],
    ungroupedCount: 0,
    totalAssetCount: 1,
  );

  @override
  Future<UserAssetPage> assets({
    String groupId = assetGroupAll,
    String? cursor,
    int limit = 30,
  }) async => pages.removeAt(0)();
}

AssetCenterState _state({String? nextCursor = 'next-page'}) => AssetCenterState(
  items: const [_asset],
  groups: const [_group],
  ungroupedCount: 1,
  totalAssetCount: 2,
  selectedGroup: assetGroupAll,
  nextCursor: nextCursor,
);

class _FakeAssetController extends AssetCenterController {
  _FakeAssetController({this.loadMoreGate});

  final Completer<void>? loadMoreGate;
  String? selectedGroup;
  String? uploadedTitle;
  String? uploadedGroupId;
  String? updatedAssetId;
  String? updatedTitle;
  String? movedGroupId;
  String? deletedAssetId;
  String? createdGroupName;
  String? renamedGroupId;
  String? renamedGroupName;
  String? deletedGroupId;
  int loadMoreCount = 0;

  @override
  Future<AssetCenterState> build() async => _state();

  @override
  Future<void> refresh() async {}

  @override
  Future<void> selectGroup(String groupId) async {
    selectedGroup = groupId;
    state = AsyncData(state.requireValue.copyWith(selectedGroup: groupId));
  }

  @override
  Future<void> loadMore() async {
    final current = state.requireValue;
    if (!current.hasMore || current.isLoadingMore) return;
    loadMoreCount += 1;
    if (loadMoreGate != null) {
      state = AsyncData(current.copyWith(isLoadingMore: true));
      await loadMoreGate!.future;
    }
    final latest = state.requireValue;
    state = AsyncData(
      latest.copyWith(
        items: [
          ...latest.items,
          const UserAsset(
            id: 'asset-2',
            title: '风景参考',
            url: '',
            thumbnailUrl: '',
            contentType: 'image/png',
            sizeBytes: 2048,
          ),
        ],
        clearCursor: true,
        isLoadingMore: false,
      ),
    );
  }

  @override
  Future<UserAsset> upload({
    required ReferenceImageDraft image,
    required String title,
    String? groupId,
  }) async {
    uploadedTitle = title;
    uploadedGroupId = groupId;
    const result = UserAsset(
      id: 'asset-uploaded',
      title: '新素材',
      url: '',
      thumbnailUrl: '',
      contentType: 'image/jpeg',
      sizeBytes: 100,
    );
    return result;
  }

  @override
  Future<void> updateAsset(
    String id, {
    String? title,
    String? groupId,
    bool updateGroup = false,
  }) async {
    updatedAssetId = id;
    if (title != null) updatedTitle = title;
    if (updateGroup) movedGroupId = groupId ?? assetGroupUngrouped;
  }

  @override
  Future<void> deleteAsset(String id) async {
    deletedAssetId = id;
    final current = state.requireValue;
    state = AsyncData(
      current.copyWith(
        items: current.items.where((item) => item.id != id).toList(),
        totalAssetCount: current.totalAssetCount - 1,
      ),
    );
  }

  @override
  Future<void> createGroup(String name) async {
    createdGroupName = name;
    final current = state.requireValue;
    state = AsyncData(
      current.copyWith(
        groups: [
          ...current.groups,
          UserAssetGroup(id: 'group-new', name: name, sort: 20, assetCount: 0),
        ],
      ),
    );
  }

  @override
  Future<void> renameGroup(String id, String name) async {
    renamedGroupId = id;
    renamedGroupName = name;
    final current = state.requireValue;
    state = AsyncData(
      current.copyWith(
        groups: current.groups
            .map(
              (group) => group.id == id
                  ? UserAssetGroup(
                      id: group.id,
                      name: name,
                      sort: group.sort,
                      assetCount: group.assetCount,
                    )
                  : group,
            )
            .toList(),
      ),
    );
  }

  @override
  Future<void> deleteGroup(String id) async {
    deletedGroupId = id;
    final current = state.requireValue;
    state = AsyncData(
      current.copyWith(
        groups: current.groups.where((group) => group.id != id).toList(),
      ),
    );
  }
}

class _RecoveringAssetController extends _FakeAssetController {
  @override
  Future<void> loadMore() async {
    final current = state.requireValue;
    if (!current.hasMore || current.isLoadingMore) return;
    loadMoreCount += 1;
    if (loadMoreCount == 1) throw StateError('temporary paging failure');
    state = AsyncData(current.copyWith(clearCursor: true));
  }
}

Widget _app({
  required AssetCenterController Function() controller,
  double textScale = 1,
  bool dark = false,
}) => ProviderScope(
  overrides: [assetCenterControllerProvider.overrideWith(controller)],
  child: MaterialApp(
    theme: ThemeData.light(),
    darkTheme: ThemeData.dark(),
    themeMode: dark ? ThemeMode.dark : ThemeMode.light,
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: const AssetsScreen(),
  ),
);

void main() {
  test('parses asset pages and sorted group summary safely', () {
    final page = UserAssetPage.fromJson({
      'items': [
        {
          'id': 'asset-1',
          'title': ' 人像素材 ',
          'url': '/api/v1/files/original.jpg',
          'thumbnailUrl': '/api/v1/files/thumb',
          'contentType': 'image/jpeg',
          'sizeBytes': 2048,
          'groupId': 'group-1',
          'createdAt': '2026-08-24T08:00:00Z',
        },
        {'id': '', 'url': '/invalid'},
      ],
      'nextCursor': ' next-page ',
    });
    final groups = UserAssetGroupSummary.fromJson({
      'items': [
        {'id': 'group-b', 'name': 'B', 'sort': 20, 'assetCount': 1},
        {'id': 'group-a', 'name': 'A', 'sort': 10, 'assetCount': 2},
      ],
      'ungroupedCount': 3,
      'totalAssetCount': 6,
    });

    expect(page.items, hasLength(1));
    expect(page.items.first.title, '人像素材');
    expect(page.items.first.groupId, 'group-1');
    expect(page.nextCursor, 'next-page');
    expect(groups.items.map((group) => group.name), ['A', 'B']);
    expect(groups.ungroupedCount, 3);
    expect(groups.totalAssetCount, 6);
    expect(formatAssetSize(1536 * 1024), '1.5 MB');
  });

  test('validates asset and group names', () {
    expect(validateAssetTitle(''), isNotNull);
    expect(validateAssetTitle('人像参考'), isNull);
    expect(validateAssetTitle('x' * 121), contains('120'));
    expect(validateAssetGroupName('  '), isNotNull);
    expect(validateAssetGroupName('品牌素材'), isNull);
    expect(validateAssetGroupName('x' * 65), contains('64'));
  });

  test('searches loaded assets with every title keyword', () {
    const items = [
      _asset,
      UserAsset(
        id: 'asset-product',
        title: '蓝色 产品 主图',
        url: '',
        thumbnailUrl: '',
        contentType: 'image/png',
        sizeBytes: 2048,
      ),
    ];

    expect(searchUserAssets(items, '人像').map((item) => item.id), ['asset-1']);
    expect(searchUserAssets(items, '产品 蓝色').map((item) => item.id), [
      'asset-product',
    ]);
    expect(searchUserAssets(items, '蓝色 人像'), isEmpty);
    expect(searchUserAssets(items, '  '), items);
  });

  test('refresh supersedes an in-flight asset cursor page', () async {
    final oldPage = Completer<UserAssetPage>();
    const refreshedAsset = UserAsset(
      id: 'asset-refreshed',
      title: '刷新后的素材',
      url: '',
      thumbnailUrl: '',
      contentType: 'image/jpeg',
      sizeBytes: 100,
    );
    final repository = _QueuedAssetRepository([
      () => const UserAssetPage(items: [_asset], nextCursor: 'cursor-2'),
      () => oldPage.future,
      () => const UserAssetPage(items: [refreshedAsset]),
    ]);
    final container = ProviderContainer(
      overrides: [assetRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    final subscription = container.listen(
      assetCenterControllerProvider,
      (_, _) {},
    );
    addTearDown(subscription.close);
    await container.read(assetCenterControllerProvider.future);
    final controller = container.read(assetCenterControllerProvider.notifier);

    final loadingOldPage = controller.loadMore();
    await Future<void>.delayed(Duration.zero);
    await controller.refresh();
    oldPage.complete(
      const UserAssetPage(
        items: [
          UserAsset(
            id: 'asset-stale',
            title: '旧分页素材',
            url: '',
            thumbnailUrl: '',
            contentType: 'image/jpeg',
            sizeBytes: 100,
          ),
        ],
      ),
    );
    await loadingOldPage;

    final state = container.read(assetCenterControllerProvider).requireValue;
    expect(state.items.map((item) => item.id), ['asset-refreshed']);
    expect(state.hasMore, isFalse);
  });

  testWidgets('capacity, group filtering and automatic cursor loading work', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 520));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final loadMoreGate = Completer<void>();
    late _FakeAssetController controller;
    await tester.pumpWidget(
      _app(
        controller: () =>
            controller = _FakeAssetController(loadMoreGate: loadMoreGate),
        textScale: 1.6,
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.text('个人素材库'), findsOneWidget);
    expect(find.text('2 项素材 · 1 个分组'), findsOneWidget);
    expect(find.text('2/200'), findsOneWidget);
    expect(find.text('人像参考'), findsOneWidget);

    await tester.drag(
      find.byType(SingleChildScrollView).first,
      const Offset(-260, 0),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('asset-group-group-1')));
    await tester.pumpAndSettle();
    expect(controller.selectedGroup, 'group-1');

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -900));
    await tester.pump();
    expect(controller.loadMoreCount, 1);
    expect(find.text('正在自动加载更多素材'), findsOneWidget);

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -80));
    await tester.pump();
    expect(controller.loadMoreCount, 1);

    loadMoreGate.complete();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(controller.state.requireValue.items.last.title, '风景参考');
    expect(controller.state.requireValue.hasMore, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('asset automatic paging failure stays inline and can retry', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 520));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _RecoveringAssetController controller;
    await tester.pumpWidget(
      _app(
        controller: () => controller = _RecoveringAssetController(),
        textScale: 1.6,
      ),
    );
    await tester.pump();
    await tester.pump();

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -900));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.loadMoreCount, 1);
    expect(find.byKey(const Key('asset-load-more-error')), findsOneWidget);
    expect(find.text('更多素材加载失败，请稍后重试'), findsOneWidget);
    expect(find.byKey(const Key('app-notice-card')), findsNothing);

    await tester.tap(find.byKey(const Key('asset-load-more-retry')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(controller.loadMoreCount, 2);
    expect(controller.state.requireValue.hasMore, isFalse);
    expect(find.byKey(const Key('asset-load-more-error')), findsNothing);
    expect(find.text('已加载全部素材'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('asset search can continue into the next page in dark mode', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late _FakeAssetController controller;
    await tester.pumpWidget(
      _app(
        controller: () => controller = _FakeAssetController(),
        textScale: 1.3,
        dark: true,
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('asset-search')), '风景');
    await tester.pump();
    expect(find.text('已显示 0 / 已加载 1'), findsOneWidget);
    expect(find.text('当前已加载素材中没有匹配项'), findsOneWidget);

    final loadMore = find.byKey(const Key('asset-search-load-more'));
    await tester.ensureVisible(loadMore);
    await tester.pumpAndSettle();
    await tester.tap(loadMore);
    await tester.pumpAndSettle();

    expect(controller.loadMoreCount, 1);
    expect(find.text('风景参考'), findsOneWidget);
    expect(find.text('已显示 1 / 已加载 2'), findsOneWidget);
    final card = tester.widget<Material>(
      find.byKey(const Key('asset-card-asset-2')),
    );
    final shape = card.shape! as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(8));
    expect(
      Theme.of(tester.element(find.text('风景参考'))).brightness,
      Brightness.dark,
    );

    await tester.tap(find.byKey(const Key('asset-search-clear')));
    await tester.pump();
    expect(find.text('人像参考'), findsOneWidget);
    expect(find.text('风景参考'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('upload sheet validates and submits title with group', (
    tester,
  ) async {
    String? capturedTitle;
    String? capturedGroupId;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AssetUploadSheet(
            image: const ReferenceImageDraft(
              localPath: '',
              filename: 'reference.jpg',
            ),
            groups: const [_group],
            initialGroupId: _group.id,
            onSubmit: ({required image, required title, groupId}) async {
              capturedTitle = title;
              capturedGroupId = groupId;
              return _asset;
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), '');
    await tester.ensureVisible(find.text('上传并保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('上传并保存'));
    await tester.pump();
    expect(find.text('请填写素材名称'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), '产品主图');
    await tester.ensureVisible(find.text('上传并保存'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('上传并保存'));
    await tester.pumpAndSettle();
    expect(capturedTitle, '产品主图');
    expect(capturedGroupId, _group.id);
  });

  testWidgets('asset media actions expose progress and resume safely', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 740));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final saveGate = Completer<void>();
    var useCount = 0;
    var useAssistantCount = 0;
    var saveCount = 0;
    var shareCount = 0;
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: ThemeData.light(),
          darkTheme: ThemeData.dark(),
          themeMode: ThemeMode.dark,
          home: Scaffold(
            body: MediaQuery(
              data: const MediaQueryData(
                size: Size(320, 740),
                textScaler: TextScaler.linear(1.6),
              ),
              child: AssetDetailSheet(
                asset: _asset,
                groupName: _group.name,
                busy: false,
                onUseForCreation: () => useCount += 1,
                onUseForAssistant: () => useAssistantCount += 1,
                onSave: () {
                  saveCount += 1;
                  return saveGate.future;
                },
                onShare: (_) async => shareCount += 1,
                onRename: () {},
                onMove: () {},
                onDelete: () {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('asset-use-for-creation')), findsOneWidget);
    expect(find.byKey(const Key('asset-use-for-assistant')), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('asset-save-original')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('asset-save-original')));
    await tester.pump();
    expect(saveCount, 1);
    expect(
      find.descendant(
        of: find.byKey(const Key('asset-save-original')),
        matching: find.byType(CircularProgressIndicator),
      ),
      findsOneWidget,
    );
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const Key('asset-share')))
          .onPressed,
      isNull,
    );

    saveGate.complete();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('asset-share')));
    await tester.pumpAndSettle();
    expect(shareCount, 1);
    await tester.ensureVisible(
      find.byKey(const Key('asset-use-for-assistant')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('asset-use-for-assistant')));
    await tester.pumpAndSettle();
    expect(useAssistantCount, 1);
    expect(useCount, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'asset detail actions rename, move and delete through controller',
    (tester) async {
      late _FakeAssetController controller;
      await tester.pumpWidget(
        _app(controller: () => controller = _FakeAssetController()),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('人像参考'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('asset-save-original')), findsOneWidget);
      expect(find.byKey(const Key('asset-share')), findsOneWidget);
      expect(find.byKey(const Key('asset-use-for-creation')), findsOneWidget);
      expect(find.byKey(const Key('asset-use-for-assistant')), findsOneWidget);
      expect(find.byTooltip('全屏预览素材'), findsOneWidget);
      await tester.tap(find.byTooltip('全屏预览素材'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('asset-fullscreen-actions')), findsOneWidget);
      expect(find.byKey(const Key('asset-fullscreen-save')), findsOneWidget);
      expect(find.byKey(const Key('asset-fullscreen-share')), findsOneWidget);
      expect(
        find.byKey(const Key('asset-fullscreen-use-for-creation')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('asset-fullscreen-use-for-assistant')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('asset-fullscreen-close')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('重命名'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('重命名'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField), '新人像参考');
      await tester.tap(find.widgetWithText(FilledButton, '保存'));
      await tester.pumpAndSettle();
      expect(controller.updatedAssetId, _asset.id);
      expect(controller.updatedTitle, '新人像参考');

      await tester.tap(find.text('人像参考'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('移动分组'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('移动分组'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('未分组'));
      await tester.pumpAndSettle();
      expect(controller.movedGroupId, assetGroupUngrouped);

      await tester.tap(find.text('人像参考'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('删除素材'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('删除素材'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('确认删除'));
      await tester.pumpAndSettle();
      expect(controller.deletedAssetId, _asset.id);
      expect(find.text('素材已删除'), findsOneWidget);
    },
  );

  testWidgets('group management creates, renames and deletes groups', (
    tester,
  ) async {
    late _FakeAssetController controller;
    await tester.pumpWidget(
      _app(controller: () => controller = _FakeAssetController()),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('管理分组'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('新建分组'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), '产品图');
    await tester.tap(find.widgetWithText(FilledButton, '保存'));
    await tester.pumpAndSettle();
    expect(controller.createdGroupName, '产品图');

    await tester.tap(find.byTooltip('管理分组'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('重命名 参考图'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), '灵感图');
    await tester.tap(find.widgetWithText(FilledButton, '保存'));
    await tester.pumpAndSettle();
    expect(controller.renamedGroupId, _group.id);
    expect(controller.renamedGroupName, '灵感图');

    await tester.tap(find.byTooltip('管理分组'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('删除 灵感图'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('删除分组'));
    await tester.pumpAndSettle();
    expect(controller.deletedGroupId, _group.id);
  });

  test('asset file extension follows content type and url', () {
    expect(assetFileExtension(_asset), 'jpg');
    expect(
      assetFileExtension(
        const UserAsset(
          id: 'png',
          title: 'PNG',
          url: '/api/v1/files/uploads/image.bin',
          thumbnailUrl: '',
          contentType: 'image/png',
          sizeBytes: 1,
        ),
      ),
      'png',
    );
    expect(
      assetFileExtension(
        const UserAsset(
          id: 'webp',
          title: 'WebP',
          url: '/api/v1/files/uploads/image.webp',
          thumbnailUrl: '',
          contentType: 'application/octet-stream',
          sizeBytes: 1,
        ),
      ),
      'webp',
    );
  });

  testWidgets('asset summary and cards fit narrow large-text layout', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(controller: _FakeAssetController.new, textScale: 1.6),
    );
    await tester.pumpAndSettle();
    expect(find.text('个人素材库'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.scrollUntilVisible(
      find.text('人像参考'),
      220,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('asset-group-ungrouped')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
