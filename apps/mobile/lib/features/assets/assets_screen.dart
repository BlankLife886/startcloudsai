import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/authenticated_image.dart';
import '../create/reference_image_service.dart';
import 'assets.dart';
import '../../core/widgets/app_chrome.dart';

class AssetsScreen extends ConsumerStatefulWidget {
  const AssetsScreen({super.key});

  @override
  ConsumerState<AssetsScreen> createState() => _AssetsScreenState();
}

class _AssetsScreenState extends ConsumerState<AssetsScreen> {
  final _scrollController = ScrollController();
  String? _loadMoreError;
  bool _loadMoreInFlight = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_onScroll)
      ..dispose();
    super.dispose();
  }

  void _onScroll() {
    final state = ref.read(assetCenterControllerProvider).asData?.value;
    if (!_scrollController.hasClients ||
        _scrollController.position.extentAfter > 320 ||
        _scrollController.position.pixels <= 0 ||
        _loadMoreInFlight ||
        _loadMoreError != null ||
        state == null ||
        !state.hasMore ||
        state.isLoadingMore) {
      return;
    }
    unawaited(_loadMore(showErrorNotice: false));
  }

  Future<void> _refresh() async {
    if (_loadMoreError != null && mounted) {
      setState(() => _loadMoreError = null);
    }
    await ref.read(assetCenterControllerProvider.notifier).refresh();
  }

  Future<void> _loadMore({bool showErrorNotice = true}) async {
    if (_loadMoreInFlight) return;
    _loadMoreInFlight = true;
    if (_loadMoreError != null && mounted) {
      setState(() => _loadMoreError = null);
    }
    try {
      await ref.read(assetCenterControllerProvider.notifier).loadMore();
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException ? error.message : '更多素材加载失败，请稍后重试';
      setState(() => _loadMoreError = message);
      if (showErrorNotice) AppNotice.error(context, message);
    } finally {
      _loadMoreInFlight = false;
    }
  }

  void _showError(Object error, String fallback) {
    final message = error is ApiException
        ? error.message
        : error is FormatException
        ? error.message
        : fallback;
    AppNotice.error(context, message);
  }

  Future<void> _startUpload(AssetCenterState state) async {
    final source = await showAppSheet<_AssetImageSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('从相册选择'),
              onTap: () => Navigator.pop(context, _AssetImageSource.gallery),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('拍照'),
              onTap: () => Navigator.pop(context, _AssetImageSource.camera),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    ReferenceImageDraft? draft;
    try {
      final service = ref.read(referenceImageServiceProvider);
      final images = source == _AssetImageSource.gallery
          ? await service.pickFromGallery(1)
          : await service.takePhoto();
      if (!mounted || images.isEmpty) return;
      draft = images.first;
      final result = await showAppSheet<UserAsset>(
        context: context,
        isScrollControlled: true,
        builder: (context) => AssetUploadSheet(
          image: draft!,
          groups: state.groups,
          initialGroupId:
              state.selectedGroup != assetGroupAll &&
                  state.selectedGroup != assetGroupUngrouped
              ? state.selectedGroup
              : null,
          onSubmit: ({required image, required title, groupId}) => ref
              .read(assetCenterControllerProvider.notifier)
              .upload(image: image, title: title, groupId: groupId),
        ),
      );
      if (result != null && mounted) {
        AppNotice.success(context, '素材已保存');
      }
    } catch (error) {
      if (mounted) _showError(error, '素材上传失败');
    } finally {
      if (draft != null && draft.localPath.isNotEmpty) {
        File(draft.localPath).delete().ignore();
      }
    }
  }

  Future<void> _createGroup() async {
    final name = await showAppDialog<String>(
      context: context,
      builder: (context) => const AssetNameDialog(
        title: '新建素材分组',
        label: '分组名称',
        validator: validateAssetGroupName,
      ),
    );
    if (name == null || !mounted) return;
    try {
      await ref.read(assetCenterControllerProvider.notifier).createGroup(name);
      if (mounted) {
        AppNotice.success(context, '分组已创建');
      }
    } catch (error) {
      if (mounted) _showError(error, '分组创建失败');
    }
  }

  Future<void> _renameGroup(UserAssetGroup group) async {
    final name = await showAppDialog<String>(
      context: context,
      builder: (context) => AssetNameDialog(
        title: '重命名分组',
        label: '分组名称',
        initialValue: group.name,
        validator: validateAssetGroupName,
      ),
    );
    if (name == null || name == group.name || !mounted) return;
    try {
      await ref
          .read(assetCenterControllerProvider.notifier)
          .renameGroup(group.id, name);
    } catch (error) {
      if (mounted) _showError(error, '分组更新失败');
    }
  }

  Future<void> _deleteGroup(UserAssetGroup group) async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.folder_delete_outlined),
        title: Text('删除“${group.name}”？'),
        content: const Text('分组中的素材不会被删除，将移到“未分组”。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除分组'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref
          .read(assetCenterControllerProvider.notifier)
          .deleteGroup(group.id);
    } catch (error) {
      if (mounted) _showError(error, '分组删除失败');
    }
  }

  Future<void> _manageGroups(AssetCenterState state) async {
    await showAppSheet<void>(
      context: context,
      builder: (sheetContext) => AssetGroupsSheet(
        groups: state.groups,
        onCreate: () {
          Navigator.pop(sheetContext);
          _createGroup();
        },
        onRename: (group) {
          Navigator.pop(sheetContext);
          _renameGroup(group);
        },
        onDelete: (group) {
          Navigator.pop(sheetContext);
          _deleteGroup(group);
        },
      ),
    );
  }

  Future<void> _renameAsset(UserAsset asset) async {
    final name = await showAppDialog<String>(
      context: context,
      builder: (context) => AssetNameDialog(
        title: '重命名素材',
        label: '素材名称',
        initialValue: asset.title,
        validator: validateAssetTitle,
      ),
    );
    if (name == null || name == asset.title || !mounted) return;
    try {
      await ref
          .read(assetCenterControllerProvider.notifier)
          .updateAsset(asset.id, title: name);
    } catch (error) {
      if (mounted) _showError(error, '素材更新失败');
    }
  }

  Future<void> _moveAsset(UserAsset asset, List<UserAssetGroup> groups) async {
    final selected = await showAppSheet<String>(
      context: context,
      builder: (context) =>
          AssetGroupPickerSheet(groups: groups, selectedGroupId: asset.groupId),
    );
    if (selected == null || !mounted) return;
    final groupId = selected == assetGroupUngrouped ? null : selected;
    if (groupId == asset.groupId) return;
    try {
      await ref
          .read(assetCenterControllerProvider.notifier)
          .updateAsset(asset.id, groupId: groupId, updateGroup: true);
    } catch (error) {
      if (mounted) _showError(error, '素材移动失败');
    }
  }

  Future<void> _deleteAsset(UserAsset asset) async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.delete_outline),
        title: const Text('删除这项素材？'),
        content: Text('“${asset.title}”将从素材库中永久删除。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref
          .read(assetCenterControllerProvider.notifier)
          .deleteAsset(asset.id);
      if (mounted) {
        AppNotice.success(context, '素材已删除');
      }
    } catch (error) {
      if (mounted) _showError(error, '素材删除失败');
    }
  }

  Future<void> _openAsset(UserAsset asset, AssetCenterState state) async {
    await showAppSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => AssetDetailSheet(
        asset: asset,
        groupName: state.groups
            .where((group) => group.id == asset.groupId)
            .firstOrNull
            ?.name,
        busy: state.busyIds.contains(asset.id),
        onRename: () {
          Navigator.pop(sheetContext);
          _renameAsset(asset);
        },
        onMove: () {
          Navigator.pop(sheetContext);
          _moveAsset(asset, state.groups);
        },
        onDelete: () {
          Navigator.pop(sheetContext);
          _deleteAsset(asset);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final assets = ref.watch(assetCenterControllerProvider);
    final state = assets.asData?.value;
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('我的素材'),
        fallbackLocation: '/profile',
        actions: [
          IconButton(
            tooltip: '管理分组',
            onPressed: state == null ? null : () => _manageGroups(state),
            icon: const Icon(Icons.folder_outlined),
          ),
          IconButton(
            tooltip: '添加素材',
            onPressed: state == null || state.isUploading
                ? null
                : () => _startUpload(state),
            icon: state?.isUploading == true
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.add_photo_alternate_outlined),
          ),
          IconButton(
            tooltip: '刷新',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: assets.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => _AssetsError(onRetry: _refresh),
        data: _buildAssets,
      ),
    );
  }

  Widget _buildAssets(AssetCenterState state) {
    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
            sliver: SliverToBoxAdapter(child: AssetCapacityPanel(state: state)),
          ),
          SliverToBoxAdapter(
            child: AssetGroupFilterStrip(
              state: state,
              onSelected: (groupId) => ref
                  .read(assetCenterControllerProvider.notifier)
                  .selectGroup(groupId),
            ),
          ),
          if (state.items.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: _AssetsEmpty(
                filtered: state.selectedGroup != assetGroupAll,
                onUpload: () => _startUpload(state),
              ),
            )
          else ...[
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
              sliver: SliverGrid.builder(
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                  maxCrossAxisExtent: 210,
                  crossAxisSpacing: 10,
                  mainAxisSpacing: 10,
                  childAspectRatio: 0.76,
                ),
                itemCount: state.items.length,
                itemBuilder: (context, index) {
                  final asset = state.items[index];
                  return AssetCard(
                    asset: asset,
                    busy: state.busyIds.contains(asset.id),
                    onTap: () => _openAsset(asset, state),
                  );
                },
              ),
            ),
            SliverToBoxAdapter(
              child: AssetPaginationFooter(
                hasMore: state.hasMore,
                loading: state.isLoadingMore,
                errorMessage: _loadMoreError,
                onLoadMore: _loadMore,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class AssetPaginationFooter extends StatelessWidget {
  const AssetPaginationFooter({
    required this.hasMore,
    required this.loading,
    required this.errorMessage,
    required this.onLoadMore,
    super.key,
  });

  final bool hasMore;
  final bool loading;
  final String? errorMessage;
  final Future<void> Function() onLoadMore;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final error = errorMessage?.trim();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 2, 16, 28),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 52),
        child: error?.isNotEmpty == true
            ? Semantics(
                liveRegion: true,
                child: Row(
                  key: const Key('asset-load-more-error'),
                  children: [
                    Icon(Icons.error_outline, size: 20, color: colors.error),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        error!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(
                          context,
                        ).textTheme.bodySmall?.copyWith(color: colors.error),
                      ),
                    ),
                    IconButton(
                      key: const Key('asset-load-more-retry'),
                      tooltip: '重试加载素材',
                      onPressed: onLoadMore,
                      icon: const Icon(Icons.refresh),
                    ),
                  ],
                ),
              )
            : loading
            ? Semantics(
                liveRegion: true,
                label: '正在自动加载更多素材',
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: 10),
                    Text('正在自动加载更多素材'),
                  ],
                ),
              )
            : hasMore
            ? Row(
                children: [
                  Icon(
                    Icons.keyboard_arrow_down,
                    size: 20,
                    color: colors.primary,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      '继续向下浏览将自动加载',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  TextButton(
                    key: const Key('asset-load-more'),
                    onPressed: onLoadMore,
                    child: const Text('立即加载'),
                  ),
                ],
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.check_circle_outline,
                    size: 18,
                    color: colors.outline,
                  ),
                  const SizedBox(width: 7),
                  Text('已加载全部素材', style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
      ),
    );
  }
}

