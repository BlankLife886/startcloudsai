import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../auth/auth.dart';
import 'profile_image_service.dart';

String uploadedFileUrl(Map<String, dynamic> map) {
  for (final key in const ['url', 'displayUrl', 'thumbnailUrl']) {
    final value = map[key]?.toString().trim() ?? '';
    if (value.isNotEmpty) return value;
  }
  return '';
}

class WalletSnapshot {
  const WalletSnapshot({
    required this.availablePoints,
    required this.frozenPoints,
    required this.trialPoints,
    this.normalBalancePoints,
    this.normalFrozenPoints = 0,
    this.trialFrozenPoints = 0,
    this.accountTotalPoints,
  });

  factory WalletSnapshot.fromJson(Map<String, dynamic> json) {
    final available =
        ((json['availableCents'] ??
                    json['balanceCents'] ??
                    json['balancePoints'])
                as num?)
            ?.toInt() ??
        0;
    final frozen =
        ((json['frozenCents'] ?? json['frozenPoints']) as num?)?.toInt() ?? 0;
    final trial = (json['trialBalanceCents'] as num?)?.toInt() ?? 0;
    return WalletSnapshot(
      availablePoints: available,
      frozenPoints: frozen,
      trialPoints: trial,
      normalBalancePoints: (json['normalBalanceCents'] as num?)?.toInt(),
      normalFrozenPoints: (json['normalFrozenCents'] as num?)?.toInt() ?? 0,
      trialFrozenPoints: (json['trialFrozenCents'] as num?)?.toInt() ?? 0,
      accountTotalPoints: (json['totalCents'] as num?)?.toInt(),
    );
  }

  final int availablePoints;
  final int frozenPoints;
  final int trialPoints;
  final int? normalBalancePoints;
  final int normalFrozenPoints;
  final int trialFrozenPoints;
  final int? accountTotalPoints;

  int get normalPoints {
    final stored = normalBalancePoints;
    if (stored != null) return stored;
    final derived = availablePoints - trialPoints;
    return derived < 0 ? 0 : derived;
  }

  int get totalPoints => accountTotalPoints ?? availablePoints + frozenPoints;
}

class ProfileTaskStats {
  const ProfileTaskStats({
    required this.total,
    required this.succeeded,
    required this.running,
    required this.failed,
  });

  factory ProfileTaskStats.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return ProfileTaskStats(
      total: (map['total'] as num?)?.toInt() ?? 0,
      succeeded: (map['succeeded'] as num?)?.toInt() ?? 0,
      running: (map['running'] as num?)?.toInt() ?? 0,
      failed: (map['failed'] as num?)?.toInt() ?? 0,
    );
  }

  final int total;
  final int succeeded;
  final int running;
  final int failed;
}

class ProfileSubmissionStats {
  const ProfileSubmissionStats({
    required this.total,
    required this.pending,
    required this.approved,
    required this.rejected,
  });

  factory ProfileSubmissionStats.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return ProfileSubmissionStats(
      total: (map['total'] as num?)?.toInt() ?? 0,
      pending: (map['pending'] as num?)?.toInt() ?? 0,
      approved: (map['approved'] as num?)?.toInt() ?? 0,
      rejected: (map['rejected'] as num?)?.toInt() ?? 0,
    );
  }

  final int total;
  final int pending;
  final int approved;
  final int rejected;
}

class ProfileRecentTask {
  const ProfileRecentTask({
    required this.id,
    required this.prompt,
    required this.status,
    required this.previewUrl,
    required this.createdAt,
  });

  factory ProfileRecentTask.fromJson(Map<String, dynamic> json) {
    final params = json['params'];
    final prompt = params is Map
        ? params['userPrompt']?.toString().trim() ?? ''
        : '';
    String? firstUrl(dynamic value) => value is List
        ? value
              .map((item) => item.toString().trim())
              .firstWhere((item) => item.isNotEmpty, orElse: () => '')
        : null;
    final preview = firstUrl(json['thumbnailUrls']);
    final display = firstUrl(json['displayUrls']);
    final output = firstUrl(json['outputUrls']);
    return ProfileRecentTask(
      id: json['id']?.toString() ?? '',
      prompt: prompt.isNotEmpty
          ? prompt
          : json['prompt']?.toString().trim() ?? '',
      status: json['status']?.toString() ?? 'queued',
      previewUrl: [preview, display, output].whereType<String>().firstWhere(
        (item) => item.isNotEmpty,
        orElse: () => '',
      ),
      createdAt: DateTime.tryParse(
        json['createdAt']?.toString() ?? '',
      )?.toLocal(),
    );
  }

