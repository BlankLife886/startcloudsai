import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/providers.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';
import 'package:starcloudsai_mobile/features/meta/meta.dart';
import 'package:starcloudsai_mobile/features/meta/startup_announcements.dart';

class _MemoryReceiptStore implements AnnouncementReceiptStore {
  final Map<String, DateTime> values = {};

  String _key(AppAnnouncement item) => '${item.id}:${item.version}';

  @override
  Future<DateTime?> lastShown(AppAnnouncement announcement) async =>
      values[_key(announcement)];

  @override
  Future<void> recordShown(
    AppAnnouncement announcement,
    DateTime shownAt,
  ) async {
    values[_key(announcement)] = shownAt;
  }
}

AppAnnouncement _announcement({
  String id = 'release',
  String placement = 'modal',
  String frequency = 'once_per_version',
  bool allowClose = true,
  String? ctaText,
  String? ctaUrl,
  String? latestAppVersion,
  String? minimumSupportedAppVersion,
  List<String> targetPlatforms = const [],
}) => AppAnnouncement(
  id: id,
  title: '版本更新',
  body: '图片生成与 AI 助手体验已更新，请查看本次发布内容。',
  createdAt: DateTime(2026, 9, 2),
  placement: placement,
  frequency: frequency,
  allowClose: allowClose,
  ctaText: ctaText,
  ctaUrl: ctaUrl,
  latestAppVersion: latestAppVersion,
  minimumSupportedAppVersion: minimumSupportedAppVersion,
  targetPlatforms: targetPlatforms,
);

Widget _app({
  required List<AppAnnouncement> announcements,
  required AnnouncementReceiptStore store,
  Brightness brightness = Brightness.light,
  double textScale = 1,
  String? installedVersion,
  TargetPlatform targetPlatform = TargetPlatform.iOS,
  Future<bool> Function(Uri uri)? openExternal,
}) {
  final navigatorKey = GlobalKey<NavigatorState>();
  return ProviderScope(
    overrides: [
      appEnvironmentProvider.overrideWithValue(
        AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'http://localhost:8000',
        ),
      ),
      startupAnnouncementsProvider.overrideWith(
        (ref) => Future.value(announcements),
      ),
      announcementReceiptStoreProvider.overrideWithValue(store),
    ],
    child: MaterialApp(
      navigatorKey: navigatorKey,
      theme: brightness == Brightness.dark
          ? StarCloudsTheme.dark()
          : StarCloudsTheme.light(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: AppNoticeHost(
          child: StartupAnnouncements(
            navigatorContext: () => navigatorKey.currentContext,
            installedVersion: installedVersion,
            targetPlatform: targetPlatform,
            openExternal: openExternal,
            child: child ?? const SizedBox.shrink(),
          ),
        ),
      ),
      home: const Scaffold(body: Text('首页')),
    ),
  );
}

