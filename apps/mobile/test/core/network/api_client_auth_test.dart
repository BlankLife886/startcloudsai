import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/network/api_exception.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';

class _MemorySessionStore extends SessionStore {
  _MemorySessionStore() : super(namespace: 'test');

  int clearCount = 0;

  @override
  Future<String?> cookieHeader() async => 'sc_session=test-token';

  @override
  Future<void> clear() async {
    clearCount += 1;
  }
}

class _UnauthorizedAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode({'success': false, 'code': 'auth_required', 'error': '请重新登录'}),
      401,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

ApiClient _client(
  _MemorySessionStore store, {
  required void Function() onUnauthorized,
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: 'http://localhost:8000/api/v1',
      responseType: ResponseType.json,
      validateStatus: (status) => status != null && status < 600,
    ),
  )..httpClientAdapter = _UnauthorizedAdapter();
  return ApiClient(
    environment: AppEnvironment.create(
      name: AppEnvironmentName.development,
      baseUrl: 'http://localhost:8000',
    ),
    sessionStore: store,
    dio: dio,
    onUnauthorized: onUnauthorized,
  );
}

void main() {
  test(
    '401 from REST, private files and streams expires the session',
    () async {
      final store = _MemorySessionStore();
      var signalCount = 0;
      final client = _client(store, onUnauthorized: () => signalCount += 1);

      await expectLater(
        client.get('/me/overview'),
        throwsA(
          isA<ApiException>()
              .having((error) => error.statusCode, 'statusCode', 401)
              .having((error) => error.code, 'code', 'auth_required'),
        ),
      );
      await expectLater(
        client.getBytes('/api/v1/files/private.jpg'),
        throwsA(
          isA<ApiException>().having(
            (error) => error.statusCode,
            'statusCode',
            401,
          ),
        ),
      );
      await expectLater(
        client.openEventStream('/me/tasks/events'),
        throwsA(
          isA<ApiException>()
              .having((error) => error.statusCode, 'statusCode', 401)
              .having((error) => error.code, 'code', 'auth_required'),
        ),
      );

      expect(store.clearCount, 3);
      expect(signalCount, 3);
    },
  );
}
