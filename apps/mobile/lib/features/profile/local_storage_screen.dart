import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/storage/app_image_cache.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../assistant/assistant_draft.dart';
import '../create/creation_draft.dart';
import '../feedback/feedback.dart';

@immutable
class LocalStorageSnapshot {
  const LocalStorageSnapshot({
    required this.imageCache,
    required this.hasCreationDraft,
    required this.hasAssistantDraft,
    required this.hasFeedbackDraft,
  });

  final AppImageCacheSnapshot imageCache;
  final bool hasCreationDraft;
  final bool hasAssistantDraft;
  final bool hasFeedbackDraft;

  int get draftCount => [
    hasCreationDraft,
    hasAssistantDraft,
    hasFeedbackDraft,
  ].where((value) => value).length;

  List<String> get draftLabels => [
    if (hasCreationDraft) '文生图',
    if (hasAssistantDraft) 'AI 助手',
    if (hasFeedbackDraft) '问题反馈',
  ];
}

class LocalStorageScreen extends ConsumerStatefulWidget {
  const LocalStorageScreen({super.key});

  @override
  ConsumerState<LocalStorageScreen> createState() => _LocalStorageScreenState();
}

class _LocalStorageScreenState extends ConsumerState<LocalStorageScreen> {
  LocalStorageSnapshot? _snapshot;
  Object? _error;
  bool _loading = true;
  bool _clearing = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final values = await Future.wait<Object?>([
        ref.read(creationDraftStoreProvider).read(),
        ref.read(assistantDraftStoreProvider).read(),
        ref.read(feedbackDraftStoreProvider).read(),
      ]);
      if (!mounted) return;
      setState(() {
        _snapshot = LocalStorageSnapshot(
          imageCache: ref.read(appImageCacheServiceProvider).snapshot(),
          hasCreationDraft: values[0] != null,
          hasAssistantDraft: values[1] != null,
          hasFeedbackDraft: values[2] != null,
        );
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<bool> _confirmClear({
    required String title,
    required String content,
    required String actionLabel,
  }) async =>
      await showAppDialog<bool>(
        context: context,
        builder: (dialogContext) => AppDialog(
          icon: const Icon(Icons.delete_sweep_outlined),
          title: Text(title),
          content: Text(content),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(actionLabel),
            ),
          ],
        ),
      ) ??
      false;

  Future<void> _runCleanup({
    required Future<void> Function() action,
    required String message,
  }) async {
    if (_clearing) return;
    setState(() => _clearing = true);
    try {
      await action();
      await _load();
      if (mounted) AppNotice.success(context, message);
    } catch (_) {
      if (mounted) AppNotice.error(context, '清理失败，请稍后重试');
    } finally {
      if (mounted) setState(() => _clearing = false);
    }
  }

  Future<void> _clearImages() => _runCleanup(
    action: () async {
      ref.read(appImageCacheServiceProvider).clear();
    },
    message: '图片缓存已清理',
  );

  Future<void> _clearDrafts() async {
    final confirmed = await _confirmClear(
      title: '清理未发送草稿？',
      content: '文生图、AI 助手和问题反馈中尚未提交的本机内容将被删除。',
      actionLabel: '清理草稿',
    );
    if (!confirmed || !mounted) return;
    await _runCleanup(
      action: () => Future.wait([
        ref.read(creationDraftStoreProvider).clear(),
        ref.read(assistantDraftStoreProvider).clear(),
        ref.read(feedbackDraftStoreProvider).clear(),
      ]),
      message: '未发送草稿已清理',
    );
  }

  Future<void> _clearAll() async {
    if (_clearing ||
        !await _confirmClear(
          title: '清理全部本地内容？',
          content: '图片缓存和未发送草稿将从本机删除，账号中的作品、素材和对话不会受到影响。',
          actionLabel: '确认清理',
        ) ||
        !mounted) {
      return;
    }
    await _runCleanup(
      action: () async {
        await Future.wait([
          ref.read(creationDraftStoreProvider).clear(),
          ref.read(assistantDraftStoreProvider).clear(),
          ref.read(feedbackDraftStoreProvider).clear(),
        ]);
        ref.read(appImageCacheServiceProvider).clear();
      },
      message: '本地内容已清理',
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const AppTopBar(
        title: Text('本地存储'),
        fallbackLocation: '/profile/security',
      ),
      body: AnimatedSwitcher(
        duration: const Duration(milliseconds: 180),
        child: _loading && _snapshot == null
            ? const Center(
                key: Key('local-storage-loading'),
                child: CircularProgressIndicator(),
              )
            : _error != null && _snapshot == null
            ? _StorageError(onRetry: _load)
            : _StorageContent(
                snapshot: _snapshot!,
                clearing: _clearing,
                onRefresh: _load,
                onClearImages: _clearImages,
                onClearDrafts: _clearDrafts,
                onClearAll: _clearAll,
              ),
      ),
    );
  }
}

