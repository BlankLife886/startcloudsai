import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/starclouds_theme.dart';
import '../../core/widgets/app_top_bar.dart';
import 'auth.dart';

class AuthenticatedRoute extends ConsumerWidget {
  const AuthenticatedRoute({
    required this.title,
    required this.icon,
    required this.child,
    this.showBackButton = true,
    this.fallbackLocation = '/discover',
    super.key,
  });

  final String title;
  final IconData icon;
  final Widget child;
  final bool showBackButton;
  final String fallbackLocation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);
    return session.when(
      loading: () => _AuthRouteScaffold(
        title: title,
        showBackButton: showBackButton,
        fallbackLocation: fallbackLocation,
        child: const _RouteLoading(),
      ),
      error: (error, stackTrace) => _AuthRouteScaffold(
        title: title,
        showBackButton: showBackButton,
        fallbackLocation: fallbackLocation,
        child: _RouteSessionError(
          onRetry: () => ref.read(sessionControllerProvider.notifier).refresh(),
        ),
      ),
      data: (state) => state.isAuthenticated
          ? child
          : _AuthRouteScaffold(
              title: title,
              showBackButton: showBackButton,
              fallbackLocation: fallbackLocation,
              child: _LoginRequired(title: title, icon: icon),
            ),
    );
  }
}

class _AuthRouteScaffold extends StatelessWidget {
  const _AuthRouteScaffold({
    required this.title,
    required this.showBackButton,
    required this.fallbackLocation,
    required this.child,
  });

  final String title;
  final bool showBackButton;
  final String fallbackLocation;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppTopBar(
        title: Text(title),
        showBackButton: showBackButton,
        fallbackLocation: fallbackLocation,
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: (constraints.maxHeight - 56).clamp(
                  0,
                  double.infinity,
                ),
              ),
              child: Center(child: child),
            ),
          ),
        ),
      ),
    );
  }
}

class _LoginRequired extends StatelessWidget {
  const _LoginRequired({required this.title, required this.icon});

  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 360),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              gradient: StarCloudsVisualStyle.of(context).brandGradient,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Icon(icon, size: 32, color: colors.onPrimary),
          ),
          const SizedBox(height: 18),
          Text(
            '登录后查看$title',
            textAlign: TextAlign.center,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          Text(
            '账号验证完成后将自动返回当前页面',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: colors.onSurfaceVariant,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 22),
          FilledButton.icon(
            key: const Key('authenticated-route-login'),
            onPressed: () => context.push('/login'),
            icon: const Icon(Icons.login),
            label: const Text('邮箱验证码登录'),
          ),
        ],
      ),
    );
  }
}

class _RouteLoading extends StatelessWidget {
  const _RouteLoading();

  @override
  Widget build(BuildContext context) {
    return const Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircularProgressIndicator(),
        SizedBox(height: 14),
        Text('正在检查账号状态'),
      ],
    );
  }
}

class _RouteSessionError extends StatelessWidget {
  const _RouteSessionError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          Icons.cloud_off_outlined,
          size: 48,
          color: Theme.of(context).colorScheme.error,
        ),
        const SizedBox(height: 14),
        Text(
          '账号状态暂不可用',
          textAlign: TextAlign.center,
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          onPressed: onRetry,
          icon: const Icon(Icons.refresh),
          label: const Text('重新检查'),
        ),
      ],
    );
  }
}
