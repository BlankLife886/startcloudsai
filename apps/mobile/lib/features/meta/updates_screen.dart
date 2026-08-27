import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/providers.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import 'meta.dart';

class UpdatesScreen extends ConsumerStatefulWidget {
  const UpdatesScreen({this.openExternal, super.key});

  final Future<bool> Function(Uri uri)? openExternal;

  @override
  ConsumerState<UpdatesScreen> createState() => _UpdatesScreenState();
}

class _UpdatesScreenState extends ConsumerState<UpdatesScreen> {
  String? _tag;

  Future<void> _openAnnouncement(AppAnnouncement item) async {
    final raw = item.ctaUrl?.trim() ?? '';
    final uri = Uri.tryParse(raw);
    if (uri == null || raw.isEmpty) return;
    if (!uri.hasScheme && raw.startsWith('/')) {
      final router = GoRouter.maybeOf(context);
      if (router == null) {
        AppNotice.error(context, '暂时无法打开此页面');
        return;
      }
      router.push(uri.toString());
      return;
    }
    if (uri.scheme != 'http' && uri.scheme != 'https') {
      AppNotice.error(context, '公告链接不可用');
      return;
    }
    try {
      final opened = await (widget.openExternal ?? _launchExternal)(uri);
      if (mounted && !opened) AppNotice.error(context, '暂时无法打开公告链接');
    } catch (_) {
      if (mounted) AppNotice.error(context, '暂时无法打开公告链接');
    }
  }

  Future<bool> _launchExternal(Uri uri) =>
      launchUrl(uri, mode: LaunchMode.externalApplication);

  Future<void> _refresh() async {
    ref.invalidate(metaFeedProvider);
    ref.invalidate(latestChangelogProvider);
    await ref.read(metaFeedProvider.future);
  }

  @override
  Widget build(BuildContext context) {
    final feed = ref.watch(metaFeedProvider);
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('公告与更新'),
        fallbackLocation: '/profile',
        actions: [
          IconButton(
            tooltip: '刷新',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: feed.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _UpdatesError(onRetry: _refresh),
        data: _buildFeed,
      ),
    );
  }

