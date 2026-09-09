import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

@immutable
class StarCloudsVisualStyle extends ThemeExtension<StarCloudsVisualStyle> {
  const StarCloudsVisualStyle({
    required this.brandStart,
    required this.brandEnd,
    required this.brandSoft,
    required this.panel,
    required this.panelStrong,
    required this.shadow,
    required this.hairline,
    required this.overlay,
  });

  final Color brandStart;
  final Color brandEnd;
  final Color brandSoft;
  final Color panel;
  final Color panelStrong;
  final Color shadow;
  final Color hairline;
  final Color overlay;

  LinearGradient get brandGradient => LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [brandStart, brandEnd],
  );

  static StarCloudsVisualStyle of(BuildContext context) {
    final theme = Theme.of(context);
    final configured = theme.extension<StarCloudsVisualStyle>();
    if (configured != null) return configured;
    final colors = theme.colorScheme;
    return StarCloudsVisualStyle(
      brandStart: colors.primary,
      brandEnd: colors.secondary,
      brandSoft: colors.primaryContainer,
      panel: colors.surfaceContainerLow,
      panelStrong: colors.surfaceContainerLowest,
      shadow: Colors.black.withValues(alpha: .14),
      hairline: colors.outlineVariant,
      overlay: Colors.black.withValues(alpha: .46),
    );
  }

  @override
  StarCloudsVisualStyle copyWith({
    Color? brandStart,
    Color? brandEnd,
    Color? brandSoft,
    Color? panel,
    Color? panelStrong,
    Color? shadow,
    Color? hairline,
    Color? overlay,
  }) => StarCloudsVisualStyle(
    brandStart: brandStart ?? this.brandStart,
    brandEnd: brandEnd ?? this.brandEnd,
    brandSoft: brandSoft ?? this.brandSoft,
    panel: panel ?? this.panel,
    panelStrong: panelStrong ?? this.panelStrong,
    shadow: shadow ?? this.shadow,
    hairline: hairline ?? this.hairline,
    overlay: overlay ?? this.overlay,
  );

  @override
  StarCloudsVisualStyle lerp(covariant StarCloudsVisualStyle? other, double t) {
    if (other == null) return this;
    return StarCloudsVisualStyle(
      brandStart: Color.lerp(brandStart, other.brandStart, t)!,
      brandEnd: Color.lerp(brandEnd, other.brandEnd, t)!,
      brandSoft: Color.lerp(brandSoft, other.brandSoft, t)!,
      panel: Color.lerp(panel, other.panel, t)!,
      panelStrong: Color.lerp(panelStrong, other.panelStrong, t)!,
      shadow: Color.lerp(shadow, other.shadow, t)!,
      hairline: Color.lerp(hairline, other.hairline, t)!,
      overlay: Color.lerp(overlay, other.overlay, t)!,
    );
  }
}

abstract final class StarCloudsRadii {
  static const double sm = 6;
  static const double md = 8;
  static const double lg = 8;
  static const double xl = 12;
  static const double pill = 999;

  static BorderRadius get control => BorderRadius.circular(md);
  static BorderRadius get card => BorderRadius.circular(lg);
  static BorderRadius get sheet =>
      const BorderRadius.vertical(top: Radius.circular(xl));
  static BorderRadius get pillAll => BorderRadius.circular(pill);
}

class StarCloudsPageTransitionsBuilder extends PageTransitionsBuilder {
  const StarCloudsPageTransitionsBuilder({this.delegate});

  final PageTransitionsBuilder? delegate;

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (MediaQuery.disableAnimationsOf(context)) return child;

    final transitionDelegate = delegate;
    if (transitionDelegate != null) {
      return transitionDelegate.buildTransitions(
        route,
        context,
        animation,
        secondaryAnimation,
        child,
      );
    }

    final curved = CurvedAnimation(
      parent: animation,
      curve: Curves.easeOutCubic,
      reverseCurve: Curves.easeInCubic,
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0.035, 0),
          end: Offset.zero,
        ).animate(curved),
        child: child,
      ),
    );
  }
}

abstract final class StarCloudsTheme {
  static const primary = Color(0xFF4B5FE3);
  static const secondary = Color(0xFF7A5CDB);
  static const tertiary = Color(0xFFB14A9A);
  static const ink = Color(0xFF16171C);

