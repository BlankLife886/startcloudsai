import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../config/app_environment.dart';
import '../storage/session_store.dart';
import 'api_exception.dart';

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
  }) : _environment = environment,
       _sessionStore = sessionStore,
       _onUnauthorized = onUnauthorized,
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
  final Dio _dio;

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
    try {
      response = await _dio.request<dynamic>(
        path,
        data: data,
        queryParameters: queryParameters,
        cancelToken: cancelToken,
        options: Options(method: method),
      );
    } on DioException catch (error) {
      if (CancelToken.isCancel(error)) rethrow;
      throw const ApiException(
        code: 'network_error',
        message: '网络连接失败，请检查网络后重试',
      );
    }

    final statusCode = response.statusCode ?? 0;
    final setCookies = response.headers.map['set-cookie'] ?? const <String>[];
    if (kDebugMode) {
      debugPrint(
        '[API] $method $path -> $statusCode setCookies=${setCookies.length}',
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
    try {
      final response = await _dio.get<List<int>>(
        resolved,
        cancelToken: cancelToken,
        options: Options(responseType: ResponseType.bytes),
      );
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
    } on DioException catch (error) {
      if (CancelToken.isCancel(error)) rethrow;
      throw ApiException(
        code: 'network_error',
        message: '$downloadFailedMessage，请检查网络后重试',
      );
    }
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