class AssetCapacityPanel extends StatelessWidget {
  const AssetCapacityPanel({required this.state, super.key});

  final AssetCenterState state;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.primaryContainer,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: colors.primary,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Icon(Icons.collections, color: colors.onPrimary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        '个人素材库',
                        style: TextStyle(fontWeight: FontWeight.w900),
                      ),
                      Text(
                        '${state.totalAssetCount} 项素材 · ${state.groups.length} 个分组',
                      ),
                    ],
                  ),
                ),
                Text(
                  '${state.totalAssetCount}/200',
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: (state.totalAssetCount / 200).clamp(0, 1),
              minHeight: 7,
              borderRadius: BorderRadius.circular(4),
            ),
          ],
        ),
      ),
    );
  }
}

class AssetGroupFilterStrip extends StatelessWidget {
  const AssetGroupFilterStrip({
    required this.state,
    required this.onSelected,
    super.key,
  });

  final AssetCenterState state;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
    child: Row(
      spacing: 8,
      children: [
        FilterChip(
          key: const Key('asset-group-all'),
          label: Text('全部 ${state.totalAssetCount}'),
          selected: state.selectedGroup == assetGroupAll,
          onSelected: (_) => onSelected(assetGroupAll),
        ),
        FilterChip(
          key: const Key('asset-group-ungrouped'),
          label: Text('未分组 ${state.ungroupedCount}'),
          selected: state.selectedGroup == assetGroupUngrouped,
          onSelected: (_) => onSelected(assetGroupUngrouped),
        ),
        for (final group in state.groups)
          FilterChip(
            key: Key('asset-group-${group.id}'),
            label: Text('${group.name} ${group.assetCount}'),
            selected: state.selectedGroup == group.id,
            onSelected: (_) => onSelected(group.id),
          ),
      ],
    ),
  );
}

