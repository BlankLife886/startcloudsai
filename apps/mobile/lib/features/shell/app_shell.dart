import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth.dart';
import '../notifications/notifications.dart';
import '../tasks/task_sync.dart';

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

class AppBottomNavigationBar extends StatelessWidget {
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

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textScale = MediaQuery.textScalerOf(context).scale(1);
    final height = 64 + ((textScale - 1).clamp(0.0, 0.6) * 20);
    final currentIndex = selectedIndex.clamp(0, 3);
    final destinations = [
      (
        label: '首页',
        semantics: '首页',
        icon: Icons.home_outlined,
        selectedIcon: Icons.home_rounded,
        showLabel: true,
      ),
      (
        label: 'AI',
        semantics: 'AI',
        icon: Icons.auto_awesome_outlined,
        selectedIcon: Icons.auto_awesome_rounded,
        showLabel: false,
      ),
      (
        label: '设计',
        semantics: activeCount > 0 ? '设计，$activeCount 个正在生成' : '设计',
        icon: Icons.palette_outlined,
        selectedIcon: Icons.palette_rounded,
        showLabel: true,
      ),
      (
        label: '我的',
        semantics: unreadNotifications > 0
            ? '我的，$unreadNotifications 条未读通知'
            : '我的',
        icon: Icons.person_outline_rounded,
        selectedIcon: Icons.person_rounded,
        showLabel: true,
      ),
    ];
    return Material(
      key: const Key('app-bottom-navigation'),
      color: colors.surface,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(
              color: colors.outlineVariant.withValues(alpha: .45),
            ),
          ),
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: height,
            child: Row(
              children: List.generate(destinations.length, (index) {
                final destination = destinations[index];
                final selected = currentIndex == index;
                Widget icon;
                if (index == 1) {
                  icon = _AiNavigationIcon(selected: selected);
                } else if (index == 2) {
                  icon = NavigationStatusIcon(
                    icon: selected
                        ? destination.selectedIcon
                        : destination.icon,
                    count: activeCount,
                    semanticsLabel: destination.label,
                    countDescription: '个正在生成',
                  );
                } else if (index == 3) {
                  icon = NavigationStatusIcon(
                    icon: selected
                        ? destination.selectedIcon
                        : destination.icon,
                    count: unreadNotifications,
                    semanticsLabel: destination.label,
                    countDescription: '条未读通知',
                  );
                } else {
                  icon = Icon(
                    selected ? destination.selectedIcon : destination.icon,
                  );
                }
                return Expanded(
                  child: _BottomNavigationItem(
                    key: Key('bottom-nav-item-$index'),
                    label: destination.label,
                    semanticsLabel: destination.semantics,
                    selected: selected,
                    showLabel: destination.showLabel,
                    icon: icon,
                    onTap: () {
                      unawaited(HapticFeedback.selectionClick());
                      onDestinationSelected(index);
                    },
                  ),
                );
              }),
            ),
          ),
        ),
      ),
    );
  }
}

class _BottomNavigationItem extends StatelessWidget {
  const _BottomNavigationItem({
    required this.label,
    required this.semanticsLabel,
    required this.selected,
    required this.showLabel,
    required this.icon,
    required this.onTap,
    super.key,
  });

  final String label;
  final String semanticsLabel;
  final bool selected;
  final bool showLabel;
  final Widget icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final foreground = selected ? colors.primary : colors.onSurfaceVariant;
    final motionDuration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 160);
    return Semantics(
      label: semanticsLabel,
      button: true,
      selected: selected,
      child: ExcludeSemantics(
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(4, 6, 4, 4),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SizedBox(
                  height: showLabel ? 38 : 44,
                  child: Center(
                    child: IconTheme(
                      data: IconThemeData(
                        color: foreground,
                        size: showLabel ? 24 : 28,
                      ),
                      child: AnimatedScale(
                        key: const Key('bottom-nav-icon-motion'),
                        scale: selected ? 1.08 : 1,
                        duration: motionDuration,
                        curve: Curves.easeOutCubic,
                        child: icon,
                      ),
                    ),
                  ),
                ),
                if (showLabel)
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: foreground,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                    ),
                  ),
              ],
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
    final iconTheme = IconTheme.of(context);
    final size = iconTheme.size ?? 28;
    return SizedBox.square(
      key: const Key('bottom-nav-ai-button'),
      dimension: size,
      child: Icon(
        selected ? Icons.auto_awesome_rounded : Icons.auto_awesome_outlined,
        color: iconTheme.color,
        size: size,
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
            label: Text(navigationBadgeLabel(safeCount)),
            child: Icon(icon),
          ),
        ),
      ),
    );
  }
}