  static ThemeData light() => _theme(Brightness.light);
  static ThemeData dark() => _theme(Brightness.dark);

  static ColorScheme _scheme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    return ColorScheme(
      brightness: brightness,
      primary: dark ? const Color(0xFFB4C0FF) : primary,
      onPrimary: dark ? const Color(0xFF152056) : Colors.white,
      primaryContainer: dark
          ? const Color(0xFF2A3368)
          : const Color(0xFFE4E8FF),
      onPrimaryContainer: dark
          ? const Color(0xFFE7EBFF)
          : const Color(0xFF1E2A6B),
      secondary: dark ? const Color(0xFFCDB8FF) : secondary,
      onSecondary: dark ? const Color(0xFF2C2158) : Colors.white,
      secondaryContainer: dark
          ? const Color(0xFF3D335F)
          : const Color(0xFFEDE7FF),
      onSecondaryContainer: dark
          ? const Color(0xFFEDE6FF)
          : const Color(0xFF2D2158),
      tertiary: dark ? const Color(0xFFF0B4E2) : tertiary,
      onTertiary: dark ? const Color(0xFF4A1A40) : Colors.white,
      tertiaryContainer: dark
          ? const Color(0xFF5A314F)
          : const Color(0xFFF8D7F0),
      onTertiaryContainer: dark
          ? const Color(0xFFFBE6F5)
          : const Color(0xFF4A1A40),
      error: dark ? const Color(0xFFFFB3B0) : const Color(0xFFCF3B4A),
      onError: dark ? const Color(0xFF680014) : Colors.white,
      errorContainer: dark ? const Color(0xFF93001A) : const Color(0xFFFFDAD8),
      onErrorContainer: dark
          ? const Color(0xFFFFDAD8)
          : const Color(0xFF5C1218),
      surface: dark ? const Color(0xFF0B0C10) : Colors.white,
      onSurface: dark ? const Color(0xFFF4F5F8) : ink,
      surfaceContainerLowest: dark
          ? const Color(0xFF13141A)
          : const Color(0xFFF7F7FA),
      surfaceContainerLow: dark
          ? const Color(0xFF181A22)
          : const Color(0xFFF2F2F7),
      surfaceContainer: dark
          ? const Color(0xFF1E2029)
          : const Color(0xFFEBEBF0),
      surfaceContainerHigh: dark
          ? const Color(0xFF252833)
          : const Color(0xFFE5E5EA),
      surfaceContainerHighest: dark
          ? const Color(0xFF2E3140)
          : const Color(0xFFDCDCE3),
      onSurfaceVariant: dark
          ? const Color(0xFFB8BCC8)
          : const Color(0xFF5C5F6A),
      outline: dark ? const Color(0xFF8B90A0) : const Color(0xFF8B8E98),
      outlineVariant: dark ? const Color(0xFF323644) : const Color(0xFFE4E4EA),
      shadow: Colors.black,
      scrim: Colors.black,
      inverseSurface: dark ? const Color(0xFFF4F5F8) : const Color(0xFF23242B),
      onInverseSurface: dark
          ? const Color(0xFF23242B)
          : const Color(0xFFF4F5F8),
      inversePrimary: dark ? primary : const Color(0xFFB4C0FF),
      surfaceTint: Colors.transparent,
    );
  }

  static ThemeData _theme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final scheme = _scheme(brightness);
    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      canvasColor: scheme.surface,
      visualDensity: VisualDensity.standard,
      applyElevationOverlayColor: false,
    );
    final textTheme = _textTheme(base.textTheme, scheme);
    final chromeStyle =
        (dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark)
            .copyWith(
              statusBarColor: Colors.transparent,
              systemNavigationBarColor: scheme.surface,
              systemNavigationBarDividerColor: Colors.transparent,
              systemNavigationBarIconBrightness: dark
                  ? Brightness.light
                  : Brightness.dark,
            );
    final visualStyle = StarCloudsVisualStyle(
      brandStart: dark ? const Color(0xFF8EA0FF) : const Color(0xFF4B5FE3),
      brandEnd: dark ? const Color(0xFFE0A8F0) : const Color(0xFF8B5CF6),
      brandSoft: dark ? const Color(0xFF2A3368) : const Color(0xFFDDE3FA),
      panel: scheme.surfaceContainerLow,
      panelStrong: scheme.surfaceContainerLowest,
      shadow: dark
          ? Colors.black.withValues(alpha: .42)
          : const Color(0xFF3B3A4A).withValues(alpha: .10),
      hairline: scheme.outlineVariant.withValues(alpha: dark ? .9 : .85),
      overlay: Colors.black.withValues(alpha: dark ? .62 : .44),
    );
    final controlShape = RoundedRectangleBorder(
      borderRadius: StarCloudsRadii.control,
    );
    final cardShape = RoundedRectangleBorder(
      borderRadius: StarCloudsRadii.card,
    );
    return base.copyWith(
      extensions: [visualStyle],
      textTheme: textTheme,
      primaryTextTheme: textTheme,
      splashFactory: NoSplash.splashFactory,
      highlightColor: Colors.transparent,
      splashColor: Colors.transparent,
      hoverColor: scheme.primary.withValues(alpha: .04),
      dividerColor: visualStyle.hairline,
      pageTransitionsTheme: PageTransitionsTheme(
        builders: {
          TargetPlatform.android: const StarCloudsPageTransitionsBuilder(),
          TargetPlatform.fuchsia: const StarCloudsPageTransitionsBuilder(),
          TargetPlatform.linux: const StarCloudsPageTransitionsBuilder(),
          TargetPlatform.windows: const StarCloudsPageTransitionsBuilder(),
          TargetPlatform.iOS: const StarCloudsPageTransitionsBuilder(
            delegate: CupertinoPageTransitionsBuilder(),
          ),
          TargetPlatform.macOS: const StarCloudsPageTransitionsBuilder(
            delegate: CupertinoPageTransitionsBuilder(),
          ),
        },
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: chromeStyle,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        titleSpacing: 0,
        toolbarHeight: 56,
        titleTextStyle: textTheme.titleMedium?.copyWith(
          fontWeight: FontWeight.w800,
          fontSize: 17,
          letterSpacing: 0,
          color: scheme.onSurface,
        ),
        iconTheme: IconThemeData(color: scheme.onSurface, size: 22),
        actionsIconTheme: IconThemeData(color: scheme.onSurface, size: 22),
      ),
      cardTheme: CardThemeData(
        margin: EdgeInsets.zero,
        elevation: 1,
        color: scheme.surface,
        surfaceTintColor: Colors.transparent,
        shadowColor: visualStyle.shadow,
        shape: cardShape,
      ),
      listTileTheme: ListTileThemeData(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        minTileHeight: 56,
        iconColor: scheme.onSurfaceVariant,
        textColor: scheme.onSurface,
        shape: controlShape,
        selectedColor: scheme.primary,
        selectedTileColor: scheme.primaryContainer.withValues(alpha: .62),
        titleTextStyle: textTheme.bodyLarge?.copyWith(
          fontWeight: FontWeight.w600,
        ),
        subtitleTextStyle: textTheme.bodySmall?.copyWith(
          color: scheme.onSurfaceVariant,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerLow,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        hintStyle: textTheme.bodyMedium?.copyWith(
          color: scheme.onSurfaceVariant.withValues(alpha: .72),
        ),
        labelStyle: textTheme.bodyMedium?.copyWith(
          color: scheme.onSurfaceVariant,
          fontWeight: FontWeight.w600,
        ),
        floatingLabelStyle: textTheme.bodyMedium?.copyWith(
          color: scheme.primary,
          fontWeight: FontWeight.w700,
        ),
        prefixIconColor: scheme.onSurfaceVariant,
        border: OutlineInputBorder(
          borderRadius: StarCloudsRadii.control,
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: StarCloudsRadii.control,
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: StarCloudsRadii.control,
          borderSide: BorderSide(color: scheme.primary, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: StarCloudsRadii.control,
          borderSide: BorderSide(color: scheme.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: StarCloudsRadii.control,
          borderSide: BorderSide(color: scheme.error, width: 1.6),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 48),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: controlShape,
          textStyle: textTheme.labelLarge?.copyWith(
            fontWeight: FontWeight.w800,
            letterSpacing: 0,
          ),
          elevation: 0,
          shadowColor: Colors.transparent,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 48),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          shape: controlShape,
          side: BorderSide(color: visualStyle.hairline),
          textStyle: textTheme.labelLarge?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(44, 44),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          shape: controlShape,
          textStyle: textTheme.labelLarge?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          minimumSize: const Size.square(44),
          highlightColor: scheme.primary.withValues(alpha: .08),
          shape: const CircleBorder(),
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        elevation: 0,
        highlightElevation: 0,
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        shape: const CircleBorder(),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: scheme.surfaceContainerLow,
        selectedColor: scheme.primaryContainer,
        secondarySelectedColor: scheme.secondaryContainer,
        disabledColor: scheme.surfaceContainer,
        side: BorderSide(color: visualStyle.hairline),
        shape: const StadiumBorder(),
        labelStyle: textTheme.labelMedium?.copyWith(
          fontWeight: FontWeight.w700,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        showCheckmark: false,
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(Size(44, 44)),
          visualDensity: VisualDensity.compact,
          shape: WidgetStatePropertyAll(controlShape),
          side: WidgetStatePropertyAll(BorderSide(color: visualStyle.hairline)),
          backgroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected)
                ? scheme.primary
                : scheme.surfaceContainerLowest,
          ),
          foregroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected)
                ? scheme.onPrimary
                : scheme.onSurfaceVariant,
          ),
          textStyle: WidgetStatePropertyAll(
            textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 68,
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        indicatorColor: Colors.transparent,
        indicatorShape: const StadiumBorder(),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => textTheme.labelSmall?.copyWith(
            color: states.contains(WidgetState.selected)
                ? scheme.primary
                : scheme.onSurfaceVariant,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w800
                : FontWeight.w500,
          ),
        ),
      ),
      navigationDrawerTheme: NavigationDrawerThemeData(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: scheme.primaryContainer,
        indicatorShape: controlShape,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surfaceContainerLowest,
        modalBackgroundColor: scheme.surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        modalElevation: 0,
        shadowColor: visualStyle.shadow,
        dragHandleColor: scheme.outline.withValues(alpha: .35),
        dragHandleSize: const Size(40, 4),
        showDragHandle: false,
        shape: RoundedRectangleBorder(borderRadius: StarCloudsRadii.sheet),
        constraints: const BoxConstraints(maxWidth: 640),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: scheme.surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: visualStyle.shadow,
        barrierColor: visualStyle.overlay,
        shape: RoundedRectangleBorder(
          borderRadius: StarCloudsRadii.card,
          side: BorderSide(color: visualStyle.hairline),
        ),
        titleTextStyle: textTheme.titleLarge?.copyWith(
          color: scheme.onSurface,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
        contentTextStyle: textTheme.bodyMedium?.copyWith(
          color: scheme.onSurfaceVariant,
          height: 1.45,
        ),
        actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      ),
      drawerTheme: DrawerThemeData(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        scrimColor: visualStyle.overlay,
        shape: const RoundedRectangleBorder(),
      ),
      dividerTheme: DividerThemeData(
        color: visualStyle.hairline,
        thickness: 1,
        space: 1,
      ),
      searchBarTheme: SearchBarThemeData(
        backgroundColor: WidgetStatePropertyAll(scheme.surfaceContainerLow),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
        overlayColor: WidgetStatePropertyAll(
          scheme.primary.withValues(alpha: .06),
        ),
        elevation: const WidgetStatePropertyAll(0),
        side: const WidgetStatePropertyAll(BorderSide.none),
        shape: const WidgetStatePropertyAll(StadiumBorder()),
        textStyle: WidgetStatePropertyAll(textTheme.bodyMedium),
        hintStyle: WidgetStatePropertyAll(
          textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
        ),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 16),
        ),
      ),
      menuTheme: MenuThemeData(
        style: MenuStyle(
          backgroundColor: WidgetStatePropertyAll(
            scheme.surfaceContainerLowest,
          ),
          surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
          elevation: const WidgetStatePropertyAll(0),
          shadowColor: WidgetStatePropertyAll(visualStyle.shadow),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(
              borderRadius: StarCloudsRadii.control,
              side: BorderSide(color: visualStyle.hairline),
            ),
          ),
          padding: const WidgetStatePropertyAll(EdgeInsets.all(8)),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: scheme.surfaceContainerLowest,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: visualStyle.shadow,
        shape: RoundedRectangleBorder(
          borderRadius: StarCloudsRadii.control,
          side: BorderSide(color: visualStyle.hairline),
        ),
        textStyle: textTheme.bodyMedium,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: dark
            ? scheme.surfaceContainerHighest
            : const Color(0xFF1C1E27),
        contentTextStyle: textTheme.bodyMedium?.copyWith(color: Colors.white),
        shape: controlShape,
        elevation: 0,
      ),
      badgeTheme: BadgeThemeData(
        backgroundColor: scheme.tertiary,
        textColor: dark ? const Color(0xFF31102F) : Colors.white,
        textStyle: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w800),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: scheme.primary,
        linearTrackColor: scheme.primaryContainer,
        circularTrackColor: scheme.primaryContainer,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? scheme.onPrimary
              : scheme.outline,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? scheme.primary
              : scheme.surfaceContainerHighest,
        ),
        trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      ),
      checkboxTheme: CheckboxThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        fillColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? scheme.primary
              : Colors.transparent,
        ),
        side: BorderSide(color: scheme.outline, width: 1.4),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? scheme.primary
              : scheme.outline,
        ),
      ),
      sliderTheme: SliderThemeData(
        activeTrackColor: scheme.primary,
        inactiveTrackColor: scheme.primaryContainer,
        thumbColor: scheme.primary,
        overlayColor: scheme.primary.withValues(alpha: .12),
        trackHeight: 4,
      ),
      tooltipTheme: TooltipThemeData(
        waitDuration: const Duration(milliseconds: 400),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: dark
              ? scheme.surfaceContainerHighest
              : const Color(0xFF1C1E27),
          borderRadius: BorderRadius.circular(8),
        ),
        textStyle: textTheme.labelMedium?.copyWith(color: Colors.white),
      ),
      dropdownMenuTheme: DropdownMenuThemeData(
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: scheme.surfaceContainerLow,
          border: OutlineInputBorder(
            borderRadius: StarCloudsRadii.control,
            borderSide: BorderSide.none,
          ),
        ),
        menuStyle: MenuStyle(
          backgroundColor: WidgetStatePropertyAll(
            scheme.surfaceContainerLowest,
          ),
          surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
          elevation: const WidgetStatePropertyAll(0),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(
              borderRadius: StarCloudsRadii.control,
              side: BorderSide(color: visualStyle.hairline),
            ),
          ),
        ),
      ),
      tabBarTheme: TabBarThemeData(
        indicatorSize: TabBarIndicatorSize.label,
        dividerColor: Colors.transparent,
        labelColor: scheme.onSurface,
        unselectedLabelColor: scheme.onSurfaceVariant,
        labelStyle: textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
        unselectedLabelStyle: textTheme.titleSmall?.copyWith(
          fontWeight: FontWeight.w600,
        ),
        indicator: UnderlineTabIndicator(
          borderSide: BorderSide(color: scheme.primary, width: 2.5),
          borderRadius: BorderRadius.circular(99),
        ),
      ),
    );
  }

  static TextTheme _textTheme(TextTheme source, ColorScheme colors) =>
      source.copyWith(
        displayLarge: source.displayLarge?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
        displayMedium: source.displayMedium?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
        displaySmall: source.displaySmall?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
        headlineLarge: source.headlineLarge?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
        headlineMedium: source.headlineMedium?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
        headlineSmall: source.headlineSmall?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
        titleLarge: source.titleLarge?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
        titleMedium: source.titleMedium?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        titleSmall: source.titleSmall?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        bodyLarge: source.bodyLarge?.copyWith(
          color: colors.onSurface,
          letterSpacing: 0,
          height: 1.45,
        ),
        bodyMedium: source.bodyMedium?.copyWith(
          color: colors.onSurface,
          letterSpacing: 0,
          height: 1.45,
        ),
        bodySmall: source.bodySmall?.copyWith(
          color: colors.onSurfaceVariant,
          letterSpacing: 0,
          height: 1.4,
        ),
        labelLarge: source.labelLarge?.copyWith(
          color: colors.onSurface,
          letterSpacing: 0,
          fontWeight: FontWeight.w700,
        ),
        labelMedium: source.labelMedium?.copyWith(
          color: colors.onSurfaceVariant,
          letterSpacing: 0,
        ),
        labelSmall: source.labelSmall?.copyWith(
          color: colors.onSurfaceVariant,
          letterSpacing: 0,
        ),
      );
}
