import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';
import 'package:starcloudsai_mobile/features/meta/meta.dart';
import 'package:starcloudsai_mobile/features/meta/updates_screen.dart';

class _MetaApiClient extends ApiClient {
  _MetaApiClient({this.failAnnouncements = false, this.failChangelog = false})
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'http://localhost:8000',
        ),
        sessionStore: SessionStore(namespace: 'updates-test'),
      );

  final bool failAnnouncements;
  final bool failChangelog;

  @override
  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    if (path == '/announcements') {
      if (failAnnouncements) throw StateError('announcements unavailable');
      return {
        'items': [
          {
            'id': 'announcement-live',
            'title': '线上公告',
            'body': '公告接口返回成功。',
            'createdAt': '2026-08-27T08:00:00Z',
          },
        ],
      };
    }
    if (path == '/changelog') {
      if (failChangelog) throw StateError('changelog unavailable');
      return {
        'items': [
          {
            'id': 'change-live',
            'version': '3.5.0',
            'date': '2026-08-27',
            'tag': 'fix',
            'title': '稳定性更新',
            'items': ['修复公告加载'],
          },
        ],
      };
    }
    throw StateError('unexpected path: $path');
  }
}

final _feed = MetaFeed(
  announcements: [
    AppAnnouncement(
      id: 'announcement-1',
      title: '服务维护安排',
      body: '维护期间已提交的任务会继续处理，完成后可在作品页查看。',
      createdAt: DateTime(2026, 8, 24),
      endsAt: DateTime(2026, 8, 31),
      ctaText: '查看安排',
      ctaUrl: 'https://example.com/maintenance',
    ),
  ],
  changelog: [
    ChangelogEntry(
      id: 'change-feature',
      version: '3.4.0',
      date: DateTime(2026, 8, 24),
      tag: 'feature',
      title: '移动端公告中心',
      summary: '集中查看服务公告和版本变化。',
      items: const ['新增公告总览', '新增版本标签筛选'],
      highlight: true,
    ),
    ChangelogEntry(
      id: 'change-fix',
      version: '3.3.1',
      date: DateTime(2026, 8, 20),
      tag: 'fix',
      title: '创作稳定性修复',
      summary: '优化弱网下的任务恢复。',
      items: const ['修复断线重连后的重复提示'],
      highlight: false,
    ),
  ],
);

Widget _app({
  double textScale = 1,
  Future<bool> Function(Uri uri)? openExternal,
}) => ProviderScope(
  overrides: [metaFeedProvider.overrideWith((ref) async => _feed)],
  child: MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: UpdatesScreen(openExternal: openExternal),
  ),
);

