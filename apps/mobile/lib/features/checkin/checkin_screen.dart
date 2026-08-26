import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/starclouds_theme.dart';
import '../../core/network/api_exception.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../profile/profile.dart';
import 'checkin.dart';

abstract final class _CheckinTone {
  static const light = Color(0xFFD8F3EE);
  static const dark = Color(0xFF1E3A36);
  static const accent = Color(0xFF0F766E);
}

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
              CheckinRewardStrip(state: state),
              const SizedBox(height: 22),
              CheckinMonthCalendar(state: state),
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    final checked = state.todayChecked;
    final onCard = dark ? const Color(0xE6F4F5F8) : const Color(0xFF134E4A);
    final muted = dark ? const Color(0xB8F4F5F8) : const Color(0xCC134E4A);
    return AppAppear(
      child: AppSoftCard(
        color: dark ? _CheckinTone.dark : _CheckinTone.light,
        radius: StarCloudsRadii.card,
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 18),
        child: Column(
          children: [
            Text(
              state.campaignTitle,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w900,
                color: onCard,
              ),
            ),
            const SizedBox(height: 16),
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                checked
                    ? '${state.currentStreak}'
                    : '${state.claimRewardPoints}',
                style: Theme.of(context).textTheme.displaySmall?.copyWith(
                  fontWeight: FontWeight.w900,
                  letterSpacing: -1.4,
                  height: 1,
                  color: onCard,
                ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              checked ? '连续签到天数' : '今日可领积分',
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: muted,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: state.enabled && !checked && !claiming
                    ? onClaim
                    : null,
                style: FilledButton.styleFrom(
                  backgroundColor: _CheckinTone.accent,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: _CheckinTone.accent.withValues(
                    alpha: .38,
                  ),
                  disabledForegroundColor: Colors.white.withValues(alpha: .86),
                ),
                icon: claiming
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Icon(checked ? Icons.check_circle : Icons.add_circle),
                label: Text(
                  claiming
                      ? '签到中'
                      : checked
                      ? '今日已签到'
                      : state.enabled
                      ? '立即签到'
                      : '活动暂停',
                ),
              ),
            ),
            if (checked && state.nextRewardPoints > 0) ...[
              const SizedBox(height: 10),
              Text(
                '明日继续签到可领 ${state.nextRewardPoints} 积分',
                textAlign: TextAlign.center,
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: muted),
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
    return AppSoftCard(
      radius: StarCloudsRadii.card,
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
  const CheckinRewardStrip({required this.state, super.key});

  final CheckinState state;

  @override
  Widget build(BuildContext context) {
    final rewards = state.rewards;
    if (rewards.isEmpty) {
      return const SizedBox(height: 88, child: Center(child: Text('奖励配置暂不可用')));
    }
    final completed = state.todayChecked
        ? state.todayRecord?.cycleDay ?? state.claimCycleDay
        : (state.claimCycleDay - 1).clamp(0, rewards.length);
    return AppSoftCard(
      radius: StarCloudsRadii.card,
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
  });

  final CheckinReward reward;
  final bool done;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final tone = done || active ? _CheckinTone.accent : colors.outline;
    return Expanded(
      child: Semantics(
        label:
            '第 ${reward.day} 天，${reward.rewardPoints} 积分${active ? '，当前进度' : ''}',
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
                  color: active ? _CheckinTone.accent : colors.onSurfaceVariant,
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
    );
  }
}

class CheckinMonthCalendar extends StatelessWidget {
  const CheckinMonthCalendar({required this.state, super.key});

  final CheckinState state;

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
    return AppSoftCard(
      radius: StarCloudsRadii.card,
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
              );
            },
          ),
        ],
      ),
    );
  }
}

class _CalendarDay extends StatelessWidget {
  const _CalendarDay({required this.day, required this.today, this.record});

  final int day;
  final bool today;
  final CheckinRecord? record;

  @override
  Widget build(BuildContext context) {
    final checked = record != null;
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      label:
          '$day 日${checked
              ? '，已签到 ${record!.rewardPoints} 积分'
              : today
              ? '，今天'
              : ''}',
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
