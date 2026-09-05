import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../profile/profile.dart';
import 'checkin.dart';

abstract final class _CheckinTone {
  static const accent = Color(0xFF0F766E);
}

const _checkinRadius = BorderRadius.all(Radius.circular(8));

class CheckinScreen extends ConsumerStatefulWidget {
  const CheckinScreen({super.key});

  @override
  ConsumerState<CheckinScreen> createState() => _CheckinScreenState();
}

class _CheckinScreenState extends ConsumerState<CheckinScreen> {
  bool _claiming = false;

  Future<void> _claim() async {
    if (_claiming) return;
    setState(() => _claiming = true);
    try {
      final result = await ref.read(checkinControllerProvider.notifier).claim();
      ref.invalidate(walletProvider);
      ref.invalidate(profileOverviewProvider);
      if (!mounted) return;
      final message = result.alreadyChecked
          ? '今天已经签到过了'
          : '签到成功，获得 ${result.claimedRewardPoints} 积分';
      AppNotice.success(context, message);
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException ? error.message : '签到失败，请稍后重试';
      AppNotice.error(context, message);
    } finally {
      if (mounted) setState(() => _claiming = false);
    }
  }

  Future<void> _refresh() =>
      ref.read(checkinControllerProvider.notifier).refresh();

  void _showRewardDetails(CheckinState state, CheckinReward reward) {
    final completed = state.todayChecked
        ? state.todayRecord?.cycleDay ?? state.claimCycleDay
        : (state.claimCycleDay - 1).clamp(0, state.rewards.length);
    final message = reward.day <= completed
        ? '已领取 ${reward.rewardPoints} 积分'
        : reward.day == state.activeCycleDay
        ? '今天签到可领取 ${reward.rewardPoints} 积分'
        : '连续签到至第 ${reward.day} 天可领取 ${reward.rewardPoints} 积分';
    AppNotice.show(
      context,
      message,
      title: '第 ${reward.day} 天奖励${reward.milestone ? ' · 里程碑' : ''}',
    );
  }

  void _showRecordDetails(CheckinRecord record) {
    final parts = record.date.split('-');
    final month = int.tryParse(parts.elementAtOrNull(1) ?? '');
    final day = int.tryParse(parts.elementAtOrNull(2) ?? '');
    AppNotice.show(
      context,
      '连续 ${record.streak} 天，本次获得 ${record.rewardPoints} 积分',
      title: month == null || day == null ? '签到记录' : '$month 月 $day 日签到',
    );
  }

