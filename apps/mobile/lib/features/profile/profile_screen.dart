import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/providers.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_visual.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/authenticated_image.dart';
import '../../app/appearance.dart';
import '../assets/assets.dart';
import '../auth/auth.dart';
import '../benefits/benefits.dart';
import '../checkin/checkin.dart';
import '../gallery/gallery.dart';
import '../meta/meta.dart';
import '../notifications/notifications.dart';
import 'profile.dart';
import 'profile_avatar.dart';
import 'app_info.dart';

Future<void> _refreshProfile(WidgetRef ref) async {
  ref.invalidate(walletProvider);
  ref.invalidate(profileOverviewProvider);
  ref.invalidate(myGallerySubmissionsProvider);
  ref.invalidate(gallerySubmissionSummaryProvider);
  ref.invalidate(notificationSummaryProvider);
  ref.invalidate(checkinControllerProvider);
  ref.invalidate(latestChangelogProvider);
  ref.invalidate(benefitsControllerProvider);
  ref.invalidate(assetCenterControllerProvider);
  await Future.wait([
    ref.read(profileOverviewProvider.future),
    ref.read(sessionControllerProvider.notifier).refresh(),
  ]);
}

Uri? profileWebsiteUri(String value) {
  final raw = value.trim();
  if (raw.isEmpty) return null;
  final candidate = Uri.tryParse(raw)?.hasScheme == true ? raw : 'https://$raw';
  final uri = Uri.tryParse(candidate);
  if (uri == null ||
      !{'http', 'https'}.contains(uri.scheme) ||
      uri.host.isEmpty) {
    return null;
  }
  return uri;
}

abstract final class _ProfileLayout {
  static const inset = 20.0;
  static const block = 10.0;
  static const section = 20.0;
  static const radius = 24.0;
  static const avatar = 36.0;
  static const action = 36.0;
  static bool stackedPair(BuildContext context) {
    final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
    return MediaQuery.sizeOf(context).width < 360 || scale > 1.35;
  }
}

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({this.openExternal, super.key});

  final Future<bool> Function(Uri uri)? openExternal;

  Future<void> _openWebsite(BuildContext context, String value) async {
    final uri = profileWebsiteUri(value);
    if (uri == null) {
      AppNotice.warning(context, '个人网站地址不可用');
      return;
    }
    try {
      final opened = await (openExternal ?? _launchExternal)(uri);
      if (context.mounted && !opened) {
        AppNotice.error(context, '暂时无法打开个人网站');
      }
    } catch (_) {
      if (context.mounted) AppNotice.error(context, '暂时无法打开个人网站');
    }
  }

  Future<bool> _launchExternal(Uri uri) =>
      launchUrl(uri, mode: LaunchMode.externalApplication);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);
    final environment = ref.watch(appEnvironmentProvider);
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: AppTopBar(
        title: const Text('我的'),
        showBackButton: false,
        backgroundColor: Theme.of(context).colorScheme.surface,
      ),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: session.when(
            skipLoadingOnReload: true,
            skipLoadingOnRefresh: true,
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, stackTrace) => Center(
              child: OutlinedButton.icon(
                onPressed: () =>
                    ref.read(sessionControllerProvider.notifier).refresh(),
                icon: const Icon(Icons.refresh),
                label: const Text('重新检查账号'),
              ),
            ),
            data: (state) {
              if (!state.isAuthenticated) {
                return _AnonymousProfile(environmentLabel: environment.label);
              }
              return _SignedInProfile(
                user: state.user!,
                environmentLabel: environment.label,
                onOpenWebsite: () =>
                    _openWebsite(context, state.user!.websiteUrl),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _AnonymousProfile extends StatelessWidget {
  const _AnonymousProfile({required this.environmentLabel});

  final String environmentLabel;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        const _ProfileHeroShell(
          child: AppGlassSurface(
            key: Key('profile-account-panel'),
            child: Padding(
              padding: EdgeInsets.all(20),
              child: _AnonymousIdentity(),
            ),
          ),
        ),
        _ProfileSection(
          title: '我的创作',
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: _ProfileQuickAction(
                    key: const Key('profile-quick-works'),
                    title: '我的作品',
                    icon: Icons.photo_library_outlined,
                    onTap: () => context.push('/works'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _ProfileQuickAction(
                    key: const Key('profile-quick-assets'),
                    title: '我的素材',
                    icon: Icons.collections_outlined,
                    onTap: () => context.push('/profile/assets'),
                  ),
                ),
              ],
            ),
          ),
        ),
        _ProfileSection(
          title: '设置与支持',
          child: _ProfileActionGrid(
            children: [
              const _AppearanceTile(),
              _ProfileActionCell(
                key: const Key('profile-help'),
                icon: Icons.help_outline_rounded,
                title: '帮助中心',
                accent: Theme.of(context).colorScheme.onSurfaceVariant,
                onTap: () => context.push('/help'),
              ),
              _AboutTile(environmentLabel: environmentLabel),
            ],
          ),
        ),
        const _ProfileLegalLinks(),
      ],
    );
  }
}

