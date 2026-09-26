String userStorageNamespace({required String environment, String? userId}) {
  final normalizedEnvironment = environment.trim().toLowerCase();
  final normalizedUser = userId?.trim().toLowerCase() ?? '';
  return '${normalizedEnvironment.isEmpty ? 'production' : normalizedEnvironment}.user.${normalizedUser.isEmpty ? 'anonymous' : normalizedUser}';
}
