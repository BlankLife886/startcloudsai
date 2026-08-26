import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/starclouds_theme.dart';

enum AppNoticeType { info, success, warning, error }

abstract final class AppNotice {
  static OverlayEntry? _fallbackEntry;
  static int _fallbackSequence = 0;

  static void show(
    BuildContext context,
    String message, {
    String? title,
    AppNoticeType type = AppNoticeType.info,
    Duration duration = const Duration(seconds: 3),
    String? actionLabel,
    VoidCallback? onAction,
  }) {
    final host = AppNoticeHost.maybeOf(context);
    if (host != null) {
      host.show(
        message,
        title: title,
        type: type,
        duration: duration,
        actionLabel: actionLabel,
        onAction: onAction,
      );
      return;
    }
    _showFallback(
      context,
      message,
      title: title,
      type: type,
      duration: duration,
      actionLabel: actionLabel,
      onAction: onAction,
    );
  }

  static void info(BuildContext context, String message) =>
      show(context, message);

  static void success(BuildContext context, String message) =>
      show(context, message, type: AppNoticeType.success);

  static void warning(BuildContext context, String message) =>
      show(context, message, type: AppNoticeType.warning);

  static void error(BuildContext context, String message) =>
      show(context, message, type: AppNoticeType.error);

  static void hide(BuildContext context) {
    final host = AppNoticeHost.maybeOf(context);
    if (host != null) {
      host.hide();
    } else {
      _hideFallback();
    }
  }

  static void _showFallback(
    BuildContext context,
    String message, {
    required String? title,
    required AppNoticeType type,
    required Duration duration,
    required String? actionLabel,
    required VoidCallback? onAction,
  }) {
    final cleanMessage = message.trim();
    final cleanTitle = title?.trim();
    if (cleanMessage.isEmpty && cleanTitle?.isNotEmpty != true) return;
    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) return;
    _hideFallback();
    final data = _AppNoticeData(
      sequence: ++_fallbackSequence,
      title: cleanTitle?.isEmpty == true ? null : cleanTitle,
      message: cleanMessage,
      type: type,
      actionLabel: actionLabel?.trim(),
      onAction: onAction,
    );
    final entry = OverlayEntry(
      builder: (context) => Positioned.fill(
        child: IgnorePointer(
          ignoring: onAction == null,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Center(
                child: _AppNoticeFallback(
                  data: data,
                  duration: duration,
                  onHide: _hideFallback,
                ),
              ),
            ),
          ),
        ),
      ),
    );
    _fallbackEntry = entry;
    overlay.insert(entry);
  }

  static void _hideFallback() {
    final entry = _fallbackEntry;
    _fallbackEntry = null;
    if (entry?.mounted == true) entry!.remove();
  }
}

class AppNoticeHost extends StatefulWidget {
  const AppNoticeHost({required this.child, super.key});

  final Widget child;

  static AppNoticeHostState? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_AppNoticeScope>()?.state;

  @override
  State<AppNoticeHost> createState() => AppNoticeHostState();
}

class AppNoticeHostState extends State<AppNoticeHost> {
  Timer? _timer;
  _AppNoticeData? _notice;
  int _sequence = 0;

  void show(
    String message, {
    String? title,
    AppNoticeType type = AppNoticeType.info,
    Duration duration = const Duration(seconds: 3),
    String? actionLabel,
    VoidCallback? onAction,
  }) {
    final cleanMessage = message.trim();
    final cleanTitle = title?.trim();
    if (cleanMessage.isEmpty && cleanTitle?.isNotEmpty != true) return;
    _timer?.cancel();
    final sequence = ++_sequence;
    setState(() {
      _notice = _AppNoticeData(
        sequence: sequence,
        title: cleanTitle?.isEmpty == true ? null : cleanTitle,
        message: cleanMessage,
        type: type,
        actionLabel: actionLabel?.trim(),
        onAction: onAction,
      );
    });
    if (duration > Duration.zero) {
      _timer = Timer(duration, () {
        if (mounted && _notice?.sequence == sequence) hide();
      });
    }
  }

