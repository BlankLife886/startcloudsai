import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/storage/app_image_cache.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';
import 'package:starcloudsai_mobile/features/assistant/assistant_draft.dart';
import 'package:starcloudsai_mobile/features/create/creation_draft.dart';
import 'package:starcloudsai_mobile/features/feedback/feedback.dart';
import 'package:starcloudsai_mobile/features/profile/local_storage_screen.dart';

class _FakeImageCacheService extends AppImageCacheService {
  _FakeImageCacheService(this.value);

  AppImageCacheSnapshot value;
  bool clearCalled = false;

  @override
  AppImageCacheSnapshot snapshot() => value;

  @override
  AppImageCacheSnapshot clear() {
    clearCalled = true;
    return value = const AppImageCacheSnapshot(
      bytes: 0,
      entries: 0,
      liveEntries: 0,
    );
  }
}

class _FakeCreationDraftStore implements CreationDraftStore {
  _FakeCreationDraftStore(this.value);

  CreationDraft? value;
  int clearCount = 0;

  @override
  Future<CreationDraft?> read() async => value;

  @override
  Future<void> write(CreationDraft draft) async => value = draft;

  @override
  Future<void> clear() async {
    clearCount += 1;
    value = null;
  }
}

class _FakeAssistantDraftStore implements AssistantDraftStore {
  _FakeAssistantDraftStore(this.value);

  AssistantDraft? value;
  int clearCount = 0;

  @override
  Future<AssistantDraft?> read() async => value;

  @override
  Future<void> write(AssistantDraft draft) async => value = draft;

  @override
  Future<void> clear() async {
    clearCount += 1;
    value = null;
  }
}

class _FakeFeedbackDraftStore implements FeedbackDraftStore {
  _FakeFeedbackDraftStore(this.value);

  FeedbackDraft? value;
  int clearCount = 0;

  @override
  Future<FeedbackDraft?> read() async => value;

  @override
  Future<void> write(FeedbackDraft draft) async => value = draft;

  @override
  Future<void> clear() async {
    clearCount += 1;
    value = null;
  }
}

Widget _screen({
  required AppImageCacheService imageCache,
  required CreationDraftStore creationDrafts,
  required AssistantDraftStore assistantDrafts,
  required FeedbackDraftStore feedbackDrafts,
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) => ProviderScope(
  overrides: [
    appImageCacheServiceProvider.overrideWithValue(imageCache),
    creationDraftStoreProvider.overrideWithValue(creationDrafts),
    assistantDraftStoreProvider.overrideWithValue(assistantDrafts),
    feedbackDraftStoreProvider.overrideWithValue(feedbackDrafts),
  ],
  child: MaterialApp(
    theme: ThemeData(brightness: brightness, useMaterial3: true),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: AppNoticeHost(child: child!),
    ),
    home: const LocalStorageScreen(),
  ),
);

void main() {
  test('storage snapshot exposes active draft labels', () {
    const snapshot = LocalStorageSnapshot(
      imageCache: AppImageCacheSnapshot(
        bytes: 1024,
        entries: 2,
        liveEntries: 1,
      ),
      hasCreationDraft: true,
      hasAssistantDraft: false,
      hasFeedbackDraft: true,
    );

    expect(snapshot.draftCount, 2);
    expect(snapshot.draftLabels, ['文生图', '问题反馈']);
  });

  testWidgets('local storage stays usable and clears each content type', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final now = DateTime(2026, 9, 3, 8);
    final imageCache = _FakeImageCacheService(
      const AppImageCacheSnapshot(
        bytes: 2 * 1024 * 1024,
        entries: 4,
        liveEntries: 1,
      ),
    );
    final creation = _FakeCreationDraftStore(
      CreationDraft(prompt: '海边日落', count: 1, updatedAt: now),
    );
    final assistant = _FakeAssistantDraftStore(
      AssistantDraft(prompt: '优化这段文案', references: const [], updatedAt: now),
    );
    final feedback = _FakeFeedbackDraftStore(
      FeedbackDraft(
        category: FeedbackCategory.suggestion,
        title: '建议标题',
        content: '建议内容',
        updatedAt: now,
      ),
    );

    await tester.pumpWidget(
      _screen(
        imageCache: imageCache,
        creationDrafts: creation,
        assistantDrafts: assistant,
        feedbackDrafts: feedback,
        brightness: Brightness.dark,
        textScale: 1.6,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('本地存储'), findsOneWidget);
    expect(find.text('3 项草稿 · 2.0 MB 图片缓存'), findsOneWidget);
    expect(find.text('文生图、AI 助手、问题反馈 · 3 项'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const Key('local-storage-clear-images')));
    await tester.pumpAndSettle();
    expect(imageCache.clearCalled, isTrue);
    expect(find.text('0 张 · 0 KB'), findsOneWidget);
    expect(find.text('图片缓存已清理'), findsOneWidget);

    await tester.ensureVisible(
      find.byKey(const Key('local-storage-clear-drafts')),
    );
    await tester.tap(find.byKey(const Key('local-storage-clear-drafts')));
    await tester.pumpAndSettle();
    expect(find.text('清理未发送草稿？'), findsOneWidget);
    expect(creation.clearCount, 0);

    await tester.tap(find.text('清理草稿'));
    await tester.pumpAndSettle();
    expect(creation.clearCount, 1);
    expect(assistant.clearCount, 1);
    expect(feedback.clearCount, 1);
    expect(find.text('暂无未发送草稿'), findsOneWidget);
    expect(find.text('未发送草稿已清理'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
