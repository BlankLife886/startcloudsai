import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth.dart';
import '../notifications/notifications.dart';
import '../tasks/task_sync.dart';
import '../../core/widgets/app_visual.dart';
import '../../app/starclouds_theme.dart';

final navigationNotificationCountProvider = FutureProvider<int>((ref) async {
  final session = await ref.watch(sessionControllerProvider.future);
  if (!session.isAuthenticated) return 0;
  return ref.watch(notificationSummaryProvider.future);
});

String navigationBadgeLabel(int count) => count > 99 ? '99+' : '$count';

class AppShell extends ConsumerWidget {
  const AppShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  void _select(int index) {
    navigationShell.goBranch(
      index,
      initialLocation: index == navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeCount = ref.watch(
      taskSyncControllerProvider.select((state) => state.activeCount),
    );
    final unreadNotifications =
        ref.watch(navigationNotificationCountProvider).asData?.value ?? 0;
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: AppBottomNavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: _select,
        activeCount: activeCount,
        unreadNotifications: unreadNotifications,
      ),
    );
  }
}

class AppSidebarScaffold extends StatefulWidget {
  const AppSidebarScaffold({
    required this.body,
    required this.bottomNavigationBar,
    this.drawerEnabled = false,
    super.key,
  });

  final Widget body;
  final Widget bottomNavigationBar;
  final bool drawerEnabled;

  @override
  State<AppSidebarScaffold> createState() => _AppSidebarScaffoldState();
}

class _AppSidebarScaffoldState extends State<AppSidebarScaffold> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();

  void _openDrawer() {
    if (!widget.drawerEnabled) return;
    _scaffoldKey.currentState?.openDrawer();
  }

  void _closeDrawerIfNeeded(AppSidebarScaffold oldWidget) {
    if (oldWidget.drawerEnabled && !widget.drawerEnabled) {
      _scaffoldKey.currentState?.closeDrawer();
    }
  }

  @override
  void didUpdateWidget(covariant AppSidebarScaffold oldWidget) {
    super.didUpdateWidget(oldWidget);
    _closeDrawerIfNeeded(oldWidget);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      drawer: widget.drawerEnabled ? const _EmptyAppSidebar() : null,
      drawerEnableOpenDragGesture: widget.drawerEnabled,
      body: AppSidebarScope(onOpen: _openDrawer, child: widget.body),
      bottomNavigationBar: widget.bottomNavigationBar,
    );
  }
}

class AppSidebarScope extends InheritedWidget {
  const AppSidebarScope({
    required this.onOpen,
    required super.child,
    super.key,
  });

  final VoidCallback onOpen;

  static void open(BuildContext context) {
    context.dependOnInheritedWidgetOfExactType<AppSidebarScope>()?.onOpen();
  }

  @override
  bool updateShouldNotify(AppSidebarScope oldWidget) =>
      oldWidget.onOpen != onOpen;
}

class HomeSidebarIcon extends StatelessWidget {
  const HomeSidebarIcon({this.size = 22, super.key});

  final double size;

  @override
  Widget build(BuildContext context) {
    final color =
        IconTheme.of(context).color ?? Theme.of(context).colorScheme.onSurface;
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(painter: _HomeSidebarIconPainter(color: color)),
    );
  }
}

class _HomeSidebarIconPainter extends CustomPainter {
  const _HomeSidebarIconPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.85
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    final inset = size.width * 0.14;
    final start = Offset(inset, 0);
    final end = Offset(size.width - inset, 0);
    for (final t in const [0.29, 0.50, 0.71]) {
      final dy = size.height * t;
      canvas.drawLine(start.translate(0, dy), end.translate(0, dy), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _HomeSidebarIconPainter oldDelegate) =>
      oldDelegate.color != color;
}

class _EmptyAppSidebar extends StatelessWidget {
  const _EmptyAppSidebar();

  @override
  Widget build(BuildContext context) {
    final width = (MediaQuery.sizeOf(context).width * 0.82).clamp(240.0, 320.0);
    return Drawer(
      key: const Key('home-sidebar'),
      width: width,
      shape: const RoundedRectangleBorder(),
      child: SafeArea(
        child: Align(
          alignment: Alignment.topLeft,
          child: IconButton(
            key: const Key('home-sidebar-close'),
            tooltip: '收起侧栏',
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.close_rounded),
          ),
        ),
      ),
    );
  }
}

class AppBottomNavigationBar extends StatefulWidget {
  const AppBottomNavigationBar({
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.activeCount,
    required this.unreadNotifications,
    super.key,
  });

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final int activeCount;
  final int unreadNotifications;

  static const destinationCount = 5;

  @override
  State<AppBottomNavigationBar> createState() => _AppBottomNavigationBarState();
}

enum _NavigationGesture { none, drag, hold }

