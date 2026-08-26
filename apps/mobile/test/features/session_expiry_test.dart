import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/providers.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';

class _SessionApiClient extends ApiClient {
  _SessionApiClient()
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'http://localhost:8000',
        ),
        sessionStore: SessionStore(namespace: 'test'),
      );

  bool failLogout = false;

  @override
  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    dynamic cancelToken,
  }) async => {
    'user': {'id': 'user-1', 'email': 'qa@example.com', 'username': 'QA'},
  };

  @override
  Future<dynamic> delete(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    dynamic cancelToken,
  }) async {
    if (failLogout) throw StateError('network unavailable');
    return null;
  }
}

class _RefreshRaceApiClient extends _SessionApiClient {
  int getCount = 0;
  final refreshStarted = Completer<void>();
  final refreshResult = Completer<dynamic>();

  @override
  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    dynamic cancelToken,
  }) async {
    getCount += 1;
    if (getCount == 1) return super.get(path);
    refreshStarted.complete();
    return refreshResult.future;
  }
}

void main() {
  test(
    'session controller becomes expired after an unauthorized signal',
    () async {
      final api = _SessionApiClient();
      final container = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            AuthRepository(api, SessionStore(namespace: 'test')),
          ),
        ],
      );
      addTearDown(container.dispose);

      final initial = await container.read(sessionControllerProvider.future);
      expect(initial.isAuthenticated, isTrue);
      expect(initial.expired, isFalse);

      container.read(sessionExpiredSignalProvider.notifier).state += 1;

      final expired = container.read(sessionControllerProvider).requireValue;
      expect(expired.isAuthenticated, isFalse);
      expect(expired.expired, isTrue);
    },
  );

  test(
    'account refresh keeps the current user until the session returns',
    () async {
      final api = _RefreshRaceApiClient();
      final container = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            AuthRepository(api, SessionStore(namespace: 'test')),
          ),
        ],
      );
      addTearDown(container.dispose);
      await container.read(sessionControllerProvider.future);

      final refresh = container
          .read(sessionControllerProvider.notifier)
          .refresh();
      await api.refreshStarted.future;
      final mid = container.read(sessionControllerProvider);
      expect(mid.isLoading, isFalse);
      expect(mid.requireValue.isAuthenticated, isTrue);
      expect(mid.requireValue.user?.username, 'QA');

      api.refreshResult.complete({
        'user': {
          'id': 'user-1',
          'email': 'qa@example.com',
          'username': 'QA',
          'avatarUrl': '/api/v1/files/uploads/user-1/original/avatar.jpg',
        },
      });
      await refresh;

      expect(
        container.read(sessionControllerProvider).requireValue.user?.avatarUrl,
        '/api/v1/files/uploads/user-1/original/avatar.jpg',
      );
    },
  );

  test('session expiry wins over an in-flight account refresh', () async {
    final api = _RefreshRaceApiClient();
    final container = ProviderContainer(
      overrides: [
        authRepositoryProvider.overrideWithValue(
          AuthRepository(api, SessionStore(namespace: 'test')),
        ),
      ],
    );
    addTearDown(container.dispose);
    await container.read(sessionControllerProvider.future);

    final refresh = container
        .read(sessionControllerProvider.notifier)
        .refresh();
    await api.refreshStarted.future;
    container.read(sessionExpiredSignalProvider.notifier).state += 1;
    api.refreshResult.completeError(StateError('unauthorized'));
    await refresh;

    final state = container.read(sessionControllerProvider).requireValue;
    expect(state.isAuthenticated, isFalse);
    expect(state.expired, isTrue);
  });

  test('explicit sign-out completes locally when the network fails', () async {
    final api = _SessionApiClient();
    final container = ProviderContainer(
      overrides: [
        authRepositoryProvider.overrideWithValue(
          AuthRepository(api, SessionStore(namespace: 'test')),
        ),
      ],
    );
    addTearDown(container.dispose);
    await container.read(sessionControllerProvider.future);
    api.failLogout = true;

    await container.read(sessionControllerProvider.notifier).signOut();

    final state = container.read(sessionControllerProvider).requireValue;
    expect(state.isAuthenticated, isFalse);
    expect(state.expired, isFalse);
  });

  testWidgets('expired-session notice fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    late BuildContext noticeContext;
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: AppNoticeHost(child: child!),
        ),
        home: Scaffold(
          body: Builder(
            builder: (context) {
              noticeContext = context;
              return const SizedBox.expand();
            },
          ),
        ),
      ),
    );
    AppNotice.show(
      noticeContext,
      '账号数据已安全退出，请重新验证邮箱',
      title: '登录已过期',
      type: AppNoticeType.warning,
      duration: const Duration(minutes: 1),
    );
    await tester.pumpAndSettle();

    expect(find.text('登录已过期'), findsOneWidget);
    expect(find.text('账号数据已安全退出，请重新验证邮箱'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
