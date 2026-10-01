import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

class TrialFeature {
  const TrialFeature({
    required this.key,
    required this.label,
    required this.taskTypes,
    required this.entitlementActive,
  });

  factory TrialFeature.fromJson(Map<String, dynamic> json) => TrialFeature(
    key: json['key']?.toString() ?? '',
    label: json['label']?.toString().trim() ?? '',
    taskTypes:
        (json['taskTypes'] as List?)
            ?.map((item) => item.toString())
            .where((item) => item.isNotEmpty)
            .toList() ??
        const [],
    entitlementActive: json['entitlementActive'] == true,
  );

  final String key;
  final String label;
  final List<String> taskTypes;
  final bool entitlementActive;
}

class TrialCampaign {
  const TrialCampaign({
    required this.id,
    required this.title,
    required this.features,
    required this.accessMode,
    required this.capacity,
    required this.applied,
    required this.remaining,
    required this.full,
    required this.nextPosition,
    required this.enabled,
    required this.remainingSeconds,
    this.expiresAt,
  });

  factory TrialCampaign.fromJson(Map<String, dynamic> json) => TrialCampaign(
    id: json['id']?.toString() ?? '',
    title: json['title']?.toString().trim() ?? '',
    features: _features(json['features']),
    accessMode: json['accessMode']?.toString() ?? 'credit_only',
    capacity: (json['capacity'] as num?)?.toInt() ?? 0,
    applied: (json['displayApplied'] as num?)?.toInt() ?? 0,
    remaining: (json['remaining'] as num?)?.toInt() ?? 0,
    full: json['full'] == true,
    nextPosition: (json['nextPosition'] as num?)?.toInt() ?? 0,
    enabled: json['enabled'] == true && json['expired'] != true,
    remainingSeconds: (json['remainingSeconds'] as num?)?.toInt() ?? 0,
    expiresAt: _date(json['expiresAt']),
  );

  final String id;
  final String title;
  final List<TrialFeature> features;
  final String accessMode;
  final int capacity;
  final int applied;
  final int remaining;
  final bool full;
  final int nextPosition;
  final bool enabled;
  final int remainingSeconds;
  final DateTime? expiresAt;

  double get progress => capacity <= 0 ? 1 : (applied / capacity).clamp(0, 1);
}

class TrialApplication {
  const TrialApplication({
    required this.id,
    required this.campaignId,
    required this.position,
    required this.occupation,
    required this.reason,
    required this.status,
    required this.reviewNote,
    required this.rewardPoints,
    required this.rewardStatus,
    required this.entitlementActive,
    required this.features,
    this.rewardExpiresAt,
    this.rewardClaimedAt,
    this.createdAt,
    this.reviewedAt,
  });

  factory TrialApplication.fromJson(Map<String, dynamic> json) =>
      TrialApplication(
        id: json['id']?.toString() ?? '',
        campaignId: json['campaignId']?.toString() ?? '',
        position:
            ((json['position'] ?? json['applicationNo']) as num?)?.toInt() ?? 0,
        occupation: json['occupation']?.toString().trim() ?? '',
        reason: json['reason']?.toString().trim() ?? '',
        status: json['status']?.toString() ?? 'pending',
        reviewNote: json['reviewNote']?.toString().trim() ?? '',
        reviewedAt: _date(json['reviewedAt']),
        createdAt: _date(json['createdAt']),
        rewardPoints: (json['rewardCents'] as num?)?.toInt() ?? 0,
        rewardStatus: json['rewardStatus']?.toString() ?? '',
        rewardExpiresAt: _date(json['rewardExpiresAt']),
        rewardClaimedAt: _date(json['rewardClaimedAt']),
        entitlementActive: json['entitlementActive'] == true,
        features: _features(json['features']),
      );

  final String id;
  final String campaignId;
  final int position;
  final String occupation;
  final String reason;
  final String status;
  final String reviewNote;
  final DateTime? reviewedAt;
  final DateTime? createdAt;
  final int rewardPoints;
  final String rewardStatus;
  final DateTime? rewardExpiresAt;
  final DateTime? rewardClaimedAt;
  final bool entitlementActive;
  final List<TrialFeature> features;

  bool get canApply => status == 'rejected';
  bool get canClaimReward => status == 'approved' && rewardStatus == 'active';
  bool get rewardClaimed => rewardStatus == 'redeemed';
}

class GrowthMilestone {
  const GrowthMilestone({
    required this.units,
    required this.rewardPoints,
    required this.achieved,
  });