class _StorageContent extends StatelessWidget {
  const _StorageContent({
    required this.snapshot,
    required this.clearing,
    required this.onRefresh,
    required this.onClearImages,
    required this.onClearDrafts,
    required this.onClearAll,
  });

  final LocalStorageSnapshot snapshot;
  final bool clearing;
  final Future<void> Function() onRefresh;
  final VoidCallback onClearImages;
  final VoidCallback onClearDrafts;
  final VoidCallback onClearAll;

  bool get _hasImages =>
      snapshot.imageCache.bytes > 0 ||
      snapshot.imageCache.entries > 0 ||
      snapshot.imageCache.liveEntries > 0;

  bool get _hasAnything => _hasImages || snapshot.draftCount > 0;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        key: const Key('local-storage-content'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 36),
        children: [
          AppAppear(child: _StorageSummary(snapshot: snapshot)),
          const SizedBox(height: 28),
          const _SectionTitle('可清理内容'),
          const SizedBox(height: 8),
          Material(
            color: Theme.of(context).colorScheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(8),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                _StorageRow(
                  key: const Key('local-storage-images'),
                  icon: Icons.image_outlined,
                  title: '图片缓存',
                  detail:
                      '${cachedImageCount(snapshot.imageCache)} 张 · ${formatCacheSize(snapshot.imageCache.bytes)}',
                  actionKey: const Key('local-storage-clear-images'),
                  actionLabel: '清理',
                  onPressed: _hasImages && !clearing ? onClearImages : null,
                ),
                Divider(
                  height: 1,
                  indent: 54,
                  color: Theme.of(
                    context,
                  ).colorScheme.outlineVariant.withValues(alpha: .7),
                ),
                _StorageRow(
                  key: const Key('local-storage-drafts'),
                  icon: Icons.edit_note_outlined,
                  title: '未发送草稿',
                  detail: snapshot.draftLabels.isEmpty
                      ? '暂无未发送草稿'
                      : '${snapshot.draftLabels.join('、')} · ${snapshot.draftCount} 项',
                  actionKey: const Key('local-storage-clear-drafts'),
                  actionLabel: '清理',
                  onPressed: snapshot.draftCount > 0 && !clearing
                      ? onClearDrafts
                      : null,
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          OutlinedButton.icon(
            key: const Key('local-storage-clear-all'),
            onPressed: _hasAnything && !clearing ? onClearAll : null,
            icon: clearing
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.delete_sweep_outlined),
            label: Text(clearing ? '正在清理' : '清理全部本地内容'),
          ),
          const SizedBox(height: 12),
          Text(
            '清理不会删除账号中的作品、素材、对话或反馈记录。',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

class _StorageSummary extends StatelessWidget {
  const _StorageSummary({required this.snapshot});

  final LocalStorageSnapshot snapshot;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: colors.primaryContainer,
            borderRadius: BorderRadius.circular(8),
          ),
          child: SizedBox.square(
            dimension: 48,
            child: Icon(
              Icons.storage_rounded,
              color: colors.onPrimaryContainer,
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '本机内容',
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 3),
              Text(
                '${snapshot.draftCount} 项草稿 · ${formatCacheSize(snapshot.imageCache.bytes)} 图片缓存',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _StorageRow extends StatelessWidget {
  const _StorageRow({
    required this.icon,
    required this.title,
    required this.detail,
    required this.actionKey,
    required this.actionLabel,
    required this.onPressed,
    super.key,
  });

  final IconData icon;
  final String title;
  final String detail;
  final Key actionKey;
  final String actionLabel;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      contentPadding: const EdgeInsets.fromLTRB(14, 4, 8, 4),
      leading: Icon(icon, color: colors.onSurfaceVariant, size: 22),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(detail, maxLines: 2, overflow: TextOverflow.ellipsis),
      trailing: TextButton(
        key: actionKey,
        onPressed: onPressed,
        child: Text(actionLabel),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Text(
    title,
    style: Theme.of(
      context,
    ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
  );
}

class _StorageError extends StatelessWidget {
  const _StorageError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    key: const Key('local-storage-error'),
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.sync_problem_outlined, size: 38),
          const SizedBox(height: 12),
          const Text('本地存储读取失败', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('重新读取'),
          ),
        ],
      ),
    ),
  );
}
