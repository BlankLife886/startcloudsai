import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

void configureReleaseErrorFallback({bool force = false}) {
  if (!kReleaseMode && !force) return;
  ErrorWidget.builder = (details) => const AppRenderErrorView();
}

class AppRenderErrorView extends StatelessWidget {
  const AppRenderErrorView({this.onRecover, super.key});

  final VoidCallback? onRecover;

  void _recover(BuildContext context) {
    final callback = onRecover;
    if (callback != null) {
      callback();
      return;
    }
    final router = GoRouter.maybeOf(context);
    if (router != null) {
      router.go('/discover');
      return;
    }
    Navigator.maybeOf(context)?.maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      key: const Key('app-render-error'),
      color: colors.surface,
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 360),
              child: Semantics(
                container: true,
                liveRegion: true,
                label: '页面出现问题，可以返回首页继续使用',
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    DecoratedBox(
                      key: const Key('app-render-error-icon'),
                      decoration: BoxDecoration(
                        color: colors.surfaceContainerLow,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: SizedBox.square(
                        dimension: 60,
                        child: Icon(
                          Icons.refresh_rounded,
                          size: 28,
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      '页面出现问题',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '当前内容没有正确显示，返回首页后可以继续使用其他功能。',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: 22),
                    FilledButton.icon(
                      key: const Key('app-render-error-recover'),
                      onPressed: () => _recover(context),
                      icon: const Icon(Icons.home_outlined),
                      label: const Text('返回首页'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
