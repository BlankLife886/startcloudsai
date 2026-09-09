import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

class CheckinReward {
  const CheckinReward({
    required this.day,
    required this.rewardPoints,
    required this.milestone,
  });

  factory CheckinReward.fromJson(Map<String, dynamic> json) => CheckinReward(
    day: (json['day'] as num?)?.toInt() ?? 1,
    rewardPoints: (json['rewardCents'] as num?)?.toInt() ?? 0,
    milestone: json['milestone'] == true,
  );

  final int day;
  final int rewardPoints;
  final bool milestone;
}

class CheckinRecord {
  const CheckinRecord({
    required this.id,
    required this.date,
    required this.streak,
    required this.cycleDay,
    required this.rewardPoints,
  });

  factory CheckinRecord.fromJson(Map<String, dynamic> json) => CheckinRecord(
    id: json['id']?.toString() ?? '',
    date: json['date']?.toString() ?? '',
    streak: (json['streak'] as num?)?.toInt() ?? 0,
    cycleDay: (json['cycleDay'] as num?)?.toInt() ?? 1,
    rewardPoints: (json['rewardCents'] as num?)?.toInt() ?? 0,
  );

  final String id;
  final String date;
  final int streak;
  final int cycleDay;
  final int rewardPoints;
}

class CheckinState {
  const CheckinState({
    required this.enabled,
    required this.campaignTitle,
    required this.today,
    required this.todayChecked,
    required this.todayRecord,
    required this.currentStreak,
    required this.claimCycleDay,
    required this.claimRewardPoints,
    required this.nextCycleDay,
    required this.nextRewardPoints,
    required this.rewards,
    required this.month,
    required this.monthRecords,
    required this.monthRewardPoints,
    required this.totalCheckins,
    required this.claimedRewardPoints,
    required this.alreadyChecked,
  });

  factory CheckinState.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final rewardItems = map['rewards'];
    final rewards = rewardItems is List
        ? rewardItems
              .whereType<Map>()
              .map(
                (item) =>
                    CheckinReward.fromJson(Map<String, dynamic>.from(item)),
              )
              .toList()
        : const <CheckinReward>[];
    final recordItems = map['monthRecords'];
    final records = recordItems is List
        ? recordItems
              .whereType<Map>()
              .map(
                (item) =>
                    CheckinRecord.fromJson(Map<String, dynamic>.from(item)),
              )
              .where((item) => item.date.isNotEmpty)
              .toList()
        : const <CheckinRecord>[];
    final rawTodayRecord = map['todayRecord'];
    return CheckinState(
      enabled: map['enabled'] != false,
      campaignTitle: map['campaignTitle']?.toString().trim().isNotEmpty == true
          ? map['campaignTitle'].toString().trim()
          : '连续签到领创作积分',
      today: map['today']?.toString() ?? '',
      todayChecked: map['todayChecked'] == true,
      todayRecord: rawTodayRecord is Map
          ? CheckinRecord.fromJson(Map<String, dynamic>.from(rawTodayRecord))
          : null,
      currentStreak: (map['currentStreak'] as num?)?.toInt() ?? 0,
      claimCycleDay: (map['claimCycleDay'] as num?)?.toInt() ?? 1,
      claimRewardPoints: (map['claimRewardCents'] as num?)?.toInt() ?? 0,
      nextCycleDay: (map['nextCycleDay'] as num?)?.toInt() ?? 1,
      nextRewardPoints: (map['nextRewardCents'] as num?)?.toInt() ?? 0,
      rewards: rewards,
      month: map['month']?.toString() ?? '',
      monthRecords: records,
      monthRewardPoints: (map['monthRewardCents'] as num?)?.toInt() ?? 0,
      totalCheckins: (map['totalCheckins'] as num?)?.toInt() ?? 0,
      claimedRewardPoints: (map['claimedRewardCents'] as num?)?.toInt() ?? 0,
      alreadyChecked: map['alreadyChecked'] == true,
    );
  }

  final bool enabled;
  final String campaignTitle;
  final String today;
  final bool todayChecked;
  final CheckinRecord? todayRecord;
  final int currentStreak;
  final int claimCycleDay;
  final int claimRewardPoints;
  final int nextCycleDay;
  final int nextRewardPoints;
  final List<CheckinReward> rewards;
  final String month;
  final List<CheckinRecord> monthRecords;
  final int monthRewardPoints;
  final int totalCheckins;
  final int claimedRewardPoints;
  final bool alreadyChecked;

  int get activeCycleDay =>
      todayChecked ? todayRecord?.cycleDay ?? claimCycleDay : claimCycleDay;
}

class CheckinRepository {
  const CheckinRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<CheckinState> state() async =>
      CheckinState.fromJson(await _apiClient.get('/me/checkin'));

  Future<CheckinState> claim() async =>
      CheckinState.fromJson(await _apiClient.post('/me/checkin'));
}

final checkinRepositoryProvider = Provider<CheckinRepository>(
  (ref) => CheckinRepository(ref.watch(apiClientProvider)),
);

class CheckinController extends AsyncNotifier<CheckinState> {
  CheckinRepository get _repository => ref.read(checkinRepositoryProvider);

  @override
  Future<CheckinState> build() => _repository.state();

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_repository.state);
  }

  Future<CheckinState> claim() async {
    final current = state.asData?.value;
    if (current?.todayChecked == true) return current!;
    final next = await _repository.claim();
    state = AsyncData(next);
    return next;
  }
}

final checkinControllerProvider =
    AsyncNotifierProvider<CheckinController, CheckinState>(
      CheckinController.new,
    );
