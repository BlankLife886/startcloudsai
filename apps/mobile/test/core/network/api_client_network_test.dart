import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/network/api_exception.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';

class _EmptySessionStore extends SessionStore {
  _EmptySessionStore() : super(namespace: 'test');

  @override
  Future<String?> cookieHeader() async => null;
}

class _RecoveringAdapter implements HttpClientAdapter {
  _RecoveringAdapter({
    this.failureType = DioExceptionType.connectionError,
    this.failuresBeforeSuccess = 1,
  });

  final DioExceptionType failureType;
  final int failuresBeforeSuccess;
  var calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls += 1;
    if (calls <= failuresBeforeSuccess) {
      throw DioException(
        requestOptions: options,
        type: failureType,
        error: StateError('offline'),
      );
    }
    return ResponseBody.fromString(
      jsonEncode({
        'success': true,
        'data': {'connected': true},
      }),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _StatusRecoveringAdapter implements HttpClientAdapter {
  var calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls += 1;
    return ResponseBody.fromString(
      jsonEncode(
        calls == 1
            ? {'success': false, 'error': 'service unavailable'}
            : {
                'success': true,
                'data': {'connected': true},
              },
      ),
      calls == 1 ? 503 : 200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  test('GET retries a transient disconnect before reporting success', () async {
    final adapter = _RecoveringAdapter();
    final dio = Dio(
      BaseOptions(
        baseUrl: 'http://localhost:8000/api/v1',
        responseType: ResponseType.json,
        validateStatus: (status) => status != null && status < 600,
      ),
    )..httpClientAdapter = adapter;
    final statuses = <ApiNetworkStatus>[];
    final client = ApiClient(
      environment: AppEnvironment.create(
        name: AppEnvironmentName.development,
        baseUrl: 'http://localhost:8000',
      ),
      sessionStore: _EmptySessionStore(),
      dio: dio,
      onNetworkStatusChanged: statuses.add,
      retryDelay: (_) async {},
    );

    expect(await client.get('/auth/providers'), {'connected': true});
    expect(adapter.calls, 2);
    expect(statuses, [ApiNetworkStatus.available]);

    await client.get('/auth/providers');
    expect(statuses, hasLength(1));
  });

  test('iOS-style socket failures without a response report offline', () async {
    final adapter = _RecoveringAdapter(
      failureType: DioExceptionType.unknown,
      failuresBeforeSuccess: 2,
    );
    final dio = Dio(
      BaseOptions(
        baseUrl: 'http://localhost:8000/api/v1',
        responseType: ResponseType.json,
        validateStatus: (status) => status != null && status < 600,
      ),
    )..httpClientAdapter = adapter;
    final statuses = <ApiNetworkStatus>[];
    final client = ApiClient(
      environment: AppEnvironment.create(
        name: AppEnvironmentName.development,
        baseUrl: 'http://localhost:8000',
      ),
      sessionStore: _EmptySessionStore(),
      dio: dio,
      onNetworkStatusChanged: statuses.add,
      retryDelay: (_) async {},
    );

    await expectLater(
      client.get('/auth/providers'),
      throwsA(isA<ApiException>()),
    );

    expect(statuses, [ApiNetworkStatus.unavailable]);
    expect(adapter.calls, 2);
  });

  test('GET retries a temporary service response', () async {
    final adapter = _StatusRecoveringAdapter();
    final dio = Dio(
      BaseOptions(
        baseUrl: 'http://localhost:8000/api/v1',
        responseType: ResponseType.json,
        validateStatus: (status) => status != null && status < 600,
      ),
    )..httpClientAdapter = adapter;
    final client = ApiClient(
      environment: AppEnvironment.create(
        name: AppEnvironmentName.development,
        baseUrl: 'http://localhost:8000',
      ),
      sessionStore: _EmptySessionStore(),
      dio: dio,
      retryDelay: (_) async {},
    );

    expect(await client.get('/announcements'), {'connected': true});
    expect(adapter.calls, 2);
  });

  test('mutating requests are never retried automatically', () async {
    final adapter = _RecoveringAdapter();
    final dio = Dio(
      BaseOptions(
        baseUrl: 'http://localhost:8000/api/v1',
        responseType: ResponseType.json,
        validateStatus: (status) => status != null && status < 600,
      ),
    )..httpClientAdapter = adapter;
    final client = ApiClient(
      environment: AppEnvironment.create(
        name: AppEnvironmentName.development,
        baseUrl: 'http://localhost:8000',
      ),
      sessionStore: _EmptySessionStore(),
      dio: dio,
      retryDelay: (_) async {},
    );

    await expectLater(
      client.post('/tasks', data: {'prompt': 'test'}),
      throwsA(
        isA<ApiException>().having(
          (error) => error.code,
          'code',
          'network_error',
        ),
      ),
    );
    expect(adapter.calls, 1);
  });

  test('file downloads retry a transient disconnect', () async {
    final adapter = _RecoveringAdapter();
    final dio = Dio(
      BaseOptions(
        baseUrl: 'http://localhost:8000/api/v1',
        responseType: ResponseType.json,
        validateStatus: (status) => status != null && status < 600,
      ),
    )..httpClientAdapter = adapter;
    final statuses = <ApiNetworkStatus>[];
    final client = ApiClient(
      environment: AppEnvironment.create(
        name: AppEnvironmentName.development,
        baseUrl: 'http://localhost:8000',
      ),
      sessionStore: _EmptySessionStore(),
      dio: dio,
      onNetworkStatusChanged: statuses.add,
      retryDelay: (_) async {},
    );

    final bytes = await client.getBytes('/api/v1/files/work.png');

    expect(bytes, isNotEmpty);
    expect(adapter.calls, 2);
    expect(statuses, [ApiNetworkStatus.available]);
  });
}