void main() {
  test('meta feed keeps the successful endpoint when its peer fails', () async {
    final announcementsOnly = await MetaRepository(
      _MetaApiClient(failChangelog: true),
    ).load();
    final changelogOnly = await MetaRepository(
      _MetaApiClient(failAnnouncements: true),
    ).load();

    expect(announcementsOnly.announcements.single.title, '线上公告');
    expect(announcementsOnly.changelog, isEmpty);
    expect(announcementsOnly.changelogUnavailable, isTrue);
    expect(announcementsOnly.announcementsUnavailable, isFalse);
    expect(changelogOnly.announcements, isEmpty);
    expect(changelogOnly.changelog.single.version, '3.5.0');
    expect(changelogOnly.announcementsUnavailable, isTrue);
    expect(changelogOnly.changelogUnavailable, isFalse);
  });

  test('meta feed still reports an error when both endpoints fail', () {
    final repository = MetaRepository(
      _MetaApiClient(failAnnouncements: true, failChangelog: true),
    );

    expect(repository.load, throwsStateError);
  });

  test('parses announcement config and changelog fields defensively', () {
    final announcement = AppAnnouncement.fromJson({
      'id': 'announcement-1',
      'title': '  新公告  ',
      'body': '公告正文',
      'createdAt': '2026-08-24T08:00:00Z',
      'config': {
        'decorImageUrl': '/api/v1/files/announcement.webp',
        'ctaText': '查看详情',
        'ctaUrl': 'https://example.com/notice',
      },
    });
    final changelog = ChangelogEntry.fromJson({
      'id': 'change-1',
      'version': ' 3.4.0 ',
      'date': '2026-08-24',
      'tag': 'feature',
      'title': '版本更新',
      'summary': null,
      'items': [' 第一项 ', '', 3],
      'highlight': true,
    });

    expect(announcement.title, '新公告');
    expect(announcement.imageUrl, '/api/v1/files/announcement.webp');
    expect(announcement.ctaText, '查看详情');
    expect(announcement.createdAt, isNotNull);
    expect(changelog.version, '3.4.0');
    expect(changelog.summary, isEmpty);
    expect(changelog.items, ['第一项', '3']);
    expect(changelog.highlight, isTrue);
  });

  test('formats a complete changelog summary for copying', () {
    expect(
      changelogCopyText(_feed.changelog.first),
      'v3.4.0 · 移动端公告中心\n集中查看服务公告和版本变化。\n'
      '- 新增公告总览\n- 新增版本标签筛选',
    );
  });

  testWidgets('updates screen expands latest entry and filters by tag', (
    tester,
  ) async {
    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();

    expect(find.text('服务版本 v3.4.0'), findsOneWidget);
    expect(find.text('服务维护安排'), findsOneWidget);
    expect(find.text('新增公告总览'), findsOneWidget);
    expect(find.text('查看安排'), findsOneWidget);
    final overview = tester.widget<DecoratedBox>(
      find.byKey(const Key('updates-overview-surface')),
    );
    expect(
      (overview.decoration as BoxDecoration).borderRadius,
      BorderRadius.circular(8),
    );

    await tester.scrollUntilVisible(
      find.byKey(const Key('updates-tag-fix')),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('updates-tag-fix')));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byKey(const Key('changelog-change-fix')),
      180,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('创作稳定性修复'), findsOneWidget);
    expect(find.byKey(const Key('changelog-change-feature')), findsNothing);
    expect(find.text('修复断线重连后的重复提示'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('announcement action safely opens an external web link', (
    tester,
  ) async {
    Uri? opened;
    await tester.pumpWidget(
      _app(
        openExternal: (uri) async {
          opened = uri;
          return true;
        },
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const Key('announcement-action-announcement-1')),
    );
    await tester.pumpAndSettle();
    expect(opened, Uri.parse('https://example.com/maintenance'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('announcement action routes app-relative links in place', (
    tester,
  ) async {
    final internalFeed = MetaFeed(
      announcements: [
        AppAnnouncement(
          id: 'announcement-internal',
          title: '外观设置更新',
          body: '选择新的显示模式。',
          createdAt: DateTime(2026, 8, 27),
          ctaText: '前往设置',
          ctaUrl: '/profile/appearance',
        ),
      ],
      changelog: const [],
    );
    final router = GoRouter(
      initialLocation: '/updates',
      routes: [
        GoRoute(
          path: '/updates',
          builder: (context, state) => const UpdatesScreen(),
        ),
        GoRoute(
          path: '/profile/appearance',
          builder: (context, state) => const Scaffold(body: Text('外观设置目标页')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [metaFeedProvider.overrideWith((ref) async => internalFeed)],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const Key('announcement-action-announcement-internal')),
    );
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/profile/appearance');
    expect(find.text('外观设置目标页'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('announcement and update cards fit narrow large-text layout', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_app(textScale: 1.6));
    await tester.pumpAndSettle();

    expect(find.text('服务版本 v3.4.0'), findsOneWidget);
    expect(find.text('服务维护安排'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.scrollUntilVisible(
      find.byKey(const Key('changelog-change-feature')),
      260,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('新增版本标签筛选'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('expanded update copies its complete summary', (tester) async {
    String? clipboardText;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          clipboardText = (call.arguments as Map)['text'] as String?;
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
    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const Key('copy-changelog-change-feature')),
      260,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('copy-changelog-change-feature')));
    await tester.pump();

    expect(clipboardText, contains('v3.4.0 · 移动端公告中心'));
    expect(clipboardText, contains('- 新增版本标签筛选'));
    expect(find.text('更新内容已复制'), findsOneWidget);
  });

  testWidgets('flat update controls support dark mode', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [metaFeedProvider.overrideWith((ref) async => _feed)],
        child: MaterialApp(
          theme: ThemeData.light(),
          darkTheme: ThemeData.dark(),
          themeMode: ThemeMode.dark,
          home: const UpdatesScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      Theme.of(tester.element(find.text('服务版本 v3.4.0'))).brightness,
      Brightness.dark,
    );
    expect(find.byKey(const Key('updates-tag-fix')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('partial changelog failure stays distinct from an empty feed', (
    tester,
  ) async {
    final partial = MetaFeed(
      announcements: _feed.announcements,
      changelog: const [],
      changelogUnavailable: true,
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [metaFeedProvider.overrideWith((ref) async => partial)],
        child: const MaterialApp(home: UpdatesScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('版本记录暂时不可用'), findsOneWidget);
    expect(find.text('版本加载失败'), findsOneWidget);
    expect(find.text('版本记录暂时不可用，请稍后刷新'), findsOneWidget);
    expect(find.text('服务维护安排'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
