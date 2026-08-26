import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../create/reference_image_service.dart';

const assetGroupAll = 'all';
const assetGroupUngrouped = 'ungrouped';

String? assetInputKey(String value) {
  final raw = value.trim();
  if (raw.startsWith('uploads/')) return raw;
  final path = Uri.tryParse(raw)?.path ?? raw;
  const marker = '/api/v1/files/';
  final index = path.indexOf(marker);
  if (index < 0) return null;
  final key = Uri.decodeComponent(path.substring(index + marker.length));
  return key.startsWith('uploads/') ? key : null;
}

class UserAsset {
  const UserAsset({
    required this.id,
    required this.title,
    required this.url,
    required this.thumbnailUrl,
    required this.contentType,
    required this.sizeBytes,
    this.groupId,
    this.createdAt,
  });

  factory UserAsset.fromJson(Map<String, dynamic> json) => UserAsset(
    id: json['id']?.toString() ?? '',
    title: _fallback(json['title'], '未命名素材'),
    url: json['url']?.toString() ?? '',
    thumbnailUrl:
        _optional(json['thumbnailUrl']) ?? json['url']?.toString() ?? '',
    contentType: json['contentType']?.toString() ?? 'image/jpeg',
    sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
    groupId: _optional(json['groupId']),
    createdAt: _date(json['createdAt']),
  );

  final String id;
  final String title;
  final String url;
  final String thumbnailUrl;
  final String contentType;
  final int sizeBytes;
  final String? groupId;
  final DateTime? createdAt;

  String? get inputKey => assetInputKey(url);
}

class UserAssetGroup {
  const UserAssetGroup({
    required this.id,
    required this.name,
    required this.sort,
    required this.assetCount,
    this.createdAt,
    this.updatedAt,
  });

  factory UserAssetGroup.fromJson(Map<String, dynamic> json) => UserAssetGroup(
    id: json['id']?.toString() ?? '',
    name: _fallback(json['name'], '未命名分组'),
    sort: (json['sort'] as num?)?.toInt() ?? 0,
    assetCount: (json['assetCount'] as num?)?.toInt() ?? 0,
    createdAt: _date(json['createdAt']),
    updatedAt: _date(json['updatedAt']),
  );

  final String id;
  final String name;
  final int sort;
  final int assetCount;
  final DateTime? createdAt;
  final DateTime? updatedAt;
}

class UserAssetPage {
  const UserAssetPage({required this.items, this.nextCursor});

  factory UserAssetPage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return UserAssetPage(
      items: map['items'] is List
          ? (map['items'] as List)
                .whereType<Map>()
                .map(
                  (item) => UserAsset.fromJson(Map<String, dynamic>.from(item)),
                )
                .where((item) => item.id.isNotEmpty && item.url.isNotEmpty)
                .toList()
          : const [],
      nextCursor: _optional(map['nextCursor']),
    );
  }

  final List<UserAsset> items;
  final String? nextCursor;
}

class UserAssetGroupSummary {
  const UserAssetGroupSummary({
    required this.items,
    required this.ungroupedCount,
    required this.totalAssetCount,
  });

  factory UserAssetGroupSummary.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final groups = map['items'] is List
        ? (map['items'] as List)
              .whereType<Map>()
              .map(
                (item) =>
                    UserAssetGroup.fromJson(Map<String, dynamic>.from(item)),
              )
              .where((item) => item.id.isNotEmpty)
              .toList()
        : <UserAssetGroup>[];
    groups.sort((a, b) {
      final bySort = a.sort.compareTo(b.sort);
      return bySort == 0 ? a.name.compareTo(b.name) : bySort;
    });
    return UserAssetGroupSummary(
      items: groups,
      ungroupedCount: (map['ungroupedCount'] as num?)?.toInt() ?? 0,
      totalAssetCount: (map['totalAssetCount'] as num?)?.toInt() ?? 0,
    );
  }

  final List<UserAssetGroup> items;
  final int ungroupedCount;
  final int totalAssetCount;
}

class UserAssetUpload {
  const UserAssetUpload({
    required this.key,
    required this.thumbnailKey,
    required this.contentType,
  });

  factory UserAssetUpload.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return UserAssetUpload(
      key: map['key']?.toString() ?? '',
      thumbnailKey: map['thumbnailKey']?.toString() ?? '',
      contentType: map['contentType']?.toString() ?? 'image/jpeg',
    );
  }

  final String key;
  final String thumbnailKey;
  final String contentType;
}

class AssetCenterState {
  const AssetCenterState({
    required this.items,
    required this.groups,
    required this.ungroupedCount,
    required this.totalAssetCount,
    required this.selectedGroup,
    this.nextCursor,
    this.isLoadingMore = false,
    this.isUploading = false,
    this.busyIds = const {},
  });