  @override
  Widget build(BuildContext context) {
    final checkin = ref.watch(checkinControllerProvider);
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: const AppTopBar(
        title: Text('每日签到'),
        fallbackLocation: '/profile',
      ),
      body: checkin.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _CheckinError(onRetry: _refresh),
        data: (state) => RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              _CheckinHeader(
                state: state,
                claiming: _claiming,
                onClaim: _claim,
              ),
              const SizedBox(height: 14),
              _CheckinStats(state: state),
              const SizedBox(height: 22),
              const AppSectionLabel('连续奖励'),
              const SizedBox(height: 10),
              CheckinRewardStrip(
                state: state,
                onRewardTap: (reward) => _showRewardDetails(state, reward),
              ),
              const SizedBox(height: 22),
              CheckinMonthCalendar(
                state: state,
                onRecordTap: _showRecordDetails,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CheckinHeader extends StatelessWidget {
  const _CheckinHeader({
    required this.state,
    required this.claiming,
    required this.onClaim,
  });

  final CheckinState state;
  final bool claiming;
  final VoidCallback onClaim;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final checked = state.todayChecked;
    return AppAppear(
      child: _CheckinSurface(
        key: const Key('checkin-header-surface'),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: _CheckinTone.accent.withValues(alpha: .12),
                    borderRadius: _checkinRadius,
                  ),
                  child: const Icon(
                    Icons.calendar_month_outlined,
                    color: _CheckinTone.accent,
                    size: 21,
                  ),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        state.campaignTitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        checked ? '今日积分已到账' : '签到后积分立即到账',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                AnimatedSwitcher(
                  duration: reduceMotion
                      ? Duration.zero
                      : const Duration(milliseconds: 200),
                  child: Icon(
                    checked ? Icons.check_circle_rounded : Icons.stars_rounded,
                    key: ValueKey(checked),
                    color: _CheckinTone.accent,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: AnimatedSwitcher(
                    duration: reduceMotion
                        ? Duration.zero
                        : const Duration(milliseconds: 220),
                    transitionBuilder: (child, animation) => FadeTransition(
                      opacity: animation,
                      child: SlideTransition(
                        position: Tween<Offset>(
                          begin: const Offset(0, .12),
                          end: Offset.zero,
                        ).animate(animation),
                        child: child,
                      ),
                    ),
                    child: Column(
                      key: ValueKey(checked),
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          checked
                              ? '${state.currentStreak} 天'
                              : '${state.claimRewardPoints} 积分',
                          maxLines: 1,
                          style: Theme.of(context).textTheme.headlineMedium
                              ?.copyWith(
                                color: _CheckinTone.accent,
                                fontWeight: FontWeight.w900,
                                height: 1,
                              ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          checked ? '当前连续签到' : '今日可领取',
                          style: Theme.of(context).textTheme.labelMedium
                              ?.copyWith(color: colors.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                FilledButton.icon(
                  onPressed: state.enabled && !checked && !claiming
                      ? onClaim
                      : null,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(124, 46),
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    backgroundColor: _CheckinTone.accent,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: _CheckinTone.accent.withValues(
                      alpha: .14,
                    ),
                    disabledForegroundColor: _CheckinTone.accent,
                    shape: const RoundedRectangleBorder(
                      borderRadius: _checkinRadius,
                    ),
                  ),
                  icon: claiming
                      ? const SizedBox.square(
                          dimension: 17,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Icon(
                          checked
                              ? Icons.check_rounded
                              : Icons.add_circle_outline_rounded,
                          size: 19,
                        ),
                  label: AnimatedSwitcher(
                    duration: reduceMotion
                        ? Duration.zero
                        : const Duration(milliseconds: 180),
                    child: Text(
                      claiming
                          ? '签到中'
                          : checked
                          ? '已签到'
                          : state.enabled
                          ? '立即签到'
                          : '活动暂停',
                      key: ValueKey((claiming, checked, state.enabled)),
                    ),
                  ),
                ),
              ],
            ),
            if (checked && state.nextRewardPoints > 0) ...[
              const SizedBox(height: 12),
              Text(
                '明日继续签到可领 ${state.nextRewardPoints} 积分',
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _CheckinStats extends StatelessWidget {
  const _CheckinStats({required this.state});

  final CheckinState state;

  @override
  Widget build(BuildContext context) {
    return _CheckinSurface(
      key: const Key('checkin-stats-surface'),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 14),
      child: Row(
        children: [
          _CheckinMetric(label: '连续签到', value: '${state.currentStreak} 天'),
          _CheckinMetric(label: '本月积分', value: '${state.monthRewardPoints}'),
          _CheckinMetric(label: '累计签到', value: '${state.totalCheckins} 天'),
        ],
      ),
    );
  }
}

class _CheckinMetric extends StatelessWidget {
  const _CheckinMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Expanded(
      child: Column(
        children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              maxLines: 1,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w800,
                height: 1.1,
              ),
            ),
          ),
          const SizedBox(height: 5),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: colors.onSurfaceVariant,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class CheckinRewardStrip extends StatelessWidget {
  const CheckinRewardStrip({required this.state, this.onRewardTap, super.key});

  final CheckinState state;
  final ValueChanged<CheckinReward>? onRewardTap;

  @override
  Widget build(BuildContext context) {
    final rewards = state.rewards;
    if (rewards.isEmpty) {
      return const SizedBox(height: 88, child: Center(child: Text('奖励配置暂不可用')));
    }
    final completed = state.todayChecked
        ? state.todayRecord?.cycleDay ?? state.claimCycleDay
        : (state.claimCycleDay - 1).clamp(0, rewards.length);
    return _CheckinSurface(
      key: const Key('checkin-rewards-surface'),
      padding: const EdgeInsets.fromLTRB(10, 16, 10, 14),
      child: Column(
        children: [
          Row(
            children: [
              for (final reward in rewards)
                _RewardDay(
                  reward: reward,
                  done: reward.day <= completed,
                  active:
                      !state.todayChecked && reward.day == state.activeCycleDay,
                  onTap: onRewardTap == null
                      ? null
                      : () => onRewardTap!(reward),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RewardDay extends StatelessWidget {
  const _RewardDay({
    required this.reward,
    required this.done,
    required this.active,
    this.onTap,
  });

  final CheckinReward reward;
  final bool done;
  final bool active;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final tone = done || active ? _CheckinTone.accent : colors.outline;
    return Expanded(
      child: Semantics(
        button: onTap != null,
        label:
            '第 ${reward.day} 天，${reward.rewardPoints} 积分${active ? '，当前进度' : ''}',
        child: AppPressable(
          key: Key('checkin-reward-${reward.day}'),
          onTap: onTap,
          child: Column(
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: done
                      ? _CheckinTone.accent
                      : active
                      ? _CheckinTone.accent.withValues(alpha: .14)
                      : colors.surfaceContainerLow,
                  shape: BoxShape.circle,
                  border: active
                      ? Border.all(color: _CheckinTone.accent, width: 2)
                      : null,
                ),
                child: SizedBox.square(
                  dimension: 32,
                  child: Icon(
                    done
                        ? Icons.check_rounded
                        : reward.milestone
                        ? Icons.workspace_premium
                        : Icons.stars_outlined,
                    size: 16,
                    color: done ? Colors.white : tone,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  '第 ${reward.day} 天',
                  maxLines: 1,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: active
                        ? _CheckinTone.accent
                        : colors.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(height: 2),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  '+${reward.rewardPoints}',
                  maxLines: 1,
                  style: TextStyle(
                    fontWeight: FontWeight.w900,
                    color: done || active
                        ? _CheckinTone.accent
                        : colors.onSurface,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class CheckinMonthCalendar extends StatelessWidget {
  const CheckinMonthCalendar({
    required this.state,
    this.onRecordTap,
    super.key,
  });

  final CheckinState state;
  final ValueChanged<CheckinRecord>? onRecordTap;

  @override
  Widget build(BuildContext context) {
    final monthParts = state.month.split('-');
    final year = int.tryParse(monthParts.firstOrNull ?? '');
    final month = int.tryParse(monthParts.elementAtOrNull(1) ?? '');
    if (year == null || month == null || month < 1 || month > 12) {
      return const SizedBox.shrink();
    }
    final first = DateTime(year, month, 1);
    final dayCount = DateTime(year, month + 1, 0).day;
    final leading = first.weekday - 1;
    final cellCount = ((leading + dayCount + 6) ~/ 7) * 7;
    final records = {for (final item in state.monthRecords) item.date: item};
    return _CheckinSurface(
      key: const Key('checkin-calendar-surface'),
      padding: const EdgeInsets.fromLTRB(14, 16, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$year 年 $month 月',
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            '本月已签到 ${state.monthRecords.length} 天',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              for (final label in ['一', '二', '三', '四', '五', '六', '日'])
                Expanded(
                  child: Center(
                    child: Text(
                      label,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 7,
              childAspectRatio: 1,
            ),
            itemCount: cellCount,
            itemBuilder: (context, index) {
              final day = index - leading + 1;
              if (day < 1 || day > dayCount) return const SizedBox.shrink();
              final date =
                  '$year-${month.toString().padLeft(2, '0')}-${day.toString().padLeft(2, '0')}';
              return _CalendarDay(
                day: day,
                today: date == state.today,
                record: records[date],
                onTap: records[date] == null || onRecordTap == null
                    ? null
                    : () => onRecordTap!(records[date]!),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _CalendarDay extends StatelessWidget {
  const _CalendarDay({
    required this.day,
    required this.today,
    this.record,
    this.onTap,
  });

  final int day;
  final bool today;
  final CheckinRecord? record;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final checked = record != null;
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      button: onTap != null,
      label:
          '$day 日${checked
              ? '，已签到 ${record!.rewardPoints} 积分'
              : today
              ? '，今天'
              : ''}',
      child: AppPressable(
        key: Key('checkin-record-$day'),
        onTap: onTap,
        child: Center(
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: checked
                  ? _CheckinTone.accent
                  : today
                  ? _CheckinTone.accent.withValues(alpha: .12)
                  : Colors.transparent,
              shape: BoxShape.circle,
            ),
            child: SizedBox.square(
              dimension: 32,
              child: Center(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    '$day',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: checked
                          ? Colors.white
                          : today
                          ? _CheckinTone.accent
                          : colors.onSurface,
                    ),
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

class _CheckinSurface extends StatelessWidget {
  const _CheckinSurface({
    required this.child,
    required this.padding,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: _checkinRadius,
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}

class _CheckinError extends StatelessWidget {
  const _CheckinError({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.event_busy_outlined,
              size: 42,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 12),
            const Text('签到状态加载失败'),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('重新加载'),
            ),
          ],
        ),
      ),
    );
  }
}
