import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';

@immutable
class AppLicenseEntry {
  const AppLicenseEntry({required this.packages, required this.text});

  final List<String> packages;
  final String text;

  String get packageLabel => packages.join('、');
}

Future<List<AppLicenseEntry>> loadAppLicenses() async {
  final entries = <AppLicenseEntry>[];
  await for (final license in LicenseRegistry.licenses) {
    final packages = license.packages.toSet().toList()..sort();
    final text = license.paragraphs
        .map((paragraph) => paragraph.text.trim())
        .where((paragraph) => paragraph.isNotEmpty)
        .join('\n\n');
    if (packages.isEmpty || text.isEmpty) continue;
    entries.add(AppLicenseEntry(packages: packages, text: text));
  }
  entries.sort(
    (left, right) => left.packageLabel.toLowerCase().compareTo(
      right.packageLabel.toLowerCase(),
    ),
  );
  return entries;
}

List<AppLicenseEntry> filterLicenseEntries(
  Iterable<AppLicenseEntry> entries,
  String query,
) {
  final keywords = query
      .trim()
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((keyword) => keyword.isNotEmpty)
      .toList();
  if (keywords.isEmpty) return entries.toList();
  return entries.where((entry) {
    final searchable = '${entry.packageLabel}\n${entry.text}'.toLowerCase();
    return keywords.every(searchable.contains);
  }).toList();
}

class OpenSourceLicensesScreen extends StatefulWidget {
  const OpenSourceLicensesScreen({this.loadLicenses, super.key});

  final Future<List<AppLicenseEntry>> Function()? loadLicenses;

  @override
  State<OpenSourceLicensesScreen> createState() =>
      _OpenSourceLicensesScreenState();
}

class _OpenSourceLicensesScreenState extends State<OpenSourceLicensesScreen> {
  final _searchController = TextEditingController();
  List<AppLicenseEntry>? _entries;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final entries = await (widget.loadLicenses ?? loadAppLicenses)();
      if (!mounted) return;
      setState(() => _entries = entries);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }

  void _clearSearch() {
    _searchController.clear();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const AppTopBar(title: Text('开源许可'), fallbackLocation: '/about'),
      body: _entries == null
          ? _error == null
                ? const Center(child: CircularProgressIndicator())
                : _LicenseLoadError(onRetry: _load)
          : _buildContent(),
    );
  }

  Widget _buildContent() {
    final entries = _entries!;
    final filtered = filterLicenseEntries(entries, _searchController.text);
    final packageCount = entries
        .expand((entry) => entry.packages)
        .toSet()
        .length;
    return CustomScrollView(
      key: const Key('open-source-license-content'),
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
          sliver: SliverToBoxAdapter(
            child: AppAppear(
              child: _LicenseSummary(
                packageCount: packageCount,
                licenseCount: entries.length,
              ),
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 18),
          sliver: SliverToBoxAdapter(
            child: TextField(
              key: const Key('license-search'),
              controller: _searchController,
              onChanged: (_) => setState(() {}),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: '搜索组件或许可内容',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        key: const Key('license-search-clear'),
                        tooltip: '清除搜索',
                        onPressed: _clearSearch,
                        icon: const Icon(Icons.close_rounded),
                      ),
              ),
            ),
          ),
        ),
        if (filtered.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: _LicenseEmpty(hasQuery: _searchController.text.isNotEmpty),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 36),
            sliver: SliverList.separated(
              itemCount: filtered.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, index) => _LicenseTile(
                key: ValueKey('${filtered[index].packageLabel}-$index'),
                entry: filtered[index],
              ),
            ),
          ),
      ],
    );
  }
}

class _LicenseSummary extends StatelessWidget {
  const _LicenseSummary({
    required this.packageCount,
    required this.licenseCount,
  });

  final int packageCount;
  final int licenseCount;

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
            child: Icon(Icons.code_rounded, color: colors.onPrimaryContainer),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '第三方开源组件',
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 3),
              Text(
                '$packageCount 个组件 · $licenseCount 份许可',
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

class _LicenseTile extends StatelessWidget {
  const _LicenseTile({required this.entry, super.key});

  final AppLicenseEntry entry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerLow,
      borderRadius: BorderRadius.circular(8),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 14),
        childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 16),
        leading: Icon(
          Icons.extension_outlined,
          color: colors.onSurfaceVariant,
          size: 21,
        ),
        title: Text(
          entry.packageLabel,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text('${entry.text.runes.length} 个字符'),
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: SelectableText(
              entry.text,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
                height: 1.5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LicenseEmpty extends StatelessWidget {
  const _LicenseEmpty({required this.hasQuery});

  final bool hasQuery;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.manage_search_rounded, size: 38),
          const SizedBox(height: 10),
          Text(
            hasQuery ? '没有匹配的开源许可' : '暂无开源许可信息',
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    ),
  );
}

class _LicenseLoadError extends StatelessWidget {
  const _LicenseLoadError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.sync_problem_outlined, size: 38),
          const SizedBox(height: 10),
          const Text('开源许可读取失败', style: TextStyle(fontWeight: FontWeight.w700)),
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