  factory GrowthMilestone.fromJson(Map<String, dynamic> json) =>
      GrowthMilestone(
        units: (json['units'] as num?)?.toInt() ?? 0,
        rewardPoints: (json['rewardCents'] as num?)?.toInt() ?? 0,
        achieved: json['achieved'] == true,
      );

  final int units;
  final int rewardPoints;
  final bool achieved;
}

class GrowthMember {
  const GrowthMember({
    required this.userId,
    required this.username,
    required this.role,
    this.avatarUrl,
  });

  factory GrowthMember.fromJson(Map<String, dynamic> json) {
    final username = json['username']?.toString().trim() ?? '';
    return GrowthMember(
      userId: json['userId']?.toString() ?? '',
      username: username.isEmpty ? '星空用户' : username,
      role: json['role']?.toString() ?? 'member',
      avatarUrl: _optional(json['avatarUrl']),
    );
  }

  final String userId;
  final String username;
  final String role;
  final String? avatarUrl;
}

class GrowthGroup {
  const GrowthGroup({
    required this.id,
    required this.code,
    required this.status,
    required this.targetMembers,
    required this.memberCount,
    required this.rewardPoints,
    required this.members,
    this.expiresAt,
    this.completedAt,
  });

  factory GrowthGroup.fromJson(Map<String, dynamic> json) => GrowthGroup(
    id: json['id']?.toString() ?? '',
    code: json['code']?.toString() ?? '',
    status: json['status']?.toString() ?? 'active',
    targetMembers: (json['targetMembers'] as num?)?.toInt() ?? 0,
    memberCount: (json['memberCount'] as num?)?.toInt() ?? 0,
    rewardPoints: (json['rewardCents'] as num?)?.toInt() ?? 0,
    expiresAt: _date(json['expiresAt']),
    completedAt: _date(json['completedAt']),
    members: json['members'] is List
        ? (json['members'] as List)
              .whereType<Map>()
              .map(
                (item) =>
                    GrowthMember.fromJson(Map<String, dynamic>.from(item)),
              )
              .where((item) => item.userId.isNotEmpty)
              .toList()
        : const [],
  );

  final String id;
  final String code;
  final String status;
  final int targetMembers;
  final int memberCount;
  final int rewardPoints;
  final DateTime? expiresAt;
  final DateTime? completedAt;
  final List<GrowthMember> members;

  bool get isActive => status == 'active';
  double get progress =>
      targetMembers <= 0 ? 0 : (memberCount / targetMembers).clamp(0, 1);
}

class GrowthRules {
  const GrowthRules({
    required this.groupEnabled,
    required this.groupOrdinal,
    required this.groupTargetMembers,
    required this.groupRewardPoints,
    required this.groupDurationHours,
    required this.failureBonusEnabled,
    required this.failureBonusPoints,
    required this.failureBonusDailyLimit,
    required this.failureClaimsToday,
    required this.usageRewardsEnabled,
    required this.monthDeliveredUnits,
    required this.milestones,
    required this.suggestionRewardMaxPoints,
  });

  factory GrowthRules.fromJson(Map<String, dynamic> json) => GrowthRules(
    groupEnabled: json['groupEnabled'] == true,
    groupOrdinal: (json['groupCampaignOrdinal'] as num?)?.toInt() ?? 0,
    groupTargetMembers: (json['groupTargetMembers'] as num?)?.toInt() ?? 0,
    groupRewardPoints: (json['groupRewardCents'] as num?)?.toInt() ?? 0,
    groupDurationHours: (json['groupDurationHours'] as num?)?.toInt() ?? 0,
    failureBonusEnabled: json['failureBonusEnabled'] == true,
    failureBonusPoints: (json['failureBonusCents'] as num?)?.toInt() ?? 0,
    failureBonusDailyLimit:
        (json['failureBonusDailyLimit'] as num?)?.toInt() ?? 0,
    failureClaimsToday: (json['failureClaimsToday'] as num?)?.toInt() ?? 0,
    usageRewardsEnabled: json['usageRewardsEnabled'] == true,
    monthDeliveredUnits: (json['monthDeliveredUnits'] as num?)?.toInt() ?? 0,
    milestones: json['usageMilestones'] is List
        ? (json['usageMilestones'] as List)
              .whereType<Map>()
              .map(
                (item) =>
                    GrowthMilestone.fromJson(Map<String, dynamic>.from(item)),
              )
              .where((item) => item.units > 0)
              .toList()
        : const [],
    suggestionRewardMaxPoints:
        (json['suggestionRewardMaxCents'] as num?)?.toInt() ?? 0,
  );

