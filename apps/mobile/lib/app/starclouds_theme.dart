import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

abstract final class StarCloudsPalette {
  static const ice = Color(0xFFE5EFFC);
  static const mist = Color(0xFFADCCEF);
  static const peach = Color(0xFFFDF0EC);
  static const sky = Color(0xFFAEE1F9);
  static const frost = Color(0xFFBDE3FB);
  static const cornflower = Color(0xFF92BCFA);
  static const lavender = Color(0xFFD3C3FC);
  static const lightBlue = Color(0xFF9AC5FC);
  static const silver = Color(0xFFD4E1E4);
  static const cyan = Color(0xFF02EFFE);
  static const azure = Color(0xFF4CAEFE);
  static const aqua = Color(0xFF00C2FA);
  static const blue = Color(0xFF005FEA);
  static const turquoise = Color(0xFF49C5EF);
  static const iris = Color(0xFF5B6FD4);
  static const periwinkle = Color(0xFFC2D1EC);
  static const steel = Color(0xFF6A92C8);
  static const blueGray = Color(0xFF9DB2DC);
  static const rose = Color(0xFFED82D5);
  static const mint = Color(0xFF6BE6CF);
  static const gold = Color(0xFFFFC87A);
}

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

  LinearGradient glassGradient({bool highContrast = false}) => LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: highContrast
        ? [panelStrong.withValues(alpha: 1), panelStrong.withValues(alpha: 1)]
        : [
            panelStrong,
            Color.lerp(panelStrong, panel, .7)!,
            panel,
            Color.lerp(panel, panelStrong, .2)!,
          ],
    stops: highContrast ? null : const [0, .32, .70, 1],
  );

  Border glassBorder({bool highContrast = false}) => Border.all(
    color: highContrast
        ? (panel.computeLuminance() < .5 ? Colors.white : Colors.black)
        : hairline,
    width: highContrast ? 1.5 : 1,
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
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 28;
  static const double pill = 999;

  static BorderRadius get control => BorderRadius.circular(md);
  static BorderRadius get card => BorderRadius.circular(lg);
  static BorderRadius get dialog => BorderRadius.circular(xl);
  static BorderRadius get media => BorderRadius.circular(md);
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
  static const primary = Color(0xFF20242B);
  static const secondary = Color(0xFF326C62);
  static const tertiary = Color(0xFF875663);
  static const ink = Color(0xFF20242B);

  static ThemeData light() => _theme(Brightness.light);
  static ThemeData dark() => _theme(Brightness.dark);

  static ColorScheme _scheme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    return ColorScheme(
      brightness: brightness,
      primary: dark ? const Color(0xFFF5F6F8) : primary,
      onPrimary: dark ? primary : Colors.white,
      primaryContainer: dark
          ? const Color(0xFF32373F)
          : const Color(0xFFE8EBEF),
      onPrimaryContainer: dark ? const Color(0xFFF3F4F6) : primary,
      secondary: dark ? const Color(0xFFA4D5C5) : secondary,
      onSecondary: dark ? const Color(0xFF173B32) : Colors.white,
      secondaryContainer: dark
          ? const Color(0xFF24463D)
          : const Color(0xFFE1F0E9),
      onSecondaryContainer: dark
          ? const Color(0xFFD1EEE2)
          : const Color(0xFF254D43),
      tertiary: dark ? const Color(0xFFE5B8C5) : tertiary,
      onTertiary: dark ? const Color(0xFF4A2935) : Colors.white,
      tertiaryContainer: dark
          ? const Color(0xFF49323C)
          : const Color(0xFFF5E7EC),
      onTertiaryContainer: dark
          ? const Color(0xFFF5D9E3)
          : const Color(0xFF603B49),
      error: dark ? const Color(0xFFFFB3B0) : const Color(0xFFCF3B4A),
      onError: dark ? const Color(0xFF680014) : Colors.white,
      errorContainer: dark ? const Color(0xFF93001A) : const Color(0xFFFFDAD8),
      onErrorContainer: dark
          ? const Color(0xFFFFDAD8)
          : const Color(0xFF5C1218),
      surface: dark ? const Color(0xFF12151B) : const Color(0xFFF2F4F8),
      onSurface: dark ? const Color(0xFFF3F4F6) : ink,
      surfaceContainerLowest: dark ? const Color(0xFF1B2028) : Colors.white,
      surfaceContainerLow: dark
          ? const Color(0xFF252A32)
          : const Color(0xFFF5F6F8),
      surfaceContainer: dark
          ? const Color(0xFF292E36)
          : const Color(0xFFEEF0F3),
      surfaceContainerHigh: dark
          ? const Color(0xFF32373F)
          : const Color(0xFFE8EBEF),
      surfaceContainerHighest: dark
          ? const Color(0xFF3B414A)
          : const Color(0xFFDFE3E8),
      onSurfaceVariant: dark
          ? const Color(0xFFBFC5CF)
          : const Color(0xFF626974),
      outline: dark ? const Color(0xFF858D98) : const Color(0xFF777F8A),
      outlineVariant: dark ? const Color(0xFF41464F) : const Color(0xFFDEE2E7),
      shadow: Colors.black,
      scrim: Colors.black,
      inverseSurface: dark ? StarCloudsPalette.ice : const Color(0xFF23242B),
      onInverseSurface: dark ? const Color(0xFF23242B) : StarCloudsPalette.ice,
      inversePrimary: dark ? primary : Colors.white,
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
      brandStart: scheme.primary,
      brandEnd: dark ? const Color(0xFFDFE3E8) : const Color(0xFF41464F),
      brandSoft: scheme.primaryContainer,
      panel: scheme.surfaceContainerLowest,
      panelStrong: scheme.surfaceContainerLowest,
      shadow: Colors.black.withValues(alpha: dark ? .18 : .045),
      hairline: Colors.white.withValues(alpha: dark ? .16 : .95),
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
      dividerColor: scheme.onSurface.withValues(alpha: .08),
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
          fontWeight: FontWeight.w700,
          fontSize: 17,
          letterSpacing: 0,
          color: scheme.onSurface,
        ),
        iconTheme: IconThemeData(color: scheme.onSurface, size: 22),
        actionsIconTheme: IconThemeData(color: scheme.onSurface, size: 22),
      ),
      cardTheme: CardThemeData(
        margin: EdgeInsets.zero,
        elevation: 0,
        color: scheme.surfaceContainerLowest,
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
        fillColor: scheme.surfaceContainerLowest,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        hintStyle: textTheme.bodyMedium?.copyWith(
          color: scheme.onSurfaceVariant,
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
          borderSide: BorderSide(color: visualStyle.hairline),
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
          backgroundColor: scheme.primary,
          foregroundColor: scheme.onPrimary,
          minimumSize: const Size(48, 52),
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
          shape: const StadiumBorder(),
          textStyle: textTheme.labelLarge?.copyWith(
            fontWeight: FontWeight.w600,
          ),
          elevation: 0,
          shadowColor: Colors.transparent,
          side: BorderSide(color: Colors.white.withValues(alpha: .5)),
        ).copyWith(animationDuration: const Duration(milliseconds: 120)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          backgroundColor: scheme.surfaceContainerLowest,
          foregroundColor: scheme.onSurface,
          minimumSize: const Size(48, 52),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: const StadiumBorder(),
          side: BorderSide(color: visualStyle.hairline),
          textStyle: textTheme.labelLarge?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ).copyWith(animationDuration: const Duration(milliseconds: 120)),
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
          backgroundColor: scheme.surfaceContainerLowest,
          minimumSize: const Size.square(44),
          highlightColor: scheme.primary.withValues(alpha: .08),
          shape: const CircleBorder(),
        ).copyWith(animationDuration: const Duration(milliseconds: 120)),
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
                ? FontWeight.w700
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
          borderRadius: StarCloudsRadii.dialog,
          side: BorderSide(color: visualStyle.hairline),
        ),
        titleTextStyle: textTheme.titleLarge?.copyWith(
          color: scheme.onSurface,
          fontWeight: FontWeight.w700,
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
        color: scheme.onSurface.withValues(alpha: .08),
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
        textStyle: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: scheme.primary,
        linearTrackColor: scheme.primaryContainer,
        circularTrackColor: scheme.primaryContainer,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: const WidgetStatePropertyAll(Colors.white),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? StarCloudsPalette.blue
              : scheme.surfaceContainerHighest,
        ),
        trackOutlineColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? StarCloudsPalette.cyan.withValues(alpha: .7)
              : scheme.outline.withValues(alpha: .55),
        ),
        overlayColor: WidgetStatePropertyAll(
          StarCloudsPalette.cyan.withValues(alpha: .12),
        ),
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
        labelStyle: textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
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
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        displayMedium: source.displayMedium?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        displaySmall: source.displaySmall?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        headlineLarge: source.headlineLarge?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        headlineMedium: source.headlineMedium?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        headlineSmall: source.headlineSmall?.copyWith(
          color: colors.onSurface,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        titleLarge: source.titleLarge?.copyWith(
          fontSize: 22,
          color: colors.onSurface,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
        titleMedium: source.titleMedium?.copyWith(
          fontSize: 17,
          color: colors.onSurface,
          fontWeight: FontWeight.w600,
          letterSpacing: 0,
        ),
        titleSmall: source.titleSmall?.copyWith(
          fontSize: 15,
          color: colors.onSurface,
          fontWeight: FontWeight.w600,
          letterSpacing: 0,
        ),
        bodyLarge: source.bodyLarge?.copyWith(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: colors.onSurface,
          letterSpacing: 0,
          height: 1.45,
        ),
        bodyMedium: source.bodyMedium?.copyWith(
          fontSize: 15,
          fontWeight: FontWeight.w400,
          color: colors.onSurface,
          letterSpacing: 0,
          height: 1.45,
        ),
        bodySmall: source.bodySmall?.copyWith(
          fontSize: 13,
          fontWeight: FontWeight.w400,
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