  final List<UserAsset> items;
  final List<UserAssetGroup> groups;
  final int ungroupedCount;
  final int totalAssetCount;
  final String selectedGroup;
  final String? nextCursor;
  final bool isLoadingMore;
  final bool isUploading;
  final Set<String> busyIds;

  bool get hasMore => nextCursor != null;
  bool get isBusy => isUploading || busyIds.isNotEmpty;

  AssetCenterState copyWith({
    List<UserAsset>? items,
    List<UserAssetGroup>? groups,
    int? ungroupedCount,
    int? totalAssetCount,
    String? selectedGroup,
    String? nextCursor,
    bool clearCursor = false,
    bool? isLoadingMore,
    bool? isUploading,
    Set<String>? busyIds,
  }) => AssetCenterState(
    items: items ?? this.items,
    groups: groups ?? this.groups,
    ungroupedCount: ungroupedCount ?? this.ungroupedCount,
    totalAssetCount: totalAssetCount ?? this.totalAssetCount,
    selectedGroup: selectedGroup ?? this.selectedGroup,
    nextCursor: clearCursor ? null : nextCursor ?? this.nextCursor,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    isUploading: isUploading ?? this.isUploading,
    busyIds: busyIds ?? this.busyIds,
  );
}

String? validateAssetTitle(String? value) {
  final length = value?.trim().runes.length ?? 0;
  if (length == 0) return '请填写素材名称';
  if (length > 120) return '素材名称不能超过 120 个字符';
  return null;
}

String? validateAssetGroupName(String? value) {
  final length = value?.trim().runes.length ?? 0;
  if (length == 0) return '请填写分组名称';
  if (length > 64) return '分组名称不能超过 64 个字符';
  return null;
}

class AssetRepository {
  const AssetRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<UserAssetPage> assets({
    String groupId = assetGroupAll,
    String? cursor,
    int limit = 24,
  }) async => UserAssetPage.fromJson(
    await _apiClient.get(
      '/me/assets',
      queryParameters: {
        'limit': limit,
        'groupId': groupId,
        if (cursor?.isNotEmpty == true) 'cursor': cursor,
      },
    ),
  );

  Future<UserAssetGroupSummary> groups() async =>
      UserAssetGroupSummary.fromJson(await _apiClient.get('/me/asset-groups'));

  Future<UserAsset> uploadAsset({
    required ReferenceImageDraft image,
    required String title,
    String? groupId,
  }) async {
    final file = File(image.localPath);
    if (!await file.exists()) throw const FormatException('待上传图片不存在');
    if (await file.length() > 10 * 1024 * 1024) {
      throw const FormatException('素材图片不能超过 10MB');
    }
    final upload = UserAssetUpload.fromJson(
      await _apiClient.post(
        '/uploads',
        data: FormData.fromMap({
          'file': await MultipartFile.fromFile(
            image.localPath,
            filename: image.filename,
          ),
        }),
      ),
    );
    if (upload.key.isEmpty || upload.thumbnailKey.isEmpty) {
      throw const FormatException('素材上传响应无效');
    }
    final data = await _apiClient.post(
      '/me/assets',
      data: {
        'title': title.trim(),
        'fileKey': upload.key,
        'thumbnailKey': upload.thumbnailKey,
        'contentType': upload.contentType,
        'groupId': groupId ?? '',
      },
    );
    if (data is! Map) throw const FormatException('素材保存响应无效');
    return UserAsset.fromJson(Map<String, dynamic>.from(data));
  }

  Future<UserAsset> updateAsset(
    String id, {
    String? title,
    String? groupId,
    bool updateGroup = false,
  }) async {
    final data = await _apiClient.patch(
      '/me/assets/$id',
      data: {
        if (title != null) 'title': title.trim(),
        if (updateGroup) 'groupId': groupId,
      },
    );
    if (data is! Map) throw const FormatException('素材更新响应无效');
    return UserAsset.fromJson(Map<String, dynamic>.from(data));
  }

  Future<void> deleteAsset(String id) => _apiClient.delete('/me/assets/$id');

  Future<UserAssetGroup> createGroup(String name) async {
    final data = await _apiClient.post(
      '/me/asset-groups',
      data: {'name': name.trim()},
    );
    if (data is! Map) throw const FormatException('分组创建响应无效');
    return UserAssetGroup.fromJson(Map<String, dynamic>.from(data));
  }

  Future<UserAssetGroup> renameGroup(String id, String name) async {
    final data = await _apiClient.patch(
      '/me/asset-groups/$id',
      data: {'name': name.trim()},
    );
    if (data is! Map) throw const FormatException('分组更新响应无效');
    return UserAssetGroup.fromJson(Map<String, dynamic>.from(data));
  }