  Widget _buildFeed(MetaFeed feed) {
    final availableTags = <String>{
      for (final entry in feed.changelog) entry.tag,
    }.toList();
    final selectedTag = availableTags.contains(_tag) ? _tag : null;
    final filtered = feed.changelog
        .where((entry) => selectedTag == null || entry.tag == selectedTag)
        .toList();
    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
            sliver: SliverToBoxAdapter(child: _UpdatesOverview(feed: feed)),
          ),
          if (feed.announcements.isNotEmpty) ...[
            const _SectionTitle(title: '当前公告', icon: Icons.campaign_outlined),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              sliver: SliverList.separated(
                itemCount: feed.announcements.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) => _AnnouncementCard(
                  item: feed.announcements[index],
                  onOpen: () => _openAnnouncement(feed.announcements[index]),
                ),
              ),
            ),
          ],
          const _SectionTitle(title: '版本记录', icon: Icons.history),
          if (availableTags.length > 1)
            SliverToBoxAdapter(
              child: _TagStrip(
                tags: availableTags,
                selected: selectedTag,
                onSelected: (value) => setState(() => _tag = value),
              ),
            ),
          if (filtered.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: _UpdatesEmpty(filtered: selectedTag != null),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
              sliver: SliverList.separated(
                itemCount: filtered.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) => _ChangelogCard(
                  entry: filtered[index],
                  initiallyExpanded: index == 0,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _UpdatesOverview extends StatelessWidget {
  const _UpdatesOverview({required this.feed});

  final MetaFeed feed;

  @override
  Widget build(BuildContext context) {
    final latest = feed.latest;
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      key: const Key('updates-overview-surface'),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: colors.secondaryContainer,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                Icons.new_releases_outlined,
                color: colors.onSecondaryContainer,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    latest == null ? '暂无版本记录' : '服务版本 v${latest.version}',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    latest?.title ?? '更新内容发布后会在这里展示',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: [
                      _CountLabel(
                        icon: Icons.campaign_outlined,
                        label: '${feed.announcements.length} 条公告',
                      ),
                      _CountLabel(
                        icon: Icons.history,
                        label: '${feed.changelog.length} 个版本',
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CountLabel extends StatelessWidget {
  const _CountLabel({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 15),
      const SizedBox(width: 4),
      Text(label, style: Theme.of(context).textTheme.bodySmall),
    ],
  );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, required this.icon});

  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) => SliverPadding(
    padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
    sliver: SliverToBoxAdapter(
      child: Row(
        children: [
          Icon(icon, size: 20),
          const SizedBox(width: 8),
          Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    ),
  );
}

class _AnnouncementCard extends ConsumerWidget {
  const _AnnouncementCard({required this.item, required this.onOpen});

  final AppAnnouncement item;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final resolvedImage = ref
        .watch(apiClientProvider)
        .resolveUrl(item.imageUrl ?? '');
    final colors = Theme.of(context).colorScheme;
    final hasAction = item.ctaUrl?.trim().isNotEmpty == true;
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: DecoratedBox(
        key: Key('announcement-surface-${item.id}'),
        decoration: BoxDecoration(
          color: colors.surfaceContainerLow,
          border: Border.all(color: colors.outlineVariant),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (resolvedImage.isNotEmpty)
              AspectRatio(
                aspectRatio: 16 / 7,
                child: Image.network(
                  resolvedImage,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const SizedBox.shrink(),
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.campaign, size: 19, color: colors.tertiary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          item.title,
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                      ),
                    ],
                  ),
                  if (item.body.isNotEmpty) ...[
                    const SizedBox(height: 9),
                    Text(item.body, style: const TextStyle(height: 1.45)),
                  ],
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          _announcementPeriod(item),
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: colors.onSurfaceVariant),
                        ),
                      ),
                      if (hasAction)
                        TextButton.icon(
                          key: Key('announcement-action-${item.id}'),
                          onPressed: onOpen,
                          iconAlignment: IconAlignment.end,
                          icon: const Icon(
                            Icons.arrow_forward_rounded,
                            size: 17,
                          ),
                          label: Text(
                            item.ctaText?.trim().isNotEmpty == true
                                ? item.ctaText!.trim()
                                : '查看详情',
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TagStrip extends StatelessWidget {
  const _TagStrip({
    required this.tags,
    required this.selected,
    required this.onSelected,
  });

  final List<String> tags;
  final String? selected;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
    child: Row(
      spacing: 8,
      children: [
        FilterChip(
          label: const Text('全部'),
          selected: selected == null,
          onSelected: (_) => onSelected(null),
        ),
        for (final tag in tags)
          FilterChip(
            key: Key('updates-tag-$tag'),
            avatar: Icon(_tagIcon(tag), size: 16),
            label: Text(_tagLabel(tag)),
            selected: selected == tag,
            onSelected: (_) => onSelected(tag),
          ),
      ],
    ),
  );
}

class _ChangelogCard extends StatelessWidget {
  const _ChangelogCard({required this.entry, required this.initiallyExpanded});

  final ChangelogEntry entry;
  final bool initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Card(
      key: Key('changelog-${entry.id}'),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        initiallyExpanded: initiallyExpanded,
        leading: Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: entry.highlight
                ? colors.tertiaryContainer
                : colors.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(7),
          ),
          child: Icon(_tagIcon(entry.tag), size: 20),
        ),
        title: Text(
          'v${entry.version} · ${entry.title}',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Text(
          '${_tagLabel(entry.tag)} · ${_date(entry.date)}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (entry.summary.isNotEmpty) ...[
            const Divider(),
            Text(entry.summary, style: const TextStyle(height: 1.45)),
          ],
          if (entry.items.isNotEmpty) ...[
            const SizedBox(height: 10),
            for (final item in entry.items)
              Padding(
                padding: const EdgeInsets.only(bottom: 7),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Icon(
                        Icons.check_circle_outline,
                        size: 17,
                        color: colors.primary,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(child: Text(item)),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _UpdatesEmpty extends StatelessWidget {
  const _UpdatesEmpty({required this.filtered});

  final bool filtered;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.inbox_outlined, size: 40),
          const SizedBox(height: 10),
          Text(filtered ? '这个分类还没有更新记录' : '暂时没有更新记录'),
        ],
      ),
    ),
  );
}

class _UpdatesError extends StatelessWidget {
  const _UpdatesError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_outlined, size: 42),
          const SizedBox(height: 12),
          const Text('公告与更新加载失败'),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('重试'),
          ),
        ],
      ),
    ),
  );
}

String _date(DateTime? value) =>
    value == null ? '日期未知' : DateFormat('yyyy.MM.dd').format(value);

String _announcementPeriod(AppAnnouncement item) {
  if (item.endsAt != null) return '有效至 ${_date(item.endsAt)}';
  if (item.startsAt != null) return '${_date(item.startsAt)} 起生效';
  return item.createdAt == null ? '当前生效' : '${_date(item.createdAt)} 发布';
}

String _tagLabel(String tag) => switch (tag) {
  'feature' => '新功能',
  'experience' => '体验',
  'performance' => '性能',
  'fix' => '修复',
  _ => '更新',
};

IconData _tagIcon(String tag) => switch (tag) {
  'feature' => Icons.auto_awesome,
  'experience' => Icons.touch_app_outlined,
  'performance' => Icons.speed,
  'fix' => Icons.build_outlined,
  _ => Icons.update,
};
