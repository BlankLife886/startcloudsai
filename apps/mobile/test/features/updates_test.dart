import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/meta/meta.dart';
import 'package:starcloudsai_mobile/features/meta/updates_screen.dart';

final _feed = MetaFeed(
  announcements: [
    AppAnnouncement(
      id: 'announcement-1',
      title: '服务维护安排',
      body: '维护期间已提交的任务会继续处理，完成后可在作品页查看。',
      createdAt: DateTime(2026, 8, 24),
      endsAt: DateTime(2026, 8, 31),
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

Widget _app({double textScale = 1}) => ProviderScope(
  overrides: [metaFeedProvider.overrideWith((ref) async => _feed)],
  child: MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: const UpdatesScreen(),
  ),
);

void main() {
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

  testWidgets('updates screen expands latest entry and filters by tag', (
    tester,
  ) async {
    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();

    expect(find.text('服务版本 v3.4.0'), findsOneWidget);
    expect(find.text('服务维护安排'), findsOneWidget);
    expect(find.text('新增公告总览'), findsOneWidget);

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
}
