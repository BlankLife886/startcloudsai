import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';

void main() {
  test(
    'reading and action colors retain accessible contrast in both themes',
    () {
      double contrast(Color foreground, Color background) {
        final a = foreground.computeLuminance();
        final b = background.computeLuminance();
        return a > b ? (a + .05) / (b + .05) : (b + .05) / (a + .05);
      }

      for (final theme in [StarCloudsTheme.light(), StarCloudsTheme.dark()]) {
        final colors = theme.colorScheme;
        for (final pair in [
          (colors.onSurface, colors.surface),
          (colors.onSurfaceVariant, colors.surfaceContainerLow),
          (colors.onPrimary, colors.primary),
          (colors.onPrimaryContainer, colors.primaryContainer),
          (colors.onSecondary, colors.secondary),
        ]) {
          expect(contrast(pair.$1, pair.$2), greaterThanOrEqualTo(4.5));
        }
        expect(theme.textTheme.bodyMedium?.fontSize, 15);
        expect(theme.textTheme.bodyMedium?.fontWeight, FontWeight.w400);
        expect(theme.textTheme.titleMedium?.fontWeight, FontWeight.w600);
        final visual = theme.extension<StarCloudsVisualStyle>()!;
        for (final tint in [visual.panelStrong, visual.panel]) {
          for (final backdrop in [colors.surface, Colors.black, Colors.white]) {
            final rendered = Color.alphaBlend(tint, backdrop);
            expect(
              contrast(colors.onSurface, rendered),
              greaterThanOrEqualTo(4.5),
            );
            expect(
              contrast(colors.onSurfaceVariant, rendered),
              greaterThanOrEqualTo(4.5),
            );
          }
        }
      }
    },
  );

  test('global component surfaces provide distinct light and dark themes', () {
    final light = StarCloudsTheme.light();
    final dark = StarCloudsTheme.dark();

    expect(light.brightness, Brightness.light);
    expect(dark.brightness, Brightness.dark);
    expect(light.colorScheme.surface, const Color(0xFFF2F4F8));
    expect(light.colorScheme.primary, const Color(0xFF20242B));
    expect(light.colorScheme.secondaryContainer, const Color(0xFFE1F0E9));
    expect(light.colorScheme.tertiaryContainer, const Color(0xFFF5E7EC));
    expect(light.colorScheme.surfaceContainerLow, const Color(0xFFF5F6F8));
    expect(light.colorScheme.surfaceContainerLowest, Colors.white);
    expect(dark.colorScheme.surfaceContainerLowest, const Color(0xFF1B2028));
    expect(light.scaffoldBackgroundColor, const Color(0xFFF2F4F8));
    expect(light.appBarTheme.backgroundColor, const Color(0xFFF2F4F8));
    expect(light.canvasColor, const Color(0xFFF2F4F8));
    expect(dark.scaffoldBackgroundColor, dark.colorScheme.surface);
    expect(light.scaffoldBackgroundColor, isNot(dark.scaffoldBackgroundColor));

    for (final theme in [light, dark]) {
      final colors = theme.colorScheme;
      final visual = theme.extension<StarCloudsVisualStyle>()!;
      expect(visual.brandStart, isNot(visual.brandEnd));
      expect(visual.panel, colors.surfaceContainerLowest);
      expect(visual.panelStrong, visual.panel);
      expect(visual.hairline.r, 1);
      expect(visual.hairline.g, 1);
      expect(visual.hairline.b, 1);
      expect(visual.shadow.r, 0);
      expect(visual.shadow.g, 0);
      expect(visual.shadow.b, 0);
      expect(theme.filledButtonTheme.style?.backgroundBuilder, isNull);
      expect(theme.outlinedButtonTheme.style?.backgroundBuilder, isNull);
      expect(theme.iconButtonTheme.style?.backgroundBuilder, isNull);
      expect(theme.cardTheme.color, colors.surfaceContainerLowest);
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
      expect(theme.cardTheme.elevation, 0);
      expect(
        theme.filledButtonTheme.style?.minimumSize?.resolve({}),
        const Size(48, 52),
      );
      expect(
        theme.menuTheme.style?.backgroundColor?.resolve({}),
        colors.surfaceContainerLowest,
      );
      expect(
        theme.inputDecorationTheme.fillColor,
        colors.surfaceContainerLowest,
      );
      expect(theme.textTheme.headlineLarge?.letterSpacing, 0);
      expect(theme.textTheme.titleMedium?.letterSpacing, 0);
      expect(theme.appBarTheme.titleTextStyle?.letterSpacing, 0);
      final cardShape = theme.cardTheme.shape! as RoundedRectangleBorder;
      expect(cardShape.borderRadius, BorderRadius.circular(24));
      final inputBorder =
          theme.inputDecorationTheme.enabledBorder! as OutlineInputBorder;
      expect(inputBorder.borderRadius, BorderRadius.circular(16));
      expect(
        theme.pageTransitionsTheme.builders[TargetPlatform.iOS],
        isA<StarCloudsPageTransitionsBuilder>(),
      );
      expect(
        theme.pageTransitionsTheme.builders[TargetPlatform.android],
        isA<StarCloudsPageTransitionsBuilder>(),
      );
    }
    expect(StarCloudsRadii.control, BorderRadius.circular(16));
    expect(StarCloudsRadii.card, BorderRadius.circular(24));
    expect(StarCloudsRadii.dialog, BorderRadius.circular(28));
    expect(
      light.filledButtonTheme.style?.shape?.resolve({}),
      isA<StadiumBorder>(),
    );
    expect(
      light.outlinedButtonTheme.style?.shape?.resolve({}),
      isA<StadiumBorder>(),
    );
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
