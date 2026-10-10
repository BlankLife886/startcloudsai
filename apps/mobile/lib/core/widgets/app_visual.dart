import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/starclouds_theme.dart';

abstract final class AppMotion {
  static const Duration press = Duration(milliseconds: 120);
  static const Duration selection = Duration(milliseconds: 160);
  static const Duration appear = Duration(milliseconds: 220);
  static const Duration content = Duration(milliseconds: 200);
  static const Curve ease = Curves.easeOutCubic;
}

class AppActivityIndicator extends StatefulWidget {
  const AppActivityIndicator({this.size = 22, super.key});

  final double size;

  @override
  State<AppActivityIndicator> createState() => _AppActivityIndicatorState();
}

class _AppActivityIndicatorState extends State<AppActivityIndicator>
    with WidgetsBindingObserver {
  bool _foreground = true;

  @override
  void initState() {
    super.initState();
    final state = WidgetsBinding.instance.lifecycleState;
    _foreground = state == null || state == AppLifecycleState.resumed;
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    setState(() => _foreground = state == AppLifecycleState.resumed);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final animate =
        _foreground &&
        TickerMode.valuesOf(context).enabled &&
        !MediaQuery.disableAnimationsOf(context);
    final indicator = CircularProgressIndicator(
      value: animate ? null : .7,
      strokeWidth: 2,
      color: Theme.of(context).colorScheme.primary,
      backgroundColor: Colors.transparent,
    );
    return SizedBox.square(dimension: widget.size, child: indicator);
  }
}

class AppPressable extends StatefulWidget {
  const AppPressable({
    required this.child,
    this.onTap,
    this.onLongPress,
    this.semanticLabel,
    this.selected,
    this.excludeChildSemantics = false,
    this.borderRadius,
    super.key,
  });

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final String? semanticLabel;
  final bool? selected;
  final bool excludeChildSemantics;
  final BorderRadius? borderRadius;

  @override
  State<AppPressable> createState() => _AppPressableState();
}

class _AppPressableState extends State<AppPressable> {
  var _pressed = false;
  var _focused = false;

  void _setPressed(bool value) {
    if (_pressed == value ||
        (widget.onTap == null && widget.onLongPress == null)) {
      return;
    }
    setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    final interactive = widget.onTap != null || widget.onLongPress != null;
    final duration = reduce ? Duration.zero : AppMotion.press;
    return Semantics(
      button: interactive,
      enabled: interactive,
      label: widget.semanticLabel,
      selected: widget.selected,
      excludeSemantics: widget.excludeChildSemantics,
      onTap: widget.onTap,
      onLongPress: widget.onLongPress,
      child: FocusableActionDetector(
        enabled: interactive,
        mouseCursor: interactive
            ? SystemMouseCursors.click
            : SystemMouseCursors.basic,
        shortcuts: const {
          SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
          SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
        },
        actions: {
          ActivateIntent: CallbackAction<ActivateIntent>(
            onInvoke: (_) {
              widget.onTap?.call();
              return null;
            },
          ),
        },
        onShowFocusHighlight: (value) {
          if (_focused != value) setState(() => _focused = value);
        },
        child: Listener(
          behavior: HitTestBehavior.opaque,
          onPointerDown: (_) => _setPressed(true),
          onPointerUp: (_) => _setPressed(false),
          onPointerCancel: (_) => _setPressed(false),
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            excludeFromSemantics: true,
            onTap: widget.onTap,
            onLongPress: widget.onLongPress,
            child: AnimatedScale(
              scale: _pressed ? .98 : 1,
              duration: duration,
              curve: AppMotion.ease,
              child: AnimatedContainer(
                duration: duration,
                curve: AppMotion.ease,
                foregroundDecoration: BoxDecoration(
                  border: Border.all(
                    color: _focused
                        ? Theme.of(context).colorScheme.primary
                        : Colors.transparent,
                    width: 2,
                  ),
                  borderRadius: widget.borderRadius ?? StarCloudsRadii.control,
                ),
                child: widget.child,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class AppGlassSurface extends StatelessWidget {
  const AppGlassSurface({
    required this.child,
    this.color,
    this.borderRadius,
    this.shadow = true,
    super.key,
  });

  final Widget child;
  final Color? color;
  final BorderRadius? borderRadius;
  final bool shadow;

  @override
  Widget build(BuildContext context) {
    final visual = StarCloudsVisualStyle.of(context);
    final highContrast = MediaQuery.highContrastOf(context);
    final radius = borderRadius ?? StarCloudsRadii.card;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: highContrast
            ? Theme.of(context).colorScheme.surfaceContainerLowest
            : color ?? visual.panel,
        borderRadius: radius,
        border: visual.glassBorder(highContrast: highContrast),
        boxShadow: shadow && !highContrast
            ? [
                BoxShadow(
                  color: visual.shadow,
                  blurRadius: 16,
                  spreadRadius: -3,
                  offset: const Offset(0, 5),
                ),
              ]
            : null,
      ),
      child: ClipRRect(borderRadius: radius, child: child),
    );
  }
}

class AppSoftCard extends StatelessWidget {
  const AppSoftCard({
    required this.child,
    this.padding,
    this.color,
    this.onTap,
    this.radius,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final Color? color;
  final VoidCallback? onTap;
  final BorderRadius? radius;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final borderRadius = radius ?? StarCloudsRadii.card;
    final content = AppGlassSurface(
      color: color == colors.surface || color == colors.surfaceContainerLow
          ? null
          : color,
      borderRadius: borderRadius,
      child: padding == null ? child : Padding(padding: padding!, child: child),
    );
    if (onTap == null) return content;
    return AppPressable(
      onTap: onTap,
      borderRadius: borderRadius,
      child: content,
    );
  }
}

class AppAppear extends StatelessWidget {
  const AppAppear({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: AppMotion.appear,
      curve: AppMotion.ease,
      builder: (context, value, child) => Opacity(
        opacity: value,
        child: Transform.translate(
          offset: Offset(0, 6 * (1 - value)),
          child: child,
        ),
      ),
      child: child,
    );
  }
}

class AppSectionLabel extends StatelessWidget {
  const AppSectionLabel(this.title, {this.action, super.key});

  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
              letterSpacing: 0,
            ),
          ),
        ),
        ?action,
      ],
    );
  }
}
