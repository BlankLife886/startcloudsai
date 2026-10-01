import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionStore {
  SessionStore({FlutterSecureStorage? storage, String namespace = 'production'})
    : _storage = storage ?? const FlutterSecureStorage(),
      _tokenKey = tokenKeyFor(namespace),
      _canReadLegacyToken = namespace.trim().toLowerCase() == 'production';

  static const _legacyTokenKey = 'starclouds.user_session';
  static final _sessionCookiePattern = RegExp(
    r'(?:^|[\s,])sc_session=([^;,\s]*)',
    caseSensitive: false,
  );

  final FlutterSecureStorage _storage;
  final String _tokenKey;
  final bool _canReadLegacyToken;

  static String tokenKeyFor(String namespace) {
    final normalized = namespace.trim().toLowerCase();
    return '$_legacyTokenKey.${normalized.isEmpty ? 'production' : normalized}';
  }

  Future<String?> readToken() async {
    var value = await _storage.read(key: _tokenKey);
    if ((value == null || value.trim().isEmpty) && _canReadLegacyToken) {
      value = await _storage.read(key: _legacyTokenKey);
      if (value != null && value.trim().isNotEmpty) {
        await _storage.write(key: _tokenKey, value: value.trim());
        await _storage.delete(key: _legacyTokenKey);
      }
    }
    return value == null || value.trim().isEmpty ? null : value.trim();
  }

  Future<void> saveToken(String token) =>
      _storage.write(key: _tokenKey, value: token.trim());

  Future<void> clear() => _storage.delete(key: _tokenKey);

  Future<String?> cookieHeader() async {
    final token = await readToken();
    return token == null ? null : 'sc_session=$token';
  }

  Future<bool> captureSetCookies(Iterable<String> headers) async {
    for (final header in headers) {
      final token = parseSessionToken(header);
      if (token == null) continue;
      if (token.isEmpty) {
        await clear();
      } else {
        await saveToken(token);
      }
      return true;
    }
    return false;
  }

  static String? parseSessionToken(String setCookieHeader) {
    return _sessionCookiePattern.firstMatch(setCookieHeader)?.group(1);
  }
}
