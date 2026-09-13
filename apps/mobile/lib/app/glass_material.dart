import 'package:flutter/material.dart';

/// Static edge optics, isolated from text and image repaints.
class GlassBevel extends StatelessWidget {
  const GlassBevel({
    required this.radius,
    required this.cyan,
    required this.violet,
    this.pressed = false,
    this.sheen = false,
    this.animate = false,
    this.child,
    super.key,
  });

  final BorderRadius radius;
  final Color cyan;
  final Color violet;
  final bool pressed;
  final bool sheen;
  final bool animate;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final target = pressed ? 1.0 : 0.0;
    if (!animate || MediaQuery.disableAnimationsOf(context)) {
      return _paint(target);
    }
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: target, end: target),
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOutCubic,
      builder: (context, phase, child) => _paint(phase),
    );
  }

  Widget _paint(double phase) => CustomPaint(
    painter: GlassBevelPainter(
      radius: radius,
      cyan: cyan,
      violet: violet,
      pressed: pressed,
      sheen: sheen,
      phase: phase,
    ),
    child: child,
  );
}

class GlassBevelPainter extends CustomPainter {
  const GlassBevelPainter({
    required this.radius,
    required this.cyan,
    required this.violet,
    required this.pressed,
    required this.sheen,
    this.phase = 0,
  });

  final BorderRadius radius;
  final Color cyan;
  final Color violet;
  final bool pressed;
  final bool sheen;
  final double phase;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.shortestSide < 12) return;
    final rect = Offset.zero & size;
    final outer = radius.toRRect(rect).scaleRadii();
    if (sheen) {
      canvas.save();
      canvas.clipRRect(outer);
      canvas.drawRect(
        rect,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Colors.white.withValues(alpha: pressed ? .07 : .20),
              Colors.white.withValues(alpha: .025),
              Colors.black.withValues(alpha: pressed ? .2 : .10),
              Colors.white.withValues(alpha: .06),
            ],
            stops: const [0, .36, .58, 1],
          ).createShader(rect),
      );
      canvas.restore();
    }
    final rim = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6
      ..shader = SweepGradient(
        center: const Alignment(.1, -.3),
        transform: GradientRotation(phase * .35),
        colors: [
          cyan.withValues(alpha: .85),
          violet.withValues(alpha: .65),
          Colors.white.withValues(alpha: .12),
          Colors.white.withValues(alpha: .85),
          cyan.withValues(alpha: .85),
        ],
        stops: const [0, .28, .49, .76, 1],
      ).createShader(rect);
    canvas.drawRRect(outer.deflate(1), rim);
    canvas.drawRRect(
      outer.deflate(3.2),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.3
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.white.withValues(alpha: .32),
            Colors.black.withValues(alpha: .30),
            Colors.white.withValues(alpha: .18),
          ],
          stops: const [0, .65, 1],
        ).createShader(rect),
    );
    canvas.drawRRect(
      outer.deflate(5),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = .7
        ..color = Colors.white.withValues(alpha: .075),
    );
  }

  @override
  bool shouldRepaint(covariant GlassBevelPainter oldDelegate) =>
      oldDelegate.radius != radius ||
      oldDelegate.cyan != cyan ||
      oldDelegate.violet != violet ||
      oldDelegate.pressed != pressed ||
      oldDelegate.phase != phase ||
      oldDelegate.sheen != sheen;
}
