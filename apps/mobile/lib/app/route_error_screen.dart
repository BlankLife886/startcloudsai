import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/widgets/app_top_bar.dart';

class RouteErrorScreen extends StatelessWidget {
  const RouteErrorScreen({
    required this.error,
    this.homeLocation = '/discover',
    super.key,
  });

  final Object? error;
  final String homeLocation;

  bool get _isMissingRoute => error is GoException;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final title = _isMissingRoute ? '页面不存在' : '页面无法打开';
    final detail = _isMissingRoute
        ? '链接可能已经失效，或该功能已调整位置。'
        : '页面加载时遇到问题，请返回首页后重试。';
    return Scaffold(
      appBar: AppTopBar(title: Text(title), fallbackLocation: homeLocation),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 32, 24, 40),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: (constraints.maxHeight - 72).clamp(
                  0,
                  double.infinity,
                ),
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 360),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox.square(
                        key: const Key('route-error-icon'),
                        dimension: 44,
                        child: Icon(
                          _isMissingRoute
                              ? Icons.link_off_rounded
                              : Icons.error_outline_rounded,
                          size: 36,
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        title,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        detail,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant,
                          height: 1.5,
                        ),
                      ),
                      const SizedBox(height: 24),
                      FilledButton.icon(
                        key: const Key('route-error-home'),
                        onPressed: () => context.go(homeLocation),
                        icon: const Icon(Icons.home_outlined),
                        label: const Text('回到首页'),
                      ),
                    ],
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
