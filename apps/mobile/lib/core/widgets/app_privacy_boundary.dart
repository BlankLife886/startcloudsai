import 'package:flutter/material.dart';

bool appLifecycleNeedsPrivacyShield(AppLifecycleState state) => switch (state) {
  AppLifecycleState.inactive ||
  AppLifecycleState.paused ||
  AppLifecycleState.hidden => true,
  AppLifecycleState.resumed || AppLifecycleState.detached => false,
};

class AppPrivacyBoundary extends StatefulWidget {
  const AppPrivacyBoundary({required this.child, super.key});

  final Widget child;

  @override
  State<AppPrivacyBoundary> createState() => _AppPrivacyBoundaryState();
}

class _AppPrivacyBoundaryState extends State<AppPrivacyBoundary>
    with WidgetsBindingObserver {
  bool _shieldVisible = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final visible = appLifecycleNeedsPrivacyShield(state);
    if (visible == _shieldVisible || !mounted) return;
    setState(() => _shieldVisible = visible);
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        ExcludeSemantics(
          excluding: _shieldVisible,
          child: IgnorePointer(ignoring: _shieldVisible, child: widget.child),
        ),
        if (_shieldVisible) const Positioned.fill(child: _PrivacyShield()),
      ],
    );
  }
}

class _PrivacyShield extends StatelessWidget {
  const _PrivacyShield();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      key: const Key('app-privacy-shield'),
      container: true,
      label: '星空云绘，内容已隐藏',
      child: ColoredBox(
        color: colors.surface,
        child: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: colors.primaryContainer,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: SizedBox.square(
                      dimension: 48,
                      child: Icon(
                        Icons.auto_awesome_rounded,
                        color: colors.onPrimaryContainer,
                        size: 24,
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    '星空云绘',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '内容已隐藏',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
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
