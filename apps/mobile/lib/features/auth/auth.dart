import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../../core/storage/session_store.dart';

class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.username,
    this.avatarUrl,
    this.bio = '',
    this.location = '',
    this.websiteUrl = '',
    this.requireCostConfirm = true,
  });

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
    id: json['id']?.toString() ?? '',
    email: json['email']?.toString() ?? '',
    username: json['username']?.toString() ?? '星空用户',
    avatarUrl: _optionalProfileUrl(json['avatarUrl']),
    bio: json['bio']?.toString() ?? '',
    location: json['location']?.toString() ?? '',
    websiteUrl: json['websiteUrl']?.toString() ?? '',
    requireCostConfirm: json['requireCostConfirm'] != false,
  );

  final String id;
  final String email;
  final String username;
  final String? avatarUrl;
  final String bio;
  final String location;
  final String websiteUrl;
  final bool requireCostConfirm;
}

String? _optionalProfileUrl(dynamic value) {
  final text = value?.toString().trim() ?? '';
  if (text.isEmpty || text == 'null') return null;
  return text;
}

class CodeDelivery {
  const CodeDelivery({
    required this.expiresIn,
    required this.resendAfter,
    this.developmentCode,
  });

  final int expiresIn;
  final int resendAfter;
  final String? developmentCode;
}

class AuthProviders {
  const AuthProviders({
    required this.email,
    required this.verificationCode,
    required this.emailDomains,
  });

  factory AuthProviders.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final domains =
        (map['emailDomains'] as List?)
            ?.map((item) => item.toString().trim().toLowerCase())
            .where((item) => item.isNotEmpty)
            .toSet()
            .toList() ??
        const <String>[];
    return AuthProviders(
      email: map['email'] == true,
      verificationCode: map['verificationCode'] == true,
      emailDomains: domains,
    );
  }

  final bool email;
  final bool verificationCode;
  final List<String> emailDomains;

  bool get canUseEmailCode =>
      email && verificationCode && emailDomains.isNotEmpty;
}

String? validateLoginEmail(String? value, AuthProviders providers) {
  final email = value?.trim().toLowerCase() ?? '';
  if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
    return '请输入有效邮箱';
  }
  final domain = email.split('@').last;
  if (!providers.emailDomains.contains(domain)) {
    return '仅支持 ${formatLoginEmailDomains(providers.emailDomains)}';
  }
  return null;
}

String formatLoginEmailDomains(Iterable<String> domains) {
  final labels = domains
      .map((domain) {
        return switch (domain.toLowerCase()) {
          'gmail.com' => 'Gmail',
          'googlemail.com' => 'Googlemail',
          'qq.com' => 'QQ 邮箱',
          _ => domain,
        };
      })
      .toSet()
      .toList();
  return labels.isEmpty ? '服务端配置的邮箱' : labels.join('、');
}

int codeResendSecondsRemaining(DateTime? deadline, DateTime now) {
  if (deadline == null) return 0;
  final milliseconds = deadline.difference(now).inMilliseconds;
  if (milliseconds <= 0) return 0;
  return (milliseconds + 999) ~/ 1000;
}

class AuthRepository {
  const AuthRepository(this._apiClient, this._sessionStore);

  final ApiClient _apiClient;
  final SessionStore _sessionStore;

  Future<AuthProviders> providers() async =>
      AuthProviders.fromJson(await _apiClient.get('/auth/providers'));

  Future<AppUser?> currentUser() async {
    final data = await _apiClient.get('/auth/session');
    if (data is! Map || data['user'] is! Map) return null;
    return AppUser.fromJson(Map<String, dynamic>.from(data['user'] as Map));
  }

  Future<CodeDelivery> requestCode(String email) async {
    final data = await _apiClient.post(
      '/auth/email-verification-codes',
      data: {'email': email.trim()},
    );
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return CodeDelivery(
      expiresIn: (map['expiresIn'] as num?)?.toInt() ?? 180,
      resendAfter: (map['resendAfter'] as num?)?.toInt() ?? 60,
      developmentCode: map['developmentCode']?.toString(),
    );
  }

  Future<AppUser> verifyCode(String email, String code) async {
    final response = await _apiClient.request(
      '/auth/session',
      method: 'POST',
      data: {'email': email.trim(), 'code': code.trim()},
    );
    await _sessionStore.captureSetCookies(response.setCookies);
    final data = response.data;
    if (data is! Map || data['user'] is! Map) {
      throw const FormatException('登录响应缺少用户信息');
    }
    return AppUser.fromJson(Map<String, dynamic>.from(data['user'] as Map));
  }

  Future<void> logout() async {
    try {
      await _apiClient.delete('/auth/session');
    } finally {
      await _sessionStore.clear();
    }
  }
}

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    ref.watch(apiClientProvider),
    ref.watch(sessionStoreProvider),
  ),
);

final authProvidersProvider = FutureProvider.autoDispose<AuthProviders>(
  (ref) => ref.watch(authRepositoryProvider).providers(),
);

class SessionState {
  const SessionState({this.user, this.expired = false});

  final AppUser? user;
  final bool expired;
  bool get isAuthenticated => user != null;
}

class SessionController extends AsyncNotifier<SessionState> {
  bool _authenticated = false;

  AuthRepository get _repository => ref.read(authRepositoryProvider);

  @override
  FutureOr<SessionState> build() async {
    ref.listen<int>(sessionExpiredSignalProvider, (previous, next) {
      if (previous == next || !_authenticated) return;
      _authenticated = false;
      state = const AsyncData(SessionState(expired: true));
    });
    final user = await _repository.currentUser();
    _authenticated = user != null;
    return SessionState(user: user);
  }

  Future<CodeDelivery> requestCode(String email) =>
      _repository.requestCode(email);

  Future<void> signIn(String email, String code) async {
    final user = await _repository.verifyCode(email, code);
    _authenticated = true;
    state = AsyncData(SessionState(user: user));
  }

  Future<void> refresh() async {
    final refreshed = await AsyncValue.guard(
      () async => SessionState(user: await _repository.currentUser()),
    );
    if (state.asData?.value.expired == true) return;
    _authenticated = refreshed.asData?.value.isAuthenticated == true;
    state = refreshed;
  }

  void replaceUser(AppUser user) {
    _authenticated = true;
    state = AsyncData(SessionState(user: user));
  }

  Future<void> signOut() async {
    _authenticated = false;
    try {
      await _repository.logout();
    } catch (_) {
      // Local sign-out must complete even when the remote session is gone.
    } finally {
      state = const AsyncData(SessionState());
    }
  }
}

final sessionControllerProvider =
    AsyncNotifierProvider<SessionController, SessionState>(
      SessionController.new,
    );
