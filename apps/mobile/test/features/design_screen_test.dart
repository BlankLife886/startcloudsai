import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/features/design/design_screen.dart';

void main() {
  testWidgets('design hub exposes every tool on narrow large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: const DesignScreen(),
      ),
    );

    expect(find.byKey(const Key('design-tool-text-to-image')), findsOneWidget);
    expect(find.text('文生图'), findsOneWidget);
    expect(find.bySemanticsLabel('进入文生图'), findsOneWidget);
    for (final removed in ['模型设计', '插画染色', '智能去背景']) {
      expect(find.text(removed), findsNothing);
    }
    for (final keyName in ['model-sheet', 'coloring', 'background-remove']) {
      expect(find.byKey(Key('design-tool-$keyName')), findsNothing);
    }
    expect(find.byKey(const Key('design-open-works')), findsOneWidget);
    expect(find.byKey(const Key('design-open-assets')), findsOneWidget);
    expect(find.byKey(const Key('app-top-bar-back')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('every design tool opens its processing page', (tester) async {
    final destinations = {'text-to-image': '/create'};
    final router = GoRouter(
      initialLocation: '/design',
      routes: [
        GoRoute(
          path: '/design',
          builder: (context, state) => const DesignScreen(),
        ),
        for (final destination in destinations.values)
          GoRoute(
            path: destination,
            builder: (context, state) =>
                Scaffold(body: Center(child: Text('处理页:$destination'))),
          ),
        GoRoute(
          path: '/works',
          builder: (context, state) => const SizedBox.shrink(),
        ),
        GoRoute(
          path: '/profile/assets',
          builder: (context, state) => const SizedBox.shrink(),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));

    for (final entry in destinations.entries) {
      final tool = find.byKey(Key('design-tool-${entry.key}'));
      await tester.ensureVisible(tool);
      await tester.tap(tool);
      await tester.pumpAndSettle();
      expect(find.text('处理页:${entry.value}'), findsOneWidget);
      router.go('/design');
      await tester.pumpAndSettle();
    }
    expect(tester.takeException(), isNull);
  });
}
