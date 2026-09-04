import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

class AccountSession {
  const AccountSession({
    required this.id,
    required this.current,
    required this.ip,
    required this.userAgent,
    required this.createdAt,
    required this.expiresAt,
  });

  factory AccountSession.fromJson(Map<String, dynamic> json) => AccountSession(
    id: json['id']?.toString() ?? '',
    current: json['current'] == true,
    ip: json['ip']?.toString() ?? '',
    userAgent: json['userAgent']?.toString() ?? '',
    createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? ''),
    expiresAt: DateTime.tryParse(json['expiresAt']?.toString() ?? ''),
  );

  final String id;
  final bool current;
  final String ip;
  final String userAgent;
  final DateTime? createdAt;
  final DateTime? expiresAt;
}

String accountSessionDevice(String userAgent) {
  final value = userAgent.toLowerCase();
  if (value.contains('iphone')) return 'iPhone';
  if (value.contains('ipad')) return 'iPad';
  if (value.contains('android')) return 'Android';
  if (value.contains('windows')) return 'Windows';
  if (value.contains('macintosh') || value.contains('mac os x')) return 'Mac';
  if (value.contains('linux')) return 'Linux';
  return '未知设备';
}

String accountSessionClient(String userAgent) {
  final value = userAgent.toLowerCase();
  if (value.contains('starcloudsai')) return '星空云绘 App';
  if (value.contains('edg/')) return 'Edge';
  if (value.contains('firefox/')) return 'Firefox';
  if (value.contains('chrome/') || value.contains('crios/')) return 'Chrome';
  if (value.contains('safari/')) return 'Safari';
  return '未知客户端';
}

String maskSessionIp(String value) {
  final ip = value.trim();
  if (ip.isEmpty) return '网络地址未知';
  final ipv4 = ip.split('.');
  if (ipv4.length == 4 && ipv4.every((part) => int.tryParse(part) != null)) {
    return '${ipv4[0]}.${ipv4[1]}.*.*';
  }
  if (ip.contains(':')) {
    final parts = ip.split(':').where((part) => part.isNotEmpty).toList();
    if (parts.length >= 2) return '${parts.first}:****:${parts.last}';
  }
  return '网络地址已隐藏';
}

List<AccountSession> sortAccountSessions(Iterable<AccountSession> sessions) {
  final items = sessions.toList();
  items.sort((a, b) {
    if (a.current != b.current) return a.current ? -1 : 1;
    final aTime = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
    final bTime = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
    return bTime.compareTo(aTime);
  });
  return items;
}

abstract class AccountSessionsRepository {
  Future<List<AccountSession>> list();

  Future<void> revoke(String id);

  Future<int> revokeOthers();
}

class ApiAccountSessionsRepository implements AccountSessionsRepository {
  const ApiAccountSessionsRepository(this._apiClient);

  final ApiClient _apiClient;

  @override
  Future<List<AccountSession>> list() async {
    final data = await _apiClient.get('/me/sessions');
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final items = (map['items'] as List? ?? const [])
        .whereType<Map>()
        .map((item) => AccountSession.fromJson(Map<String, dynamic>.from(item)))
        .where((item) => item.id.isNotEmpty)
        .toList();
    return sortAccountSessions(items);
  }

  @override
  Future<void> revoke(String id) => _apiClient.delete('/me/sessions/$id');

  @override
  Future<int> revokeOthers() async {
    final data = await _apiClient.delete(
      '/me/sessions',
      queryParameters: const {'scope': 'others'},
    );
    if (data is! Map) return 0;
    return (data['revoked'] as num?)?.toInt() ?? 0;
  }
}

final accountSessionsRepositoryProvider = Provider<AccountSessionsRepository>(
  (ref) => ApiAccountSessionsRepository(ref.watch(apiClientProvider)),
);

final accountSessionsProvider =
    FutureProvider.autoDispose<List<AccountSession>>(
      (ref) => ref.watch(accountSessionsRepositoryProvider).list(),
    );
