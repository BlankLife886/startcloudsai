import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/create/create.dart';
import 'package:starcloudsai_mobile/features/model_sheet/model_sheet.dart';
import 'package:starcloudsai_mobile/features/model_sheet/model_sheet_screen.dart';

const _model = ImageModelOption(
  id: 'model-sheet-pro',
  name: '模型设定 Pro',
  description: '多视角一致性模型',
  resolutions: ['1K', '2K'],
  aspectRatios: ['16:9', '1:1'],
  qualities: ['low', 'medium', 'high'],
  maxImages: 4,
  maxReferenceImages: 4,
  pricePoints: 6,
  transparentBackground: true,
  outputFormats: ['png'],
);

ModelSheetRequest _request({
  String outputMode = 'board',
  List<String> views = const ['front', 'side', 'back'],
  String background = 'gray',
  int count = 2,
  int batchSize = 2,
  String viewId = '',
  String viewLabel = '',
}) => ModelSheetRequest(
  prompt: '冷灰机甲战士，可动关节清晰',
  model: _model,
  subjectType: 'character',
  fidelity: 'strict',
  views: views,
  background: background,
  detail: 85,
  outputMode: outputMode,
  aspectRatio: '16:9',
  resolution: '2K',
  quality: 'high',
  inputKeys: const ['uploads/user/mecha-front.jpg'],
  count: count,
  batchSize: batchSize,
  batchId: 'batch-1',
  viewId: viewId,
  viewLabel: viewLabel,
);

void main() {
  test('parses model sheet runtime config and output capabilities', () {
    final config = ModelSheetConfig.fromRuntimeConfig({
      'features': {
        'ai.ultraModelSheet': {
          'enabled': true,
          'config': {
            'publicModels': [
              {
                'id': 'model-sheet-pro',
                'label': '模型设定 Pro',
                'pricePoints': 6,
                'maxReferenceImages': 8,
                'transparentBackground': true,
                'outputFormats': ['png', 'webp'],
              },
              {'label': '缺少 ID'},
            ],
          },
        },
      },
    });

    expect(config.enabled, isTrue);
    expect(config.models, hasLength(1));
    expect(config.models.single.maxReferenceImages, 8);
    expect(config.models.single.transparentBackground, isTrue);
    expect(config.models.single.outputFormats, ['png', 'webp']);
    expect(config.models.single.supportsTransparentPng, isTrue);
  });

  test(
    'board payload preserves multi-view and transparent output contract',
    () {
      final request = _request(background: 'transparent');
      final payload = modelSheetTaskPayload(
        request: request,
        idempotencyKey: 'model-sheet-request-1',
      );
      final params = payload['params'] as Map<String, dynamic>;

      expect(payload['type'], 'model_sheet');
      expect(payload['count'], 2);
      expect(payload['inputKeys'], ['uploads/user/mecha-front.jpg']);
      expect(payload['idempotencyKey'], 'model-sheet-request-1');
      expect(params['publicModelKey'], 'model-sheet-pro');
      expect(params['views'], '正面、侧面、背面');
      expect(params['batchId'], 'batch-1');
      expect(params['batchSize'], 2);
      expect(params['transparentPngEnabled'], isTrue);
      expect(params['outputFormat'], 'png');
      expect(params['_source'], 'flutter_app');
    },
  );

  test('separate view prompt requests only its assigned view', () {
    final request = _request(
      outputMode: 'separate',
      views: const ['side'],
      count: 1,
      batchSize: 4,
      viewId: 'side',
      viewLabel: '侧面',
    );
    final prompt = modelSheetPrompt(request);
    final payload = modelSheetTaskPayload(
      request: request,
      idempotencyKey: 'separate-side',
    );
    final params = payload['params'] as Map<String, dynamic>;

    expect(prompt, contains('本张只输出侧面视图'));
    expect(prompt, isNot(contains('正面、侧面、背面')));
    expect(payload['count'], 1);
    expect(params['viewId'], 'side');
    expect(params['viewLabel'], '侧面');
    expect(params['batchSize'], 4);
  });

  testWidgets('blueprint stage fits a narrow phone with large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          modelSheetConfigProvider.overrideWith(
            (ref) async =>
                const ModelSheetConfig(enabled: true, models: [_model]),
          ),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const ModelSheetScreen(),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('模型蓝图预览'), findsOneWidget);
    expect(find.text('正面'), findsWidgets);
    expect(find.text('侧面'), findsWidgets);
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(find.byKey(const Key('creation-tool-coloring')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('separate mode updates cost from schemes to selected views', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(430, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          modelSheetConfigProvider.overrideWith(
            (ref) async =>
                const ModelSheetConfig(enabled: true, models: [_model]),
          ),
        ],
        child: const MaterialApp(home: ModelSheetScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('6 积分'), findsOneWidget);
    await tester.ensureVisible(find.text('独立视图'));
    await tester.tap(find.text('独立视图'));
    await tester.pump();

    expect(find.text('24 积分'), findsOneWidget);
    expect(find.text('生成 4 张独立视图'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('example fills the subject description', (tester) async {
    await tester.binding.setSurfaceSize(const Size(430, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          modelSheetConfigProvider.overrideWith(
            (ref) async =>
                const ModelSheetConfig(enabled: true, models: [_model]),
          ),
        ],
        child: const MaterialApp(home: ModelSheetScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const Key('model-sheet-example-产品设备')),
    );
    await tester.tap(find.byKey(const Key('model-sheet-example-产品设备')));
    await tester.pump();

    final field = tester.widget<TextField>(
      find.byKey(const Key('model-sheet-prompt')),
    );
    expect(field.controller?.text, contains('便携咖啡机'));
  });
}