class _AnonymousIdentity extends StatelessWidget {
  const _AnonymousIdentity();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dark = colors.brightness == Brightness.dark;
    final identity = Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 56,
          height: 56,
          padding: const EdgeInsets.all(9),
          decoration: BoxDecoration(
            color: dark
                ? Colors.white.withValues(alpha: .06)
                : const Color(0xFFF5F6F8),
            shape: BoxShape.circle,
            border: Border.all(
              color: Colors.white.withValues(alpha: dark ? .16 : 1),
            ),
          ),
          child: Image.asset(
            'assets/brand/brand_mark.png',
            cacheWidth: 168,
            excludeFromSemantics: true,
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '星空账号',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '未登录',
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ],
    );
    final signIn = FilledButton.icon(
      key: const Key('profile-login'),
      onPressed: () => context.push('/login'),
      icon: const Icon(Icons.login_rounded, size: 18),
      label: const Text('登录'),
      style:
          FilledButton.styleFrom(
            backgroundColor: dark ? Colors.white : const Color(0xFF20242B),
            foregroundColor: dark ? const Color(0xFF20242B) : Colors.white,
            minimumSize: const Size(100, 44),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            side: BorderSide(color: Colors.white.withValues(alpha: .5)),
            elevation: 0,
          ).copyWith(
            backgroundBuilder: (context, states, child) =>
                child ?? const SizedBox.shrink(),
          ),
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked =
            constraints.maxWidth < 300 ||
            MediaQuery.textScalerOf(context).scale(1) > 1.3;
        if (stacked) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [identity, const SizedBox(height: 16), signIn],
          );
        }
        return Row(
          children: [
            Expanded(child: identity),
            const SizedBox(width: 16),
            signIn,
          ],
        );
      },
    );
  }
}

