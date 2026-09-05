import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/storage/user_storage_namespace.dart';
import 'package:starcloudsai_mobile/features/assistant/assistant.dart';
import 'package:starcloudsai_mobile/features/assistant/assistant_draft.dart';
import 'package:starcloudsai_mobile/features/create/creation_draft.dart';
import 'package:starcloudsai_mobile/features/feedback/feedback.dart';

void main() {
  test('local private state is isolated by environment and account', () {
    final first = userStorageNamespace(
      environment: 'Production',
      userId: 'USER-A',
    );
    final second = userStorageNamespace(
      environment: 'production',
      userId: 'user-b',
    );
    final anonymous = userStorageNamespace(
      environment: 'production',
      userId: null,
    );

    expect(first, 'production.user.user-a');
    expect(second, 'production.user.user-b');
    expect(anonymous, 'production.user.anonymous');
    expect(
      SecureCreationDraftStore.keyFor(first),
      isNot(SecureCreationDraftStore.keyFor(second)),
    );
    expect(
      SecureAssistantDraftStore.keyFor(first),
      isNot(SecureAssistantDraftStore.keyFor(second)),
    );
    expect(
      assistantPinnedConversationIdsKey(first),
      isNot(assistantPinnedConversationIdsKey(second)),
    );
    expect(
      SecureFeedbackDraftStore.keyFor(first),
      isNot(SecureFeedbackDraftStore.keyFor(second)),
    );
  });
}
