import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'config/app_environment.dart';
import 'network/api_client.dart';
import 'storage/session_store.dart';

final appEnvironmentProvider = Provider<AppEnvironment>(
  (ref) => AppEnvironment.fromDefines(),
);

final sessionStoreProvider = Provider<SessionStore>(
  (ref) => SessionStore(namespace: ref.watch(appEnvironmentProvider).name.name),
);

final sessionExpiredSignalProvider = StateProvider<int>((ref) => 0);

final apiNetworkStatusProvider = StateProvider<ApiNetworkStatus>(
  (ref) => ApiNetworkStatus.unknown,
);

final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(
    environment: ref.watch(appEnvironmentProvider),
    sessionStore: ref.watch(sessionStoreProvider),
    onUnauthorized: () {
      final notifier = ref.read(sessionExpiredSignalProvider.notifier);
      notifier.state += 1;
    },
    onNetworkStatusChanged: (status) {
      ref.read(apiNetworkStatusProvider.notifier).state = status;
    },
  ),
);