class _ProfileQuickAction extends StatelessWidget {
  const _ProfileQuickAction({
    required this.title,
    required this.icon,
    required this.onTap,
    super.key,
  });
  final String title;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => AppPressable(
    onTap: onTap,
    semanticLabel: title,
    excludeChildSemantics: true,
    borderRadius: BorderRadius.circular(24),
    child: AppGlassSurface(
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 96),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                icon,
                size: 22,
                color: Theme.of(context).colorScheme.onSurface,
              ),
              const SizedBox(height: 12),
              Text(
                title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(
                  context,
                ).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _ProfileLegalLinks extends StatelessWidget {
  const _ProfileLegalLinks();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
    child: Wrap(
      alignment: WrapAlignment.center,
      spacing: 4,
      children: [
        TextButton(
          key: const Key('profile-terms'),
          onPressed: () => context.push('/legal/terms'),
          style: TextButton.styleFrom(
            foregroundColor: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          child: const Text('用户协议'),
        ),
        TextButton(
          key: const Key('profile-privacy'),
          onPressed: () => context.push('/legal/privacy'),
          style: TextButton.styleFrom(
            foregroundColor: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          child: const Text('隐私政策'),
        ),
      ],
    ),
  );
}

class _SignedInProfile extends ConsumerWidget {
  const _SignedInProfile({
    required this.user,
    required this.environmentLabel,
    required this.onOpenWebsite,
  });

  final AppUser user;
  final String environmentLabel;
  final VoidCallback onOpenWebsite;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wallet = ref.watch(walletProvider);
    final overview = ref.watch(profileOverviewProvider);
    final checkin = ref.watch(checkinControllerProvider);
    return RefreshIndicator(
      onRefresh: () => _refreshProfile(ref),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          _ProfileHeroShell(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _ProfileIdentityHeader(
                  user: user,
                  unreadCount: overview.asData?.value.unreadNotifications ?? 0,
                  onEdit: () => context.push('/profile/edit'),
                  onOpenNotifications: () =>
                      context.push('/profile/notifications'),
                  onOpenWebsite: onOpenWebsite,
                ),
                const SizedBox(height: 22),
                _ProfileOverviewPanel(
                  wallet: wallet,
                  overview: overview,
                  onOpenWallet: () => context.push('/profile/wallet'),
                  onOpenWorks: () => context.push('/works'),
                  onOpenAssets: () => context.push('/profile/assets'),
                  onRetry: () {
                    ref.invalidate(walletProvider);
                    ref.invalidate(profileOverviewProvider);
                  },
                ),
              ],
            ),
          ),
          _ProfileSection(
            title: '内容管理',
            child: _ProfileActionGrid(
              children: [
                _SubmissionTile(overview: overview),
                const _FavoritePromptsTile(),
              ],
            ),
          ),
          _ProfileSection(
            title: '权益与服务',
            child: Column(
              children: [
                _PurchaseBanner(
                  onTap: () => context.push('/profile/purchases'),
                ),
                const SizedBox(height: _ProfileLayout.block),
                _ProfileFeaturePair(
                  left: _CheckinFeatureCard(checkin: checkin),
                  right: const _BenefitsFeatureCard(),
                ),
              ],
            ),
          ),
          _ProfileSection(
            title: '设置与支持',
            child: _ProfileActionGrid(
              children: [
                const _AppearanceTile(),
                _ProfileActionCell(
                  key: const Key('profile-help'),
                  icon: Icons.help_outline_rounded,
                  title: '帮助中心',
                  accent: Theme.of(context).colorScheme.onSurfaceVariant,
                  onTap: () => context.push('/help'),
                ),
                _ProfileActionCell(
                  icon: Icons.security_outlined,
                  title: '账号与安全',
                  accent: const Color(0xFF0F766E),
                  onTap: () => context.push('/profile/security'),
                ),
                _ProfileActionCell(
                  icon: Icons.feedback_outlined,
                  title: '问题反馈',
                  accent: const Color(0xFF0F766E),
                  onTap: () => context.push('/profile/feedback'),
                ),
                _AboutTile(environmentLabel: environmentLabel),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileHeroShell extends StatelessWidget {
  const _ProfileHeroShell({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ColoredBox(
      key: const Key('profile-hero-surface'),
      color: colors.surface,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          _ProfileLayout.inset,
          8,
          _ProfileLayout.inset,
          8,
        ),
        child: child,
      ),
    );
  }
}

class _ProfileHeroActions extends StatelessWidget {
  const _ProfileHeroActions({
    required this.unreadCount,
    required this.onOpenNotifications,
  });

  final int unreadCount;
  final VoidCallback onOpenNotifications;

  @override
  Widget build(BuildContext context) {
    return Badge(
      isLabelVisible: unreadCount > 0,
      label: Text('${unreadCount > 99 ? 99 : unreadCount}'),
      child: _ProfileHeroIconButton(
        tooltip: '查看通知',
        icon: Icons.notifications_outlined,
        onPressed: onOpenNotifications,
      ),
    );
  }
}

class _ProfileHeroIconButton extends StatelessWidget {
  const _ProfileHeroIconButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      style: IconButton.styleFrom(
        backgroundColor: Colors.transparent,
        foregroundColor: Theme.of(context).colorScheme.onSurface,
        minimumSize: const Size.square(_ProfileLayout.action),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        padding: EdgeInsets.zero,
        shape: const CircleBorder(),
      ),
      icon: _ProfileHeroIconMark(icon: icon),
    );
  }
}

class _ProfileHeroIconMark extends StatelessWidget {
  const _ProfileHeroIconMark({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: dark
            ? Colors.white.withValues(alpha: .08)
            : Colors.white.withValues(alpha: .62),
        shape: BoxShape.circle,
      ),
      child: SizedBox.square(
        dimension: _ProfileLayout.action,
        child: Icon(icon, size: 18),
      ),
    );
  }
}

class _ProfileIdentityHeader extends StatelessWidget {
  const _ProfileIdentityHeader({
    required this.user,
    required this.unreadCount,
    required this.onEdit,
    required this.onOpenNotifications,
    required this.onOpenWebsite,
  });

  final AppUser user;
  final int unreadCount;
  final VoidCallback onEdit;
  final VoidCallback onOpenNotifications;
  final VoidCallback onOpenWebsite;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final hasMeta =
        user.bio.isNotEmpty ||
        user.location.isNotEmpty ||
        user.websiteUrl.isNotEmpty;
    return AppAppear(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Tooltip(
                  message: '编辑资料',
                  child: AppPressable(
                    key: const Key('profile-edit'),
                    onTap: onEdit,
                    child: Row(
                      children: [
                        ProfileAvatar(
                          username: user.username,
                          userId: user.id,
                          avatarUrl: user.avatarUrl,
                          radius: _ProfileLayout.avatar,
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                user.username,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.titleLarge
                                    ?.copyWith(
                                      fontWeight: FontWeight.w700,
                                      letterSpacing: 0,
                                      height: 1.15,
                                    ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                user.email,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(
                                      color: colors.onSurfaceVariant,
                                      height: 1.2,
                                    ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              _ProfileHeroActions(
                unreadCount: unreadCount,
                onOpenNotifications: onOpenNotifications,
              ),
              const SizedBox(width: 8),
              Tooltip(
                message: '编辑资料',
                child: AppPressable(
                  onTap: onEdit,
                  child: const _ProfileHeroIconMark(icon: Icons.edit_outlined),
                ),
              ),
            ],
          ),
          if (hasMeta) ...[
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.only(
                left: _ProfileLayout.avatar * 2 + 14,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (user.bio.isNotEmpty)
                    Text(
                      user.bio,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(
                        context,
                      ).textTheme.bodyMedium?.copyWith(height: 1.4),
                    ),
                  if (user.location.isNotEmpty ||
                      user.websiteUrl.isNotEmpty) ...[
                    if (user.bio.isNotEmpty) const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        if (user.location.isNotEmpty)
                          _ProfileMetaChip(
                            icon: Icons.location_on_outlined,
                            text: user.location,
                          ),
                        if (user.websiteUrl.isNotEmpty)
                          _ProfileMetaChip(
                            key: const Key('profile-website'),
                            icon: Icons.open_in_new_rounded,
                            text: user.websiteUrl,
                            tooltip: '打开个人网站',
                            onTap: onOpenWebsite,
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ProfileOverviewPanel extends StatelessWidget {
  const _ProfileOverviewPanel({
    required this.wallet,
    required this.overview,
    required this.onOpenWallet,
    required this.onOpenWorks,
    required this.onOpenAssets,
    required this.onRetry,
  });

  final AsyncValue<WalletSnapshot> wallet;
  final AsyncValue<ProfileOverview> overview;
  final VoidCallback onOpenWallet;
  final VoidCallback onOpenWorks;
  final VoidCallback onOpenAssets;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final partialFailure = wallet.hasError || overview.hasError;
    final loading = wallet.isLoading || overview.isLoading;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: _ProfileMetricButton(
                key: const Key('profile-overview-wallet'),
                value: wallet.asData?.value.availablePoints.toString() ?? '--',
                label: '可用积分',
                onTap: onOpenWallet,
              ),
            ),
            Expanded(
              child: _ProfileMetricButton(
                key: const Key('profile-overview-works'),
                value:
                    overview.asData?.value.taskStats.total.toString() ?? '--',
                label: '历史记录',
                onTap: onOpenWorks,
              ),
            ),
            Expanded(
              child: _ProfileMetricButton(
                key: const Key('profile-overview-assets'),
                value: overview.asData?.value.assetCount.toString() ?? '--',
                label: '我的素材',
                onTap: onOpenAssets,
              ),
            ),
          ],
        ),
        if (loading) ...[
          const SizedBox(height: 10),
          const LinearProgressIndicator(minHeight: 2),
        ],
        if (partialFailure) ...[
          const SizedBox(height: 8),
          _ProfileDataError(onRetry: onRetry),
        ],
      ],
    );
  }
}

class _ProfileMetricButton extends StatelessWidget {
  const _ProfileMetricButton({
    required this.value,
    required this.label,
    required this.onTap,
    super.key,
  });

  final String value;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    label: '$label，$value',
    button: true,
    child: ExcludeSemantics(
      child: AppPressable(
        onTap: onTap,
        child: SizedBox(
          width: double.infinity,
          child: Column(
            children: [
              Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0,
                  height: 1.1,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _ProfileDataError extends StatelessWidget {
  const _ProfileDataError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(
        Icons.sync_problem_outlined,
        size: 17,
        color: Theme.of(context).colorScheme.error,
      ),
      const SizedBox(width: 7),
      Expanded(
        child: Text(
          '部分数据暂不可用',
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
            color: Theme.of(context).colorScheme.error,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      TextButton.icon(
        key: const Key('profile-overview-retry'),
        onPressed: onRetry,
        icon: const Icon(Icons.refresh, size: 17),
        label: const Text('重试'),
      ),
    ],
  );
}

class _ProfileSection extends StatelessWidget {
  const _ProfileSection({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        _ProfileLayout.inset,
        _ProfileLayout.section,
        _ProfileLayout.inset,
        0,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ProfileSectionTitle(title: title),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }
}

class _ProfileSectionTitle extends StatelessWidget {
  const _ProfileSectionTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) => Text(
    title,
    style: Theme.of(
      context,
    ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
  );
}

class _PurchaseBanner extends StatelessWidget {
  const _PurchaseBanner({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => _ProfileActionCell(
    icon: Icons.workspace_premium_outlined,
    title: '会员与订单',
    detail: '查看当前权益与历史订单',
    accent: Theme.of(context).colorScheme.secondary,
    onTap: onTap,
  );
}

class _ProfileFeaturePair extends StatelessWidget {
  const _ProfileFeaturePair({required this.left, required this.right});

  final Widget left;
  final Widget right;

  @override
  Widget build(BuildContext context) {
    if (_ProfileLayout.stackedPair(context)) {
      return Column(
        children: [
          left,
          const SizedBox(height: _ProfileLayout.block),
          right,
        ],
      );
    }
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: left),
          const SizedBox(width: _ProfileLayout.block),
          Expanded(child: right),
        ],
      ),
    );
  }
}

class _CheckinFeatureCard extends StatelessWidget {
  const _CheckinFeatureCard({required this.checkin});

  final AsyncValue<CheckinState> checkin;

  @override
  Widget build(BuildContext context) {
    final value = checkin.asData?.value;
    final detail = checkin.when(
      loading: () => '同步中',
      error: (error, stackTrace) => '暂不可用',
      data: (state) => !state.enabled
          ? '暂未开放'
          : state.todayChecked
          ? '已签到 · ${state.currentStreak} 天'
          : '+${state.claimRewardPoints} 积分',
    );
    return _ProfileColorCard(
      title: '每日签到',
      detail: detail,
      icon: value?.todayChecked == true
          ? Icons.event_available
          : Icons.calendar_month_outlined,
      background: Theme.of(context).brightness == Brightness.dark
          ? const Color(0xFF1E3A36)
          : const Color(0xFFD8F3EE),
      accent: const Color(0xFF0F766E),
      onTap: () => context.push('/profile/checkin'),
    );
  }
}

class _BenefitsFeatureCard extends StatelessWidget {
  const _BenefitsFeatureCard();

  @override
  Widget build(BuildContext context) {
    return _ProfileColorCard(
      title: '福利中心',
      detail: '领取活动与试用权益',
      icon: Icons.card_giftcard_outlined,
      background: Theme.of(context).brightness == Brightness.dark
          ? const Color(0xFF3D2A38)
          : const Color(0xFFFCE4EC),
      accent: const Color(0xFFE05D5D),
      onTap: () => context.push('/profile/benefits'),
    );
  }
}

class _ProfileColorCard extends StatelessWidget {
  const _ProfileColorCard({
    required this.title,
    required this.detail,
    required this.icon,
    required this.background,
    required this.accent,
    required this.onTap,
  });

  final String title;
  final String detail;
  final IconData icon;
  final Color background;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppPressable(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 112),
        child: SizedBox(
          width: double.infinity,
          child: AppGlassSurface(
            borderRadius: BorderRadius.circular(_ProfileLayout.radius),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(icon, color: accent, size: 22),
                  const SizedBox(height: 12),
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    detail,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      height: 1.3,
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

class _ProfileActionGrid extends StatelessWidget {
  const _ProfileActionGrid({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (var index = 0; index < children.length; index++) ...[
        if (index > 0)
          Padding(
            padding: const EdgeInsets.only(left: 52),
            child: Divider(
              height: 1,
              color: Theme.of(context).brightness == Brightness.dark
                  ? Colors.white.withValues(alpha: .08)
                  : Colors.black.withValues(alpha: .045),
            ),
          ),
        children[index],
      ],
    ],
  );
}

class _ProfileActionCell extends StatelessWidget {
  const _ProfileActionCell({
    required this.icon,
    required this.title,
    required this.accent,
    required this.onTap,
    this.detail,
    this.badgeCount = 0,
    super.key,
  });

  final IconData icon;
  final String title;
  final Color accent;
  final VoidCallback onTap;
  final String? detail;
  final int badgeCount;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return AppPressable(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 64),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            children: [
              Badge(
                isLabelVisible: badgeCount > 0,
                label: Text('${badgeCount > 99 ? 99 : badgeCount}'),
                child: Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: colors.brightness == Brightness.dark
                        ? Colors.white.withValues(alpha: .06)
                        : Colors.white.withValues(alpha: .86),
                    border: Border.all(
                      color: Colors.white.withValues(
                        alpha: colors.brightness == Brightness.dark ? .12 : .95,
                      ),
                    ),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Icon(icon, color: colors.onSurfaceVariant, size: 20),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    if (detail?.isNotEmpty == true) ...[
                      const SizedBox(height: 3),
                      Text(
                        detail!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: colors.outline,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AppearanceTile extends ConsumerWidget {
  const _AppearanceTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appearance = ref.watch(appearanceControllerProvider);
    return _ProfileActionCell(
      icon: switch (appearance.asData?.value) {
        AppAppearance.light => Icons.light_mode_outlined,
        AppAppearance.dark => Icons.dark_mode_outlined,
        _ => Icons.brightness_auto_outlined,
      },
      title: '外观设置',
      accent: const Color(0xFF005FEA),
      detail: appearance.when(
        loading: () => '同步中',
        error: (error, stackTrace) => '跟随系统',
        data: (value) => value.label,
      ),
      onTap: () => context.push('/profile/appearance'),
    );
  }
}

class _ProfileMetaChip extends StatelessWidget {
  const _ProfileMetaChip({
    required this.icon,
    required this.text,
    this.tooltip,
    this.onTap,
    super.key,
  });

  final IconData icon;
  final String text;
  final String? tooltip;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final content = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 14, color: colors.onSurfaceVariant),
          const SizedBox(width: 5),
          Expanded(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: onTap == null ? colors.onSurfaceVariant : colors.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return content;
    return Tooltip(
      message: tooltip ?? text,
      child: Semantics(
        button: true,
        label: tooltip,
        child: AppPressable(onTap: onTap, child: content),
      ),
    );
  }
}

class _FavoritePromptsTile extends StatelessWidget {
  const _FavoritePromptsTile();

  @override
  Widget build(BuildContext context) => _ProfileActionCell(
    key: const Key('profile-favorite-prompts'),
    icon: Icons.bookmark_outline_rounded,
    title: '我的收藏',
    accent: const Color(0xFF005FEA),
    detail: '提示词收藏',
    onTap: () => context.go('/discover?tab=prompts&favorites=1'),
  );
}

class _SubmissionTile extends StatelessWidget {
  const _SubmissionTile({required this.overview});

  final AsyncValue<ProfileOverview> overview;

  @override
  Widget build(BuildContext context) {
    final value = overview.asData?.value.submissionStats;
    final detail = overview.when(
      loading: () => '同步中',
      error: (error, stackTrace) => '暂不可用',
      data: (value) => value.submissionStats.total == 0
          ? '暂无投稿'
          : value.submissionStats.pending > 0
          ? '${value.submissionStats.pending} 件审核中'
          : '${value.submissionStats.total} 件',
    );
    return _ProfileActionCell(
      icon: Icons.public_outlined,
      title: '我的投稿',
      accent: const Color(0xFFE05D5D),
      detail: detail,
      badgeCount: value?.pending ?? 0,
      onTap: () => context.push('/profile/submissions'),
    );
  }
}

class ProfileCreationOverviewCard extends StatelessWidget {
  const ProfileCreationOverviewCard({
    required this.overview,
    required this.onOpenWorks,
    required this.onOpenTask,
    super.key,
  });

  final ProfileOverview overview;
  final VoidCallback onOpenWorks;
  final ValueChanged<String> onOpenTask;

  @override
  Widget build(BuildContext context) {
    final recent = overview.recentTasks.take(2).toList();
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          AppPressable(
            onTap: onOpenWorks,
            semanticLabel: overview.taskStats.running > 0
                ? '创作概览，${overview.taskStats.running} 个任务正在生成'
                : '创作概览，创作状态已同步',
            excludeChildSemantics: true,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 15, 12, 14),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.secondaryContainer,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Icon(Icons.insights_outlined),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          '创作概览',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          overview.taskStats.running > 0
                              ? '${overview.taskStats.running} 个任务正在生成'
                              : '创作状态已同步',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right),
                ],
              ),
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(14),
            child: LayoutBuilder(
              builder: (context, constraints) {
                final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
                final columns = constraints.maxWidth < 330 || scale > 1.35
                    ? 2
                    : 4;
                final width =
                    (constraints.maxWidth - (columns - 1) * 8) / columns;
                final metrics = [
                  ('全部', overview.taskStats.total, Icons.grid_view_outlined),
                  (
                    '已完成',
                    overview.taskStats.succeeded,
                    Icons.check_circle_outline,
                  ),
                  (
                    '进行中',
                    overview.taskStats.running,
                    Icons.motion_photos_on_outlined,
                  ),
                  ('失败', overview.taskStats.failed, Icons.error_outline),
                ];
                return Wrap(
                  spacing: 8,
                  runSpacing: 10,
                  children: metrics
                      .map(
                        (metric) => SizedBox(
                          width: width,
                          child: _CreationMetric(
                            label: metric.$1,
                            value: metric.$2,
                            icon: metric.$3,
                          ),
                        ),
                      )
                      .toList(),
                );
              },
            ),
          ),
          if (recent.isNotEmpty) ...[
            const Divider(height: 1),
            ...recent.indexed.map((entry) {
              final index = entry.$1;
              final task = entry.$2;
              return Column(
                children: [
                  if (index > 0) const Divider(height: 1, indent: 76),
                  _RecentTaskTile(task: task, onTap: () => onOpenTask(task.id)),
                ],
              );
            }),
          ],
        ],
      ),
    );
  }
}

class _CreationMetric extends StatelessWidget {
  const _CreationMetric({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final int value;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, size: 18, color: Theme.of(context).colorScheme.primary),
      const SizedBox(height: 6),
      Text(
        '$value',
        style: Theme.of(
          context,
        ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
      ),
      Text(label, style: Theme.of(context).textTheme.bodySmall),
    ],
  );
}

class _RecentTaskTile extends StatelessWidget {
  const _RecentTaskTile({required this.task, required this.onTap});

  final ProfileRecentTask task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = _profileTaskStatus(task.status);
    final title = task.prompt.isEmpty ? '未命名创作' : task.prompt;
    return AppPressable(
      onTap: onTap,
      semanticLabel: '$title，${status.label}',
      excludeChildSemantics: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(7),
              child: SizedBox.square(
                dimension: 48,
                child: task.previewUrl.isEmpty
                    ? ColoredBox(
                        color: Theme.of(
                          context,
                        ).colorScheme.surfaceContainerHighest,
                        child: const Icon(Icons.image_outlined),
                      )
                    : AuthenticatedImage(url: task.previewUrl),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    status.label,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: status.color,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, size: 20),
          ],
        ),
      ),
    );
  }
}

({String label, Color color}) _profileTaskStatus(String value) =>
    switch (value) {
      'queued' => (label: '排队中', color: const Color(0xFFD97706)),
      'running' => (label: '生成中', color: const Color(0xFF005FEA)),
      'succeeded' => (label: '已完成', color: const Color(0xFF0F766E)),
      'failed' => (label: '生成失败', color: const Color(0xFFDC2626)),
      'canceled' => (label: '已取消', color: const Color(0xFF64748B)),
      _ => (label: value, color: const Color(0xFF64748B)),
    };

class _AboutTile extends ConsumerWidget {
  const _AboutTile({required this.environmentLabel});

  final String environmentLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final packageInfo = ref.watch(appPackageInfoProvider);
    return _ProfileActionCell(
      icon: Icons.info_outline_rounded,
      title: '关于星空云绘',
      accent: const Color(0xFF64748B),
      detail: packageInfo.when(
        loading: () => '读取版本中',
        error: (error, stackTrace) => '版本信息不可用',
        data: (info) => installedVersionLabel(info, environmentLabel),
      ),
      onTap: () => context.push('/about'),
    );
  }
}
