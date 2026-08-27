import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/login_screen.dart';
import '../features/auth/authenticated_route.dart';
import '../features/assistant/assistant_screen.dart';
import '../features/assets/assets_screen.dart';
import '../features/billing/purchase_center_screen.dart';
import '../features/billing/purchase_orders_screen.dart';
import '../features/benefits/benefits_screen.dart';
import '../features/checkin/checkin_screen.dart';
import '../features/create/create.dart';
import '../features/create/create_screen.dart';
import '../features/design/design_screen.dart';
import '../features/discover/discover_screen.dart';
import '../features/feedback/feedback_screen.dart';
import '../features/gallery/my_submissions_screen.dart';
import '../features/meta/updates_screen.dart';
import '../features/notifications/notification_center_screen.dart';
import '../features/profile/edit_profile_screen.dart';
import '../features/profile/appearance_settings_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/shell/app_shell.dart';
import '../features/tasks/works_screen.dart';
import '../features/tasks/task_detail_screen.dart';
import '../features/wallet/wallet_ledger_screen.dart';
import '../features/wallet/wallet_screen.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();

final appRouterProvider = Provider<GoRouter>(
  (ref) => GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/discover',
    routes: [
      GoRoute(path: '/', redirect: (context, state) => '/discover'),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            AppShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/discover',
                builder: (context, state) => DiscoverScreen(
                  initialTab: HomeDiscoverTab.fromQuery(
                    state.uri.queryParameters['tab'],
                  ),
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/ai',
                builder: (context, state) => const AuthenticatedRoute(
                  title: 'AI 助手',
                  icon: Icons.auto_awesome_outlined,
                  showBackButton: false,
                  loading: AssistantPageSkeleton(),
                  child: AssistantScreen(),
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/design',
                builder: (context, state) => const DesignScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                builder: (context, state) => const ProfileScreen(),
                routes: [
                  GoRoute(
                    parentNavigatorKey: _rootNavigatorKey,
                    path: 'submissions',
                    builder: (context, state) => const AuthenticatedRoute(
                      title: '我的投稿',
                      icon: Icons.public_outlined,
                      fallbackLocation: '/profile',
                      child: MySubmissionsScreen(),
                    ),
                  ),
                  GoRoute(
                    parentNavigatorKey: _rootNavigatorKey,
                    path: 'notifications',
                    builder: (context, state) => const AuthenticatedRoute(
                      title: '通知中心',
                      icon: Icons.notifications_outlined,
                      fallbackLocation: '/profile',
                      child: NotificationCenterScreen(),
                    ),
                  ),
                  GoRoute(
                    parentNavigatorKey: _rootNavigatorKey,
                    path: 'checkin',
                    builder: (context, state) => const AuthenticatedRoute(
                      title: '每日签到',
                      icon: Icons.calendar_month_outlined,
                      fallbackLocation: '/profile',
                      child: CheckinScreen(),
                    ),
                  ),
                  GoRoute(
                    parentNavigatorKey: _rootNavigatorKey,
                    path: 'wallet',
                    builder: (context, state) => const AuthenticatedRoute(
                      title: '积分钱包',
                      icon: Icons.account_balance_wallet_outlined,
                      fallbackLocation: '/profile',
                      child: WalletScreen(),
                    ),
                    routes: [
                      GoRoute(
                        parentNavigatorKey: _rootNavigatorKey,
                        path: 'ledger',
                        builder: (context, state) => const AuthenticatedRoute(
                          title: '积分明细',
                          icon: Icons.receipt_long_outlined,
                          fallbackLocation: '/profile/wallet',
                          child: WalletLedgerScreen(),
                        ),
                      ),
                    ],
                  ),
                  GoRoute(
                    parentNavigatorKey: _rootNavigatorKey,
                    path: 'purchases',
                    redirect: (context, state) {
                      final order = state.uri.queryParameters['order']?.trim();
                      if (order == null || order.isEmpty) return null;
                      if (state.uri.path.endsWith('/orders')) return null;
                      return '/profile/purchases/orders?order=${Uri.encodeQueryComponent(order)}';
                    },
                    builder: (context, state) => const AuthenticatedRoute(
                      title: '套餐与订单',
                      icon: Icons.shopping_bag_outlined,
                      fallbackLocation: '/profile',
                      child: PurchaseCenterScreen(),
                    ),
                    routes: [
                      GoRoute(
                        parentNavigatorKey: _rootNavigatorKey,
                        path: 'orders',
                        builder: (context, state) => AuthenticatedRoute(
                          title: '我的订单',
                          icon: Icons.receipt_long_outlined,
                          fallbackLocation: '/profile/purchases',
                          child: PurchaseOrdersScreen(
                            initialOrderId: state.uri.queryParameters['order'],
                          ),
                        ),
                      ),
                    ],
                  ),
                  GoRoute(
                    parentNavigatorKey: _rootNavigatorKey,
                    path: 'benefits',
                    builder: (context, state) => const AuthenticatedRoute(
                      title: '福利中心',
                      icon: Icons.card_giftcard_outlined,
                      fallbackLocation: '/profile',
                      child: BenefitsScreen(),
                    ),
                    routes: [
                      GoRoute(
                        parentNavigatorKey: _rootNavigatorKey,
                        path: 'trial',
                        builder: (context, state) => const AuthenticatedRoute(
                          title: '体验资格',
                          icon: Icons.auto_awesome_outlined,
                          fallbackLocation: '/profile/benefits',
                          child: TrialBenefitScreen(),
                        ),
                      ),
                      GoRoute(
                        parentNavigatorKey: _rootNavigatorKey,
                        path: 'growth',
                        builder: (context, state) => const AuthenticatedRoute(
                          title: '成长奖励',
                          icon: Icons.trending_up,
                          fallbackLocation: '/profile/benefits',
                          child: GrowthBenefitScreen(),
                        ),
                      ),
                      GoRoute(
                        parentNavigatorKey: _rootNavigatorKey,
                        path: 'group',
                        builder: (context, state) => const AuthenticatedRoute(
                          title: '好友拼团',
                          icon: Icons.groups_outlined,
                          fallbackLocation: '/profile/benefits',
                          child: GrowthGroupBenefitScreen(),
                        ),
                      ),
                    ],
                  ),
                  GoRoute(
                    parentNavigatorKey: _rootNavigatorKey,
                    path: 'assets',
                    builder: (context, state) => const AuthenticatedRoute(
                      title: '我的素材',
                      icon: Icons.collections_outlined,
                      fallbackLocation: '/profile',
                      child: AssetsScreen(),
                    ),
                  ),
                  GoRoute(
                    parentNavigatorKey: _rootNavigatorKey,
                    path: 'feedback',
                    builder: (context, state) => const AuthenticatedRoute(
                      title: '问题反馈',
                      icon: Icons.feedback_outlined,
                      fallbackLocation: '/profile',
                      child: FeedbackScreen(),
                    ),
                  ),
                  GoRoute(
                    parentNavigatorKey: _rootNavigatorKey,
                    path: 'appearance',
                    builder: (context, state) =>
                        const AppearanceSettingsScreen(),
                  ),
                  GoRoute(
                    parentNavigatorKey: _rootNavigatorKey,
                    path: 'edit',
                    builder: (context, state) => const AuthenticatedRoute(
                      title: '编辑资料',
                      icon: Icons.manage_accounts_outlined,
                      fallbackLocation: '/profile',
                      child: EditProfileScreen(),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        parentNavigatorKey: _rootNavigatorKey,
        path: '/create',
        builder: (context, state) {
          final preset = CreationPreset.fromQuery(state.uri.queryParameters);
          return CreateScreen(
            initialPrompt: preset == null
                ? state.uri.queryParameters['prompt']
                : null,
            initialPreset: preset,
          );
        },
      ),
      GoRoute(
        parentNavigatorKey: _rootNavigatorKey,
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/community',
        redirect: (context, state) => '/discover?tab=community',
      ),
      GoRoute(
        path: '/prompts',
        redirect: (context, state) => '/discover?tab=prompts',
      ),
      GoRoute(
        parentNavigatorKey: _rootNavigatorKey,
        path: '/assistant',
        builder: (context, state) => AuthenticatedRoute(
          title: 'AI 助手',
          icon: Icons.auto_awesome_outlined,
          fallbackLocation: '/discover',
          loading: const AssistantPageSkeleton(
            showBackButton: true,
            fallbackLocation: '/discover',
          ),
          child: AssistantScreen(
            initialPrompt: state.uri.queryParameters['prompt'],
            showBackButton: true,
            fallbackLocation: '/discover',
          ),
        ),
      ),
      GoRoute(
        parentNavigatorKey: _rootNavigatorKey,
        path: '/works',
        builder: (context, state) => const WorksScreen(),
        routes: [
          GoRoute(
            path: ':id',
            builder: (context, state) => AuthenticatedRoute(
              title: '作品详情',
              icon: Icons.photo_outlined,
              fallbackLocation: '/works',
              child: TaskDetailScreen(taskId: state.pathParameters['id'] ?? ''),
            ),
          ),
        ],
      ),
      GoRoute(
        path: '/background-remove',
        redirect: (context, state) => '/design',
      ),
      GoRoute(path: '/coloring', redirect: (context, state) => '/design'),
      GoRoute(path: '/model-sheet', redirect: (context, state) => '/design'),
      GoRoute(
        parentNavigatorKey: _rootNavigatorKey,
        path: '/updates',
        builder: (context, state) => const UpdatesScreen(),
      ),
    ],
  ),
);
