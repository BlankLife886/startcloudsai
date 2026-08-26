import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../../app/starclouds_theme.dart';
import '../../core/network/api_exception.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../benefits/benefits.dart';
import '../notifications/notifications.dart';
import '../profile/profile.dart';
import 'wallet.dart';

typedef WalletBillShareHandler =
    Future<void> Function(File file, Rect? sharePositionOrigin);

final walletBillShareHandlerProvider = Provider<WalletBillShareHandler>(
  (ref) =>
      (file, origin) => SharePlus.instance.share(
        ShareParams(
          files: [XFile(file.path, mimeType: 'text/csv')],
          title: '星空云绘积分账单',
          sharePositionOrigin: origin,
        ),
      ),
);

String walletPoints(int value, {bool withUnit = false}) {
  final text = NumberFormat.decimalPattern('zh_CN').format(value);
  return withUnit ? '$text 积分' : text;
}

class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key});

  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen> {
  Future<void> _refresh() async {
    ref.invalidate(walletProvider);
    ref.invalidate(profileOverviewProvider);
    ref.invalidate(benefitsControllerProvider);
    await Future.wait([
      ref.read(walletProvider.future),
      ref.read(walletCenterControllerProvider.notifier).refresh(),
    ]);
  }

  Future<void> _openRedeem() async {
    final result = await showAppSheet<WalletRedemption>(
      context: context,
      isScrollControlled: true,
      builder: (context) => RedeemCodeSheet(
        onSubmit: ref.read(walletCenterControllerProvider.notifier).redeem,
      ),
    );
    if (result == null || !mounted) return;
    ref.invalidate(walletProvider);
    ref.invalidate(profileOverviewProvider);
    try {
      await ref.read(walletProvider.future);
    } catch (_) {
      // The redemption result remains authoritative if balance refresh fails.
    }
    if (!mounted) return;
    AppNotice.success(context, '兑换成功，${result.grantPoints} 积分已入账');
  }

  Future<void> _claimTrial() async {
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
    final wallet = ref.watch(walletProvider);
    final center = ref.watch(walletCenterControllerProvider);
    final benefits = ref.watch(benefitsControllerProvider);
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: const AppTopBar(
        title: Text('积分钱包'),
        fallbackLocation: '/profile',
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            WalletBalancePanel(
              wallet: wallet,
              onRedeem: _openRedeem,
              onLedger: () => context.push('/profile/wallet/ledger'),
              onPurchase: () => context.push('/profile/purchases'),
            ),
            if (benefits.asData?.value.application case final application?
                when application.status == 'approved' &&
                    application.rewardPoints > 0) ...[
              const SizedBox(height: 12),
              _WalletTrialBanner(
                application: application,
                claiming: benefits.asData?.value.isClaimingReward == true,
                onClaim: _claimTrial,
              ),
            ],
            const SizedBox(height: 16),
            WalletCompositionGrid(wallet: wallet),
            const SizedBox(height: 22),
            WalletBillSummary(center: center),
          ],
        ),
      ),
    );
  }
}

class WalletBalancePanel extends StatelessWidget {
  const WalletBalancePanel({
    required this.wallet,
    required this.onRedeem,
    required this.onLedger,
    required this.onPurchase,
    super.key,
  });

