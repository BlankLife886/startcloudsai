import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_top_bar.dart';
import 'auth.dart';

class AuthenticatedRoute extends ConsumerWidget {
  const AuthenticatedRoute({
    required this.title,
    required this.icon,
    required this.child,
    this.showBackButton = true,
    this.fallbackLocation = '/discover',
    this.loading,
    super.key,
  });

  final String title;
  final IconData icon;
  final Widget child;
  final bool showBackButton;
  final String fallbackLocation;
  final Widget? loading;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);
    return session.when(
      skipLoadingOnReload: true,
      skipLoadingOnRefresh: true,
      loading: () =>
          loading ??
          _AuthRouteScaffold(
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
  Widget build(BuildContext context) => AppStatusView(
    icon: icon,
    iconKey: const Key('authenticated-route-icon'),
    title: '登录后查看$title',
    message: '账号验证完成后将自动返回当前页面',
    actionLabel: '邮箱验证码登录',
    actionKey: const Key('authenticated-route-login'),
    actionIcon: Icons.login_rounded,
    onAction: () => context.push('/login'),
    primaryAction: true,
    embedded: true,
  );
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
  Widget build(BuildContext context) => AppStatusView(
    icon: Icons.cloud_off_outlined,
    title: '账号状态暂不可用',
    message: '请检查网络连接后重新验证账号状态',
    actionLabel: '重新检查',
    actionKey: const Key('authenticated-route-retry'),
    onAction: onRetry,
    embedded: true,
  );
}
