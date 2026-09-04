import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';

void main() {
  test('global component surfaces provide distinct light and dark themes', () {
    final light = StarCloudsTheme.light();
    final dark = StarCloudsTheme.dark();

    expect(light.brightness, Brightness.light);
    expect(dark.brightness, Brightness.dark);
    expect(light.colorScheme.surface, Colors.white);
    expect(light.colorScheme.surfaceContainerLow, const Color(0xFFF2F2F7));
    expect(light.colorScheme.surfaceContainerLowest, const Color(0xFFF7F7FA));
    expect(light.scaffoldBackgroundColor, Colors.white);
    expect(light.appBarTheme.backgroundColor, Colors.white);
    expect(light.canvasColor, Colors.white);
    expect(dark.scaffoldBackgroundColor, dark.colorScheme.surface);
    expect(light.scaffoldBackgroundColor, isNot(dark.scaffoldBackgroundColor));

    for (final theme in [light, dark]) {
      final colors = theme.colorScheme;
      final visual = theme.extension<StarCloudsVisualStyle>()!;
      expect(visual.brandStart, isNot(visual.brandEnd));
      expect(theme.appBarTheme.backgroundColor, colors.surface);
      expect(theme.navigationBarTheme.backgroundColor, colors.surface);
      expect(
        theme.bottomSheetTheme.backgroundColor,
        colors.surfaceContainerLowest,
      );
      expect(
        theme.bottomSheetTheme.modalBackgroundColor,
        colors.surfaceContainerLowest,
      );
      expect(theme.dialogTheme.backgroundColor, colors.surfaceContainerLowest);
      expect(theme.drawerTheme.backgroundColor, colors.surface);
      expect(
        theme.searchBarTheme.backgroundColor?.resolve({}),
        colors.surfaceContainerLow,
      );
      expect(theme.cardTheme.elevation, 1);
      expect(
        theme.filledButtonTheme.style?.minimumSize?.resolve({}),
        const Size(48, 48),
      );
      expect(
        theme.menuTheme.style?.backgroundColor?.resolve({}),
        colors.surfaceContainerLowest,
      );
      expect(theme.inputDecorationTheme.fillColor, colors.surfaceContainerLow);
      expect(theme.textTheme.headlineLarge?.letterSpacing, 0);
      expect(theme.textTheme.titleMedium?.letterSpacing, 0);
      expect(theme.appBarTheme.titleTextStyle?.letterSpacing, 0);
      final cardShape = theme.cardTheme.shape! as RoundedRectangleBorder;
      expect(cardShape.borderRadius, BorderRadius.circular(8));
      final inputBorder =
          theme.inputDecorationTheme.enabledBorder! as OutlineInputBorder;
      expect(inputBorder.borderRadius, BorderRadius.circular(8));
      expect(
        theme.pageTransitionsTheme.builders[TargetPlatform.iOS],
        isA<StarCloudsPageTransitionsBuilder>(),
      );
      expect(
        theme.pageTransitionsTheme.builders[TargetPlatform.android],
        isA<StarCloudsPageTransitionsBuilder>(),
      );
    }
    expect(StarCloudsRadii.control, BorderRadius.circular(8));
    expect(StarCloudsRadii.card, BorderRadius.circular(8));
  });

  test('system chrome stays legible in both modes', () {
    final lightStyle = StarCloudsTheme.light().appBarTheme.systemOverlayStyle;
    final darkStyle = StarCloudsTheme.dark().appBarTheme.systemOverlayStyle;

    expect(lightStyle?.statusBarIconBrightness, Brightness.dark);
    expect(lightStyle?.systemNavigationBarIconBrightness, Brightness.dark);
    expect(darkStyle?.statusBarIconBrightness, Brightness.light);
    expect(darkStyle?.systemNavigationBarIconBrightness, Brightness.light);
    expect(lightStyle?.statusBarColor, Colors.transparent);
    expect(darkStyle?.statusBarColor, Colors.transparent);
  });

  testWidgets('page transitions respect the system reduce motion setting', (
    tester,
  ) async {
    const childKey = ValueKey('route-child');
    const builder = StarCloudsPageTransitionsBuilder();
    late Widget transition;

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: Builder(
            builder: (context) {
              transition = builder.buildTransitions<void>(
                MaterialPageRoute<void>(builder: (_) => const SizedBox()),
                context,
                const AlwaysStoppedAnimation(.4),
                const AlwaysStoppedAnimation(0),
                const SizedBox(key: childKey),
              );
              return transition;
            },
          ),
        ),
      ),
    );

    expect(transition, isA<SizedBox>());
    expect(find.byKey(childKey), findsOneWidget);
  });

  testWidgets('page transitions keep motion when animations are enabled', (
    tester,
  ) async {
    const builder = StarCloudsPageTransitionsBuilder();
    late Widget transition;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            transition = builder.buildTransitions<void>(
              MaterialPageRoute<void>(builder: (_) => const SizedBox()),
              context,
              const AlwaysStoppedAnimation(.4),
              const AlwaysStoppedAnimation(0),
              const SizedBox(),
            );
            return transition;
          },
        ),
      ),
    );

    expect(transition, isA<FadeTransition>());
    expect((transition as FadeTransition).child, isA<SlideTransition>());
  });
}