  final bool groupEnabled;
  final int groupOrdinal;
  final int groupTargetMembers;
  final int groupRewardPoints;
  final int groupDurationHours;
  final bool failureBonusEnabled;
  final int failureBonusPoints;
  final int failureBonusDailyLimit;
  final int failureClaimsToday;
  final bool usageRewardsEnabled;
  final int monthDeliveredUnits;
  final List<GrowthMilestone> milestones;
  final int suggestionRewardMaxPoints;
}

class GrowthOverview {
  const GrowthOverview({required this.rules, this.group});

  factory GrowthOverview.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return GrowthOverview(
      rules: GrowthRules.fromJson(
        map['rules'] is Map
            ? Map<String, dynamic>.from(map['rules'] as Map)
            : const {},
      ),
      group: map['group'] is Map
          ? GrowthGroup.fromJson(Map<String, dynamic>.from(map['group'] as Map))
          : null,
    );
  }

  final GrowthRules rules;
  final GrowthGroup? group;
}

class BenefitsState {
  const BenefitsState({
    required this.campaign,
    required this.application,
    required this.growth,
    this.isSubmittingApplication = false,
    this.isClaimingReward = false,
    this.isGroupBusy = false,
  });

  final TrialCampaign? campaign;
  final TrialApplication? application;
  final GrowthOverview growth;
  final bool isSubmittingApplication;
  final bool isClaimingReward;
  final bool isGroupBusy;

  BenefitsState copyWith({
    TrialCampaign? campaign,
    TrialApplication? application,
    bool clearApplication = false,
    GrowthOverview? growth,
    bool? isSubmittingApplication,
    bool? isClaimingReward,
    bool? isGroupBusy,
  }) => BenefitsState(
    campaign: campaign ?? this.campaign,
    application: clearApplication ? null : application ?? this.application,
    growth: growth ?? this.growth,
    isSubmittingApplication:
        isSubmittingApplication ?? this.isSubmittingApplication,
    isClaimingReward: isClaimingReward ?? this.isClaimingReward,
    isGroupBusy: isGroupBusy ?? this.isGroupBusy,
  );
}

class TrialReward {
  const TrialReward({required this.grantPoints, required this.alreadyClaimed});

  factory TrialReward.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return TrialReward(
      grantPoints: (map['grantCents'] as num?)?.toInt() ?? 0,
      alreadyClaimed: map['alreadyClaimed'] == true,
    );
  }

  final int grantPoints;
  final bool alreadyClaimed;
}

class BenefitsRepository {
  const BenefitsRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<TrialCampaign?> campaign() async {
    final data = await _apiClient.get('/trial-access-campaign');
    if (data is! Map || data['campaign'] is! Map) return null;
    final campaign = TrialCampaign.fromJson(
      Map<String, dynamic>.from(data['campaign'] as Map),
    );
    return campaign.id.isEmpty ? null : campaign;
  }

  Future<TrialApplication?> application() async {
    final data = await _apiClient.get('/me/trial-access-application');
    if (data is! Map || data['application'] is! Map) return null;
    final application = TrialApplication.fromJson(
      Map<String, dynamic>.from(data['application'] as Map),
    );
    return application.id.isEmpty ? null : application;
  }

  Future<GrowthOverview> growth() async =>
      GrowthOverview.fromJson(await _apiClient.get('/me/growth'));

  Future<TrialApplication> submitApplication({
    required String occupation,
    required String reason,
  }) async {
    final data = await _apiClient.post(
      '/me/trial-access-applications',
      data: {
        'occupation': normalizeOccupations(occupation),
        'reason': reason.trim(),
      },
    );
    if (data is! Map || data['application'] is! Map) {
      throw const FormatException('体验申请响应无效');
    }
    return TrialApplication.fromJson(
      Map<String, dynamic>.from(data['application'] as Map),
    );
  }

  Future<TrialReward> claimReward() async => TrialReward.fromJson(
    await _apiClient.post('/me/trial-access-application/reward'),
  );

  Future<GrowthGroup> createGroup() async {
    final data = await _apiClient.post('/me/growth/groups');
    if (data is! Map) throw const FormatException('创建拼团响应无效');
    return GrowthGroup.fromJson(Map<String, dynamic>.from(data));
  }

