import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/sse.dart';
import '../../core/providers.dart';
import '../auth/auth.dart';
import '../profile/profile.dart';
import 'tasks.dart';

enum TaskSyncMode { idle, connecting, live, polling }

class TaskSyncNotice {
  const TaskSyncNotice({required this.tasks});

  static TaskSyncNotice? fromTransitions(
    Iterable<TaskItem> tasks,
    Set<String> previouslyActive,
  ) {
    final completed = tasks
        .where(
          (task) =>
              previouslyActive.contains(task.id) &&
              !task.isActive &&
              task.status != 'canceled',
        )
        .toList(growable: false);
    return completed.isEmpty ? null : TaskSyncNotice(tasks: completed);
  }

  final List<TaskItem> tasks;

  int get succeededCount => tasks.where((task) => task.isSucceeded).length;
  int get failedCount => tasks.length - succeededCount;
  bool get isSingle => tasks.length == 1;
  TaskItem get firstTask => tasks.first;
}

class TaskSyncState {
  const TaskSyncState({
    this.mode = TaskSyncMode.idle,
    this.activeCount = 0,
    this.lastTask,
    this.lastEventAt,
    this.notice,
    this.noticeSequence = 0,
  });

  final TaskSyncMode mode;
  final int activeCount;
  final TaskItem? lastTask;
  final DateTime? lastEventAt;
  final TaskSyncNotice? notice;
  final int noticeSequence;

  TaskSyncState copyWith({
    TaskSyncMode? mode,
    int? activeCount,
    TaskItem? lastTask,
    DateTime? lastEventAt,
    TaskSyncNotice? notice,
    int? noticeSequence,
  }) => TaskSyncState(
    mode: mode ?? this.mode,
    activeCount: activeCount ?? this.activeCount,
    lastTask: lastTask ?? this.lastTask,
    lastEventAt: lastEventAt ?? this.lastEventAt,
    notice: notice ?? this.notice,
    noticeSequence: noticeSequence ?? this.noticeSequence,
  );
}

class TaskSyncController extends Notifier<TaskSyncState> {
  final Set<String> _activeTaskIds = {};
  CancelToken? _streamCancelToken;
  Timer? _pollTimer;
  Timer? _reconnectTimer;
  DateTime? _lastPollAt;
  bool _resumed = false;
  bool _authenticated = false;
  bool _connecting = false;
  bool _polling = false;
  int _generation = 0;

  @override
  TaskSyncState build() {
    ref.listen<AsyncValue<SessionState>>(sessionControllerProvider, (_, next) {
      final authenticated = next.asData?.value.isAuthenticated == true;
      if (_authenticated == authenticated) return;
      _authenticated = authenticated;
      _syncConnection();
    });
    ref.listen<AsyncValue<List<TaskItem>>>(taskListProvider, (_, next) {
      next.whenData(_trackTasks);
    });
    ref.onDispose(_dispose);
    Future<void>.microtask(() {
      _authenticated =
          ref.read(sessionControllerProvider).asData?.value.isAuthenticated ==
          true;
      _syncConnection();
    });
    return const TaskSyncState();
  }

  void resume() {
    _resumed = true;
    _syncConnection(refresh: true);
  }

  void pause() {
    _resumed = false;
    _stopConnection();
  }

  Future<void> refreshNow() async {
    if (!_authenticated) return;
    ref.invalidate(taskListProvider);
    try {
      final tasks = await ref.read(taskListProvider.future);
      _trackTasks(tasks);
      await _pollActive(force: true);
    } catch (_) {
      // The screen-level provider exposes actionable refresh errors.
    }
  }

  void _syncConnection({bool refresh = false}) {
    if (!_resumed || !_authenticated) {
      _stopConnection(clearTasks: !_authenticated);
      return;
    }
    _startPollingTimer();
    if (refresh) unawaited(refreshNow());
    if (_streamCancelToken == null && !_connecting) {
      unawaited(_connectStream());
    }
  }

  Future<void> _connectStream() async {
    if (!_resumed || !_authenticated || _connecting) return;
    _connecting = true;
    final generation = ++_generation;
    final cancelToken = CancelToken();
    _streamCancelToken = cancelToken;
    state = state.copyWith(mode: TaskSyncMode.connecting);
    try {
      final body = await ref
          .read(apiClientProvider)
          .openEventStream('/me/tasks/events', cancelToken: cancelToken);
      if (!_isCurrent(generation, cancelToken)) return;
      state = state.copyWith(mode: TaskSyncMode.live);
      await for (final event in SseDecoder.decode(body.stream)) {
        if (!_isCurrent(generation, cancelToken)) return;
        _consumeEvent(event);
      }
      if (_isCurrent(generation, cancelToken)) {
        throw const FormatException('实时状态连接已结束');
      }
    } catch (_) {
      if (!_isCurrent(generation, cancelToken)) return;
      state = state.copyWith(mode: TaskSyncMode.polling);
      _scheduleReconnect();
    } finally {
      if (identical(_streamCancelToken, cancelToken)) {
        _streamCancelToken = null;
      }
      _connecting = false;
    }
  }

