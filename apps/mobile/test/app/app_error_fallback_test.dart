import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/app_error_fallback.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';

Widget _app({
  required VoidCallback onRecover,
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) => MaterialApp(
  theme: brightness == Brightness.dark
      ? StarCloudsTheme.dark()
      : StarCloudsTheme.light(),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: child!,
  ),
  home: AppRenderErrorView(onRecover: onRecover),
);

void main() {
  testWidgets('release fallback hides diagnostics and recovers', (
    tester,
  ) async {
    var recovered = false;
    await tester.pumpWidget(_app(onRecover: () => recovered = true));

    expect(find.text('页面出现问题'), findsOneWidget);
    expect(find.textContaining('Exception'), findsNothing);
    expect(find.textContaining('stack'), findsNothing);
    final decoration =
        tester
                .widget<DecoratedBox>(
                  find.byKey(const Key('app-render-error-icon')),
                )
                .decoration
            as BoxDecoration;
    expect(decoration.borderRadius, BorderRadius.circular(8));

    await tester.tap(find.byKey(const Key('app-render-error-recover')));
    expect(recovered, isTrue);
  });

  testWidgets('release fallback fits narrow dark large-text layout', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 568));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(onRecover: () {}, brightness: Brightness.dark, textScale: 1.6),
    );

    expect(find.byKey(const Key('app-render-error-recover')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('configuration installs the product fallback builder', () {
    final previous = ErrorWidget.builder;
    try {
      configureReleaseErrorFallback(force: true);
      final built = ErrorWidget.builder(
        FlutterErrorDetails(exception: StateError('sensitive diagnostics')),
      );
      expect(built, isA<AppRenderErrorView>());
    } finally {
      ErrorWidget.builder = previous;
    }
  });
}