  Future<void> deleteGroup(String id) =>
      _apiClient.delete('/me/asset-groups/$id');
}

final assetRepositoryProvider = Provider<AssetRepository>(
  (ref) => AssetRepository(ref.watch(apiClientProvider)),
);

class AssetCenterController extends AsyncNotifier<AssetCenterState> {
  int _generation = 0;

  AssetRepository get _repository => ref.read(assetRepositoryProvider);

  @override
  Future<AssetCenterState> build() => _load(assetGroupAll);

  Future<AssetCenterState> _load(String selectedGroup) async {
    final results = await Future.wait([
      _repository.groups(),
      _repository.assets(groupId: selectedGroup),
    ]);
    final groups = results[0] as UserAssetGroupSummary;
    final page = results[1] as UserAssetPage;
    return AssetCenterState(
      items: page.items,
      groups: groups.items,
      ungroupedCount: groups.ungroupedCount,
      totalAssetCount: groups.totalAssetCount,
      selectedGroup: selectedGroup,
      nextCursor: page.nextCursor,
    );
  }

  Future<void> refresh() async {
    final selected = state.asData?.value.selectedGroup ?? assetGroupAll;
    final generation = ++_generation;
    state = const AsyncLoading();
    final refreshed = await AsyncValue.guard(() => _load(selected));
    if (generation == _generation) state = refreshed;
  }

  Future<void> selectGroup(String groupId) async {
    final current = state.asData?.value;
    if (current == null || current.selectedGroup == groupId) return;
    final generation = ++_generation;
    state = const AsyncLoading();
    final selected = await AsyncValue.guard(() => _load(groupId));
    if (generation == _generation) state = selected;
  }

  Future<void> loadMore() async {
    final current = state.asData?.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    final generation = _generation;
    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final page = await _repository.assets(
        groupId: current.selectedGroup,
        cursor: current.nextCursor,
      );
      if (generation != _generation) return;
      final latest = state.asData?.value;
      if (latest == null) return;
      final knownIds = latest.items.map((item) => item.id).toSet();
      state = AsyncData(
        latest.copyWith(
          items: [
            ...latest.items,
            ...page.items.where((item) => knownIds.add(item.id)),
          ],
          nextCursor: page.nextCursor,
          clearCursor: page.nextCursor == null,
          isLoadingMore: false,
        ),
      );
    } catch (error, stackTrace) {
      if (generation != _generation) return;
      final latest = state.asData?.value ?? current;
      state = AsyncData(latest.copyWith(isLoadingMore: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<UserAsset> upload({
    required ReferenceImageDraft image,
    required String title,
    String? groupId,
  }) async {
    final current = state.requireValue;
    state = AsyncData(current.copyWith(isUploading: true));
    try {
      final asset = await _repository.uploadAsset(
        image: image,
        title: title,
        groupId: groupId,
      );
      state = AsyncData(await _load(current.selectedGroup));
      return asset;
    } catch (error, stackTrace) {
      state = AsyncData(current.copyWith(isUploading: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<void> updateAsset(
    String id, {
    String? title,
    String? groupId,
    bool updateGroup = false,
  }) => _mutate(
    id,
    () => _repository.updateAsset(
      id,
      title: title,
      groupId: groupId,
      updateGroup: updateGroup,
    ),
  );

  Future<void> deleteAsset(String id) =>
      _mutate(id, () => _repository.deleteAsset(id));

  Future<void> createGroup(String name) =>
      _mutate('group-new', () => _repository.createGroup(name));

  Future<void> renameGroup(String id, String name) =>
      _mutate(id, () => _repository.renameGroup(id, name));

  Future<void> deleteGroup(String id) =>
      _mutate(id, () => _repository.deleteGroup(id), deletedGroupId: id);

  Future<void> _mutate(
    String busyId,
    Future<dynamic> Function() operation, {
    String? deletedGroupId,
  }) async {
    final current = state.requireValue;
    state = AsyncData(current.copyWith(busyIds: {...current.busyIds, busyId}));
    try {
      await operation();
      final selected = current.selectedGroup == deletedGroupId
          ? assetGroupAll
          : current.selectedGroup;
      state = AsyncData(await _load(selected));
    } catch (error, stackTrace) {
      state = AsyncData(current);
      Error.throwWithStackTrace(error, stackTrace);
    }
  }
}

final assetCenterControllerProvider =
    AsyncNotifierProvider<AssetCenterController, AssetCenterState>(
      AssetCenterController.new,
    );

DateTime? _date(dynamic value) =>
    DateTime.tryParse(value?.toString() ?? '')?.toLocal();

String? _optional(dynamic value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}

String _fallback(dynamic value, String fallback) =>
    _optional(value) ?? fallback;
