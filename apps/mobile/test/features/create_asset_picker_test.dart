import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/assets/assets.dart';
import 'package:starcloudsai_mobile/features/assets/assets_screen.dart';
import 'package:starcloudsai_mobile/features/create/reference_image_service.dart';

const _group = UserAssetGroup(
  id: 'group-1',
  name: '人物',
  sort: 1,
  assetCount: 2,
);

const _assets = [
  UserAsset(
    id: 'asset-1',
    title: '人物正面',
    url: '/api/v1/files/uploads/user/portrait.jpg',
    thumbnailUrl: '',
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    groupId: 'group-1',
  ),
  UserAsset(
    id: 'asset-2',
    title: '人物侧面',
    url: 'http://localhost:8000/api/v1/files/uploads/user/profile.png',
    thumbnailUrl: '',
    contentType: 'image/png',
    sizeBytes: 2048,
    groupId: 'group-1',
  ),
  UserAsset(
    id: 'asset-3',
    title: '已经添加',
    url: 'uploads/user/existing.webp',
    thumbnailUrl: '',
    contentType: 'image/webp',
    sizeBytes: 4096,
  ),
];

class _PickerController extends AssetCenterController {
  String? selectedGroup;
  int loadMoreCount = 0;

  @override
  Future<AssetCenterState> build() async => const AssetCenterState(
    items: _assets,
    groups: [_group],
    ungroupedCount: 1,
    totalAssetCount: 3,
    selectedGroup: assetGroupAll,
    nextCursor: 'next',
  );

  @override
  Future<void> selectGroup(String groupId) async {
    selectedGroup = groupId;
    state = AsyncData(state.requireValue.copyWith(selectedGroup: groupId));
  }

  @override
  Future<void> loadMore() async {
    loadMoreCount += 1;
    state = AsyncData(state.requireValue.copyWith(clearCursor: true));
  }
}

class _PickerHost extends StatefulWidget {
  const _PickerHost({required this.maxSelection, required this.existingKeys});

  final int maxSelection;
  final Set<String> existingKeys;

  @override
  State<_PickerHost> createState() => _PickerHostState();
}

class _PickerHostState extends State<_PickerHost> {
  List<UserAsset>? result;

  Future<void> _open() async {
    result = await showModalBottomSheet<List<UserAsset>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => AssetPickerSheet(
        maxSelection: widget.maxSelection,
        existingKeys: widget.existingKeys,
      ),
    );
    setState(() {});
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: FilledButton(onPressed: _open, child: const Text('打开素材库')),
    ),
  );
}

Widget _app({
  required _PickerController controller,
  int maxSelection = 2,
  Set<String> existingKeys = const {'uploads/user/existing.webp'},
  double textScale = 1,
}) => ProviderScope(
  overrides: [assetCenterControllerProvider.overrideWith(() => controller)],
  child: MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: _PickerHost(maxSelection: maxSelection, existingKeys: existingKeys),
  ),
);

void main() {
  test('asset input key supports task file URL forms', () {
    expect(assetInputKey('uploads/user/a.jpg'), 'uploads/user/a.jpg');
    expect(
      assetInputKey('/api/v1/files/uploads/user/a.jpg'),
      'uploads/user/a.jpg',
    );
    expect(
      assetInputKey(
        'https://example.com/api/v1/files/uploads/user/a%20b.jpg?size=small',
      ),
      'uploads/user/a b.jpg',
    );
    expect(assetInputKey('/api/v1/files/public/a.jpg'), isNull);
    expect(assetInputKey('not-a-file-url'), isNull);
  });

  test('remote key update preserves asset preview metadata', () {
    const draft = ReferenceImageDraft(
      localPath: '',
      filename: '人物正面',
      remoteUrl: '/api/v1/files/uploads/user/thumb.jpg',
      sourceAssetId: 'asset-1',
    );

    final updated = draft.withRemoteKey('uploads/user/original.jpg');

    expect(updated.remoteKey, 'uploads/user/original.jpg');
    expect(updated.remoteUrl, draft.remoteUrl);
    expect(updated.sourceAssetId, draft.sourceAssetId);
    expect(updated.isRemote, isTrue);
  });

  testWidgets('picker selects, deselects and returns reusable assets', (
    tester,
  ) async {
    final controller = _PickerController();
    await tester.pumpWidget(_app(controller: controller));
    await tester.tap(find.text('打开素材库'));
    await tester.pumpAndSettle();

    expect(find.text('已添加'), findsOneWidget);
    await tester.tap(find.byKey(const Key('asset-picker-asset-1')));
    await tester.pump();
    expect(find.text('已选 1/2'), findsOneWidget);
    await tester.tap(find.byKey(const Key('asset-picker-asset-1')));
    await tester.pump();
    expect(find.text('已选 0/2'), findsOneWidget);

    await tester.tap(find.byKey(const Key('asset-picker-asset-2')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('asset-picker-confirm')));
    await tester.pumpAndSettle();

    final host = tester.state<_PickerHostState>(find.byType(_PickerHost));
    expect(host.result?.map((asset) => asset.id), ['asset-2']);
  });

  testWidgets('picker enforces selection limit and drives filters and cursor', (
    tester,
  ) async {
    final controller = _PickerController();
    await tester.pumpWidget(
      _app(controller: controller, maxSelection: 1, existingKeys: const {}),
    );
    await tester.tap(find.text('打开素材库'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('asset-picker-asset-1')));
    await tester.tap(find.byKey(const Key('asset-picker-asset-2')));
    await tester.pump();
    expect(find.text('最多再选 1 张素材'), findsOneWidget);

    await tester.tap(find.byKey(const Key('asset-group-group-1')));
    await tester.pumpAndSettle();
    expect(controller.selectedGroup, 'group-1');

    await tester.tap(find.text('加载更多'));
    await tester.pumpAndSettle();
    expect(controller.loadMoreCount, 1);
  });

  testWidgets('picker has no overflow at 320px and large text', (tester) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      _app(controller: _PickerController(), textScale: 1.6),
    );
    await tester.tap(find.text('打开素材库'));
    await tester.pumpAndSettle();

    expect(find.text('从素材库选择'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