  Future<GrowthGroup> joinGroup(String code) async {
    final data = await _apiClient.post(
      '/me/growth/groups/join',
      data: {'code': code.trim().toUpperCase()},
    );
    if (data is! Map) throw const FormatException('加入拼团响应无效');
    return GrowthGroup.fromJson(Map<String, dynamic>.from(data));
  }
}

final benefitsRepositoryProvider = Provider<BenefitsRepository>(
  (ref) => BenefitsRepository(ref.watch(apiClientProvider)),
);

class BenefitsController extends AsyncNotifier<BenefitsState> {
  BenefitsRepository get _repository => ref.read(benefitsRepositoryProvider);

  @override
  Future<BenefitsState> build() => _load();

  Future<BenefitsState> _load() async {
    final values = await Future.wait([
      _repository.campaign(),
      _repository.application(),
      _repository.growth(),
    ]);
    return BenefitsState(
      campaign: values[0] as TrialCampaign?,
      application: values[1] as TrialApplication?,
      growth: values[2] as GrowthOverview,
    );
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_load);
  }

  Future<TrialApplication> submitApplication({
    required String occupation,
    required String reason,
  }) async {
    final current = state.requireValue;
    state = AsyncData(current.copyWith(isSubmittingApplication: true));
    try {
      final application = await _repository.submitApplication(
        occupation: occupation,
        reason: reason,
      );
      state = AsyncData(
        current.copyWith(
          application: application,
          isSubmittingApplication: false,
        ),
      );
      return application;
    } catch (error, stackTrace) {
      state = AsyncData(current.copyWith(isSubmittingApplication: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<TrialReward> claimReward() async {
    final current = state.requireValue;
    state = AsyncData(current.copyWith(isClaimingReward: true));
    try {
      final reward = await _repository.claimReward();
      final application = await _repository.application();
      state = AsyncData(
        current.copyWith(
          application: application,
          clearApplication: application == null,
          isClaimingReward: false,
        ),
      );
      return reward;
    } catch (error, stackTrace) {
      state = AsyncData(current.copyWith(isClaimingReward: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<GrowthGroup> createGroup() => _changeGroup(_repository.createGroup);

  Future<GrowthGroup> joinGroup(String code) =>
      _changeGroup(() => _repository.joinGroup(code));

  Future<GrowthGroup> _changeGroup(
    Future<GrowthGroup> Function() operation,
  ) async {
    final current = state.requireValue;
    state = AsyncData(current.copyWith(isGroupBusy: true));
    try {
      final group = await operation();
      state = AsyncData(
        current.copyWith(
          growth: GrowthOverview(rules: current.growth.rules, group: group),
          isGroupBusy: false,
        ),
      );
      return group;
    } catch (error, stackTrace) {
      state = AsyncData(current.copyWith(isGroupBusy: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }
}

final benefitsControllerProvider =
    AsyncNotifierProvider<BenefitsController, BenefitsState>(
      BenefitsController.new,
    );

String normalizeOccupations(String value) {
  final parts = value
      .split(RegExp(r'[、,，;；]'))
      .map((item) => item.trim())
      .where((item) => item.isNotEmpty);
  final unique = <String>[];
  final seen = <String>{};
  for (final part in parts) {
    if (seen.add(part.toLowerCase())) unique.add(part);
  }
  return unique.join('、');
}

String? validateOccupations(String? value) {
  final normalized = normalizeOccupations(value ?? '');
  final parts = normalized.split('、').where((item) => item.isNotEmpty).toList();
  if (parts.isEmpty) return '请填写职业或使用场景';
  if (parts.length > 4) return '最多填写 4 个职业';
  if (parts.any((item) => item.runes.length < 2 || item.runes.length > 80)) {
    return '每个职业需为 2-80 个字符';
  }
  return null;
}

String? validateTrialReason(String? value) {
  final length = value?.trim().runes.length ?? 0;
  if (length < 10) return '申请理由至少需要 10 个字符';
  if (length > 1000) return '申请理由不能超过 1000 个字符';
  return null;
}

String? validateGroupCode(String? value) {
  final code = value?.trim() ?? '';
  if (code.length < 6 || code.length > 16) return '请输入 6-16 位拼团码';
  return null;
}

List<TrialFeature> _features(dynamic value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((item) => TrialFeature.fromJson(Map<String, dynamic>.from(item)))
      .where((item) => item.key.isNotEmpty && item.label.isNotEmpty)
      .toList();
}

DateTime? _date(dynamic value) =>
    DateTime.tryParse(value?.toString() ?? '')?.toLocal();

String? _optional(dynamic value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}
