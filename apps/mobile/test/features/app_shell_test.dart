import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/notifications/notifications.dart';
import 'package:starcloudsai_mobile/features/shell/app_shell.dart';

const _user = AppUser(id: 'user-1', email: 'qa@example.com', username: 'QA');

class _SessionController extends SessionController {
  _SessionController(this.authenticated);

  final bool authenticated;

  @override
  Future<SessionState> build() async =>
      SessionState(user: authenticated ? _user : null);
}

void main() {
  testWidgets('bottom navigation exposes four stable destinations', (
    tester,
  ) async {
    var selected = -1;
    final haptics = <Object?>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'HapticFeedback.vibrate') {
          haptics.add(call.arguments);
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
    await tester.binding.setSurfaceSize(const Size(320, 120));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.4)),
          child: child!,
        ),
        home: Scaffold(
          bottomNavigationBar: AppBottomNavigationBar(
            selectedIndex: 0,
            onDestinationSelected: (value) => selected = value,
            activeCount: 2,
            unreadNotifications: 12,
          ),
        ),
      ),
    );

    for (final label in ['首页', '设计', '我的']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('社区'), findsNothing);
    expect(find.text('AI'), findsNothing);
    expect(find.bySemanticsLabel('AI'), findsOneWidget);
    expect(find.byType(InkWell), findsNothing);
    expect(find.byType(NavigationBar), findsNothing);
    expect(
      tester.getSize(find.byKey(const Key('bottom-nav-ai-button'))),
      const Size(28, 28),
    );
    for (var index = 0; index < 4; index += 1) {
      expect(
        tester.getSize(find.byKey(Key('bottom-nav-item-$index'))).height,
        greaterThanOrEqualTo(56),
      );
    }
    expect(find.byKey(const Key('bottom-nav-item-4')), findsNothing);
    final selectedMotion = tester.widget<AnimatedScale>(
      find.descendant(
        of: find.byKey(const Key('bottom-nav-item-0')),
        matching: find.byKey(const Key('bottom-nav-icon-motion')),
      ),
    );
    expect(selectedMotion.scale, 1.08);
    expect(selectedMotion.duration, const Duration(milliseconds: 160));
    final navigation = tester.getRect(
      find.byKey(const Key('app-bottom-navigation')),
    );
    expect(navigation.left, 0);
    expect(navigation.right, 320);
    expect(navigation.bottom, 120);
    await tester.tap(find.byKey(const Key('bottom-nav-item-2')));
    expect(selected, 2);
    expect(haptics, ['HapticFeedbackType.selectionClick']);
    expect(find.text('2'), findsOneWidget);
    expect(find.bySemanticsLabel('设计，2 个正在生成'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('bottom navigation removes motion when the system requests it', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: Scaffold(
          bottomNavigationBar: AppBottomNavigationBar(
            selectedIndex: 1,
            onDestinationSelected: (_) {},
            activeCount: 0,
            unreadNotifications: 0,
          ),
        ),
      ),
    );

    final motion = tester.widget<AnimatedScale>(
      find.descendant(
        of: find.byKey(const Key('bottom-nav-item-1')),
        matching: find.byKey(const Key('bottom-nav-icon-motion')),
      ),
    );
    expect(motion.scale, 1.08);
    expect(motion.duration, Duration.zero);
    expect(tester.takeException(), isNull);
  });

  test(
    'anonymous navigation does not request private notification data',
    () async {
      var summaryLoads = 0;
      final container = ProviderContainer(
        overrides: [
          sessionControllerProvider.overrideWith(
            () => _SessionController(false),
          ),
          notificationSummaryProvider.overrideWith((ref) async {
            summaryLoads += 1;
            return 7;
          }),
        ],
      );
      addTearDown(container.dispose);

      expect(
        await container.read(navigationNotificationCountProvider.future),
        0,
      );
      expect(summaryLoads, 0);
    },
  );

  test('authenticated navigation follows refreshed unread summary', () async {
    var summaryLoads = 0;
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(() => _SessionController(true)),
        notificationSummaryProvider.overrideWith((ref) async {
          summaryLoads += 1;
          return summaryLoads == 1 ? 7 : 3;
        }),
      ],
    );
    addTearDown(container.dispose);

    expect(await container.read(navigationNotificationCountProvider.future), 7);
    container.invalidate(notificationSummaryProvider);
    expect(await container.read(navigationNotificationCountProvider.future), 3);
    expect(summaryLoads, 2);
  });

  testWidgets('home drawer swipe is ignored when the shell is not on home', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      const MaterialApp(
        home: AppSidebarScaffold(
          drawerEnabled: false,
          body: SizedBox.expand(child: Text('not-home')),
          bottomNavigationBar: SizedBox(height: 64),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.flingFrom(const Offset(4, 320), const Offset(280, 0), 1200);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-sidebar')), findsNothing);
    expect(find.text('not-home'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('home drawer swipe does not open a sidebar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      const MaterialApp(
        home: AppSidebarScaffold(
          body: SizedBox.expand(child: Text('home')),
          bottomNavigationBar: SizedBox(height: 64),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.flingFrom(const Offset(4, 320), const Offset(280, 0), 1200);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-sidebar')), findsNothing);
    expect(find.text('home'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('home sidebar icon uses three even bars', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: Center(child: HomeSidebarIcon())),
      ),
    );

    expect(find.byType(HomeSidebarIcon), findsOneWidget);
    expect(tester.getSize(find.byType(HomeSidebarIcon)), const Size(22, 22));
    expect(tester.takeException(), isNull);
  });

  test('navigation badge formatting is bounded', () {
    expect(navigationBadgeLabel(0), '0');
    expect(navigationBadgeLabel(8), '8');
    expect(navigationBadgeLabel(99), '99');
    expect(navigationBadgeLabel(100), '99+');
  });

  testWidgets('navigation badge fits large text and exposes exact semantics', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(160, 120));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: const Scaffold(
          body: Center(
            child: NavigationStatusIcon(
              icon: Icons.person_outline,
              count: 128,
              semanticsLabel: '我的',
              countDescription: '条未读通知',
            ),
          ),
        ),
      ),
    );

    expect(find.text('99+'), findsOneWidget);
    expect(find.bySemanticsLabel('我的，128 条未读通知'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
