import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

enum WalletEntryCategory { income, spend, pending, refund }

enum WalletEntryFilter { all, income, spend, pending, refund, normal, trial }

WalletEntryFilter walletEntryFilterFromName(String? name) =>
    WalletEntryFilter.values.firstWhere(
      (filter) => filter.name == name,
      orElse: () => WalletEntryFilter.all,
    );

class WalletLedgerTask {
  const WalletLedgerTask({
    required this.id,
    required this.displayName,
    required this.status,
    required this.modelName,
    required this.count,
    required this.costPoints,
    required this.settledCostPoints,
  });

  factory WalletLedgerTask.fromJson(Map<String, dynamic> json) =>
      WalletLedgerTask(
        id: json['id']?.toString() ?? '',
        displayName: json['displayName']?.toString() ?? '',
        status: json['status']?.toString() ?? '',
        modelName: json['modelName']?.toString() ?? '',
        count: (json['count'] as num?)?.toInt() ?? 1,
        costPoints: (json['costPoints'] as num?)?.toInt() ?? 0,
        settledCostPoints: (json['settledCostPoints'] as num?)?.toInt() ?? 0,
      );

  final String id;
  final String displayName;
  final String status;
  final String modelName;
  final int count;
  final int costPoints;
  final int settledCostPoints;
}

class WalletLedgerEntry {
  const WalletLedgerEntry({
    required this.id,
    required this.kind,
    required this.deltaPoints,
    required this.balanceAfterPoints,
    required this.sourceType,
    required this.reason,
    required this.creditBucket,
    required this.createdAt,
    this.task,
  });

  factory WalletLedgerEntry.fromJson(Map<String, dynamic> json) {
    final rawTask = json['task'];
    return WalletLedgerEntry(
      id: json['id']?.toString() ?? '',
      kind: json['kind']?.toString() ?? '',
      deltaPoints:
          ((json['deltaPoints'] ?? json['deltaCents']) as num?)?.toInt() ?? 0,
      balanceAfterPoints:
          ((json['balanceAfterPoints'] ?? json['balanceAfterCents']) as num?)
              ?.toInt() ??
          0,
      sourceType: json['sourceType']?.toString() ?? '',
      reason: json['reason']?.toString().trim() ?? '',
      creditBucket: json['creditBucket']?.toString() ?? 'normal',
      createdAt: DateTime.tryParse(
        json['createdAt']?.toString() ?? '',
      )?.toLocal(),
      task: rawTask is Map
          ? WalletLedgerTask.fromJson(Map<String, dynamic>.from(rawTask))
          : null,
    );
  }

  final String id;
  final String kind;
  final int deltaPoints;
  final int balanceAfterPoints;
  final String sourceType;
  final String reason;
  final String creditBucket;
  final DateTime? createdAt;
  final WalletLedgerTask? task;

  WalletEntryCategory get category {
    final normalized = kind.toLowerCase();
    if (normalized == 'freeze' || normalized.contains('freeze')) {
      return WalletEntryCategory.pending;
    }
    if (normalized == 'release' ||
        normalized == 'refund' ||
        normalized.contains('release') ||
        normalized.contains('refund')) {
      return WalletEntryCategory.refund;
    }
    if (normalized == 'spend' ||
        normalized.contains('settle') ||
        deltaPoints < 0) {
      return WalletEntryCategory.spend;
    }
    return WalletEntryCategory.income;
  }

  int get displayPoints {
    final amount = deltaPoints.abs();
    if (amount > 0) return amount;
    if (category == WalletEntryCategory.spend) {
      final settled = task?.settledCostPoints ?? 0;
      return settled > 0 ? settled : task?.costPoints ?? 0;
    }
    if (category == WalletEntryCategory.pending) {
      return task?.costPoints ?? 0;
    }
    return 0;
  }

  bool get increasesBalance =>
      category == WalletEntryCategory.income ||
      category == WalletEntryCategory.refund;

  String get title {
    final taskTitle = task?.displayName.trim() ?? '';
    if (taskTitle.isNotEmpty && category != WalletEntryCategory.income) {
      return taskTitle;
    }
    const sources = {
      'order': '套餐入账',
      'redeem_code': '兑换码入账',
      'daily_checkin': '签到奖励',
      'subscription_daily': '订阅积分发放',
      'signup_bonus': '注册赠送',
      'admin': '人工调整',
      'trial_access': '体验积分',
      'usage_milestone': '用量激励',
      'growth_group': '拼团奖励',
      'feedback_adoption': '建议采纳',
      'task_failure_bonus': '失败补偿',
    };
    return sources[sourceType] ??
        switch (category) {
          WalletEntryCategory.income => '积分入账',
          WalletEntryCategory.spend => '创作消费',
          WalletEntryCategory.pending => '任务冻结',
          WalletEntryCategory.refund => '积分退回',
        };
  }
}

