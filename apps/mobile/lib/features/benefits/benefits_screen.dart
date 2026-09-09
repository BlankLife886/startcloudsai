import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../../app/starclouds_theme.dart';
import '../../core/network/api_exception.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../notifications/notifications.dart';
import '../profile/profile.dart';
import '../wallet/wallet.dart';
import 'benefits.dart';

typedef GrowthGroupShareHandler =
    Future<void> Function(String code, Rect origin);

final growthGroupShareHandlerProvider = Provider<GrowthGroupShareHandler>(
  (ref) =>
      (code, origin) => SharePlus.instance.share(
        ShareParams(
          title: '邀请好友拼团',
          text: '我正在星空云绘参加好友拼团，输入拼团码 $code 一起加入。',
          sharePositionOrigin: origin,
        ),
      ),
);

class BenefitsScreen extends ConsumerStatefulWidget {
  const BenefitsScreen({super.key});

  @override
  ConsumerState<BenefitsScreen> createState() => _BenefitsScreenState();
}

class _BenefitsScreenState extends ConsumerState<BenefitsScreen> {
  Future<void> _refresh() =>
      ref.read(benefitsControllerProvider.notifier).refresh();

  @override
  Widget build(BuildContext context) {
    final benefits = ref.watch(benefitsControllerProvider);
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: AppTopBar(
        title: const Text('福利中心'),
        fallbackLocation: '/profile',
        actions: [
          IconButton(
            tooltip: '刷新',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: benefits.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _BenefitsError(onRetry: _refresh),
        data: _buildBenefits,
      ),
    );
  }

  Widget _buildBenefits(BenefitsState state) {
    final application = state.application;
    final group = state.growth.group;
    final rules = state.growth.rules;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Text(
            '资格与奖励',
            style: Theme.of(
              context,
            ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(
                color: Theme.of(context).colorScheme.outlineVariant,
              ),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              children: [
                _BenefitHubEntry(
                  icon: Icons.auto_awesome_outlined,
                  title: '体验资格',
                  detail: application == null
                      ? (state.campaign?.full == true ? '本期名额已满' : '申请限量体验资格')
                      : _applicationTitle(application.status),
                  onTap: () => context.push('/profile/benefits/trial'),
                ),
                const Divider(height: 1, indent: 48),
                _BenefitHubEntry(
                  icon: Icons.trending_up,
                  title: '成长奖励',
                  detail: rules.usageRewardsEnabled ? '本月创作里程碑' : '当前未开放',
                  onTap: () => context.push('/profile/benefits/growth'),
                ),
                const Divider(height: 1, indent: 48),
                _BenefitHubEntry(
                  icon: Icons.groups_outlined,
                  title: '好友拼团',
                  detail: group == null
                      ? (rules.groupEnabled ? '创建拼团' : '拼团活动暂未开放')
                      : (group.status == 'completed' ? '拼团已完成' : '拼团进行中'),
                  onTap: () => context.push('/profile/benefits/group'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class TrialBenefitScreen extends ConsumerStatefulWidget {
  const TrialBenefitScreen({super.key});

  @override
  ConsumerState<TrialBenefitScreen> createState() => _TrialBenefitScreenState();
}

class _TrialBenefitScreenState extends ConsumerState<TrialBenefitScreen> {
  Future<void> _refresh() =>
      ref.read(benefitsControllerProvider.notifier).refresh();

  Future<void> _openApplication(TrialApplication? application) async {
    final result = await showAppSheet<TrialApplication>(
      context: context,
      isScrollControlled: true,
      builder: (context) => TrialApplicationSheet(
        initialOccupation: application?.occupation ?? '',
        initialReason: application?.reason ?? '',
        onSubmit: ({required occupation, required reason}) => ref
            .read(benefitsControllerProvider.notifier)
            .submitApplication(occupation: occupation, reason: reason),
      ),
    );
    if (result != null && mounted) {
      AppNotice.success(context, '体验申请已提交，审核结果会通过通知告知');
    }
  }

  Future<void> _claimReward() async {
    try {
      final reward = await ref
          .read(benefitsControllerProvider.notifier)
          .claimReward();
      ref.invalidate(walletProvider);
      ref.invalidate(profileOverviewProvider);
      ref.invalidate(walletCenterControllerProvider);
      ref.invalidate(notificationSummaryProvider);
      if (!mounted) return;
      AppNotice.success(
        context,
        reward.alreadyClaimed ? '体验积分已经领取过' : '${reward.grantPoints} 体验积分已到账',
      );
    } catch (error) {
      if (!mounted) return;
      AppNotice.error(
        context,
        error is ApiException ? error.message : '体验积分领取失败',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final benefits = ref.watch(benefitsControllerProvider);
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: const AppTopBar(
        title: Text('体验资格'),
        fallbackLocation: '/profile/benefits',
      ),
      body: benefits.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _BenefitsError(onRetry: _refresh),
        data: (state) => RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              if (state.campaign == null)
                const _NoCampaignPanel()
              else
                TrialCampaignPanel(campaign: state.campaign!),
              const SizedBox(height: 14),
              TrialApplicationPanel(
                campaign: state.campaign,
                application: state.application,
                submitting: state.isSubmittingApplication,
                claiming: state.isClaimingReward,
                onApply: () => _openApplication(state.application),
                onClaim: _claimReward,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class GrowthBenefitScreen extends ConsumerStatefulWidget {
  const GrowthBenefitScreen({super.key});

  @override
  ConsumerState<GrowthBenefitScreen> createState() =>
      _GrowthBenefitScreenState();
}

class _GrowthBenefitScreenState extends ConsumerState<GrowthBenefitScreen> {
  Future<void> _refresh() =>
      ref.read(benefitsControllerProvider.notifier).refresh();

  @override
  Widget build(BuildContext context) {
    final benefits = ref.watch(benefitsControllerProvider);
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: const AppTopBar(
        title: Text('成长奖励'),
        fallbackLocation: '/profile/benefits',
      ),
      body: benefits.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _BenefitsError(onRetry: _refresh),
        data: (state) => RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              GrowthRewardsPanel(
                rules: state.growth.rules,
                onFeedback: () => context.push('/profile/feedback'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class GrowthGroupBenefitScreen extends ConsumerStatefulWidget {
  const GrowthGroupBenefitScreen({super.key});

  @override
  ConsumerState<GrowthGroupBenefitScreen> createState() =>
      _GrowthGroupBenefitScreenState();
}

class _GrowthGroupBenefitScreenState
    extends ConsumerState<GrowthGroupBenefitScreen> {
  Future<void> _refresh() =>
      ref.read(benefitsControllerProvider.notifier).refresh();

  Future<void> _createGroup() async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.group_add_outlined),
        title: const Text('创建好友拼团？'),
        content: const Text('创建后本期不能再加入其他拼团，可将生成的邀请码分享给好友。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认创建'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref.read(benefitsControllerProvider.notifier).createGroup();
      ref.invalidate(profileOverviewProvider);
      if (mounted) {
        AppNotice.success(context, '拼团已创建，可以邀请好友加入');
      }
    } catch (error) {
      if (mounted) {
        AppNotice.error(
          context,
          error is ApiException ? error.message : '拼团创建失败',
        );
      }
    }
  }

  Future<void> _joinGroup() async {
    final group = await showAppSheet<GrowthGroup>(
      context: context,
      isScrollControlled: true,
      builder: (context) => JoinGrowthGroupSheet(
        onSubmit: ref.read(benefitsControllerProvider.notifier).joinGroup,
      ),
    );
    if (group != null && mounted) {
      ref.invalidate(walletProvider);
      ref.invalidate(profileOverviewProvider);
      AppNotice.success(context, '已加入好友拼团');
    }
  }

  Future<void> _shareGroup(String code, BuildContext buttonContext) async {
    final box = buttonContext.findRenderObject() as RenderBox?;
    final origin = box == null
        ? Offset(MediaQuery.sizeOf(context).width / 2, 80) & const Size(1, 1)
        : box.localToGlobal(Offset.zero) & box.size;
    try {
      await ref.read(growthGroupShareHandlerProvider)(code, origin);
    } catch (error) {
      if (!mounted) return;
      AppNotice.error(context, '分享面板打开失败，请稍后重试');
    }
  }

  @override
  Widget build(BuildContext context) {
    final benefits = ref.watch(benefitsControllerProvider);
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: const AppTopBar(
        title: Text('好友拼团'),
        fallbackLocation: '/profile/benefits',
      ),
      body: benefits.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _BenefitsError(onRetry: _refresh),
        data: (state) => RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              GrowthGroupPanel(
                group: state.growth.group,
                rules: state.growth.rules,
                busy: state.isGroupBusy,
                onCreate: _createGroup,
                onJoin: _joinGroup,
                onShare: _shareGroup,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BenefitHubEntry extends StatelessWidget {
  const _BenefitHubEntry({
    required this.icon,
    required this.title,
    required this.detail,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String detail;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
          child: Row(
            children: [
              SizedBox.square(
                dimension: 24,
                child: Icon(icon, color: colors.primary, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      detail,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: colors.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

class TrialCampaignPanel extends StatelessWidget {
  const TrialCampaignPanel({required this.campaign, super.key});

  final TrialCampaign campaign;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return AppSoftCard(
      color: colors.secondaryContainer,
      radius: StarCloudsRadii.card,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            campaign.title,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          Text(
            campaign.full
                ? '本期名额已满'
                : '剩余 ${campaign.remaining} 个名额 · 下一位第 ${campaign.nextPosition} 名',
          ),
          const SizedBox(height: 14),
          LinearProgressIndicator(
            value: campaign.progress,
            minHeight: 7,
            borderRadius: BorderRadius.circular(4),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text('已申请 ${campaign.applied}/${campaign.capacity}'),
              ),
              if (campaign.expiresAt != null)
                Text(
                  '${DateFormat('M月d日').format(campaign.expiresAt!)} 截止',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
            ],
          ),
          if (campaign.features.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 7,
              children: [
                for (final feature in campaign.features)
                  Chip(
                    avatar: const Icon(Icons.stars_outlined, size: 16),
                    label: Text(feature.label),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _NoCampaignPanel extends StatelessWidget {
  const _NoCampaignPanel();

  @override
  Widget build(BuildContext context) => AppSoftCard(
    padding: const EdgeInsets.all(16),
    child: const Row(
      children: [
        Icon(Icons.event_busy_outlined),
        SizedBox(width: 10),
        Expanded(child: Text('当前没有开放中的限量体验活动')),
      ],
    ),
  );
}

class TrialApplicationPanel extends StatelessWidget {
  const TrialApplicationPanel({
    required this.campaign,
    required this.application,
    required this.submitting,
    required this.claiming,
    required this.onApply,
    required this.onClaim,
    super.key,
  });

  final TrialCampaign? campaign;
  final TrialApplication? application;
  final bool submitting;
  final bool claiming;
  final VoidCallback onApply;
  final VoidCallback onClaim;

  @override
  Widget build(BuildContext context) {
    final item = application;
    if (item == null) {
      return AppSoftCard(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '申请限量体验资格',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            const Text('审核通过后可领取专属体验积分，用于本期开放功能。'),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed:
                    campaign?.enabled == true &&
                        campaign?.full != true &&
                        !submitting
                    ? onApply
                    : null,
                icon: const Icon(Icons.edit_note),
                label: Text(campaign?.full == true ? '本期名额已满' : '填写体验申请'),
              ),
            ),
          ],
        ),
      );
    }
    final colors = Theme.of(context).colorScheme;
    return AppSoftCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_applicationIcon(item.status)),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  _applicationTitle(item.status),
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
              _StatusLabel(
                label: _applicationStatus(item.status),
                color: item.status == 'rejected'
                    ? colors.error
                    : item.status == 'approved'
                    ? Colors.green.shade700
                    : colors.primary,
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text('申请序号：第 ${item.position} 名 · ${item.occupation}'),
          if (item.features.isNotEmpty) ...[
            const SizedBox(height: 7),
            Wrap(
              spacing: 7,
              runSpacing: 6,
              children: [
                for (final feature in item.features)
                  _FeatureLabel(feature: feature),
              ],
            ),
          ],
          if (item.reviewNote.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              '审核说明：${item.reviewNote}',
              style: TextStyle(
                color: item.status == 'rejected' ? colors.error : null,
              ),
            ),
          ],
          if (item.canClaimReward) ...[
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: claiming ? null : onClaim,
                icon: claiming
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.redeem),
                label: Text('领取 ${item.rewardPoints} 体验积分'),
              ),
            ),
          ] else if (item.rewardClaimed) ...[
            const SizedBox(height: 12),
            const Row(
              children: [
                Icon(Icons.check_circle, color: Colors.green),
                SizedBox(width: 8),
                Expanded(child: Text('体验积分已领取')),
              ],
            ),
          ] else if (item.canApply) ...[
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: submitting ? null : onApply,
                icon: const Icon(Icons.refresh),
                label: const Text('修改资料并重新申请'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _FeatureLabel extends StatelessWidget {
  const _FeatureLabel({required this.feature});

  final TrialFeature feature;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(
        feature.entitlementActive
            ? Icons.verified_outlined
            : Icons.auto_awesome_outlined,
        size: 16,
      ),
      const SizedBox(width: 4),
      Text(feature.label, style: Theme.of(context).textTheme.bodySmall),
    ],
  );
}

class GrowthRewardsPanel extends StatelessWidget {
  const GrowthRewardsPanel({
    required this.rules,
    required this.onFeedback,
    super.key,
  });

  final GrowthRules rules;
  final VoidCallback onFeedback;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (rules.usageRewardsEnabled)
          _UsageMilestones(rules: rules)
        else
          const _RewardRow(
            icon: Icons.insights_outlined,
            title: '创作用量奖励',
            subtitle: '当前未开放',
          ),
        const SizedBox(height: 10),
        _RewardRow(
          icon: Icons.health_and_safety_outlined,
          title: '失败补偿',
          subtitle: rules.failureBonusEnabled
              ? '失败任务自动补偿 ${rules.failureBonusPoints} 积分 · 今日 ${rules.failureClaimsToday}/${rules.failureBonusDailyLimit}'
              : '当前未开放',
        ),
        const SizedBox(height: 10),
        _RewardRow(
          icon: Icons.lightbulb_outline,
          title: '建议采纳',
          subtitle: '优秀产品建议最高奖励 ${rules.suggestionRewardMaxPoints} 积分',
          action: IconButton(
            tooltip: '提交建议',
            onPressed: onFeedback,
            icon: const Icon(Icons.chevron_right),
          ),
        ),
      ],
    );
  }
}

class _UsageMilestones extends StatelessWidget {
  const _UsageMilestones({required this.rules});

  final GrowthRules rules;

  @override
  Widget build(BuildContext context) {
    final next = rules.milestones.where((item) => !item.achieved).firstOrNull;
    final target = next?.units ?? rules.milestones.lastOrNull?.units ?? 1;
    return AppSoftCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.insights_outlined),
              const SizedBox(width: 9),
              const Expanded(
                child: Text(
                  '本月创作里程碑',
                  style: TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
              Text('${rules.monthDeliveredUnits} 个作品'),
            ],
          ),
          const SizedBox(height: 12),
          LinearProgressIndicator(
            value: (rules.monthDeliveredUnits / target).clamp(0, 1),
            minHeight: 7,
            borderRadius: BorderRadius.circular(4),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 12,
            runSpacing: 7,
            children: [
              for (final milestone in rules.milestones)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      milestone.achieved
                          ? Icons.check_circle
                          : Icons.radio_button_unchecked,
                      size: 16,
                      color: milestone.achieved
                          ? Colors.green
                          : Theme.of(context).colorScheme.outline,
                    ),
                    const SizedBox(width: 4),
                    Text('${milestone.units} 个 +${milestone.rewardPoints}'),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RewardRow extends StatelessWidget {
  const _RewardRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.action,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) => AppSoftCard(
    padding: EdgeInsets.zero,
    child: ListTile(
      leading: Icon(icon),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: action,
    ),
  );
}

class GrowthGroupPanel extends StatelessWidget {
  const GrowthGroupPanel({
    required this.group,
    required this.rules,
    required this.busy,
    required this.onCreate,
    required this.onJoin,
    required this.onShare,
    super.key,
  });

  final GrowthGroup? group;
  final GrowthRules rules;
  final bool busy;
  final VoidCallback onCreate;
  final VoidCallback onJoin;
  final Future<void> Function(String code, BuildContext buttonContext) onShare;

  @override
  Widget build(BuildContext context) {
    final item = group;
    if (item == null) {
      return AppSoftCard(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              rules.groupEnabled
                  ? '${rules.groupTargetMembers} 人成团，每人得 ${rules.groupRewardPoints} 积分'
                  : '拼团活动暂未开放',
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
            if (rules.groupEnabled) ...[
              const SizedBox(height: 5),
              Text(
                '第 ${rules.groupOrdinal} 期 · ${rules.groupDurationHours} 小时内有效',
              ),
              const SizedBox(height: 14),
              LayoutBuilder(
                builder: (context, constraints) {
                  final vertical = constraints.maxWidth < 310;
                  final create = FilledButton.icon(
                    onPressed: busy ? null : onCreate,
                    icon: const Icon(Icons.group_add_outlined),
                    label: const Text('创建拼团'),
                  );
                  final join = OutlinedButton.icon(
                    onPressed: busy ? null : onJoin,
                    icon: const Icon(Icons.login),
                    label: const Text('输入拼团码'),
                  );
                  return vertical
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [create, const SizedBox(height: 8), join],
                        )
                      : Row(
                          children: [
                            Expanded(child: create),
                            const SizedBox(width: 8),
                            Expanded(child: join),
                          ],
                        );
                },
              ),
            ],
          ],
        ),
      );
    }
    return AppSoftCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.groups),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  item.status == 'completed' ? '拼团已完成' : '拼团进行中',
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
              _StatusLabel(
                label: '${item.memberCount}/${item.targetMembers} 人',
                color: Theme.of(context).colorScheme.primary,
              ),
            ],
          ),
          const SizedBox(height: 12),
          LinearProgressIndicator(
            value: item.progress,
            minHeight: 7,
            borderRadius: BorderRadius.circular(4),
          ),
          const SizedBox(height: 12),
          DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(
                color: Theme.of(context).colorScheme.outlineVariant,
              ),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 2, 2, 2),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '拼团码 ${item.code}',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: '复制拼团码',
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: item.code));
                      if (!context.mounted) return;
                      AppNotice.success(context, '拼团码已复制');
                    },
                    icon: const Icon(Icons.copy_outlined),
                  ),
                  Builder(
                    builder: (buttonContext) => IconButton(
                      tooltip: '分享拼团码',
                      onPressed: () => onShare(item.code, buttonContext),
                      icon: const Icon(Icons.ios_share_outlined),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (item.expiresAt != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(
                  Icons.schedule_outlined,
                  size: 16,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    '有效期至 ${DateFormat('M月d日 HH:mm').format(item.expiresAt!.toLocal())}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          Wrap(
            spacing: 14,
            runSpacing: 10,
            children: [
              for (final member in item.members)
                _GroupMemberLabel(member: member),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            item.status == 'completed'
                ? '${item.rewardPoints} 积分奖励已发放'
                : '满员后每位成员自动获得 ${item.rewardPoints} 积分',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _GroupMemberLabel extends StatelessWidget {
  const _GroupMemberLabel({required this.member});

  final GrowthMember member;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      CircleAvatar(
        radius: 12,
        backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
        child: Text(
          member.username.characters.first.toUpperCase(),
          style: Theme.of(context).textTheme.labelSmall,
        ),
      ),
      const SizedBox(width: 6),
      Text(member.username, style: Theme.of(context).textTheme.bodySmall),
    ],
  );
}

class TrialApplicationSheet extends StatefulWidget {
  const TrialApplicationSheet({
    required this.initialOccupation,
    required this.initialReason,
    required this.onSubmit,
    super.key,
  });

  final String initialOccupation;
  final String initialReason;
  final Future<TrialApplication> Function({
    required String occupation,
    required String reason,
  })
  onSubmit;

  @override
  State<TrialApplicationSheet> createState() => _TrialApplicationSheetState();
}

class _TrialApplicationSheetState extends State<TrialApplicationSheet> {
  final _formKey = GlobalKey<FormState>();
  late final _occupationController = TextEditingController(
    text: widget.initialOccupation,
  );
  late final _reasonController = TextEditingController(
    text: widget.initialReason,
  );
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _occupationController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final application = await widget.onSubmit(
        occupation: _occupationController.text,
        reason: _reasonController.text,
      );
      if (mounted) Navigator.pop(context, application);
    } catch (error) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _error = error is ApiException ? error.message : '申请提交失败，请稍后重试';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        20,
        4,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.initialOccupation.isEmpty ? '申请体验资格' : '重新申请体验资格',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _occupationController,
              decoration: const InputDecoration(
                labelText: '职业或使用场景',
                hintText: '例如：产品设计师、独立开发者',
                prefixIcon: Icon(Icons.badge_outlined),
              ),
              textInputAction: TextInputAction.next,
              validator: validateOccupations,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _reasonController,
              decoration: const InputDecoration(
                labelText: '申请理由',
                hintText: '说明希望体验的工作流和实际用途',
                alignLabelWithHint: true,
              ),
              minLines: 4,
              maxLines: 7,
              maxLength: 1000,
              validator: validateTrialReason,
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send_outlined),
              label: const Text('提交申请'),
            ),
          ],
        ),
      ),
    ),
  );
}

class JoinGrowthGroupSheet extends StatefulWidget {
  const JoinGrowthGroupSheet({required this.onSubmit, super.key});

  final Future<GrowthGroup> Function(String code) onSubmit;

  @override
  State<JoinGrowthGroupSheet> createState() => _JoinGrowthGroupSheetState();
}

class _JoinGrowthGroupSheetState extends State<JoinGrowthGroupSheet> {
  final _formKey = GlobalKey<FormState>();
  final _controller = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final group = await widget.onSubmit(_controller.text);
      if (mounted) Navigator.pop(context, group);
    } catch (error) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _error = error is ApiException ? error.message : '加入拼团失败，请检查拼团码';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        4,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '加入好友拼团',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _controller,
              autofocus: true,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                labelText: '拼团码',
                prefixIcon: Icon(Icons.password),
              ),
              validator: validateGroupCode,
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.group_add_outlined),
              label: const Text('加入拼团'),
            ),
          ],
        ),
      ),
    ),
  );
}

class _StatusLabel extends StatelessWidget {
  const _StatusLabel({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      child: Text(
        label,
        style: TextStyle(color: color, fontWeight: FontWeight.w800),
      ),
    ),
  );
}

class _BenefitsError extends StatelessWidget {
  const _BenefitsError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_outlined, size: 42),
          const SizedBox(height: 12),
          const Text('福利信息加载失败'),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('重试'),
          ),
        ],
      ),
    ),
  );
}

IconData _applicationIcon(String status) => switch (status) {
  'approved' => Icons.verified_outlined,
  'rejected' => Icons.info_outline,
  _ => Icons.hourglass_top,
};

String _applicationTitle(String status) => switch (status) {
  'approved' => '体验资格已通过',
  'rejected' => '体验申请需要调整',
  _ => '体验申请审核中',
};

String _applicationStatus(String status) => switch (status) {
  'approved' => '已通过',
  'rejected' => '未通过',
  _ => '待审核',
};
