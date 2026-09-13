import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/tasks/tasks.dart';

class _Session extends SessionController {
  _Session(this.pending);
  final Completer<SessionState> pending;
  @override
  Future<SessionState> build() => pending.future;

  void clearForTest() => state = const AsyncData(SessionState());
}

class _Tasks extends TaskRepository {
  _Tasks()
    : super(
        ApiClient(
          environment: AppEnvironment.create(
            name: AppEnvironmentName.development,
            baseUrl: 'http://localhost',
          ),
          sessionStore: SessionStore(namespace: 'test'),
        ),
      );
  int loads = 0;
  @override
  Future<List<TaskItem>> list() async {
    loads++;
    return [
      TaskItem.fromJson({'id': 'owned-task', 'status': 'succeeded'}),
    ];
  }
}

void main() {
  test('private tasks wait for login and clear on logout', () async {
    final pending = Completer<SessionState>();
    final repository = _Tasks();
    final container = ProviderContainer(
      overrides: [
        sessionControllerProvider.overrideWith(() => _Session(pending)),
        taskRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);
    final result = container.read(taskListProvider.future);
    await Future<void>.value();
    expect(repository.loads, 0);
    pending.complete(const SessionState());
    expect(await result, isEmpty);
    expect(repository.loads, 0);

    container
        .read(sessionControllerProvider.notifier)
        .replaceUser(
          const AppUser(
            id: 'user-1',
            email: 'qa@example.invalid',
            username: 'QA',
          ),
        );
    expect(
      (await container.read(taskListProvider.future)).single.id,
      'owned-task',
    );
    expect(repository.loads, 1);
    (container.read(sessionControllerProvider.notifier) as _Session)
        .clearForTest();
    expect(await container.read(taskListProvider.future), isEmpty);
    expect(repository.loads, 1);
  });
}
