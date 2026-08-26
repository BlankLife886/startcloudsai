import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/background_remove/background_remove.dart';
import 'package:starcloudsai_mobile/features/background_remove/background_remove_screen.dart';

const _models = [
  BackgroundRemovalModel(
    id: 'remove-default',
    label: '精准抠图',
    pricePoints: 20,
    isDefault: true,
  ),
];

void main() {
  test('parses background removal models and selects configured default', () {
    final config = BackgroundRemovalConfig.fromRuntimeConfig({
      'features': {
        'ai.imageTools': {
          'enabled': true,
          'config': {
            'backgroundRemovalModels': [
              {'id': 'remove-fast', 'label': '快速抠图', 'pricePoints': 10},
              {
                'publicModelKey': 'remove-default',
                'name': '精准抠图',
                'creditCost': 20,
                'default': true,
              },
              {'label': '缺少 ID'},
            ],
          },
        },
      },
    });

    expect(config.enabled, isTrue);
    expect(config.models, hasLength(2));
    expect(config.defaultModel?.id, 'remove-default');
    expect(config.defaultModel?.pricePoints, 20);
  });

  test('tool is unavailable when runtime config has no usable model', () {
    final config = BackgroundRemovalConfig.fromRuntimeConfig({
      'features': {
        'ai.imageTools': {
          'enabled': true,
          'config': {
            'backgroundRemovalModels': [
              {'label': 'invalid'},
            ],
          },
        },
      },
    });

    expect(config.enabled, isFalse);
    expect(config.defaultModel, isNull);
  });

  test('task payload follows single-image background removal contract', () {
    final payload = backgroundRemovalTaskPayload(
      inputKey: 'uploads/user/source.jpg',
      model: _models.single,
      idempotencyKey: 'request-1',
    );

    expect(payload['type'], 'background_remove');
    expect(payload['count'], 1);
    expect(payload['inputKeys'], ['uploads/user/source.jpg']);
    expect(payload['idempotencyKey'], 'request-1');
    expect(
      (payload['params'] as Map<String, dynamic>)['publicModelKey'],
      'remove-default',
    );
    expect(
      (payload['params'] as Map<String, dynamic>)['_source'],
      'flutter_app',
    );
  });

  testWidgets('tool screen stays usable at 320px with large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          backgroundRemovalConfigProvider.overrideWith(
            (ref) async =>
                const BackgroundRemovalConfig(enabled: true, models: _models),
          ),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const BackgroundRemoveScreen(),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('原图'), findsOneWidget);
    expect(find.text('透明结果'), findsOneWidget);
    expect(find.text('20 积分'), findsOneWidget);
    expect(find.byKey(const Key('background-remove-submit')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
