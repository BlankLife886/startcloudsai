import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config/app_environment.dart';
import '../storage/session_store.dart';
import 'api_exception.dart';

enum ApiNetworkStatus { unknown, available, unavailable }

class ApiPayload {
  const ApiPayload({
    required this.data,
    required this.statusCode,
    required this.setCookies,
  });

  final dynamic data;
  final int statusCode;
  final List<String> setCookies;
}

class ApiClient {
  ApiClient({
    required AppEnvironment environment,
    required SessionStore sessionStore,
    Dio? dio,
    VoidCallback? onUnauthorized,
    ValueChanged<ApiNetworkStatus>? onNetworkStatusChanged,
    int maxGetRetries = 1,
    Future<void> Function(Duration duration)? retryDelay,
  }) : _environment = environment,
       _sessionStore = sessionStore,
       _onUnauthorized = onUnauthorized,
       _onNetworkStatusChanged = onNetworkStatusChanged,
       _maxGetRetries = maxGetRetries < 0 ? 0 : maxGetRetries,
       _retryDelay =
           retryDelay ?? ((duration) => Future<void>.delayed(duration)),
       _dio =
           dio ??
           Dio(
             BaseOptions(
               baseUrl: environment.apiBaseUrl,
               connectTimeout: const Duration(seconds: 15),
               receiveTimeout: const Duration(seconds: 45),
               sendTimeout: const Duration(seconds: 45),
               responseType: ResponseType.json,
               validateStatus: (status) => status != null && status < 600,
               headers: const {'Accept': 'application/json'},
             ),
           ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final cookie = await _sessionStore.cookieHeader();
          if (cookie != null) options.headers['Cookie'] = cookie;
          if (kDebugMode) {
            debugPrint(
              '[API] ${options.method} ${options.path} '
              'authenticated=${cookie != null}',
            );
          }
          handler.next(options);
        },
      ),
    );
  }

  final AppEnvironment _environment;
  final SessionStore _sessionStore;
  final VoidCallback? _onUnauthorized;
  final ValueChanged<ApiNetworkStatus>? _onNetworkStatusChanged;
  final int _maxGetRetries;
  final Future<void> Function(Duration duration) _retryDelay;
  final Dio _dio;
  ApiNetworkStatus _networkStatus = ApiNetworkStatus.unknown;

  void _reportNetworkStatus(ApiNetworkStatus status) {
    if (_networkStatus == status) return;
    _networkStatus = status;
    if (kDebugMode) debugPrint('[API] network=${status.name}');
    _onNetworkStatusChanged?.call(status);
  }

  void _reportConnectionFailure(DioException error) {
    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        (error.type == DioExceptionType.unknown && error.response == null)) {
      _reportNetworkStatus(ApiNetworkStatus.unavailable);
    }
  }

  Future<void> _expireSession() async {
    await _sessionStore.clear();
    _onUnauthorized?.call();
  }

  String resolveUrl(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return '';
    final uri = Uri.tryParse(trimmed);
    if (uri?.hasScheme == true) return trimmed;
    return '${_environment.origin}${trimmed.startsWith('/') ? '' : '/'}$trimmed';
  }

  Future<Map<String, String>> authenticatedHeaders() async {
    final cookie = await _sessionStore.cookieHeader();
    return cookie == null ? const {} : {'Cookie': cookie};
  }

  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    return (await request(
      path,
      method: 'GET',
      queryParameters: queryParameters,
      cancelToken: cancelToken,
    )).data;
  }

  Future<dynamic> post(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    return (await request(
      path,
      method: 'POST',
      data: data,
      queryParameters: queryParameters,
      cancelToken: cancelToken,
    )).data;
  }

  Future<dynamic> patch(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    return (await request(
      path,
      method: 'PATCH',
      data: data,
      queryParameters: queryParameters,
      cancelToken: cancelToken,
    )).data;
  }

  Future<dynamic> put(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    return (await request(
      path,
      method: 'PUT',
      data: data,
      queryParameters: queryParameters,
      cancelToken: cancelToken,
    )).data;
  }

  Future<dynamic> delete(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    return (await request(
      path,
      method: 'DELETE',
      data: data,
      queryParameters: queryParameters,
      cancelToken: cancelToken,
    )).data;
  }

  Future<ApiPayload> request(
    String path, {
    required String method,
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    late Response<dynamic> response;
    final normalizedMethod = method.toUpperCase();
    var attempt = 0;
    while (true) {
      try {
        response = await _dio.request<dynamic>(
          path,
          data: data,
          queryParameters: queryParameters,
          cancelToken: cancelToken,
          options: Options(method: normalizedMethod),
        );
      } on DioException catch (error) {
        if (CancelToken.isCancel(error)) rethrow;
        if (_shouldRetryGet(
          method: normalizedMethod,
          attempt: attempt,
          error: error,
        )) {
          await _waitBeforeRetry(normalizedMethod, path, attempt);
          attempt += 1;
          continue;
        }
        _reportConnectionFailure(error);
        throw const ApiException(
          code: 'network_error',
          message: '网络连接失败，请检查网络后重试',
        );
      }
      final statusCode = response.statusCode ?? 0;
      if (_shouldRetryGet(
        method: normalizedMethod,
        attempt: attempt,
        statusCode: statusCode,
      )) {
        await _waitBeforeRetry(normalizedMethod, path, attempt);
        attempt += 1;
        continue;
      }
      break;
    }
    _reportNetworkStatus(ApiNetworkStatus.available);

    final statusCode = response.statusCode ?? 0;
    final setCookies = response.headers.map['set-cookie'] ?? const <String>[];
    if (kDebugMode) {
      debugPrint(
        '[API] $normalizedMethod $path -> $statusCode setCookies=${setCookies.length}',
      );
    }
    if (statusCode == 204) {
      return ApiPayload(
        data: null,
        statusCode: statusCode,
        setCookies: setCookies,
      );
    }

    final body = response.data;
    final map = body is Map<String, dynamic>
        ? body
        : body is Map
        ? Map<String, dynamic>.from(body)
        : null;
    final success =
        statusCode >= 200 && statusCode < 300 && map?['success'] == true;
    if (!success) {
      final exception = ApiException(
        statusCode: statusCode,
        code:
            map?['code']?.toString() ??
            (statusCode >= 500 ? 'internal_error' : 'request_failed'),
        message: map?['error']?.toString() ?? '请求失败（$statusCode）',
      );
      if (exception.isUnauthorized) await _expireSession();
      throw exception;
    }
    return ApiPayload(
      data: map?['data'],
      statusCode: statusCode,
      setCookies: setCookies,
    );
  }

  bool _shouldRetryGet({
    required String method,
    required int attempt,
    DioException? error,
    int? statusCode,
  }) {
    if (method != 'GET' || attempt >= _maxGetRetries) return false;
    if (statusCode != null) {
      return statusCode == 408 ||
          statusCode == 502 ||
          statusCode == 503 ||
          statusCode == 504;
    }
    if (error == null) return false;
    return error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        (error.type == DioExceptionType.unknown && error.response == null);
  }

  Future<void> _waitBeforeRetry(String method, String path, int attempt) async {
    final delay = Duration(milliseconds: 300 * (attempt + 1));
    if (kDebugMode) {
      debugPrint('[API] $method $path retry=${attempt + 1}');
    }
    await _retryDelay(delay);
  }

  Future<List<int>> getBytes(
    String url, {
    CancelToken? cancelToken,
    String invalidUrlMessage = '作品文件地址无效',
    String downloadFailedMessage = '作品下载失败',
  }) async {
    final resolved = resolveUrl(url);
    if (resolved.isEmpty) {
      throw ApiException(code: 'invalid_file_url', message: invalidUrlMessage);
    }
    late Response<List<int>> response;
    var attempt = 0;
    while (true) {
      try {
        response = await _dio.get<List<int>>(
          resolved,
          cancelToken: cancelToken,
          options: Options(responseType: ResponseType.bytes),
        );
      } on DioException catch (error) {
        if (CancelToken.isCancel(error)) rethrow;
        if (_shouldRetryGet(method: 'GET', attempt: attempt, error: error)) {
          await _waitBeforeRetry('GET', resolved, attempt);
          attempt += 1;
          continue;
        }
        _reportConnectionFailure(error);
        throw ApiException(
          code: 'network_error',
          message: '$downloadFailedMessage，请检查网络后重试',
        );
      }
      final statusCode = response.statusCode ?? 0;
      if (_shouldRetryGet(
        method: 'GET',
        attempt: attempt,
        statusCode: statusCode,
      )) {
        await _waitBeforeRetry('GET', resolved, attempt);
        attempt += 1;
        continue;
      }
      break;
    }
    _reportNetworkStatus(ApiNetworkStatus.available);
    final statusCode = response.statusCode ?? 0;
    if (statusCode >= 200 && statusCode < 300 && response.data != null) {
      return response.data!;
    }
    if (statusCode == 401) await _expireSession();
    throw ApiException(
      statusCode: statusCode,
      code: 'file_download_failed',
      message: '$downloadFailedMessage（$statusCode）',
    );
  }

  Future<ResponseBody> openEventStream(
    String path, {
    CancelToken? cancelToken,
  }) async {
    try {
      final response = await _dio.get<ResponseBody>(
        path,
        cancelToken: cancelToken,
        options: Options(
          responseType: ResponseType.stream,
          receiveTimeout: Duration.zero,
          headers: const {'Accept': 'text/event-stream'},
        ),
      );
      _reportNetworkStatus(ApiNetworkStatus.available);
      final statusCode = response.statusCode ?? 0;
      if (statusCode >= 200 && statusCode < 300 && response.data != null) {
        return response.data!;
      }
      if (statusCode == 401) await _expireSession();
      throw ApiException(
        statusCode: statusCode,
        code: statusCode == 401 ? 'auth_required' : 'stream_failed',
        message: statusCode == 401 ? '请重新登录' : '实时状态连接失败（$statusCode）',
      );
    } on DioException catch (error) {
      if (CancelToken.isCancel(error)) rethrow;
      throw const ApiException(code: 'network_error', message: '实时状态连接失败');
    }
  }
}
