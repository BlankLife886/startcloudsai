import 'package:flutter/material.dart';

import '../../core/network/api_exception.dart';
import 'tasks.dart';
import '../../core/widgets/app_chrome.dart';

Future<TaskDeletionResult?> runTaskDeletionFlow(
  BuildContext context, {
  required TaskItem task,
  required Future<TaskDeletionResult> Function(bool cascade) onDelete,
  required void Function(bool busy) onBusyChanged,
}) async {
  final confirmed = await showAppDialog<bool>(
    context: context,
    builder: (context) => AppDialog(
      icon: Icon(
        Icons.delete_outline,
        color: Theme.of(context).colorScheme.error,
      ),
      title: const Text('删除这件作品？'),
      content: const Text('云端作品、关联投稿和未被其他内容使用的文件将被删除，操作无法恢复。'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(context).colorScheme.error,
            foregroundColor: Theme.of(context).colorScheme.onError,
          ),
          onPressed: () => Navigator.pop(context, true),
          icon: const Icon(Icons.delete_outline),
          label: const Text('确认删除'),
        ),
      ],
    ),
  );
  if (confirmed != true || !context.mounted) return null;

  onBusyChanged(true);
  try {
    return await onDelete(false);
  } on ApiException catch (error) {
    if (error.code != 'task_in_use') rethrow;
    onBusyChanged(false);
    if (!context.mounted) return null;
    final cascade = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: Icon(
          Icons.account_tree_outlined,
          color: Theme.of(context).colorScheme.error,
        ),
        title: const Text('同时删除关联作品？'),
        content: const Text('这件作品正在被后续创作引用。继续后，所有依赖它的作品及关联投稿也会一并删除，且无法恢复。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('保留作品'),
          ),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            onPressed: () => Navigator.pop(context, true),
            icon: const Icon(Icons.delete_forever_outlined),
            label: const Text('删除全部关联作品'),
          ),
        ],
      ),
    );
    if (cascade != true || !context.mounted) return null;
    onBusyChanged(true);
    return await onDelete(true);
  } finally {
    if (context.mounted) onBusyChanged(false);
  }
}
