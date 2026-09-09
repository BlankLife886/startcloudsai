import 'dart:math' as math;

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const appRefreshScrollPhysics = BouncingScrollPhysics(
  parent: AlwaysScrollableScrollPhysics(),
);

const _isFlutterTest = bool.fromEnvironment('FLUTTER_TEST');

class AppSliverRefresh extends StatelessWidget {
  const AppSliverRefresh({required this.onRefresh, super.key});

  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    return CupertinoSliverRefreshControl(
      refreshTriggerPullDistance: 86,
      refreshIndicatorExtent: 52,
      onRefresh: onRefresh,
      builder:
          (
            context,
            refreshState,
            pulledExtent,
            refreshTriggerPullDistance,
            refreshIndicatorExtent,
          ) => _AppRefreshMark(
            refreshState: refreshState,
            pulledExtent: pulledExtent,
            triggerDistance: refreshTriggerPullDistance,
          ),
    );
  }
}

class _AppRefreshMark extends StatefulWidget {
  const _AppRefreshMark({
    required this.refreshState,
    required this.pulledExtent,
    required this.triggerDistance,
  });

  final RefreshIndicatorMode refreshState;
  final double pulledExtent;
  final double triggerDistance;

  @override
  State<_AppRefreshMark> createState() => _AppRefreshMarkState();
}

class _AppRefreshMarkState extends State<_AppRefreshMark> {
  RefreshIndicatorMode? _last;

  @override
  void didUpdateWidget(covariant _AppRefreshMark oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshState == RefreshIndicatorMode.armed &&
        _last != RefreshIndicatorMode.armed) {
      HapticFeedback.mediumImpact();
    }
    _last = widget.refreshState;
  }

  @override
  Widget build(BuildContext context) {
    final progress = widget.triggerDistance <= 0
        ? 0.0
        : (widget.pulledExtent / widget.triggerDistance).clamp(0.0, 1.0);
    if (widget.refreshState == RefreshIndicatorMode.inactive && progress <= 0) {
      return const SizedBox.shrink();
    }
    final refreshing =
        widget.refreshState == RefreshIndicatorMode.refresh ||
        widget.refreshState == RefreshIndicatorMode.done;
    final appear = Curves.easeOutCubic.transform(progress);
    return Align(
      alignment: Alignment.bottomCenter,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Opacity(
          opacity: refreshing ? 1 : appear,
          child: Transform.scale(
            scale: refreshing ? 1 : 0.68 + 0.32 * appear,
            child: _AppRefreshSpinner(
              progress: refreshing ? 0.72 : (0.12 + 0.74 * progress),
              spinning:
                  refreshing &&
                  !_isFlutterTest &&
                  !MediaQuery.disableAnimationsOf(context),
            ),
          ),
        ),
      ),
    );
  }
}

class _AppRefreshSpinner extends StatefulWidget {
  const _AppRefreshSpinner({required this.progress, required this.spinning});

  final double progress;
  final bool spinning;

  @override
  State<_AppRefreshSpinner> createState() => _AppRefreshSpinnerState();
}

class _AppRefreshSpinnerState extends State<_AppRefreshSpinner>
    with SingleTickerProviderStateMixin {
  late final AnimationController _spin;

  @override
  void initState() {
    super.initState();
    _spin = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 740),
    );
    _syncSpin();
  }

  @override
  void didUpdateWidget(covariant _AppRefreshSpinner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.spinning != widget.spinning) {
      _syncSpin();
    }
  }

  void _syncSpin() {
    if (widget.spinning) {
      _spin.repeat();
    } else {
      _spin.stop();
      _spin.value = 0;
    }
  }

  @override
  void dispose() {
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    return SizedBox.square(
      dimension: 22,
      child: RepaintBoundary(
        child: AnimatedBuilder(
          animation: _spin,
          builder: (context, child) =>
              Transform.rotate(angle: _spin.value * math.pi * 2, child: child),
          child: CustomPaint(
            key: const Key('app-refresh-indicator'),
            painter: _RefreshArcPainter(
              progress: widget.progress,
              color: color,
            ),
          ),
        ),
      ),
    );
  }
}

class _RefreshArcPainter extends CustomPainter {
  const _RefreshArcPainter({required this.progress, required this.color});

  final double progress;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = 2.15;
    final rect = Offset.zero & size;
    final arc = rect.deflate(stroke / 2 + 0.4);
    final track = Paint()
      ..color = color.withValues(alpha: .16)
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(arc, 0, math.pi * 2, false, track);
    canvas.drawArc(
      arc,
      -math.pi / 2,
      math.pi * 2 * progress.clamp(0.08, 0.86),
      false,
      paint,
    );
  }

  @override
  bool shouldRepaint(covariant _RefreshArcPainter oldDelegate) =>
      oldDelegate.progress != progress || oldDelegate.color != color;
}
