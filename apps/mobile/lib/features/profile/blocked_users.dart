import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

class BlockedUser {
  const BlockedUser({
    required this.id,
    required this.username,
    this.avatarUrl,
    this.blockedAt,
  });

  factory BlockedUser.fromJson(Map<String, dynamic> json) => BlockedUser(
    id: json['id']?.toString() ?? '',
    username: json['username']?.toString().trim() ?? '',
    avatarUrl: json['avatarUrl']?.toString(),
    blockedAt: DateTime.tryParse(json['blockedAt']?.toString() ?? ''),
  );

  final String id;
  final String username;
  final String? avatarUrl;
  final DateTime? blockedAt;

  String get displayName => username.isEmpty ? '星空用户' : username;
}

abstract class BlockedUsersRepository {
  Future<List<BlockedUser>> listAll();

  Future<void> unblock(String id);
}

class ApiBlockedUsersRepository implements BlockedUsersRepository {
  const ApiBlockedUsersRepository(this._apiClient);

  final ApiClient _apiClient;

  @override
  Future<List<BlockedUser>> listAll() async {
    final items = <BlockedUser>[];
    final ids = <String>{};
    final seenCursors = <String>{};
    String? cursor;
    do {
      final data = await _apiClient.get(
        '/me/blocked-users',
        queryParameters: {'limit': 100, 'cursor': ?cursor},
      );
      final map = data is Map
          ? Map<String, dynamic>.from(data)
          : const <String, dynamic>{};
      for (final raw in map['items'] as List? ?? const []) {
        if (raw is! Map) continue;
        final item = BlockedUser.fromJson(Map<String, dynamic>.from(raw));
        if (item.id.isNotEmpty && ids.add(item.id)) items.add(item);
      }
      final next = map['nextCursor']?.toString().trim();
      cursor = next == null || next.isEmpty || !seenCursors.add(next)
          ? null
          : next;
    } while (cursor != null);
    return items;
  }

  @override
  Future<void> unblock(String id) async {
    await _apiClient.delete('/gallery/users/$id/block');
  }
}

final blockedUsersRepositoryProvider = Provider<BlockedUsersRepository>(
  (ref) => ApiBlockedUsersRepository(ref.watch(apiClientProvider)),
);

final blockedUsersProvider = FutureProvider.autoDispose<List<BlockedUser>>(
  (ref) => ref.watch(blockedUsersRepositoryProvider).listAll(),
);
