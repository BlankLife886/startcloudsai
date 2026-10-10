import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/assistant/assistant.dart';

void main() {
  test('image configuration obeys model, route and account limits', () {
    final config = AssistantConfig.fromJson({
      'imageBatchLimit': 6,
      'concurrency': {'imageLimit': 3},
      'imageModels': [
        {'model': 'a', 'maxImages': 8, 'imageBatchLimit': 4},
        {'model': 'b', 'maxImages': 2},
      ],
    });
    expect(config.imageModels.map((model) => model.maxImages), [3, 2]);
  });

  test('zero image capacity does not remove the chat models', () {
    final config = AssistantConfig.fromJson({
      'concurrency': {'imageLimit': 0, 'chatLimit': 4},
      'conversationModels': [
        {'model': 'chat'},
      ],
      'imageModels': [
        {'model': 'image', 'maxImages': 8},
      ],
    });
    expect(config.imageModels, isEmpty);
    expect(config.models.single.id, 'chat');
  });

  test(
    'legacy limits and repeated model selection preserve source metadata',
    () {
      final model = {'model': 'image', 'maxImages': 8};
      final first = AssistantConfig.fromJson({
        'concurrency': {'limit': 4},
        'imageModels': [model],
      });
      final second = AssistantConfig.fromJson({
        'concurrency': {'imageLimit': 1},
        'imageModels': [model],
      });
      expect(first.imageModels.single.maxImages, 4);
      expect(second.imageModels.single.maxImages, 1);
      expect(model['maxImages'], 8);
    },
  );
}