  final String id;
  final String prompt;
  final String status;
  final String previewUrl;
  final DateTime? createdAt;
}

class ProfileOverview {
  const ProfileOverview({
    required this.wallet,
    required this.taskStats,
    required this.submissionStats,
    required this.assetCount,
    required this.assetUngrouped,
    required this.unreadNotifications,
    required this.recentTasks,
  });

  factory ProfileOverview.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final rawTasks = map['recentTasks'];
    return ProfileOverview(
      wallet: WalletSnapshot.fromJson(
        map['wallet'] is Map
            ? Map<String, dynamic>.from(map['wallet'] as Map)
            : const <String, dynamic>{},
      ),
      taskStats: ProfileTaskStats.fromJson(map['taskStats']),
      submissionStats: ProfileSubmissionStats.fromJson(map['submissionStats']),
      assetCount: (map['assetCount'] as num?)?.toInt() ?? 0,
      assetUngrouped: (map['assetUngrouped'] as num?)?.toInt() ?? 0,
      unreadNotifications: (map['unreadNotifications'] as num?)?.toInt() ?? 0,
      recentTasks: rawTasks is List
          ? rawTasks
                .whereType<Map>()
                .map(
                  (item) => ProfileRecentTask.fromJson(
                    Map<String, dynamic>.from(item),
                  ),
                )
                .where((item) => item.id.isNotEmpty)
                .toList()
          : const [],
    );
  }

  final WalletSnapshot wallet;
  final ProfileTaskStats taskStats;
  final ProfileSubmissionStats submissionStats;
  final int assetCount;
  final int assetUngrouped;
  final int unreadNotifications;
  final List<ProfileRecentTask> recentTasks;
}

class ProfileRepository {
  const ProfileRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<WalletSnapshot> wallet() async {
    final data = await _apiClient.get('/me/wallet');
    return WalletSnapshot.fromJson(
      data is Map ? Map<String, dynamic>.from(data) : const <String, dynamic>{},
    );
  }

  Future<ProfileOverview> overview() async =>
      ProfileOverview.fromJson(await _apiClient.get('/me/overview'));

  Future<String> uploadAvatar(ProfileImageDraft image) async {
    final data = await _apiClient.post(
      '/uploads',
      data: FormData.fromMap({
        'file': await MultipartFile.fromFile(
          image.localPath,
          filename: image.filename,
        ),
      }),
    );
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final url = uploadedFileUrl(map);
    if (url.isEmpty) throw const FormatException('头像上传响应缺少文件地址');
    return url;
  }

  Future<AppUser> updateProfile({
    required String username,
    required String bio,
    required String location,
    required String websiteUrl,
    required bool requireCostConfirm,
    String? avatarUrl,
    bool updateAvatar = false,
  }) async {
    final data = await _apiClient.patch(
      '/me/profile',
      data: {
        'username': username.trim(),
        'bio': bio.trim(),
        'location': location.trim(),
        'websiteUrl': websiteUrl.trim(),
        'requireCostConfirm': requireCostConfirm,
        if (updateAvatar) 'avatarUrl': avatarUrl ?? '',
      },
    );
    if (data is! Map || data['user'] is! Map) {
      throw const FormatException('资料更新响应缺少用户信息');
    }
    return AppUser.fromJson(Map<String, dynamic>.from(data['user'] as Map));
  }
}

final profileRepositoryProvider = Provider<ProfileRepository>(
  (ref) => ProfileRepository(ref.watch(apiClientProvider)),
);

final walletProvider = FutureProvider<WalletSnapshot>(
  (ref) => ref.watch(profileRepositoryProvider).wallet(),
);

final profileOverviewProvider = FutureProvider<ProfileOverview>(
  (ref) => ref.watch(profileRepositoryProvider).overview(),
);

final profileImageServiceProvider = Provider<ProfileImageService>(
  (ref) => ProfileImageService(),
);
