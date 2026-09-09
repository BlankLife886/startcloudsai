import 'package:flutter/material.dart';

import '../../app/starclouds_theme.dart';

const _headerHeight = 40.0;

Future<T?> showAppDrawer<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  String barrierLabel = '关闭侧栏',
}) {
  final visual = StarCloudsVisualStyle.of(context);
  final reduceMotion = MediaQuery.disableAnimationsOf(context);
  return showGeneralDialog<T>(
    context: context,
    useRootNavigator: true,
    barrierDismissible: true,
    barrierLabel: barrierLabel,
    barrierColor: visual.overlay,
    transitionDuration: reduceMotion
        ? Duration.zero
        : const Duration(milliseconds: 320),
    pageBuilder: (context, animation, secondaryAnimation) =>
        SizedBox.expand(child: builder(context)),
    transitionBuilder: (context, animation, secondaryAnimation, child) {
      if (reduceMotion) return child;
      final appear = CurvedAnimation(
        parent: animation,
        curve: const Cubic(0.22, 1, 0.36, 1),
        reverseCurve: Curves.easeInCubic,
      );
      return SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(-1, 0),
          end: Offset.zero,
        ).animate(appear),
        child: child,
      );
    },
  );
}

Future<T?> showAppSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool isScrollControlled = false,
  bool useSafeArea = true,
  bool showCloseButton = true,
}) {
  final visual = StarCloudsVisualStyle.of(context);
  return showModalBottomSheet<T>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: isScrollControlled,
    useSafeArea: useSafeArea,
    enableDrag: true,
    backgroundColor: Colors.transparent,
    barrierColor: visual.overlay,
    builder: (context) => AppSheetScaffold(
      showCloseButton: showCloseButton,
      child: builder(context),
    ),
  );
}

class AppSheetScaffold extends StatelessWidget {
  const AppSheetScaffold({
    required this.child,
    this.showCloseButton = true,
    super.key,
  });

  final Widget child;
  final bool showCloseButton;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final routeAnimation = ModalRoute.of(context)?.animation;
    const radius = BorderRadius.vertical(top: Radius.circular(26));
    final sheet = DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .08),
            blurRadius: 18,
            offset: const Offset(0, -3),
          ),
        ],
      ),
      child: Material(
        color: colors.surface,
        elevation: 0,
        shadowColor: Colors.transparent,
        shape: const RoundedRectangleBorder(borderRadius: radius),
        clipBehavior: Clip.antiAlias,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final maxHeight = constraints.maxHeight.isFinite
                ? constraints.maxHeight
                : MediaQuery.sizeOf(context).height * 0.92;
            return ConstrainedBox(
              constraints: BoxConstraints(maxHeight: maxHeight),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _AppSheetHeader(showCloseButton: showCloseButton),
                  ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight: (maxHeight - _headerHeight).clamp(
                        0,
                        maxHeight,
                      ),
                    ),
                    child: child,
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
    if (reduceMotion || routeAnimation == null) return sheet;
    final appear = CurvedAnimation(
      parent: routeAnimation,
      curve: Curves.easeOutCubic,
      reverseCurve: Curves.easeInCubic,
    );
    return FadeTransition(
      opacity: Tween<double>(begin: .94, end: 1).animate(appear),
      child: sheet,
    );
  }
}

class _AppSheetHeader extends StatelessWidget {
  const _AppSheetHeader({this.showCloseButton = true});

  final bool showCloseButton;

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final routeAnimation = ModalRoute.of(context)?.animation;
    Widget header = SizedBox(
      height: _headerHeight,
      child: Stack(
        children: [
          const Positioned(top: 8, left: 0, right: 0, child: _AppSheetHandle()),
          if (showCloseButton)
            const Positioned(top: 6, right: 10, child: _AppSheetCloseButton()),
        ],
      ),
    );
    if (reduceMotion || routeAnimation == null) return header;
    return FadeTransition(
      opacity: CurvedAnimation(
        parent: routeAnimation,
        curve: const Interval(.38, 1, curve: Curves.easeOutCubic),
        reverseCurve: const Interval(0, .5, curve: Curves.easeInCubic),
      ),
      child: header,
    );
  }
}

class _AppSheetHandle extends StatelessWidget {
  const _AppSheetHandle();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '拖动关闭',
      child: Center(
        child: DecoratedBox(
          key: const Key('app-sheet-handle'),
          decoration: BoxDecoration(
            color: Colors.black,
            borderRadius: BorderRadius.circular(99),
          ),
          child: const SizedBox(width: 64, height: 5),
        ),
      ),
    );
  }
}

class _AppSheetCloseButton extends StatefulWidget {
  const _AppSheetCloseButton();

  @override
  State<_AppSheetCloseButton> createState() => _AppSheetCloseButtonState();
}

class _AppSheetCloseButtonState extends State<_AppSheetCloseButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 140),
    reverseDuration: const Duration(milliseconds: 90),
    value: 1,
    lowerBound: .88,
    upperBound: 1,
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _close() async {
    if (!MediaQuery.disableAnimationsOf(context)) {
      await _controller.reverse();
    }
    if (!mounted) return;
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      label: '关闭',
      child: GestureDetector(
        key: const Key('app-sheet-close'),
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _controller.reverse(),
        onTapCancel: () => _controller.forward(),
        onTap: _close,
        child: ScaleTransition(
          scale: CurvedAnimation(
            parent: _controller,
            curve: Curves.easeOutCubic,
            reverseCurve: Curves.easeInCubic,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: colors.surfaceContainerHighest,
              shape: BoxShape.circle,
            ),
            child: SizedBox.square(
              dimension: 28,
              child: Center(
                child: Icon(
                  Icons.close_rounded,
                  size: 16,
                  color: colors.onSurface,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