  void _consumeEvent(SseEvent event) {
    if (event.event != 'message' || event.data.trim().isEmpty) return;
    try {
      final payload = jsonDecode(event.data);
      if (payload is! Map) return;
      final rawTask = payload['task'];
      if (rawTask is! Map) return;
      _handleTask(TaskItem.fromJson(Map<String, dynamic>.from(rawTask)));
    } catch (_) {
      // A malformed transient event must not tear down a healthy stream.
    }
  }

  void _handleTask(TaskItem task) {
    if (task.id.isEmpty) return;
    final notice = TaskSyncNotice.fromTransitions([task], _activeTaskIds);
    if (task.isActive) {
      _activeTaskIds.add(task.id);
    } else {
      _activeTaskIds.remove(task.id);
    }
    state = state.copyWith(
      activeCount: _activeTaskIds.length,
      lastTask: task,
      lastEventAt: DateTime.now(),
      notice: notice,
      noticeSequence: notice == null
          ? state.noticeSequence
          : state.noticeSequence + 1,
    );
    ref.read(taskCenterControllerProvider.notifier).upsert(task);
    ref.invalidate(taskDetailProvider(task.id));
    ref.invalidate(taskListProvider);
    if (notice != null) {
      ref.invalidate(profileOverviewProvider);
      ref.invalidate(walletProvider);
    }
  }

  void _trackTasks(List<TaskItem> tasks) {
    if (!_authenticated) return;
    final notice = TaskSyncNotice.fromTransitions(tasks, _activeTaskIds);
    _activeTaskIds
      ..clear()
      ..addAll(tasks.where((task) => task.isActive).map((task) => task.id));
    if (state.activeCount != _activeTaskIds.length || notice != null) {
      state = state.copyWith(
        activeCount: _activeTaskIds.length,
        notice: notice,
        noticeSequence: notice == null
            ? state.noticeSequence
            : state.noticeSequence + 1,
      );
    }
    if (notice != null) {
      ref.invalidate(profileOverviewProvider);
      ref.invalidate(walletProvider);
    }
  }

  void _startPollingTimer() {
    _pollTimer ??= Timer.periodic(
      const Duration(seconds: 6),
      (_) => unawaited(_pollActive()),
    );
  }

  Future<void> _pollActive({bool force = false}) async {
    if (!_resumed || !_authenticated || _polling || _activeTaskIds.isEmpty) {
      return;
    }
    final now = DateTime.now();
    if (!force &&
        state.mode == TaskSyncMode.live &&
        _lastPollAt != null &&
        now.difference(_lastPollAt!) < const Duration(seconds: 30)) {
      return;
    }
    _polling = true;
    _lastPollAt = now;
    try {
      final tasks = await ref
          .read(taskRepositoryProvider)
          .getBatch(_activeTaskIds);
      final notice = TaskSyncNotice.fromTransitions(tasks, _activeTaskIds);
      for (final task in tasks) {
        if (task.isActive) {
          _activeTaskIds.add(task.id);
        } else {
          _activeTaskIds.remove(task.id);
        }
        ref.read(taskCenterControllerProvider.notifier).upsert(task);
        ref.invalidate(taskDetailProvider(task.id));
      }
      state = state.copyWith(
        activeCount: _activeTaskIds.length,
        lastTask: tasks.firstOrNull,
        lastEventAt: tasks.isEmpty ? state.lastEventAt : DateTime.now(),
        notice: notice,
        noticeSequence: notice == null
            ? state.noticeSequence
            : state.noticeSequence + 1,
      );
      if (tasks.isNotEmpty) ref.invalidate(taskListProvider);
      if (notice != null) {
        ref.invalidate(profileOverviewProvider);
        ref.invalidate(walletProvider);
      }
    } catch (_) {
      if (state.mode != TaskSyncMode.connecting) {
        state = state.copyWith(mode: TaskSyncMode.polling);
      }
    } finally {
      _polling = false;
    }
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    if (!_resumed || !_authenticated) return;
    _reconnectTimer = Timer(const Duration(seconds: 5), () {
      if (_streamCancelToken == null) unawaited(_connectStream());
    });
  }

  bool _isCurrent(int generation, CancelToken token) =>
      _generation == generation &&
      identical(_streamCancelToken, token) &&
      !token.isCancelled &&
      _resumed &&
      _authenticated;

  void _stopConnection({bool clearTasks = false}) {
    _generation++;
    _streamCancelToken?.cancel();
    _streamCancelToken = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _pollTimer?.cancel();
    _pollTimer = null;
    _connecting = false;
    _polling = false;
    if (clearTasks) _activeTaskIds.clear();
    if (state.mode != TaskSyncMode.idle ||
        (clearTasks && state.activeCount != 0)) {
      state = state.copyWith(
        mode: TaskSyncMode.idle,
        activeCount: clearTasks ? 0 : state.activeCount,
      );
    }
  }

  void _dispose() {
    _resumed = false;
    _stopConnection();
  }
}

final taskSyncControllerProvider =
    NotifierProvider<TaskSyncController, TaskSyncState>(TaskSyncController.new);
