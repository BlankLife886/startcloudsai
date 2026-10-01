import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/coloring/coloring.dart';
import 'package:starcloudsai_mobile/features/coloring/coloring_screen.dart';
import 'package:starcloudsai_mobile/features/create/create.dart';

const _model = ImageModelOption(
  id: 'coloring-pro',
  name: '专业染色',
  description: '保留线稿并完成光影',
  resolutions: ['1K', '2K'],
  aspectRatios: ['auto', '1:1'],
  qualities: ['medium', 'high'],
  maxImages: 3,
  maxReferenceImages: 3,
  pricePoints: 15,
);

void main() {
  test('parses only coloring models that support an input image', () {
    final config = ColoringConfig.fromRuntimeConfig({
      'features': {
        'ai.illustrationColoring': {
          'enabled': true,
          'config': {
            'publicModels': [
              {
                'id': 'coloring-pro',
                'label': '专业染色',
                'maxReferenceImages': 3,
                'maxImages': 3,
                'pricePoints': 15,
              },
              {
                'id': 'text-only-image',
                'label': '不支持参考图',
                'maxReferenceImages': 0,
              },
              {'label': '缺少公开 ID'},
            ],
          },
        },
      },
    });

    expect(config.enabled, isTrue);
    expect(config.models.map((item) => item.id), ['coloring-pro']);
    expect(config.models.single.pricePoints, 15);
  });

  test('empty coloring model list disables the feature', () {
    final config = ColoringConfig.fromRuntimeConfig({
      'features': {
        'ai.illustrationColoring': {
          'enabled': true,
          'config': {
            'publicModels': [
              {'id': 'no-reference', 'maxReferenceImages': 0},
            ],
          },
        },
      },
    });

    expect(config.enabled, isFalse);
    expect(config.models, isEmpty);
  });

  test(
    'coloring payload preserves source-first input and model capabilities',
    () {
      final payload = coloringTaskPayload(
        prompt: ' 薄荷绿与珊瑚粉 ',
        title: ' 春日线稿 ',
        model: _model,
        aspectRatio: 'auto',
        resolution: '2K',
        quality: 'high',
        count: 2,
        inputKeys: ['uploads/user/line-art.jpg', 'uploads/user/palette.png'],
        idempotencyKey: 'coloring-request-1',
      );
      final params = payload['params'] as Map<String, dynamic>;

      expect(payload['type'], 'coloring');
      expect(payload['prompt'], '薄荷绿与珊瑚粉');
      expect(payload['count'], 2);
      expect(payload['inputKeys'], [
        'uploads/user/line-art.jpg',
        'uploads/user/palette.png',
      ]);
      expect(payload['idempotencyKey'], 'coloring-request-1');
      expect(params['publicModelKey'], 'coloring-pro');
      expect(params['aspectRatio'], 'auto');
      expect(params['resolutionScale'], '2K');
      expect(params['quality'], 'high');
      expect(params['_source'], 'flutter_app');
      expect(params['_kind'], 'illustration-coloring');
    },
  );

  test('empty coloring direction receives a useful default', () {
    expect(normalizedColoringPrompt('  '), '使用协调的专业配色，保持线稿清晰');
  });

  testWidgets('coloring tool fits a narrow phone with large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          coloringConfigProvider.overrideWith(
            (ref) async =>
                const ColoringConfig(enabled: true, models: [_model]),
          ),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const ColoringScreen(),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('插画染色'), findsWidgets);
    expect(find.text('线稿'), findsOneWidget);
    expect(find.text('结果'), findsOneWidget);
    expect(find.byKey(const Key('coloring-source-picker')), findsOneWidget);
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(find.byKey(const Key('creation-tool-background')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('coloring presets fill the direction field', (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          coloringConfigProvider.overrideWith(
            (ref) async =>
                const ColoringConfig(enabled: true, models: [_model]),
          ),
        ],
        child: const MaterialApp(home: ColoringScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.drag(find.byType(ListView).first, const Offset(0, -520));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('coloring-preset-电影暖调')));
    await tester.pump();

    final field = tester.widget<TextField>(
      find.widgetWithText(TextField, '配色描述'),
    );
    expect(field.controller?.text, contains('琥珀金'));
    expect(tester.takeException(), isNull);
  });
}
