import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/starclouds_theme.dart';
import 'app_chrome.dart';

class AppTopBar extends StatelessWidget implements PreferredSizeWidget {
  const AppTopBar({
    required this.title,
    this.actions,
    this.bottom,
    this.leading,
    this.showBackButton = true,
    this.fallbackLocation = '/discover',
    this.backgroundColor,
    this.foregroundColor,
    this.toolbarHeight = 56,
    this.centerTitle = true,
    this.leadingWidth,
    super.key,
  });

  final Widget title;
  final List<Widget>? actions;
  final PreferredSizeWidget? bottom;
  final Widget? leading;
  final bool showBackButton;
  final String fallbackLocation;
  final Color? backgroundColor;
  final Color? foregroundColor;
  final double toolbarHeight;
  final bool centerTitle;
  final double? leadingWidth;

  void _goBack(BuildContext context) {
    if (context.canPop()) {
      context.pop();
      return;
    }
    context.go(fallbackLocation);
  }

  @override
  Size get preferredSize =>
      Size.fromHeight(toolbarHeight + (bottom?.preferredSize.height ?? 0));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final visual = StarCloudsVisualStyle.of(context);
    final showLeading = leading != null || showBackButton;
    final effectiveLeading =
        leading ??
        (showBackButton
            ? AppBackButton(onPressed: () => _goBack(context))
            : null);
    final titleStyle = (theme.textTheme.titleMedium ?? const TextStyle())
        .copyWith(
          fontWeight: FontWeight.w800,
          fontSize: 17,
          height: 1.15,
          letterSpacing: -0.45,
          color: foregroundColor ?? colors.onSurface,
        );

    return AppBar(
      key: const Key('app-top-bar'),
      automaticallyImplyLeading: false,
      leading: effectiveLeading,
      title: DefaultTextStyle.merge(style: titleStyle, child: title),
      actions: actions,
      bottom: bottom,
      backgroundColor: backgroundColor ?? colors.surface,
      foregroundColor: foregroundColor ?? colors.onSurface,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      toolbarHeight: toolbarHeight,
      centerTitle: centerTitle,
      leadingWidth:
          leadingWidth ??
          (leading != null
              ? 56
              : showBackButton
              ? 48
              : 12),
      titleSpacing: showLeading ? 0 : 20,
      actionsPadding: const EdgeInsets.only(right: 6),
      flexibleSpace: Align(
        alignment: Alignment.bottomCenter,
        child: ColoredBox(
          color: visual.hairline.withValues(alpha: .45),
          child: const SizedBox(width: double.infinity, height: 0.5),
        ),
      ),
    );
  }
}

class AppTopBarIconButton extends StatelessWidget {
  const AppTopBarIconButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    super.key,
  });

  final Widget icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      style: IconButton.styleFrom(
        backgroundColor: Colors.transparent,
        foregroundColor: colors.onSurface,
        highlightColor: colors.primary.withValues(alpha: .08),
        minimumSize: const Size.square(44),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        padding: EdgeInsets.zero,
      ),
      icon: icon,
    );
  }
}