void main() {
  test('announcement parser honors presentation controls safely', () {
    final item = AppAnnouncement.fromJson({
      'id': 'notice',
      'title': '公告',
      'body': '内容',
      'createdAt': '2026-09-02T00:00:00Z',
      'config': {
        'placement': 'banner',
        'frequency': 'dismiss_hours',
        'version': 3,
        'dismissHours': 48,
        'allowClose': false,
        'closeText': '知道了',
        'ctaText': '查看',
        'ctaUrl': '/updates',
        'latestAppVersion': '2.4.0',
        'minimumSupportedAppVersion': '2.1.0',
        'targetPlatforms': ['ios', 'desktop', 'android', 'ios'],
      },
    });
    final malformed = AppAnnouncement.fromJson({
      'id': 'fallback',
      'title': '公告',
      'config': {
        'placement': 'fullscreen',
        'frequency': 'always',
        'version': -1,
        'dismissHours': 9999,
      },
    });

    expect(item.placement, 'banner');
    expect(item.frequency, 'dismiss_hours');
    expect(item.version, 3);
    expect(item.dismissHours, 48);
    expect(item.allowClose, isFalse);
    expect(item.hasAction, isTrue);
    expect(item.latestAppVersion, '2.4.0');
    expect(item.minimumSupportedAppVersion, '2.1.0');
    expect(item.targetPlatforms, ['ios', 'android']);
    expect(malformed.placement, 'modal');
    expect(malformed.frequency, 'session_once');
    expect(malformed.version, 1);
    expect(malformed.dismissHours, 720);
  });

  test('version targeting distinguishes optional and required updates', () {
    final announcement = _announcement(
      ctaText: '立即更新',
      ctaUrl: 'https://example.com/app',
      latestAppVersion: '2.3.0',
      minimumSupportedAppVersion: '2.0.0',
      targetPlatforms: const ['ios'],
    );

    expect(compareAppVersions('1.10.0', '1.9.9'), greaterThan(0));
    expect(compareAppVersions('2.0', '2.0.0+45'), 0);
    expect(
      announcementTargetsInstalledApp(
        announcement,
        installedVersion: '2.1.0',
        platform: TargetPlatform.iOS,
      ),
      isTrue,
    );
    expect(
      announcementRequiresUpdate(
        announcement,
        installedVersion: '2.1.0',
        platform: TargetPlatform.iOS,
      ),
      isFalse,
    );
    expect(
      announcementRequiresUpdate(
        announcement,
        installedVersion: '1.9.9',
        platform: TargetPlatform.iOS,
      ),
      isTrue,
    );
    expect(
      announcementTargetsInstalledApp(
        announcement,
        installedVersion: '1.9.9',
        platform: TargetPlatform.android,
      ),
      isFalse,
    );
    expect(
      announcementTargetsInstalledApp(
        announcement,
        installedVersion: '2.3.0',
        platform: TargetPlatform.iOS,
      ),
      isFalse,
    );
  });

  test('frequency rules use local calendar days and configured intervals', () {
    final now = DateTime(2026, 9, 2, 12);
    expect(
      shouldPresentAnnouncement(
        _announcement(frequency: 'session_once'),
        now.subtract(const Duration(minutes: 1)),
        now,
      ),
      isTrue,
    );
    expect(
      shouldPresentAnnouncement(
        _announcement(frequency: 'once_per_version'),
        now.subtract(const Duration(days: 10)),
        now,
      ),
      isFalse,
    );
    expect(
      shouldPresentAnnouncement(
        _announcement(frequency: 'daily'),
        DateTime(2026, 9, 1, 23, 59),
        now,
      ),
      isTrue,
    );
    expect(
      shouldPresentAnnouncement(
        AppAnnouncement(
          id: 'interval',
          title: '公告',
          body: '',
          createdAt: now,
          frequency: 'dismiss_hours',
          dismissHours: 24,
        ),
        now.subtract(const Duration(hours: 23)),
        now,
      ),
      isFalse,
    );
  });

  testWidgets('version announcement is shown once with a compact modal', (
    tester,
  ) async {
    final store = _MemoryReceiptStore();
    final announcement = _announcement();
    await tester.pumpWidget(_app(announcements: [announcement], store: store));
    await tester.pumpAndSettle();

    expect(find.text('版本更新'), findsOneWidget);
    expect(find.byKey(const Key('startup-announcement-close')), findsOneWidget);
    final card = tester.widget<Material>(
      find.byKey(const Key('app-dialog-card')),
    );
    expect(
      (card.shape as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
    await tester.tap(find.byKey(const Key('startup-announcement-close')));
    await tester.pumpAndSettle();

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(_app(announcements: [announcement], store: store));
    await tester.pumpAndSettle();
    expect(find.text('版本更新'), findsNothing);
  });

  testWidgets('non-action modal always keeps a safe close affordance', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        announcements: [_announcement(allowClose: false)],
        store: _MemoryReceiptStore(),
        brightness: Brightness.dark,
        textScale: 1.6,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('startup-announcement-close')), findsOneWidget);
    expect(find.text('图片生成与 AI 助手体验已更新，请查看本次发布内容。'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('banner announcement uses the centered notice component', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        announcements: [_announcement(placement: 'banner')],
        store: _MemoryReceiptStore(),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('app-notice-card')), findsOneWidget);
    final noticeCenter = tester.getCenter(
      find.byKey(const Key('app-notice-card')),
    );
    expect(noticeCenter.dy, closeTo(300, 80));
    expect(tester.takeException(), isNull);
  });

  testWidgets('unsupported app version stays behind a required update gate', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var openCount = 0;
    final store = _MemoryReceiptStore();
    final announcement = _announcement(
      allowClose: true,
      placement: 'banner',
      ctaText: '立即更新',
      ctaUrl: 'https://example.com/app',
      latestAppVersion: '2.0.0',
      minimumSupportedAppVersion: '1.5.0',
      targetPlatforms: const ['ios'],
    );
    await store.recordShown(announcement, DateTime(2026, 9, 2));
    await tester.pumpWidget(
      _app(
        announcements: [announcement],
        store: store,
        installedVersion: '1.0.0',
        brightness: Brightness.dark,
        textScale: 1.6,
        openExternal: (_) async {
          openCount += 1;
          return false;
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('startup-announcement-close')), findsNothing);
    expect(find.textContaining('当前版本已停止支持'), findsOneWidget);
    expect(
      find.byKey(const Key('startup-announcement-action')),
      findsOneWidget,
    );
    expect(find.byKey(const Key('app-notice-card')), findsNothing);

    await tester.tap(find.byKey(const Key('startup-announcement-action')));
    await tester.pumpAndSettle();

    expect(openCount, 1);
    expect(find.text('版本更新'), findsOneWidget);
    expect(find.text('暂时无法打开公告链接'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