extension WalletEntryFilterPresentation on WalletEntryFilter {
  String get label => switch (this) {
    WalletEntryFilter.all => '全部',
    WalletEntryFilter.income => '入账',
    WalletEntryFilter.spend => '消费',
    WalletEntryFilter.pending => '冻结',
    WalletEntryFilter.refund => '退款',
    WalletEntryFilter.normal => '普通积分',
    WalletEntryFilter.trial => '体验积分',
  };

  bool includes(WalletLedgerEntry entry) => switch (this) {
    WalletEntryFilter.all => true,
    WalletEntryFilter.income => entry.category == WalletEntryCategory.income,
    WalletEntryFilter.spend => entry.category == WalletEntryCategory.spend,
    WalletEntryFilter.pending => entry.category == WalletEntryCategory.pending,
    WalletEntryFilter.refund => entry.category == WalletEntryCategory.refund,
    WalletEntryFilter.normal => entry.creditBucket != 'trial',
    WalletEntryFilter.trial => entry.creditBucket == 'trial',
  };
}

class WalletLedgerPage {
  const WalletLedgerPage({
    required this.items,
    required this.nextCursor,
    required this.total,
  });

  factory WalletLedgerPage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final rawItems = map['items'];
    final cursor = map['nextCursor']?.toString().trim();
    return WalletLedgerPage(
      items: rawItems is List
          ? rawItems
                .whereType<Map>()
                .map(
                  (item) => WalletLedgerEntry.fromJson(
                    Map<String, dynamic>.from(item),
                  ),
                )
                .where((item) => item.id.isNotEmpty)
                .toList()
          : const [],
      nextCursor: cursor?.isNotEmpty == true ? cursor : null,
      total: (map['total'] as num?)?.toInt(),
    );
  }

  final List<WalletLedgerEntry> items;
  final String? nextCursor;
  final int? total;
}

class WalletSummaryItem {
  const WalletSummaryItem({
    required this.id,
    required this.label,
    required this.hint,
    required this.points,
    required this.count,
  });

  factory WalletSummaryItem.fromJson(Map<String, dynamic> json) =>
      WalletSummaryItem(
        id: json['id']?.toString() ?? '',
        label: json['label']?.toString() ?? '',
        hint: json['hint']?.toString() ?? '',
        points: (json['cents'] as num?)?.toInt() ?? 0,
        count: (json['count'] as num?)?.toInt() ?? 0,
      );

  final String id;
  final String label;
  final String hint;
  final int points;
  final int count;

  String? get route => switch (id) {
    'daily_checkin' => '/profile/checkin',
    'usage_milestone' ||
    'feedback_adoption' ||
    'task_failure_bonus' => '/profile/benefits/growth',
    'growth_group' => '/profile/benefits/group',
    'order' || 'subscription_daily' => '/profile/purchases',
    _ => null,
  };
}

class WalletSummary {
  const WalletSummary({
    required this.incomePoints,
    required this.consumedPoints,
    required this.refundPoints,
    required this.entryCount,
    this.incomeCount = 0,
    this.consumedCount = 0,
    this.refundCount = 0,
    this.items = const [],
  });

  factory WalletSummary.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final rawItems = map['items'];
    return WalletSummary(
      incomePoints: (map['incomeCents'] as num?)?.toInt() ?? 0,
      consumedPoints: (map['consumedCents'] as num?)?.toInt() ?? 0,
      refundPoints: (map['refundCents'] as num?)?.toInt() ?? 0,
      entryCount: (map['entryCount'] as num?)?.toInt() ?? 0,
      incomeCount: (map['incomeCount'] as num?)?.toInt() ?? 0,
      consumedCount: (map['consumedCount'] as num?)?.toInt() ?? 0,
      refundCount: (map['refundCount'] as num?)?.toInt() ?? 0,
      items: rawItems is List
          ? rawItems
                .whereType<Map>()
                .map(
                  (item) => WalletSummaryItem.fromJson(
                    Map<String, dynamic>.from(item),
                  ),
                )
                .where(
                  (item) => item.id.isNotEmpty && item.id != 'trial_access',
                )
                .toList()
          : const [],
    );
  }

  final int incomePoints;
  final int consumedPoints;
  final int refundPoints;
  final int entryCount;
  final int incomeCount;
  final int consumedCount;
  final int refundCount;
  final List<WalletSummaryItem> items;
}

class WalletRedemption {
  const WalletRedemption({required this.grantPoints});

  factory WalletRedemption.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return WalletRedemption(
      grantPoints: (map['grantCents'] as num?)?.toInt() ?? 0,
    );
  }

  final int grantPoints;
}

