class ApiException implements Exception {
  const ApiException({
    required this.message,
    this.code = 'request_failed',
    this.statusCode = 0,
  });

  final String message;
  final String code;
  final int statusCode;

  bool get isUnauthorized => statusCode == 401 && code == 'auth_required';

  bool get isNotFound => statusCode == 404 || code == 'not_found';

  @override
  String toString() => message;
}