class AssetCard extends StatelessWidget {
  const AssetCard({
    required this.asset,
    required this.busy,
    required this.onTap,
    super.key,
  });

  final UserAsset asset;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: busy ? null : onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                AuthenticatedImage(url: asset.thumbnailUrl),
                if (busy)
                  const ColoredBox(
                    color: Colors.black38,
                    child: Center(
                      child: CircularProgressIndicator(color: Colors.white),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 9, 10, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  asset.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 4),
                Text(
                  formatAssetSize(asset.sizeBytes),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class AssetPickerSheet extends ConsumerStatefulWidget {
  const AssetPickerSheet({
    required this.maxSelection,
    this.existingKeys = const {},
    super.key,
  });

  final int maxSelection;
  final Set<String> existingKeys;

  @override
  ConsumerState<AssetPickerSheet> createState() => _AssetPickerSheetState();
}

class _AssetPickerSheetState extends ConsumerState<AssetPickerSheet> {
  final Map<String, UserAsset> _selected = {};

  void _toggle(UserAsset asset) {
    final key = asset.inputKey;
    if (key == null || widget.existingKeys.contains(key)) return;
    if (_selected.containsKey(asset.id)) {
      setState(() => _selected.remove(asset.id));
      return;
    }
    if (_selected.length >= widget.maxSelection) {
      AppNotice.warning(context, '最多再选 ${widget.maxSelection} 张素材');
      return;
    }
    setState(() => _selected[asset.id] = asset);
  }

  Future<void> _loadMore() async {
    try {
      await ref.read(assetCenterControllerProvider.notifier).loadMore();
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException ? error.message : '更多素材加载失败';
      AppNotice.error(context, message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final assets = ref.watch(assetCenterControllerProvider);
    return FractionallySizedBox(
      heightFactor: 0.86,
      child: SafeArea(
        top: false,
        child: Column(
          children: [
            LayoutBuilder(
              builder: (context, constraints) {
                final heading = Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '从素材库选择',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text('已选 ${_selected.length}/${widget.maxSelection}'),
                  ],
                );
                final confirm = FilledButton.icon(
                  key: const Key('asset-picker-confirm'),
                  onPressed: _selected.isEmpty
                      ? null
                      : () => Navigator.pop(context, _selected.values.toList()),
                  icon: const Icon(Icons.add),
                  label: const Text('添加'),
                );
                if (constraints.maxWidth < 360) {
                  return Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [heading, const SizedBox(height: 8), confirm],
                    ),
                  );
                }
                return Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 12, 10),
                  child: Row(
                    children: [
                      Expanded(child: heading),
                      const SizedBox(width: 12),
                      confirm,
                    ],
                  ),
                );
              },
            ),
            Expanded(
              child: assets.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, stackTrace) => Center(
                  child: OutlinedButton.icon(
                    onPressed: () => ref
                        .read(assetCenterControllerProvider.notifier)
                        .refresh(),
                    icon: const Icon(Icons.refresh),
                    label: const Text('素材加载失败，点击重试'),
                  ),
                ),
                data: (state) => Column(
                  children: [
                    AssetGroupFilterStrip(
                      state: state,
                      onSelected: (groupId) => ref
                          .read(assetCenterControllerProvider.notifier)
                          .selectGroup(groupId),
                    ),
                    Expanded(
                      child: state.items.isEmpty
                          ? _AssetPickerEmpty(
                              filtered: state.selectedGroup != assetGroupAll,
                            )
                          : GridView.builder(
                              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                              gridDelegate:
                                  const SliverGridDelegateWithMaxCrossAxisExtent(
                                    maxCrossAxisExtent: 170,
                                    crossAxisSpacing: 10,
                                    mainAxisSpacing: 10,
                                    childAspectRatio: 0.84,
                                  ),
                              itemCount: state.items.length,
                              itemBuilder: (context, index) {
                                final asset = state.items[index];
                                final selected = _selected.containsKey(
                                  asset.id,
                                );
                                final unavailable =
                                    asset.inputKey == null ||
                                    widget.existingKeys.contains(
                                      asset.inputKey,
                                    );
                                return Material(
                                  color: selected
                                      ? Theme.of(
                                          context,
                                        ).colorScheme.primaryContainer
                                      : Theme.of(
                                          context,
                                        ).colorScheme.surfaceContainerLow,
                                  borderRadius: BorderRadius.circular(18),
                                  clipBehavior: Clip.antiAlias,
                                  child: InkWell(
                                    key: Key('asset-picker-${asset.id}'),
                                    onTap: unavailable
                                        ? null
                                        : () => _toggle(asset),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Expanded(
                                          child: Stack(
                                            fit: StackFit.expand,
                                            children: [
                                              AuthenticatedImage(
                                                url: asset.thumbnailUrl,
                                              ),
                                              if (selected)
                                                Positioned(
                                                  right: 7,
                                                  top: 7,
                                                  child: CircleAvatar(
                                                    radius: 13,
                                                    backgroundColor: Theme.of(
                                                      context,
                                                    ).colorScheme.primary,
                                                    foregroundColor: Theme.of(
                                                      context,
                                                    ).colorScheme.onPrimary,
                                                    child: const Icon(
                                                      Icons.check,
                                                      size: 17,
                                                    ),
                                                  ),
                                                ),
                                              if (unavailable)
                                                ColoredBox(
                                                  color: Colors.black45,
                                                  child: Center(
                                                    child: Text(
                                                      widget.existingKeys
                                                              .contains(
                                                                asset.inputKey,
                                                              )
                                                          ? '已添加'
                                                          : '不可用',
                                                      style: const TextStyle(
                                                        color: Colors.white,
                                                        fontWeight:
                                                            FontWeight.w800,
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                            ],
                                          ),
                                        ),
                                        Padding(
                                          padding: const EdgeInsets.all(9),
                                          child: Text(
                                            asset.title,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              fontWeight: FontWeight.w800,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                    if (state.hasMore || state.isLoadingMore)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                        child: SizedBox(
                          width: double.infinity,
                          child: OutlinedButton.icon(
                            onPressed: state.isLoadingMore ? null : _loadMore,
                            icon: state.isLoadingMore
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.expand_more),
                            label: Text(state.isLoadingMore ? '正在加载' : '加载更多'),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AssetPickerEmpty extends StatelessWidget {
  const _AssetPickerEmpty({required this.filtered});

  final bool filtered;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            filtered
                ? Icons.filter_alt_off_outlined
                : Icons.collections_outlined,
            size: 42,
            color: Theme.of(context).colorScheme.outline,
          ),
          const SizedBox(height: 12),
          Text(
            filtered ? '这个分组还没有素材' : '素材库还是空的',
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 5),
          Text(
            filtered ? '切换到其他分组继续查找' : '上传的个人素材会显示在这里',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    ),
  );
}

class AssetDetailSheet extends StatelessWidget {
  const AssetDetailSheet({
    required this.asset,
    required this.groupName,
    required this.busy,
    required this.onRename,
    required this.onMove,
    required this.onDelete,
    super.key,
  });

  final UserAsset asset;
  final String? groupName;
  final bool busy;
  final VoidCallback onRename;
  final VoidCallback onMove;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: AspectRatio(
              aspectRatio: 1,
              child: ColoredBox(
                color: Colors.black,
                child: AuthenticatedImage(url: asset.url, fit: BoxFit.contain),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            asset.title,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 7,
            children: [
              Chip(
                avatar: const Icon(Icons.folder_outlined, size: 16),
                label: Text(groupName ?? '未分组'),
              ),
              Chip(label: Text(formatAssetSize(asset.sizeBytes))),
              if (asset.createdAt != null)
                Chip(
                  label: Text(DateFormat('yyyy年M月d日').format(asset.createdAt!)),
                ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              IconButton.filledTonal(
                tooltip: '重命名',
                onPressed: busy ? null : onRename,
                icon: const Icon(Icons.edit_outlined),
              ),
              const SizedBox(width: 8),
              IconButton.filledTonal(
                tooltip: '移动分组',
                onPressed: busy ? null : onMove,
                icon: const Icon(Icons.drive_file_move_outlined),
              ),
              const Spacer(),
              IconButton.filledTonal(
                tooltip: '删除素材',
                onPressed: busy ? null : onDelete,
                style: IconButton.styleFrom(
                  foregroundColor: Theme.of(context).colorScheme.error,
                ),
                icon: const Icon(Icons.delete_outline),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}

class AssetUploadSheet extends StatefulWidget {
  const AssetUploadSheet({
    required this.image,
    required this.groups,
    required this.initialGroupId,
    required this.onSubmit,
    super.key,
  });

  final ReferenceImageDraft image;
  final List<UserAssetGroup> groups;
  final String? initialGroupId;
  final Future<UserAsset> Function({
    required ReferenceImageDraft image,
    required String title,
    String? groupId,
  })
  onSubmit;

  @override
  State<AssetUploadSheet> createState() => _AssetUploadSheetState();
}

class _AssetUploadSheetState extends State<AssetUploadSheet> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _titleController = TextEditingController(
    text: widget.image.filename.replaceFirst(RegExp(r'\.[^.]+$'), ''),
  );
  late String? _groupId = widget.initialGroupId;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final asset = await widget.onSubmit(
        image: widget.image,
        title: _titleController.text,
        groupId: _groupId,
      );
      if (mounted) Navigator.pop(context, asset);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = error is ApiException
            ? error.message
            : error is FormatException
            ? error.message
            : '素材上传失败，请稍后重试';
      });
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        20,
        0,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '保存到素材库',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 14),
            ClipRRect(
              borderRadius: BorderRadius.circular(18),
              child: AspectRatio(
                aspectRatio: 16 / 9,
                child:
                    widget.image.localPath.isNotEmpty &&
                        File(widget.image.localPath).existsSync()
                    ? Image.file(
                        File(widget.image.localPath),
                        fit: BoxFit.cover,
                      )
                    : ColoredBox(
                        color: Theme.of(
                          context,
                        ).colorScheme.surfaceContainerHighest,
                        child: const Icon(Icons.image_outlined, size: 38),
                      ),
              ),
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: '素材名称',
                prefixIcon: Icon(Icons.title),
              ),
              maxLength: 120,
              validator: validateAssetTitle,
            ),
            const SizedBox(height: 10),
            AppSelectField<String?>(
              label: '所属分组',
              prefixIcon: Icons.folder_outlined,
              value: _groupId,
              enabled: !_submitting,
              options: [
                const AppSelectOption<String?>(value: null, label: '未分组'),
                for (final group in widget.groups)
                  AppSelectOption<String?>(value: group.id, label: group.name),
              ],
              onChanged: (value) => setState(() => _groupId = value),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.cloud_upload_outlined),
              label: Text(_submitting ? '正在上传' : '上传并保存'),
            ),
          ],
        ),
      ),
    ),
  );
}

class AssetNameDialog extends StatefulWidget {
  const AssetNameDialog({
    required this.title,
    required this.label,
    required this.validator,
    this.initialValue = '',
    super.key,
  });

  final String title;
  final String label;
  final String initialValue;
  final String? Function(String?) validator;

  @override
  State<AssetNameDialog> createState() => _AssetNameDialogState();
}

class _AssetNameDialogState extends State<AssetNameDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _controller = TextEditingController(
    text: widget.initialValue,
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    if (_formKey.currentState!.validate()) {
      Navigator.pop(context, _controller.text.trim());
    }
  }

  @override
  Widget build(BuildContext context) => AppDialog(
    title: Text(widget.title),
    content: Form(
      key: _formKey,
      child: TextFormField(
        controller: _controller,
        autofocus: true,
        decoration: InputDecoration(labelText: widget.label),
        validator: widget.validator,
        onFieldSubmitted: (_) => _submit(),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('取消'),
      ),
      FilledButton(onPressed: _submit, child: const Text('保存')),
    ],
  );
}

class AssetGroupsSheet extends StatelessWidget {
  const AssetGroupsSheet({
    required this.groups,
    required this.onCreate,
    required this.onRename,
    required this.onDelete,
    super.key,
  });

  final List<UserAssetGroup> groups;
  final VoidCallback onCreate;
  final ValueChanged<UserAssetGroup> onRename;
  final ValueChanged<UserAssetGroup> onDelete;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.create_new_folder_outlined),
            title: const Text('新建分组'),
            onTap: onCreate,
          ),
          if (groups.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Text('还没有自定义分组'),
            )
          else
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 420),
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: groups.length,
                itemBuilder: (context, index) {
                  final group = groups[index];
                  return ListTile(
                    leading: const Icon(Icons.folder_outlined),
                    title: Text(group.name),
                    subtitle: Text('${group.assetCount} 项素材'),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          tooltip: '重命名 ${group.name}',
                          onPressed: () => onRename(group),
                          icon: const Icon(Icons.edit_outlined),
                        ),
                        IconButton(
                          tooltip: '删除 ${group.name}',
                          onPressed: () => onDelete(group),
                          icon: const Icon(Icons.delete_outline),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    ),
  );
}

class AssetGroupPickerSheet extends StatelessWidget {
  const AssetGroupPickerSheet({
    required this.groups,
    required this.selectedGroupId,
    super.key,
  });

  final List<UserAssetGroup> groups;
  final String? selectedGroupId;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ListTile(
          leading: const Icon(Icons.folder_off_outlined),
          title: const Text('未分组'),
          trailing: selectedGroupId == null ? const Icon(Icons.check) : null,
          onTap: () => Navigator.pop(context, assetGroupUngrouped),
        ),
        for (final group in groups)
          ListTile(
            leading: const Icon(Icons.folder_outlined),
            title: Text(group.name),
            trailing: selectedGroupId == group.id
                ? const Icon(Icons.check)
                : null,
            onTap: () => Navigator.pop(context, group.id),
          ),
        const SizedBox(height: 10),
      ],
    ),
  );
}

class _AssetsEmpty extends StatelessWidget {
  const _AssetsEmpty({required this.filtered, required this.onUpload});

  final bool filtered;
  final VoidCallback onUpload;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(30),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.collections_outlined, size: 46),
          const SizedBox(height: 12),
          Text(filtered ? '这个分组还没有素材' : '素材库还是空的'),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: onUpload,
            icon: const Icon(Icons.add_photo_alternate_outlined),
            label: const Text('添加第一项素材'),
          ),
        ],
      ),
    ),
  );
}

class _AssetsError extends StatelessWidget {
  const _AssetsError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: OutlinedButton.icon(
      onPressed: onRetry,
      icon: const Icon(Icons.refresh),
      label: const Text('素材库加载失败，点击重试'),
    ),
  );
}

String formatAssetSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

enum _AssetImageSource { gallery, camera }