String? validateRedemptionCode(String? value) {
  final code = value?.trim() ?? '';
  if (code.isEmpty) return '请输入兑换码';
  if (code.runes.length > 32) return '兑换码不能超过 32 个字符';
  return null;
}

String walletBillFilename(DateTime now) {
  final local = now.toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return 'starclouds-wallet-${local.year}${two(local.month)}${two(local.day)}-'
      '${two(local.hour)}${two(local.minute)}${two(local.second)}.csv';
}

class WalletBillExporter {
  WalletBillExporter({
    required Future<List<int>> Function() download,
    Future<Directory> Function()? temporaryDirectory,
    DateTime Function()? now,
  }) : _download = download,
       _temporaryDirectory = temporaryDirectory ?? getTemporaryDirectory,
       _now = now ?? DateTime.now;

  final Future<List<int>> Function() _download;
  final Future<Directory> Function() _temporaryDirectory;
  final DateTime Function() _now;

  Future<File> export() async {
    final bytes = await _download();
    if (bytes.isEmpty) throw const FormatException('账单文件为空，请稍后重试');
    final directory = await _temporaryDirectory();
    final file = File('${directory.path}/${walletBillFilename(_now())}');
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }
}

final walletBillExporterProvider = Provider<WalletBillExporter>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return WalletBillExporter(
    download: () => apiClient.getBytes(
      '/me/wallet/export',
      invalidUrlMessage: '账单地址无效',
      downloadFailedMessage: '账单导出失败',
    ),
  );
});

class WalletCenterState {
  const WalletCenterState({
    required this.items,
    required this.nextCursor,
    required this.total,
    required this.summary,
    this.isLoadingMore = false,
  });

  final List<WalletLedgerEntry> items;
  final String? nextCursor;
  final int? total;
  final WalletSummary summary;
  final bool isLoadingMore;

  bool get hasMore => nextCursor != null;

  WalletCenterState copyWith({
    List<WalletLedgerEntry>? items,
    String? nextCursor,
    bool clearCursor = false,
    int? total,
    WalletSummary? summary,
    bool? isLoadingMore,
  }) => WalletCenterState(
    items: items ?? this.items,
    nextCursor: clearCursor ? null : nextCursor ?? this.nextCursor,
    total: total ?? this.total,
    summary: summary ?? this.summary,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
  );
}

class WalletCenterRepository {
  const WalletCenterRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<WalletLedgerPage> entries({String? cursor, int limit = 24}) async {
    final data = await _apiClient.get(
      '/me/wallet/entries',
      queryParameters: {
        'limit': limit,
        if (cursor?.isNotEmpty == true) 'cursor': cursor,
      },
    );
    return WalletLedgerPage.fromJson(data);
  }

  Future<WalletSummary> summary() async =>
      WalletSummary.fromJson(await _apiClient.get('/me/wallet/summary'));

  Future<WalletRedemption> redeem(String code) async =>
      WalletRedemption.fromJson(
        await _apiClient.post(
          '/me/wallet/redemptions',
          data: {'code': code.trim().toUpperCase()},
        ),
      );
}

final walletCenterRepositoryProvider = Provider<WalletCenterRepository>(
  (ref) => WalletCenterRepository(ref.watch(apiClientProvider)),
);

class WalletCenterController extends AsyncNotifier<WalletCenterState> {
  WalletCenterRepository get _repository =>
      ref.read(walletCenterRepositoryProvider);

  @override
  Future<WalletCenterState> build() => _loadFirstPage();

  Future<WalletCenterState> _loadFirstPage() async {
    final pageFuture = _repository.entries();
    final summaryFuture = _repository.summary();
    final page = await pageFuture;
    final summary = await summaryFuture;
    return WalletCenterState(
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
      summary: summary,
    );
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_loadFirstPage);
  }

  Future<void> loadMore() async {
    final current = state.asData?.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final page = await _repository.entries(cursor: current.nextCursor);
      final knownIds = current.items.map((item) => item.id).toSet();
      state = AsyncData(
        current.copyWith(
          items: [
            ...current.items,
            ...page.items.where((item) => knownIds.add(item.id)),
          ],
          nextCursor: page.nextCursor,
          clearCursor: page.nextCursor == null,
          total: page.total,
          isLoadingMore: false,
        ),
      );
    } catch (error, stackTrace) {
      state = AsyncData(current.copyWith(isLoadingMore: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<WalletRedemption> redeem(String code) async {
    final result = await _repository.redeem(code);
    try {
      state = AsyncData(await _loadFirstPage());
    } catch (_) {
      // Redemption is already committed; a refresh failure must not report it
      // as failed and encourage the user to submit the same code again.
    }
    return result;
  }
}

final walletCenterControllerProvider =
    AsyncNotifierProvider<WalletCenterController, WalletCenterState>(
      WalletCenterController.new,
    );
