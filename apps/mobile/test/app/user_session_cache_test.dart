import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/user_session_cache.dart';
import 'package:starcloudsai_mobile/features/notifications/notifications.dart';
import 'package:starcloudsai_mobile/features/profile/profile.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';

void main() {
  test('clearing a user session invalidates private feature caches', () async {
    var taskLoads = 0;
    var walletLoads = 0;
    var notificationLoads = 0;
    final container = ProviderContainer(
      overrides: [
        taskListProvider.overrideWith((ref) async {
          taskLoads += 1;
          return const <TaskItem>[];
        }),
        walletProvider.overrideWith((ref) async {
          walletLoads += 1;
          return const WalletSnapshot(
            availablePoints: 0,
            frozenPoints: 0,
            trialPoints: 0,
          );
        }),
        notificationSummaryProvider.overrideWith((ref) async {
          notificationLoads += 1;
          return 0;
        }),
      ],
    );
    addTearDown(container.dispose);

    await Future.wait([
      container.read(taskListProvider.future),
      container.read(walletProvider.future),
      container.read(notificationSummaryProvider.future),
    ]);
    expect((taskLoads, walletLoads, notificationLoads), (1, 1, 1));

    container.read(userSessionCacheProvider).clear();
    await Future.wait([
      container.read(taskListProvider.future),
      container.read(walletProvider.future),
      container.read(notificationSummaryProvider.future),
    ]);

    expect((taskLoads, walletLoads, notificationLoads), (2, 2, 2));
  });
}