class _AppBottomNavigationBarState extends State<AppBottomNavigationBar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _position;
  _NavigationGesture _gesture = _NavigationGesture.none;
  int _previewIndex = 0;
  int _selectionEpoch = 0;

  static const _lastIndex = AppBottomNavigationBar.destinationCount - 1;

  int get _selected => widget.selectedIndex.clamp(0, _lastIndex);
  bool get _scrubbing => _gesture != _NavigationGesture.none;

  @override
  void initState() {
    super.initState();
    _previewIndex = _selected;
    _position = AnimationController(
      vsync: this,
      lowerBound: 0,
      upperBound: _lastIndex.toDouble(),
      value: _selected.toDouble(),
      duration: const Duration(milliseconds: 260),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context) && !_scrubbing) {
      _position.stop();
      _position.value = _selected.toDouble();
    }
  }

  @override
  void didUpdateWidget(covariant AppBottomNavigationBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedIndex != widget.selectedIndex) {
      _selectionEpoch++;
      _gesture = _NavigationGesture.none;
      _previewIndex = _selected;
      _settle(_selected);
    }
  }

  @override
  void dispose() {
    _gesture = _NavigationGesture.none;
    _selectionEpoch++;
    _position.dispose();
    super.dispose();
  }

  void _settle(int index) {
    final target = index.clamp(0, _lastIndex).toDouble();
    if (MediaQuery.disableAnimationsOf(context)) {
      _position.stop();
      _position.value = target;
    } else {
      _position.animateTo(target, curve: Curves.easeOutCubic);
    }
  }

  double _positionAt(double x, double width, TextDirection direction) {
    if (width <= 0 || !width.isFinite) return _selected.toDouble();
    final logicalX = direction == TextDirection.rtl ? width - x : x;
    return (logicalX / (width / AppBottomNavigationBar.destinationCount) - .5)
        .clamp(0.0, _lastIndex.toDouble());
  }

  void _begin(
    _NavigationGesture gesture,
    double x,
    double width,
    TextDirection direction,
  ) {
    _selectionEpoch++;
    _position.stop();
    setState(() {
      _gesture = gesture;
      _previewIndex = _selected;
    });
    _move(gesture, x, width, direction);
  }

  void _move(
    _NavigationGesture gesture,
    double x,
    double width,
    TextDirection direction,
  ) {
    if (_gesture != gesture) return;
    final position = _positionAt(x, width, direction);
    _position.value = position;
    final preview = position.round();
    if (_previewIndex != preview) {
      setState(() => _previewIndex = preview);
      unawaited(HapticFeedback.selectionClick());
    }
  }

  void _finish(_NavigationGesture gesture) {
    if (_gesture != gesture) return;
    final target = _previewIndex;
    setState(() => _gesture = _NavigationGesture.none);
    if (target == _selected) {
      _settle(_selected);
    } else {
      _requestSelection(target);
    }
  }

  void _cancel(_NavigationGesture gesture) {
    if (!mounted || !_scrubbing || _gesture != gesture) return;
    _selectionEpoch++;
    setState(() {
      _gesture = _NavigationGesture.none;
      _previewIndex = _selected;
    });
    _settle(_selected);
  }

  void _requestSelection(int index) {
    final epoch = ++_selectionEpoch;
    _settle(index);
    widget.onDestinationSelected(index);
    // The parent remains authoritative if navigation is rejected or redirected.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || epoch != _selectionEpoch || _scrubbing) return;
      if (_selected != index) _settle(_selected);
    });
  }

  void _tap(int index) {
    setState(() => _gesture = _NavigationGesture.none);
    unawaited(HapticFeedback.selectionClick());
    _requestSelection(index);
  }

  @override
  Widget build(BuildContext context) {
    final textScale = MediaQuery.textScalerOf(context).scale(1);
    final height = 76 + ((textScale - 1).clamp(0.0, 1.0) * 16);
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final highContrast = MediaQuery.highContrastOf(context);
    final direction = Directionality.of(context);
    final currentIndex = _scrubbing ? _previewIndex : _selected;
    final destinations = [
      (
        label: '首页',
        semantics: '首页',
        icon: Icons.home_outlined,
        selectedIcon: Icons.home_rounded,
      ),
      (
        label: '设计',
        semantics: widget.activeCount > 0
            ? '设计，${widget.activeCount} 个正在生成'
            : '设计',
        icon: Icons.palette_outlined,
        selectedIcon: Icons.palette_rounded,
      ),
      (
        label: '助手',
        semantics: '助手',
        icon: Icons.auto_awesome_outlined,
        selectedIcon: Icons.auto_awesome_rounded,
      ),
      (
        label: '订单',
        semantics: '订单',
        icon: Icons.receipt_long_outlined,
        selectedIcon: Icons.receipt_long_rounded,
      ),
      (
        label: '我的',
        semantics: widget.unreadNotifications > 0
            ? '我的，${widget.unreadNotifications} 条未读通知'
            : '我的',
        icon: Icons.person_outline_rounded,
        selectedIcon: Icons.person_rounded,
      ),
    ];
    assert(destinations.length == AppBottomNavigationBar.destinationCount);
    return Material(
      key: const Key('app-bottom-navigation'),
      color: Colors.transparent,
      child: SafeArea(
        top: false,
        child: Align(
          heightFactor: 1,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
              child: _NavigationFrame(
                key: const Key('bottom-nav-frame'),
                borderRadius: StarCloudsRadii.dialog,
                child: SizedBox(
                  height: height,
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final width = constraints.maxWidth;
                      final slot = width / destinations.length;
                      // Flutter can report an accepted drag's cancellation as an end.
                      return Listener(
                        onPointerCancel: (_) => _cancel(_gesture),
                        child: GestureDetector(
                          key: const Key('bottom-nav-track'),
                          behavior: HitTestBehavior.opaque,
                          excludeFromSemantics: true,
                          onHorizontalDragStart: (details) => _begin(
                            _NavigationGesture.drag,
                            details.localPosition.dx,
                            width,
                            direction,
                          ),
                          onHorizontalDragUpdate: (details) => _move(
                            _NavigationGesture.drag,
                            details.localPosition.dx,
                            width,
                            direction,
                          ),
                          onHorizontalDragEnd: (_) =>
                              _finish(_NavigationGesture.drag),
                          onHorizontalDragCancel: () =>
                              _cancel(_NavigationGesture.drag),
                          onLongPressStart: (details) => _begin(
                            _NavigationGesture.hold,
                            details.localPosition.dx,
                            width,
                            direction,
                          ),
                          onLongPressMoveUpdate: (details) => _move(
                            _NavigationGesture.hold,
                            details.localPosition.dx,
                            width,
                            direction,
                          ),
                          onLongPressEnd: (_) =>
                              _finish(_NavigationGesture.hold),
                          onLongPressCancel: () =>
                              _cancel(_NavigationGesture.hold),
                          child: AnimatedBuilder(
                            animation: _position,
                            builder: (context, child) {
                              final value = _position.value.clamp(
                                0.0,
                                _lastIndex.toDouble(),
                              );
                              final physicalIndex =
                                  direction == TextDirection.rtl
                                  ? _lastIndex - value
                                  : value;
                              return Stack(
                                children: [
                                  Positioned(
                                    left: physicalIndex * slot + 4,
                                    top: 4,
                                    bottom: 4,
                                    width: (slot - 8).clamp(0.0, width),
                                    child: IgnorePointer(
                                      child: SizedBox(
                                        key: const Key('bottom-nav-selection'),
                                        child: AnimatedScale(
                                          scale: _scrubbing && !reduceMotion
                                              ? 1.025
                                              : 1,
                                          duration: reduceMotion
                                              ? Duration.zero
                                              : AppMotion.press,
                                          curve: AppMotion.ease,
                                          child: highContrast
                                              ? DecoratedBox(
                                                  decoration: BoxDecoration(
                                                    color: Colors.white,
                                                    borderRadius:
                                                        StarCloudsRadii.pillAll,
                                                  ),
                                                )
                                              : _NavigationFrame(
                                                  selection: true,
                                                  borderRadius:
                                                      StarCloudsRadii.pillAll,
                                                  child:
                                                      const SizedBox.expand(),
                                                ),
                                        ),
                                      ),
                                    ),
                                  ),
                                  Row(
                                    children: List.generate(
                                      destinations.length,
                                      (index) {
                                        final destination = destinations[index];
                                        final selected = currentIndex == index;
                                        final coverage =
                                            (1 - (value - index).abs() * 2)
                                                .clamp(0.0, 1.0);
                                        final foreground = Color.lerp(
                                          _NavigationPalette.muted,
                                          highContrast
                                              ? _NavigationPalette.ink
                                              : Colors.white,
                                          coverage,
                                        )!;
                                        final iconData = selected
                                            ? destination.selectedIcon
                                            : destination.icon;
                                        final Widget icon = switch (index) {
                                          1 => NavigationStatusIcon(
                                            icon: iconData,
                                            count: widget.activeCount,
                                            semanticsLabel: destination.label,
                                            countDescription: '个正在生成',
                                          ),
                                          2 => _AiNavigationIcon(
                                            selected: selected,
                                          ),
                                          4 => NavigationStatusIcon(
                                            icon: iconData,
                                            count: widget.unreadNotifications,
                                            semanticsLabel: destination.label,
                                            countDescription: '条未读通知',
                                          ),
                                          _ => Icon(iconData),
                                        };
                                        return Expanded(
                                          child: _BottomNavigationItem(
                                            key: Key('bottom-nav-item-$index'),
                                            label: destination.label,
                                            semanticsLabel:
                                                destination.semantics,
                                            selected: selected,
                                            foreground: foreground,
                                            icon: icon,
                                            onTap: () => _tap(index),
                                          ),
                                        );
                                      },
                                    ),
                                  ),
                                ],
                              );
                            },
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

abstract final class _NavigationPalette {
  static const ink = Color(0xFF20242B);
  static const muted = Color(0xFFBBC1CB);
  static const selected = Color(0xFF484E58);
}

class _NavigationFrame extends StatelessWidget {
  const _NavigationFrame({
    required this.child,
    required this.borderRadius,
    this.selection = false,
    super.key,
  });

  final Widget child;
  final BorderRadius borderRadius;
  final bool selection;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final highContrast = MediaQuery.highContrastOf(context);
    final borderColor = highContrast
        ? Colors.white
        : Colors.white.withValues(
            alpha: selection
                ? .5
                : dark
                ? .26
                : .18,
          );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: selection
            ? _NavigationPalette.selected
            : highContrast
            ? Colors.black
            : null,
        gradient: selection || highContrast
            ? null
            : LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: dark
                    ? const [Color(0xFF262A32), Color(0xFF191C23)]
                    : const [Color(0xFF30343C), Color(0xFF20242B)],
              ),
        borderRadius: borderRadius,
        border: Border.all(color: borderColor, width: highContrast ? 1.5 : 1),
        boxShadow: selection || highContrast
            ? null
            : [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? .3 : .18),
                  blurRadius: 20,
                  spreadRadius: -2,
                  offset: const Offset(0, 7),
                ),
              ],
      ),
      child: ClipRRect(borderRadius: borderRadius, child: child),
    );
  }
}

class _BottomNavigationItem extends StatelessWidget {
  const _BottomNavigationItem({
    required this.label,
    required this.semanticsLabel,
    required this.selected,
    required this.foreground,
    required this.icon,
    required this.onTap,
    super.key,
  });

  final String label;
  final String semanticsLabel;
  final bool selected;
  final Color foreground;
  final Widget icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final motionDuration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : AppMotion.selection;
    return Semantics(
      label: semanticsLabel,
      button: true,
      selected: selected,
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          type: MaterialType.transparency,
          child: InkResponse(
            onTap: onTap,
            containedInkWell: true,
            customBorder: const StadiumBorder(),
            splashFactory: NoSplash.splashFactory,
            highlightColor: Colors.transparent,
            focusColor: Colors.white.withValues(alpha: .16),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(4, 6, 4, 4),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    height: 40,
                    child: Center(
                      child: IconTheme(
                        data: IconThemeData(color: foreground, size: 24),
                        child: AnimatedScale(
                          key: const Key('bottom-nav-icon-motion'),
                          scale: selected ? 1.04 : 1,
                          duration: motionDuration,
                          curve: Curves.easeOutCubic,
                          child: icon,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    label,
                    textScaler: MediaQuery.textScalerOf(
                      context,
                    ).clamp(maxScaleFactor: 2),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: foreground,
                      fontSize: 11,
                      height: 1.2,
                      fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AiNavigationIcon extends StatelessWidget {
  const _AiNavigationIcon({required this.selected});

  final bool selected;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      key: const Key('bottom-nav-ai-button'),
      width: 38,
      height: 38,
      duration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : AppMotion.selection,
      curve: AppMotion.ease,
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: selected ? 2 : 1),
      ),
      child: Icon(
        selected ? Icons.auto_awesome_rounded : Icons.auto_awesome_outlined,
        color: _NavigationPalette.ink,
        size: 23,
      ),
    );
  }
}

class NavigationStatusIcon extends StatelessWidget {
  const NavigationStatusIcon({
    required this.icon,
    required this.count,
    required this.semanticsLabel,
    required this.countDescription,
    super.key,
  });

  final IconData icon;
  final int count;
  final String semanticsLabel;
  final String countDescription;

  @override
  Widget build(BuildContext context) {
    final safeCount = count < 0 ? 0 : count;
    return Semantics(
      label: safeCount > 0
          ? '$semanticsLabel，$safeCount $countDescription'
          : semanticsLabel,
      child: ExcludeSemantics(
        child: SizedBox.square(
          dimension: 24,
          child: Badge(
            isLabelVisible: safeCount > 0,
            offset: const Offset(0, -4),
            textStyle: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 0,
            ),
            label: Text(
              navigationBadgeLabel(safeCount),
              textScaler: MediaQuery.textScalerOf(
                context,
              ).clamp(maxScaleFactor: 1.2),
            ),
            child: Icon(icon),
          ),
        ),
      ),
    );
  }
}