  void hide() {
    _timer?.cancel();
    _timer = null;
    if (mounted && _notice != null) setState(() => _notice = null);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final notice = _notice;
    return _AppNoticeScope(
      state: this,
      child: Stack(
        fit: StackFit.expand,
        children: [
          widget.child,
          Positioned.fill(
            child: IgnorePointer(
              ignoring: notice?.onAction == null,
              child: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Center(
                    child: AnimatedSwitcher(
                      duration: reduceMotion
                          ? Duration.zero
                          : const Duration(milliseconds: 180),
                      reverseDuration: reduceMotion
                          ? Duration.zero
                          : const Duration(milliseconds: 140),
                      switchInCurve: Curves.easeOutCubic,
                      switchOutCurve: Curves.easeInCubic,
                      transitionBuilder: (child, animation) => FadeTransition(
                        opacity: animation,
                        child: ScaleTransition(
                          scale: Tween<double>(begin: .96, end: 1).animate(
                            CurvedAnimation(
                              parent: animation,
                              curve: Curves.easeOutCubic,
                            ),
                          ),
                          child: child,
                        ),
                      ),
                      child: notice == null
                          ? const SizedBox.shrink()
                          : _AppNoticeCard(
                              key: ValueKey(notice.sequence),
                              data: notice,
                              onHide: hide,
                            ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AppNoticeScope extends InheritedWidget {
  const _AppNoticeScope({required this.state, required super.child});

  final AppNoticeHostState state;

  @override
  bool updateShouldNotify(_AppNoticeScope oldWidget) =>
      oldWidget.state != state;
}

class _AppNoticeData {
  const _AppNoticeData({
    required this.sequence,
    required this.title,
    required this.message,
    required this.type,
    required this.actionLabel,
    required this.onAction,
  });

  final int sequence;
  final String? title;
  final String message;
  final AppNoticeType type;
  final String? actionLabel;
  final VoidCallback? onAction;
}

class _AppNoticeFallback extends StatefulWidget {
  const _AppNoticeFallback({
    required this.data,
    required this.duration,
    required this.onHide,
  });

  final _AppNoticeData data;
  final Duration duration;
  final VoidCallback onHide;

  @override
  State<_AppNoticeFallback> createState() => _AppNoticeFallbackState();
}

class _AppNoticeFallbackState extends State<_AppNoticeFallback> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    if (widget.duration > Duration.zero) {
      _timer = Timer(widget.duration, widget.onHide);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    duration: MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 180),
    curve: Curves.easeOutCubic,
    tween: Tween(begin: 0, end: 1),
    builder: (context, value, child) => Opacity(
      opacity: value,
      child: Transform.scale(scale: .96 + (.04 * value), child: child),
    ),
    child: _AppNoticeCard(data: widget.data, onHide: widget.onHide),
  );
}

class _AppNoticeCard extends StatelessWidget {
  const _AppNoticeCard({required this.data, required this.onHide, super.key});

  final _AppNoticeData data;
  final VoidCallback onHide;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final visual = StarCloudsVisualStyle.of(context);
    final (icon, accent) = switch (data.type) {
      AppNoticeType.success => (
        Icons.check_circle_rounded,
        const Color(0xFF0F766E),
      ),
      AppNoticeType.warning => (
        Icons.warning_amber_rounded,
        const Color(0xFFD97706),
      ),
      AppNoticeType.error => (Icons.error_rounded, colors.error),
      AppNoticeType.info => (Icons.info_rounded, colors.primary),
    };
    final actionLabel = data.actionLabel;
    final onAction = data.onAction;
    return Semantics(
      container: true,
      liveRegion: true,
      label: [data.title, data.message].whereType<String>().join('，'),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 380),
        child: Material(
          key: const Key('app-notice-card'),
          color: colors.surfaceContainerLowest,
          elevation: 8,
          shadowColor: visual.shadow,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(
              color: dark
                  ? colors.outlineVariant.withValues(alpha: .55)
                  : colors.outlineVariant.withValues(alpha: .8),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 11, 10, 11),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: dark ? .22 : .11),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    icon,
                    key: Key('app-notice-${data.type.name}'),
                    size: 19,
                    color: accent,
                  ),
                ),
                const SizedBox(width: 10),
                Flexible(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (data.title case final title?) ...[
                        Text(
                          title,
                          style: Theme.of(context).textTheme.labelLarge
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        if (data.message.isNotEmpty) const SizedBox(height: 2),
                      ],
                      if (data.message.isNotEmpty)
                        Text(
                          data.message,
                          maxLines: 4,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(
                                height: 1.35,
                                fontWeight: data.title == null
                                    ? FontWeight.w600
                                    : FontWeight.w400,
                              ),
                        ),
                    ],
                  ),
                ),
                if (actionLabel?.isNotEmpty == true && onAction != null) ...[
                  const SizedBox(width: 8),
                  TextButton(
                    key: const Key('app-notice-action'),
                    onPressed: () {
                      onHide();
                      onAction();
                    },
                    child: Text(actionLabel!),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