  final AsyncValue<WalletSnapshot> wallet;
  final VoidCallback onRedeem;
  final VoidCallback onLedger;
  final VoidCallback onPurchase;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final visual = StarCloudsVisualStyle.of(context);
    return AppAppear(
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: StarCloudsRadii.card,
          boxShadow: [
            BoxShadow(
              color: visual.shadow.withValues(alpha: dark ? .38 : .18),
              blurRadius: 28,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: StarCloudsRadii.card,
          child: Stack(
            children: [
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: dark
                          ? const [Color(0xFF2A2438), Color(0xFF1C2038)]
                          : const [Color(0xFF2B2A32), Color(0xFF3D3428)],
                    ),
                  ),
                ),
              ),
              const Positioned(
                right: -40,
                top: -56,
                child: _HeroGlow(size: 180, color: Color(0x55E8C07A)),
              ),
              const Positioned(
                left: -36,
                bottom: 28,
                child: _HeroGlow(size: 140, color: Color(0x332B4C9A)),
              ),
              const Positioned(
                right: 18,
                top: 18,
                child: Icon(
                  Icons.account_balance_wallet_outlined,
                  color: Color(0x33E8C07A),
                  size: 26,
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(22, 22, 22, 18),
                    child: wallet.when(
                      loading: () => const SizedBox(
                        height: 88,
                        child: Center(
                          child: CircularProgressIndicator(
                            color: Color(0xFFE8C07A),
                          ),
                        ),
                      ),
                      error: (error, stackTrace) => const SizedBox(
                        height: 88,
                        child: Center(
                          child: Text(
                            '钱包加载失败',
                            style: TextStyle(color: Color(0xCCFFFFFF)),
                          ),
                        ),
                      ),
                      data: (value) => Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            '可用余额',
                            style: TextStyle(
                              color: Color(0xFFE8C07A),
                              fontWeight: FontWeight.w700,
                              fontSize: 13,
                              letterSpacing: 0.4,
                            ),
                          ),
                          const SizedBox(height: 10),
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(
                                  walletPoints(value.availablePoints),
                                  style: Theme.of(context)
                                      .textTheme
                                      .displaySmall
                                      ?.copyWith(
                                        color: Colors.white,
                                        fontWeight: FontWeight.w900,
                                        letterSpacing: -1.8,
                                        height: 1,
                                      ),
                                ),
                                const Padding(
                                  padding: EdgeInsets.only(left: 8, bottom: 4),
                                  child: Text(
                                    '积分',
                                    style: TextStyle(
                                      color: Color(0xCCFFFFFF),
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (value.frozenPoints > 0) ...[
                            const SizedBox(height: 12),
                            DecoratedBox(
                              decoration: BoxDecoration(
                                color: const Color(0x22E8C07A),
                                borderRadius: StarCloudsRadii.pillAll,
                              ),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 5,
                                ),
                                child: Text(
                                  '另有 ${walletPoints(value.frozenPoints, withUnit: true)} 冻结中，完成后结算或退回。',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Color(0xE8E8C07A),
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  ColoredBox(
                    color: const Color(0x33000000),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(6, 12, 6, 12),
                      child: Row(
                        children: [
                          _WalletHeroAction(
                            icon: Icons.redeem_outlined,
                            label: '兑换积分',
                            onTap: onRedeem,
                          ),
                          _WalletHeroAction(
                            icon: Icons.receipt_long_outlined,
                            label: '积分明细',
                            onTap: onLedger,
                          ),
                          _WalletHeroAction(
                            icon: Icons.workspace_premium_outlined,
                            label: '购买套餐',
                            onTap: onPurchase,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HeroGlow extends StatelessWidget {
  const _HeroGlow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: SizedBox.square(
        dimension: size,
        child: DecoratedBox(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(
              colors: [color, color.withValues(alpha: 0)],
            ),
          ),
        ),
      ),
    );
  }
}

class _WalletHeroAction extends StatelessWidget {
  const _WalletHeroAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: AppPressable(
        onTap: onTap,
        child: Column(
          children: [
            DecoratedBox(
              decoration: const BoxDecoration(
                color: Color(0x28E8C07A),
                shape: BoxShape.circle,
              ),
              child: SizedBox.square(
                dimension: 42,
                child: Icon(icon, color: const Color(0xFFE8C07A), size: 20),
              ),
            ),
            const SizedBox(height: 7),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xEEFFFFFF),
                fontWeight: FontWeight.w700,
                fontSize: 12,
                height: 1.1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class WalletCompositionGrid extends StatelessWidget {
  const WalletCompositionGrid({required this.wallet, super.key});

  final AsyncValue<WalletSnapshot> wallet;

  @override
  Widget build(BuildContext context) {
    final value = wallet.asData?.value;
    if (value == null) return const SizedBox.shrink();
    final colors = Theme.of(context).colorScheme;
    final rows = [
      (
        Icons.account_balance_wallet_outlined,
        '账户总额',
        value.totalPoints,
        colors.onSurface,
      ),
      (
        Icons.hourglass_top_outlined,
        '冻结中',
        value.frozenPoints,
        value.frozenPoints > 0 ? colors.tertiary : colors.onSurfaceVariant,
      ),
      (Icons.toll_outlined, '普通积分', value.normalPoints, colors.onSurface),
      (
        Icons.card_giftcard_outlined,
        '体验积分',
        value.trialPoints,
        value.trialPoints > 0 ? colors.secondary : colors.onSurfaceVariant,
      ),
    ];
    return AppSoftCard(
      radius: StarCloudsRadii.card,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0)
              Padding(
                padding: const EdgeInsets.only(left: 48),
                child: Divider(height: 1, color: colors.outlineVariant),
              ),
            _CompositionRow(
              icon: rows[i].$1,
              label: rows[i].$2,
              value: rows[i].$3,
              valueColor: rows[i].$4,
            ),
          ],
        ],
      ),
    );
  }
}

class _CompositionRow extends StatelessWidget {
  const _CompositionRow({
    required this.icon,
    required this.label,
    required this.value,
    required this.valueColor,
  });

  final IconData icon;
  final String label;
  final int value;
  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 52),
      child: Row(
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              color: valueColor.withValues(alpha: .10),
              shape: BoxShape.circle,
            ),
            child: SizedBox.square(
              dimension: 32,
              child: Icon(icon, size: 17, color: valueColor),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(
                context,
              ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 10),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerRight,
            child: Text(
              walletPoints(value),
              maxLines: 1,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
                letterSpacing: -0.3,
                color: valueColor,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _WalletTrialBanner extends StatelessWidget {
  const _WalletTrialBanner({
    required this.application,
    required this.claiming,
    required this.onClaim,
  });

  final TrialApplication application;
  final bool claiming;
  final VoidCallback onClaim;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final label = application.features.firstOrNull?.label.trim();
    final trialLabel = (label == null || label.isEmpty) ? '体验' : label;
    final redeemed = application.rewardClaimed;
    return AppSoftCard(
      radius: StarCloudsRadii.control,
      padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
      color: colors.primaryContainer.withValues(alpha: .55),
      child: Row(
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              color: colors.primary.withValues(alpha: .12),
              shape: BoxShape.circle,
            ),
            child: SizedBox.square(
              dimension: 34,
              child: Icon(
                Icons.card_giftcard_outlined,
                color: colors.primary,
                size: 18,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '$trialLabel体验礼包',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
          if (redeemed)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Text(
                '已领取',
                style: Theme.of(
                  context,
                ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
            )
          else
            AppPressable(
              onTap: claiming ? null : onClaim,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: claiming
                      ? colors.primary.withValues(alpha: .45)
                      : colors.primary,
                  borderRadius: StarCloudsRadii.pillAll,
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  child: Text(
                    claiming ? '领取中…' : '领取',
                    style: TextStyle(
                      color: colors.onPrimary,
                      fontWeight: FontWeight.w800,
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class WalletBillSummary extends StatelessWidget {
  const WalletBillSummary({required this.center, super.key});

  final AsyncValue<WalletCenterState> center;

  @override
  Widget build(BuildContext context) {
    final summary = center.asData?.value.summary;
    if (center.isLoading && summary == null) {
      return const SizedBox(
        height: 18,
        child: LinearProgressIndicator(minHeight: 2),
      );
    }
    if (summary == null) return const SizedBox.shrink();
    final colors = Theme.of(context).colorScheme;
    final totals = [
      ('入账', summary.incomePoints, colors.primary),
      ('消耗', summary.consumedPoints, colors.error),
      ('退回', summary.refundPoints, colors.tertiary),
    ];
    final channels = summary.items
        .where((item) => item.points > 0 || item.count > 0)
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const AppSectionLabel('账单汇总'),
        const SizedBox(height: 12),
        Row(
          children: [
            for (var i = 0; i < totals.length; i++) ...[
              if (i > 0) const SizedBox(width: 8),
              Expanded(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: colors.surfaceContainerLow,
                    borderRadius: StarCloudsRadii.control,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 12,
                    ),
                    child: Column(
                      children: [
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            walletPoints(totals[i].$2),
                            maxLines: 1,
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(
                                  fontWeight: FontWeight.w900,
                                  color: totals[i].$3,
                                  letterSpacing: -0.4,
                                  height: 1.1,
                                ),
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          totals[i].$1,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(
                                color: colors.onSurfaceVariant,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
        if (channels.isNotEmpty) ...[
          const SizedBox(height: 12),
          AppSoftCard(
            radius: StarCloudsRadii.card,
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < channels.length; i++) ...[
                  if (i > 0)
                    Padding(
                      padding: const EdgeInsets.only(left: 64),
                      child: Divider(height: 1, color: colors.outlineVariant),
                    ),
                  _WalletSummaryRow(item: channels[i]),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _WalletSummaryRow extends StatelessWidget {
  const _WalletSummaryRow({required this.item});

  final WalletSummaryItem item;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final route = item.route;
    final tone = _walletChannelTone(colors, item.id);
    return AppPressable(
      onTap: route == null
          ? null
          : () => GoRouter.maybeOf(context)?.push(route),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 52),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 12, 10),
          child: Row(
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: .12),
                  shape: BoxShape.circle,
                ),
                child: SizedBox.square(
                  dimension: 36,
                  child: Icon(
                    _walletChannelIcon(item.id),
                    size: 18,
                    color: tone,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  item.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(
                    context,
                  ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                walletPoints(item.points),
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.2,
                ),
              ),
              if (route != null) ...[
                const SizedBox(width: 2),
                Icon(
                  Icons.chevron_right_rounded,
                  size: 18,
                  color: colors.onSurfaceVariant,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class RedeemCodeSheet extends StatefulWidget {
  const RedeemCodeSheet({required this.onSubmit, super.key});

  final Future<WalletRedemption> Function(String code) onSubmit;

  @override
  State<RedeemCodeSheet> createState() => _RedeemCodeSheetState();
}

class _RedeemCodeSheetState extends State<RedeemCodeSheet> {
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
    if (!_formKey.currentState!.validate() || _submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final result = await widget.onSubmit(_controller.text);
      if (mounted) Navigator.pop(context, result);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = _redeemError(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + keyboard),
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '兑换积分',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 5),
              Text(
                '输入兑换码，积分将在验证后立即入账。',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 18),
              TextFormField(
                controller: _controller,
                autofocus: true,
                enabled: !_submitting,
                maxLength: 32,
                textCapitalization: TextCapitalization.characters,
                autocorrect: false,
                validator: validateRedemptionCode,
                decoration: InputDecoration(
                  labelText: '兑换码',
                  hintText: 'SC-XXXX-XXXX-XXXX',
                  prefixIcon: const Icon(Icons.confirmation_number_outlined),
                  errorText: _error,
                ),
                onFieldSubmitted: (_) => _submit(),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _submitting ? null : _submit,
                  icon: _submitting
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.redeem),
                  label: Text(_submitting ? '兑换中' : '立即兑换'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Color _walletChannelTone(ColorScheme colors, String id) => switch (id) {
  'daily_checkin' => colors.primary,
  'order' || 'subscription_daily' => colors.tertiary,
  'redeem_code' => colors.secondary,
  'signup_bonus' => colors.primary,
  'usage_milestone' ||
  'growth_group' ||
  'feedback_adoption' ||
  'task_failure_bonus' => colors.secondary,
  _ => colors.onSurfaceVariant,
};

IconData _walletChannelIcon(String id) => switch (id) {
  'daily_checkin' => Icons.calendar_month_outlined,
  'order' => Icons.workspace_premium_outlined,
  'subscription_daily' => Icons.autorenew,
  'redeem_code' => Icons.redeem_outlined,
  'signup_bonus' => Icons.celebration_outlined,
  'usage_milestone' ||
  'growth_group' ||
  'feedback_adoption' ||
  'task_failure_bonus' => Icons.card_giftcard_outlined,
  _ => Icons.payments_outlined,
};

String _redeemError(Object error) {
  if (error is! ApiException) return '兑换失败，请稍后重试';
  return switch (error.code) {
    'code_invalid' => '兑换码不存在，请检查后重试',
    'code_redeemed' => '该兑换码已被使用',
    'code_expired' => '兑换码已过期',
    'code_disabled' => '兑换码已停用',
    'rate_limited' => '操作过于频繁，请稍后再试',
    _ => error.message,
  };
}
