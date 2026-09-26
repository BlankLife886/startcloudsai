import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/app/route_error_screen.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';

Widget _app({Brightness brightness = Brightness.light, double textScale = 1}) {
  final router = GoRouter(
    initialLocation: '/missing/deep-link',
    errorBuilder: (context, state) =>
        RouteErrorScreen(error: state.error, homeLocation: '/home'),
    routes: [
      GoRoute(
        path: '/home',
        builder: (context, state) => const Scaffold(body: Text('首页内容')),
      ),
    ],
  );
  return MaterialApp.router(
    theme: brightness == Brightness.dark
        ? StarCloudsTheme.dark()
        : StarCloudsTheme.light(),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    routerConfig: router,
  );
}

void main() {
  testWidgets('invalid deep link shows a recoverable product error page', (
    tester,
  ) async {
    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();

    expect(find.text('页面不存在'), findsNWidgets(2));
    expect(find.text('链接可能已经失效，或该功能已调整位置。'), findsOneWidget);
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(find.byKey(const Key('route-error-home')), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const Key('route-error-icon'))),
      const Size.square(44),
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('route-error-icon')),
        matching: find.byType(DecoratedBox),
      ),
      findsNothing,
    );

    await tester.tap(find.byKey(const Key('route-error-home')));
    await tester.pumpAndSettle();
    expect(find.text('首页内容'), findsOneWidget);
  });

  testWidgets('route error page fits narrow dark large-text layout', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_app(brightness: Brightness.dark, textScale: 1.6));
    await tester.pumpAndSettle();

    expect(find.text('页面不存在'), findsNWidgets(2));
    expect(find.byKey(const Key('route-error-home')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
