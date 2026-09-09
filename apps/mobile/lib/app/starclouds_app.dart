import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/widgets/app_notice.dart';
import '../core/widgets/app_privacy_boundary.dart';
import '../core/widgets/app_keyboard_dismiss.dart';
import '../core/network/api_client.dart';
import '../core/providers.dart';
import '../features/auth/auth.dart';
import '../features/notifications/notifications.dart';
import '../features/meta/startup_announcements.dart';
import '../features/tasks/task_sync.dart';
import 'app_router.dart';
import 'appearance.dart';
import 'starclouds_theme.dart';
import 'user_session_cache.dart';

final _appNoticeKey = GlobalKey<AppNoticeHostState>();

bool shouldShowNetworkStatusNotice(
  ApiNetworkStatus? previous,
  ApiNetworkStatus next,
) {
  if (previous == null ||
      previous == ApiNetworkStatus.unknown ||
      previous == next ||
      next == ApiNetworkStatus.unknown) {
    return false;
  }
  return true;
}

class StarCloudsApp extends ConsumerStatefulWidget {
  const StarCloudsApp({super.key});

  @override
  ConsumerState<StarCloudsApp> createState() => _StarCloudsAppState();
}

class _StarCloudsAppState extends ConsumerState<StarCloudsApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(taskSyncControllerProvider.notifier).resume();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    ref.read(taskSyncControllerProvider.notifier).pause();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = ref.read(taskSyncControllerProvider.notifier);
    if (state == AppLifecycleState.resumed) {
      controller.resume();
      ref.invalidate(notificationSummaryProvider);
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.hidden) {
      controller.pause();
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(appRouterProvider);
    final appearance = ref.watch(appearanceControllerProvider).asData?.value;
    ref.listen<TaskSyncState>(taskSyncControllerProvider, (previous, next) {
      if (previous?.noticeSequence == next.noticeSequence ||
          next.notice == null) {
        return;
      }
      ref.invalidate(notificationSummaryProvider);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showTaskNotice(next.notice!, router);
      });
    });
    ref.listen<AsyncValue<SessionState>>(sessionControllerProvider, (
      previous,
      next,
    ) {
      final previousSession = previous?.asData?.value;
      final currentSession = next.asData?.value;
      if (currentSession?.expired != true || previousSession?.expired == true) {
        return;
      }
      ref.read(userSessionCacheProvider).clear();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showSessionExpired(router);
      });
    });
    ref.listen<ApiNetworkStatus>(apiNetworkStatusProvider, (previous, next) {
      if (!shouldShowNetworkStatusNotice(previous, next)) return;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showNetworkNotice(next);
      });
    });
    return MaterialApp.router(
      title: '星空云绘',
      debugShowCheckedModeBanner: false,
      theme: StarCloudsTheme.light(),
      darkTheme: StarCloudsTheme.dark(),
      themeMode: appearance?.themeMode ?? ThemeMode.system,
      themeAnimationDuration: const Duration(milliseconds: 260),
      themeAnimationCurve: Curves.easeOutCubic,
      routerConfig: router,
      builder: (context, child) => AppKeyboardDismiss(
        child: AppPrivacyBoundary(
          child: AppNoticeHost(
            key: _appNoticeKey,
            child: StartupAnnouncements(
              navigatorContext: () => rootNavigatorContext,
              child: child ?? const SizedBox.shrink(),
            ),
          ),
        ),
      ),
    );
  }

  void _showSessionExpired(GoRouter router) {
    _appNoticeKey.currentState?.show(
      '账号数据已安全退出，请重新验证邮箱',
      title: '登录已过期',
      type: AppNoticeType.warning,
      duration: const Duration(seconds: 8),
      actionLabel: '重新登录',
      onAction: () => router.push('/login'),
    );
  }

  void _showNetworkNotice(ApiNetworkStatus status) {
    if (status == ApiNetworkStatus.available) {
      _appNoticeKey.currentState?.show(
        '可以继续浏览和创作',
        title: '网络已恢复',
        type: AppNoticeType.success,
      );
      return;
    }
    _appNoticeKey.currentState?.show(
      '请检查 Wi-Fi 或移动网络后再试',
      title: '网络连接不可用',
      type: AppNoticeType.warning,
      duration: Duration.zero,
      actionLabel: '重试',
      onAction: () => unawaited(_retryNetwork()),
    );
  }

  Future<void> _retryNetwork() async {
    try {
      await ref.read(apiClientProvider).get('/auth/providers');
    } catch (_) {
      if (!mounted) return;
      _appNoticeKey.currentState?.show(
        '仍无法连接服务器，请稍后重试',
        title: '网络未恢复',
        type: AppNoticeType.warning,
        duration: Duration.zero,
        actionLabel: '重试',
        onAction: () => unawaited(_retryNetwork()),
      );
    }
  }

  void _showTaskNotice(TaskSyncNotice notice, GoRouter router) {
    final task = notice.firstTask;
    final succeeded = notice.succeededCount;
    final failed = notice.failedCount;
    final title = notice.isSingle
        ? task.isSucceeded
              ? '作品生成完成'
              : '作品生成失败'
        : failed == 0
        ? '$succeeded 个作品已完成'
        : '$succeeded 个完成，$failed 个失败';
    final detail = notice.isSingle
        ? task.isSucceeded
              ? task.prompt.isEmpty
                    ? '图片已经可以查看和保存'
                    : task.prompt
              : task.errorMessage?.isNotEmpty == true
              ? task.errorMessage!
              : '打开详情查看失败原因'
        : '打开作品页查看本批任务';

    _appNoticeKey.currentState?.show(
      detail,
      title: title,
      type: failed > 0 ? AppNoticeType.error : AppNoticeType.success,
      duration: Duration(seconds: failed > 0 ? 7 : 5),
      actionLabel: '查看',
      onAction: () {
        final location = notice.isSingle ? '/works/${task.id}' : '/works';
        router.go(location);
      },
    );
  }
}
