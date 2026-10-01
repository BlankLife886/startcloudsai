import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_refresh.dart';
import '../../core/widgets/app_top_bar.dart';
import '../auth/auth.dart';
import '../gallery/gallery.dart';
import 'discover.dart';
import '../../app/starclouds_theme.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_visual.dart';

enum HomeDiscoverTab {
  home,
  prompts,
  community;

  String get queryName => switch (this) {
    HomeDiscoverTab.home => '',
    HomeDiscoverTab.prompts => 'prompts',
    HomeDiscoverTab.community => 'community',
  };

  static HomeDiscoverTab fromQuery(String? value) => switch (value) {
    'prompts' => HomeDiscoverTab.prompts,
    'community' => HomeDiscoverTab.community,
    _ => HomeDiscoverTab.home,
  };
}

class DiscoverScreen extends ConsumerStatefulWidget {
  const DiscoverScreen({
    super.key,
    this.searchDebounce = const Duration(milliseconds: 350),
    this.communityOnly = false,
    this.promptLibraryOnly = false,
    this.initialTab = HomeDiscoverTab.home,
    this.initialFavoritesOnly = false,
  });

  final Duration searchDebounce;
  final bool communityOnly;
  final bool promptLibraryOnly;
  final HomeDiscoverTab initialTab;
  final bool initialFavoritesOnly;

  @override
  ConsumerState<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends ConsumerState<DiscoverScreen>
    with SingleTickerProviderStateMixin {
  static const _loadMoreExtent = 360.0;
  static const _masonryCacheExtent = 480.0;

  final _searchController = TextEditingController();
  final _promptScrollController = ScrollController();
  final _galleryScrollController = ScrollController();
  Timer? _searchTimer;
  late final TabController _tabs;
  var _applyingRouteTab = false;
  late final Set<int> _openedTabs;
  String _search = '';
  String? _promptCategory;
  String? _galleryCategory;
  late bool _favoritesOnly;
  PromptQuery? _promptPaginationQuery;
  GalleryQuery? _galleryPaginationQuery;
  List<PromptItem> _morePrompts = const [];
  List<GalleryItem> _moreGallery = const [];
  String? _promptCursor;
  String? _galleryCursor;
  bool _loadingMorePrompts = false;
  bool _loadingMoreGallery = false;
  bool _promptLoadMoreFailed = false;
  bool _galleryLoadMoreFailed = false;
  final Set<String> _blockedGalleryAuthors = {};

  HomeDiscoverTab get _activeTab {
    if (widget.promptLibraryOnly) return HomeDiscoverTab.prompts;
    if (widget.communityOnly) return HomeDiscoverTab.community;
    return HomeDiscoverTab.values[_tabs.index];
  }

  PromptQuery _homePromptQuery() => const PromptQuery(sort: 'latest', limit: 6);

  PromptQuery _libraryPromptQuery(bool authenticated) => PromptQuery(
    search: _search,
    category: _promptCategory,
    favoritesOnly: authenticated && _favoritesOnly,
  );

  GalleryQuery get _galleryQuery => GalleryQuery(category: _galleryCategory);

  void _resetPromptPaginationState() {
    _promptPaginationQuery = null;
    _morePrompts = const [];
    _promptCursor = null;
    _loadingMorePrompts = false;
    _promptLoadMoreFailed = false;
  }

  void _resetGalleryPaginationState() {
    _galleryPaginationQuery = null;
    _moreGallery = const [];
    _galleryCursor = null;
    _loadingMoreGallery = false;
    _galleryLoadMoreFailed = false;
  }

  @override
  void initState() {
    super.initState();
    _tabs = TabController(
      length: HomeDiscoverTab.values.length,
      vsync: this,
      initialIndex: widget.initialTab.index,
    );
    _favoritesOnly = widget.initialFavoritesOnly;
    _openedTabs = {widget.initialTab.index};
    _tabs.addListener(_onTabChanged);
    _promptScrollController.addListener(_onPromptScroll);
    _galleryScrollController.addListener(_onGalleryScroll);
  }

  @override
  void didUpdateWidget(covariant DiscoverScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialFavoritesOnly != widget.initialFavoritesOnly) {
      setState(() {
        _favoritesOnly = widget.initialFavoritesOnly;
        if (_favoritesOnly) _promptCategory = null;
        _resetPromptPaginationState();
      });
    }
    if (_applyingRouteTab || oldWidget.initialTab == widget.initialTab) {
      return;
    }
    if (_tabs.index != widget.initialTab.index) {
      final opened = _openedTabs.add(widget.initialTab.index);
      _tabs.index = widget.initialTab.index;
      if (opened) setState(() {});
    }
  }

  @override
  void dispose() {
    _tabs.removeListener(_onTabChanged);
    _promptScrollController.removeListener(_onPromptScroll);
    _galleryScrollController.removeListener(_onGalleryScroll);
    _tabs.dispose();
    _promptScrollController.dispose();
    _galleryScrollController.dispose();
    _searchTimer?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onTabChanged() {
    if (!mounted) return;
    final opened = _openedTabs.add(_tabs.index);
    if (opened) setState(() {});
    if (_tabs.indexIsChanging) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _syncDiscoverTabRoute();
      _fillVisibleTab();
    });
  }

  void _selectHomeTab(HomeDiscoverTab tab) {
    if (_tabs.index == tab.index) return;
    HapticFeedback.selectionClick();
    if (_openedTabs.add(tab.index)) setState(() {});
    final reduce = MediaQuery.disableAnimationsOf(context);
    if (reduce) {
      _tabs.index = tab.index;
    } else {
      _tabs.animateTo(tab.index);
    }
  }

  void _syncDiscoverTabRoute() {
    if (widget.promptLibraryOnly || widget.communityOnly) return;
    final router = GoRouter.maybeOf(context);
    if (router == null) return;
    final uri = GoRouterState.of(context).uri;
    if (uri.path != '/discover') return;
    final tab = HomeDiscoverTab.values[_tabs.index];
    if (HomeDiscoverTab.fromQuery(uri.queryParameters['tab']) == tab) return;
    _applyingRouteTab = true;
    router.go(
      tab == HomeDiscoverTab.home
          ? '/discover'
          : '/discover?tab=${tab.queryName}',
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _applyingRouteTab = false;
    });
  }

  void _fillVisibleTab() {
    if (_activeTab == HomeDiscoverTab.prompts) {
      _onPromptScroll();
    } else if (_activeTab == HomeDiscoverTab.community) {
      _onGalleryScroll();
    }
  }

  void _onSearchChanged(String value) {
    _searchTimer?.cancel();
    _searchTimer = Timer(widget.searchDebounce, () {
      final normalized = value.trim();
      if (mounted && normalized != _search) {
        setState(() {
          _search = normalized;
          _resetPromptPaginationState();
        });
      }
    });
    setState(() {});
  }

  void _submitSearch(String value) {
    _searchTimer?.cancel();
    final normalized = value.trim();
    if (normalized != _search) {
      setState(() {
        _search = normalized;
        _resetPromptPaginationState();
      });
    }
  }

  void _clearSearch() {
    _searchTimer?.cancel();
    _searchController.clear();
    if (_search.isNotEmpty) {
      setState(() {
        _search = '';
        _resetPromptPaginationState();
      });
    }
  }

  void _resetPromptFilters() {
    _searchTimer?.cancel();
    _searchController.clear();
    setState(() {
      _search = '';
      _promptCategory = null;
      _favoritesOnly = false;
      _resetPromptPaginationState();
    });
  }

  void _selectPromptCategory(String? category) {
    setState(() {
      _promptCategory = category;
      _favoritesOnly = false;
      _resetPromptPaginationState();
    });
  }

  void _selectPromptFavorites(bool enabled) {
    setState(() {
      _favoritesOnly = enabled;
      if (enabled) _promptCategory = null;
      _resetPromptPaginationState();
    });
  }

  Future<void> _refresh() async {
    if (_activeTab == HomeDiscoverTab.prompts) {
      final authenticated =
          ref.read(sessionControllerProvider).valueOrNull?.isAuthenticated ==
          true;
      final query = _libraryPromptQuery(authenticated);
      setState(_resetPromptPaginationState);
      ref.invalidate(discoverPromptCategoriesProvider);
      ref.invalidate(
        discoverPromptPageRequestProvider(PromptPageRequest(query: query)),
      );
      ref.invalidate(discoverPromptPageProvider(query));
      await Future.wait([
        ref.read(discoverPromptCategoriesProvider.future),
        ref.read(discoverPromptPageProvider(query).future),
      ]);
      return;
    }
    if (_activeTab == HomeDiscoverTab.community) {
      final galleryQuery = _galleryQuery;
      setState(_resetGalleryPaginationState);
      ref.invalidate(galleryCategoriesProvider);
      ref.invalidate(
        discoverGalleryPageRequestProvider(
          GalleryPageRequest(query: galleryQuery),
        ),
      );
      ref.invalidate(discoverGalleryPageProvider(galleryQuery));
      await Future.wait([
        ref.read(galleryCategoriesProvider.future),
        ref.read(discoverGalleryPageProvider(galleryQuery).future),
      ]);
      return;
    }
    final query = _homePromptQuery();
    setState(_resetPromptPaginationState);
    ref.invalidate(
      discoverPromptPageRequestProvider(PromptPageRequest(query: query)),
    );
    ref.invalidate(discoverPromptPageProvider(query));
    await ref.read(discoverPromptPageProvider(query).future);
  }

  List<PromptItem> _promptItemsFor(PromptPage firstPage, PromptQuery query) {
    if (_promptPaginationQuery != query) return firstPage.items;
    final seen = <String>{};
    return [
      ...firstPage.items,
      ..._morePrompts,
    ].where((item) => seen.add(item.id)).toList();
  }

  List<GalleryItem> _galleryItemsFor(
    GalleryPage firstPage,
    GalleryQuery query,
  ) {
    final seen = <String>{};
    final items = _galleryPaginationQuery != query
        ? firstPage.items
        : [...firstPage.items, ..._moreGallery];
    return items
        .where((item) => !_blockedGalleryAuthors.contains(item.authorId))
        .where((item) => seen.add(item.id))
        .toList();
  }

  String? _nextPromptCursor(PromptPage firstPage, PromptQuery query) =>
      _promptPaginationQuery == query ? _promptCursor : firstPage.nextCursor;

  String? _nextGalleryCursor(GalleryPage firstPage, GalleryQuery query) =>
      _galleryPaginationQuery == query ? _galleryCursor : firstPage.nextCursor;

  bool _shouldLoadMore(ScrollController controller) {
    if (!controller.hasClients) return false;
    final position = controller.position;
    if (position.pixels < 0) return false;
    return position.maxScrollExtent <= 0 ||
        position.extentAfter <= _loadMoreExtent;
  }

  void _revealScrollExtent(ScrollController controller) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !controller.hasClients) return;
      final position = controller.position;
      if (position.extentAfter <= 8) return;
      if (MediaQuery.disableAnimationsOf(context)) {
        position.jumpTo(position.maxScrollExtent);
        return;
      }
      unawaited(
        position.animateTo(
          position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
        ),
      );
    });
  }

  void _onPromptScroll() {
    if (_activeTab != HomeDiscoverTab.prompts) return;
    final authenticated =
        ref.read(sessionControllerProvider).valueOrNull?.isAuthenticated ==
        true;
    final query = _libraryPromptQuery(authenticated);
    final page = ref.read(discoverPromptPageProvider(query)).asData?.value;
    if (page != null) _maybeLoadMorePrompts(page, query);
  }

  void _onGalleryScroll() {
    if (_activeTab != HomeDiscoverTab.community) return;
    final query = _galleryQuery;
    final page = ref.read(discoverGalleryPageProvider(query)).asData?.value;
    if (page != null) _maybeLoadMoreGallery(page, query);
  }

  void _scheduleFillPrompts(PromptPage page, PromptQuery query) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _maybeLoadMorePrompts(page, query);
    });
  }

  void _scheduleFillGallery(GalleryPage page, GalleryQuery query) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _maybeLoadMoreGallery(page, query);
    });
  }

  void _maybeLoadMorePrompts(PromptPage firstPage, PromptQuery query) {
    if (_activeTab != HomeDiscoverTab.prompts) return;
    if (_loadingMorePrompts || _promptLoadMoreFailed) return;
    if (_nextPromptCursor(firstPage, query) == null) return;
    if (!_shouldLoadMore(_promptScrollController)) return;
    unawaited(_loadMorePrompts(firstPage, query));
  }

  void _maybeLoadMoreGallery(GalleryPage firstPage, GalleryQuery query) {
    if (_activeTab != HomeDiscoverTab.community) return;
    if (_loadingMoreGallery || _galleryLoadMoreFailed) return;
    if (_nextGalleryCursor(firstPage, query) == null) return;
    if (!_shouldLoadMore(_galleryScrollController)) return;
    unawaited(_loadMoreGallery(firstPage, query));
  }

  Future<void> _loadMorePrompts(PromptPage firstPage, PromptQuery query) async {
    if (_loadingMorePrompts) return;
    final cursor = _nextPromptCursor(firstPage, query);
    if (cursor == null) return;
    setState(() {
      if (_promptPaginationQuery != query) {
        _resetPromptPaginationState();
      }
      _promptPaginationQuery = query;
      _promptCursor = cursor;
      _loadingMorePrompts = true;
      _promptLoadMoreFailed = false;
    });
    final request = PromptPageRequest(query: query, cursor: cursor);
    try {
      ref.invalidate(discoverPromptPageRequestProvider(request));
      final page = await ref.read(
        discoverPromptPageRequestProvider(request).future,
      );
      if (!mounted || _promptPaginationQuery != query) return;
      final knownIds = {
        ...firstPage.items.map((item) => item.id),
        ..._morePrompts.map((item) => item.id),
      };
      setState(() {
        _morePrompts = [
          ..._morePrompts,
          ...page.items.where((item) => knownIds.add(item.id)),
        ];
        _promptCursor = page.nextCursor;
        _loadingMorePrompts = false;
      });
    } catch (_) {
      if (!mounted || _promptPaginationQuery != query) return;
      setState(() {
        _loadingMorePrompts = false;
        _promptLoadMoreFailed = true;
      });
      _revealScrollExtent(_promptScrollController);
    }
  }

  Future<void> _loadMoreGallery(
    GalleryPage firstPage,
    GalleryQuery query,
  ) async {
    if (_loadingMoreGallery) return;
    final cursor = _nextGalleryCursor(firstPage, query);
    if (cursor == null) return;
    setState(() {
      if (_galleryPaginationQuery != query) {
        _resetGalleryPaginationState();
      }
      _galleryPaginationQuery = query;
      _galleryCursor = cursor;
      _loadingMoreGallery = true;
      _galleryLoadMoreFailed = false;
    });
    final request = GalleryPageRequest(query: query, cursor: cursor);
    try {
      ref.invalidate(discoverGalleryPageRequestProvider(request));
      final page = await ref.read(
        discoverGalleryPageRequestProvider(request).future,
      );
      if (!mounted || _galleryPaginationQuery != query) return;
      final knownIds = {
        ...firstPage.items.map((item) => item.id),
        ..._moreGallery.map((item) => item.id),
      };
      setState(() {
        _moreGallery = [
          ..._moreGallery,
          ...page.items.where((item) => knownIds.add(item.id)),
        ];
        _galleryCursor = page.nextCursor;
        _loadingMoreGallery = false;
      });
    } catch (_) {
      if (!mounted || _galleryPaginationQuery != query) return;
      setState(() {
        _loadingMoreGallery = false;
        _galleryLoadMoreFailed = true;
      });
      _revealScrollExtent(_galleryScrollController);
    }
  }

  void _updateExtraPrompt(
    PromptQuery query,
    String promptId,
    PromptEngagement engagement,
  ) {
    if (!mounted || _promptPaginationQuery != query) return;
    setState(() {
      _morePrompts = _morePrompts
          .map(
            (item) => item.id != promptId
                ? item
                : item.copyWith(
                    likeCount: engagement.likeCount,
                    favoriteCount: engagement.favoriteCount,
                    useCount: engagement.useCount,
                    liked: engagement.action == 'like'
                        ? engagement.active
                        : item.liked,
                    favorited: engagement.action == 'favorite'
                        ? engagement.active
                        : item.favorited,
                  ),
          )
          .toList();
    });
  }

  Future<void> _openPrompt(
    PromptItem item, {
    required bool authenticated,
    required PromptQuery query,
  }) async {
    final imageUrl = ref
        .read(apiClientProvider)
        .resolveUrl(item.coverUrl ?? '');
    await showAppSheet<void>(
      context: context,
      isScrollControlled: true,
      showCloseButton: false,
      builder: (sheetContext) => PromptDetailSheet(
        item: item,
        imageUrl: imageUrl,
        authenticated: authenticated,
        onEngage: (action, active) async {
          final result = await ref
              .read(discoverRepositoryProvider)
              .recordPromptEngagement(item.id, action, active: active);
          _updateExtraPrompt(query, item.id, result);
          ref.invalidate(
            discoverPromptPageRequestProvider(PromptPageRequest(query: query)),
          );
          ref.invalidate(discoverPromptPageProvider(query));
          ref.invalidate(discoverFeedProvider);
          return result;
        },
        onUse: () {
          Navigator.of(sheetContext).pop();
          if (authenticated) unawaited(_recordPromptUse(item, query));
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            context.push(
              '/create?prompt=${Uri.encodeQueryComponent(item.prompt)}',
            );
          });
        },
        onLogin: () {
          Navigator.of(sheetContext).pop();
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) context.push('/login');
          });
        },
      ),
    );
  }

  Future<void> _recordPromptUse(PromptItem item, PromptQuery query) async {
    try {
      final result = await ref
          .read(discoverRepositoryProvider)
          .recordPromptEngagement(item.id, 'use');
      _updateExtraPrompt(query, item.id, result);
      ref.invalidate(
        discoverPromptPageRequestProvider(PromptPageRequest(query: query)),
      );
      ref.invalidate(discoverPromptPageProvider(query));
      ref.invalidate(discoverFeedProvider);
    } catch (_) {
      // Usage telemetry must not block the creation workflow.
    }
  }

  Future<void> _openGallery(GalleryItem item) async {
    final apiClient = ref.read(apiClientProvider);
    final session = ref.read(sessionControllerProvider).valueOrNull;
    final authenticated = session?.isAuthenticated == true;
    final imageUrls = item.previewUrls
        .map(apiClient.resolveUrl)
        .where((url) => url.isNotEmpty)
        .toList();
    await showAppSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => GalleryDetailSheet(
        item: item,
        imageUrls: imageUrls,
        authenticated: authenticated,
        currentUserId: session?.user?.id,
        onLogin: () {
          Navigator.of(sheetContext).pop();
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) context.push('/login');
          });
        },
        onReport: (reason, detail) async {
          await ref
              .read(discoverRepositoryProvider)
              .reportGallerySubmission(item.id, reason: reason, detail: detail);
          if (mounted) AppNotice.success(context, '举报已提交，我们会尽快处理');
        },
        onBlock: () async {
          await ref
              .read(discoverRepositoryProvider)
              .blockGalleryAuthor(item.authorId);
          if (!mounted) return;
          setState(() {
            _blockedGalleryAuthors.add(item.authorId);
            _moreGallery = _moreGallery
                .where((entry) => entry.authorId != item.authorId)
                .toList();
          });
          ref.invalidate(discoverGalleryPageProvider(_galleryQuery));
          ref.invalidate(discoverFeedProvider);
          AppNotice.success(context, '已屏蔽 ${item.authorName}');
        },
        onBlocked: () => Navigator.of(sheetContext).pop(),
      ),
    );
  }

  List<Widget> _buildHomePromptPage(
    PromptPage page,
    PromptQuery query, {
    required bool authenticated,
  }) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final items = _promptItemsFor(page, query).take(query.limit).toList();
    if (items.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: _PromptEmpty(
            filtered: false,
            onReset: _resetPromptFilters,
            inverted: dark,
          ),
        ),
      ];
    }
    return [
      SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        sliver: SliverList.builder(
          itemCount: items.length,
          itemBuilder: (context, index) => RepaintBoundary(
            child: _HomePromptRow(
              key: Key('home-prompt-${items[index].id}'),
              item: items[index],
              onOpen: () => _openPrompt(
                items[index],
                authenticated: authenticated,
                query: query,
              ),
            ),
          ),
        ),
      ),
    ];
  }

  List<Widget> _buildPromptLibraryPage(
    PromptPage page,
    PromptQuery query, {
    required bool authenticated,
  }) {
    final items = _promptItemsFor(page, query);
    if (items.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: _PromptEmpty(
            filtered:
                _search.isNotEmpty ||
                _promptCategory != null ||
                query.favoritesOnly,
            onReset: _resetPromptFilters,
          ),
        ),
      ];
    }
    final hasMore = _nextPromptCursor(page, query) != null;
    if (hasMore && !_loadingMorePrompts && !_promptLoadMoreFailed) {
      _scheduleFillPrompts(page, query);
    }
    return [
      SliverPadding(
        key: const Key('prompt-library-masonry'),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
        sliver: SliverMasonryGrid.count(
          crossAxisCount: 2,
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childCount: items.length,
          itemBuilder: (context, index) => RepaintBoundary(
            child: _PromptMasonryCard(
              item: items[index],
              onOpen: () => _openPrompt(
                items[index],
                authenticated: authenticated,
                query: query,
              ),
            ),
          ),
        ),
      ),
      if (hasMore || _loadingMorePrompts || _promptLoadMoreFailed)
        SliverToBoxAdapter(
          child: _LoadMoreBand(
            key: const Key('load-more-prompts'),
            loading: _loadingMorePrompts,
            failed: _promptLoadMoreFailed,
            noun: '提示词',
            onPressed: () => _loadMorePrompts(page, query),
          ),
        )
      else
        const SliverToBoxAdapter(child: SizedBox(height: 24)),
    ];
  }

  List<Widget> _buildGalleryPage(GalleryPage page, GalleryQuery query) {
    final items = _galleryItemsFor(page, query);
    if (items.isEmpty) {
      return const [
        SliverToBoxAdapter(child: _SectionEmpty(message: '这个分类暂时没有公开作品')),
      ];
    }
    final hasMore = _nextGalleryCursor(page, query) != null;

    if (hasMore && !_loadingMoreGallery && !_galleryLoadMoreFailed) {
      _scheduleFillGallery(page, query);
    }
    return [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(14, 4, 14, 12),
        sliver: SliverMasonryGrid.count(
          crossAxisCount: 2,
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childCount: items.length,
          itemBuilder: (context, index) => RepaintBoundary(
            child: _GalleryCard(
              item: items[index],
              onOpen: () => _openGallery(items[index]),
              overlay: true,
            ),
          ),
        ),
      ),
      if (hasMore || _loadingMoreGallery || _galleryLoadMoreFailed)
        SliverToBoxAdapter(
          child: _LoadMoreBand(
            key: const Key('load-more-gallery'),
            loading: _loadingMoreGallery,
            failed: _galleryLoadMoreFailed,
            onPressed: () => _loadMoreGallery(page, query),
          ),
        )
      else
        const SliverToBoxAdapter(child: SizedBox(height: 24)),
    ];
  }

  @override
  Widget build(BuildContext context) {
    if (widget.promptLibraryOnly) return _buildPromptLibraryScreen();
    if (widget.communityOnly) return _buildCommunityScreen();
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: colors.surface,
      body: Column(
        children: [
          ColoredBox(
            color: colors.surface,
            child: SafeArea(
              bottom: false,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
                    child: Row(
                      children: [
                        Image.asset(
                          'assets/brand/brand_mark.png',
                          width: 28,
                          cacheWidth: 84,
                          height: 28,
                          excludeFromSemantics: true,
                        ),
                        const SizedBox(width: 10),
                        Text(
                          '星空云绘',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                      ],
                    ),
                  ),
                  _HomeTabBar(controller: _tabs, onSelected: _selectHomeTab),
                ],
              ),
            ),
          ),
          Expanded(
            child: _DiscoverTabViewport(
              controller: _tabs,
              children: [
                _openedTabs.contains(HomeDiscoverTab.home.index)
                    ? _buildHomeBody()
                    : const SizedBox.shrink(),
                _openedTabs.contains(HomeDiscoverTab.prompts.index)
                    ? _buildPromptLibraryBody()
                    : const SizedBox.shrink(),
                _openedTabs.contains(HomeDiscoverTab.community.index)
                    ? _buildCommunityBody()
                    : const SizedBox.shrink(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHomeBody() {
    final authenticated =
        ref.watch(sessionControllerProvider).valueOrNull?.isAuthenticated ==
        true;
    final query = _homePromptQuery();
    final prompts = ref.watch(discoverPromptPageProvider(query));
    return CustomScrollView(
      key: const PageStorageKey('home-scroll'),
      physics: appRefreshScrollPhysics,
      cacheExtent: 160,
      slivers: [
        AppSliverRefresh(onRefresh: _refresh),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
          sliver: SliverToBoxAdapter(
            child: HomePrimaryActions(
              onCreate: () => context.push('/create'),
              onCreateWithPrompt: (prompt) => context.push(
                Uri(
                  path: '/create',
                  queryParameters: {'prompt': prompt},
                ).toString(),
              ),
              onAssistant: () => context.go('/ai'),
            ),
          ),
        ),
        _SectionHeader(
          title: '灵感精选',
          action: '全部',
          onAction: () => _selectHomeTab(HomeDiscoverTab.prompts),
        ),
        ...prompts.when(
          loading: () => const [
            SliverToBoxAdapter(child: _HomePromptSkeleton()),
          ],
          error: (error, stackTrace) => [
            SliverToBoxAdapter(
              child: _InlineError(
                message: '创作灵感加载失败',
                onRetry: () {
                  ref.invalidate(
                    discoverPromptPageRequestProvider(
                      PromptPageRequest(query: query),
                    ),
                  );
                  ref.invalidate(discoverPromptPageProvider(query));
                },
              ),
            ),
          ],
          data: (page) =>
              _buildHomePromptPage(page, query, authenticated: authenticated),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            child: Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: const Key('home-community-action'),
                onPressed: () => _selectHomeTab(HomeDiscoverTab.community),
                icon: const Icon(Icons.public_outlined, size: 18),
                label: const Text('浏览社区作品'),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPromptLibraryScreen() {
    return Scaffold(
      appBar: const AppTopBar(
        title: Text('全部提示词'),
        fallbackLocation: '/discover',
      ),
      body: _buildPromptLibraryBody(),
    );
  }

  Widget _buildPromptLibraryBody() {
    final session = ref.watch(sessionControllerProvider);
    final authenticated = session.valueOrNull?.isAuthenticated == true;
    final query = _libraryPromptQuery(authenticated);
    final prompts = ref.watch(discoverPromptPageProvider(query));
    final categories = ref.watch(discoverPromptCategoriesProvider);
    final colors = Theme.of(context).colorScheme;
    return CustomScrollView(
      controller: _promptScrollController,
      cacheExtent: _masonryCacheExtent,
      physics: appRefreshScrollPhysics,
      slivers: [
        AppSliverRefresh(onRefresh: _refresh),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
          sliver: SliverToBoxAdapter(
            child: SearchBar(
              controller: _searchController,
              hintText: '搜索提示词',
              leading: Icon(
                Icons.search_rounded,
                color: colors.onSurfaceVariant,
              ),
              elevation: const WidgetStatePropertyAll(0),
              backgroundColor: WidgetStatePropertyAll(
                colors.surfaceContainerLow,
              ),
              side: const WidgetStatePropertyAll(BorderSide.none),
              shape: WidgetStatePropertyAll(
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              constraints: const BoxConstraints(minHeight: 48, maxHeight: 48),
              trailing: [
                if (_searchController.text.isNotEmpty)
                  IconButton(
                    key: const Key('clear-prompt-search'),
                    tooltip: '清除搜索',
                    onPressed: _clearSearch,
                    icon: const Icon(Icons.close),
                  ),
              ],
              onChanged: _onSearchChanged,
              onSubmitted: _submitSearch,
              textInputAction: TextInputAction.search,
            ),
          ),
        ),
        SliverToBoxAdapter(
          child: _PromptCategoryStrip(
            categories: categories,
            selected: _promptCategory,
            favoritesOnly: authenticated && _favoritesOnly,
            showFavorites: authenticated,
            inverted: false,
            onSelected: _selectPromptCategory,
            onFavoritesChanged: _selectPromptFavorites,
          ),
        ),
        ...prompts.when(
          loading: () => const [
            SliverToBoxAdapter(child: _SectionLoading(height: 360)),
          ],
          error: (error, stackTrace) => [
            SliverToBoxAdapter(
              child: _InlineError(
                message: '提示词加载失败',
                onRetry: () {
                  ref.invalidate(
                    discoverPromptPageRequestProvider(
                      PromptPageRequest(query: query),
                    ),
                  );
                  ref.invalidate(discoverPromptPageProvider(query));
                },
              ),
            ),
          ],
          data: (page) => _buildPromptLibraryPage(
            page,
            query,
            authenticated: authenticated,
          ),
        ),
      ],
    );
  }

  Widget _buildCommunityScreen() {
    return Scaffold(
      appBar: const AppTopBar(title: Text('社区'), showBackButton: false),
      body: _buildCommunityBody(),
    );
  }

  Widget _buildCommunityBody() {
    final query = _galleryQuery;
    final gallery = ref.watch(discoverGalleryPageProvider(query));
    final categories = ref.watch(galleryCategoriesProvider);
    return CustomScrollView(
      controller: _galleryScrollController,
      cacheExtent: _masonryCacheExtent,
      physics: appRefreshScrollPhysics,
      slivers: [
        AppSliverRefresh(onRefresh: _refresh),
        const SliverToBoxAdapter(child: SizedBox(height: 4)),
        SliverToBoxAdapter(
          child: _GalleryCategoryStrip(
            categories: categories,
            selected: _galleryCategory,
            onSelected: (value) => setState(() {
              _galleryCategory = value;
              _resetGalleryPaginationState();
            }),
          ),
        ),
        ...gallery.when(
          loading: () => const [
            SliverToBoxAdapter(child: _SectionLoading(height: 360)),
          ],
          error: (error, stackTrace) => [
            SliverToBoxAdapter(
              child: _InlineError(
                message: '社区作品加载失败',
                onRetry: () {
                  ref.invalidate(
                    discoverGalleryPageRequestProvider(
                      GalleryPageRequest(query: query),
                    ),
                  );
                  ref.invalidate(discoverGalleryPageProvider(query));
                },
              ),
            ),
          ],
          data: (page) => _buildGalleryPage(page, query),
        ),
      ],
    );
  }
}

class _DiscoverTabViewport extends StatefulWidget {
  const _DiscoverTabViewport({
    required this.controller,
    required this.children,
  });

  final TabController controller;
  final List<Widget> children;

  @override
  State<_DiscoverTabViewport> createState() => _DiscoverTabViewportState();
}

class _DiscoverTabViewportState extends State<_DiscoverTabViewport> {
  late int _index = widget.controller.index;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onController);
  }

  @override
  void didUpdateWidget(covariant _DiscoverTabViewport oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_onController);
      widget.controller.addListener(_onController);
      _index = widget.controller.index;
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onController);
    super.dispose();
  }

  void _onController() {
    if (widget.controller.index == _index) return;
    setState(() => _index = widget.controller.index);
  }

  @override
  Widget build(BuildContext context) {
    return IndexedStack(
      index: _index,
      sizing: StackFit.expand,
      children: widget.children,
    );
  }
}

class _HomeTabBar extends StatelessWidget implements PreferredSizeWidget {
  const _HomeTabBar({required this.controller, required this.onSelected});

  final TabController controller;
  final ValueChanged<HomeDiscoverTab> onSelected;

  static const _indicatorWidth = 20.0;

  @override
  Size get preferredSize => const Size.fromHeight(48);

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final animation = controller.animation!;
    return AnimatedBuilder(
      animation: animation,
      builder: (context, child) {
        return SizedBox(
          key: const Key('home-tabs'),
          height: 48,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final tabWidth =
                  constraints.maxWidth / HomeDiscoverTab.values.length;
              final t = animation.value;
              return Stack(
                children: [
                  Row(
                    children: [
                      for (final tab in HomeDiscoverTab.values)
                        Expanded(
                          child: _HomeTabButton(
                            key: Key('home-tab-${tab.name}'),
                            label: switch (tab) {
                              HomeDiscoverTab.home => '首页',
                              HomeDiscoverTab.prompts => '提示词',
                              HomeDiscoverTab.community => '社区',
                            },
                            emphasis: (1 - (t - tab.index).abs()).clamp(
                              0.0,
                              1.0,
                            ),
                            color: colors.onSurface,
                            muted: colors.onSurfaceVariant,
                            onTap: () => onSelected(tab),
                          ),
                        ),
                    ],
                  ),
                  Positioned(
                    left: tabWidth * t + (tabWidth - _indicatorWidth) / 2,
                    bottom: 4,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: colors.primary,
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: const SizedBox(width: _indicatorWidth, height: 2),
                    ),
                  ),
                ],
              );
            },
          ),
        );
      },
    );
  }
}

class _HomeTabButton extends StatelessWidget {
  const _HomeTabButton({
    required this.label,
    required this.emphasis,
    required this.color,
    required this.muted,
    required this.onTap,
    super.key,
  });

  final String label;
  final double emphasis;
  final Color color;
  final Color muted;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final selected = emphasis > 0.5;
    return AppPressable(
      onTap: onTap,
      semanticLabel: label,
      selected: selected,
      excludeChildSemantics: true,
      child: Center(
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: Color.lerp(muted, color, emphasis),
            fontWeight: selected ? FontWeight.w600 : FontWeight.w600,
            fontSize: 16,
            height: 1,
            letterSpacing: 0,
          ),
        ),
      ),
    );
  }
}

class _HomePress extends InheritedWidget {
  const _HomePress({required this.pressed, required super.child});

  final bool pressed;

  static bool of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_HomePress>()?.pressed ??
      false;

  @override
  bool updateShouldNotify(_HomePress oldWidget) => pressed != oldWidget.pressed;
}

class _HomePressable extends StatefulWidget {
  const _HomePressable({required this.child, this.onTap, super.key});

  final Widget child;
  final VoidCallback? onTap;

  @override
  State<_HomePressable> createState() => _HomePressableState();
}

class _HomePressableState extends State<_HomePressable> {
  var _pressed = false;

  void _setPressed(bool value) {
    if (_pressed == value || widget.onTap == null) return;
    setState(() => _pressed = value);
    if (value) HapticFeedback.selectionClick();
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    return _HomePress(
      pressed: _pressed,
      child: Listener(
        behavior: HitTestBehavior.opaque,
        onPointerDown: (_) => _setPressed(true),
        onPointerUp: (_) => _setPressed(false),
        onPointerCancel: (_) => _setPressed(false),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.onTap == null
              ? null
              : () {
                  HapticFeedback.lightImpact();
                  widget.onTap!();
                },
          child: AnimatedScale(
            scale: _pressed ? 0.978 : 1,
            duration: reduce
                ? Duration.zero
                : Duration(milliseconds: _pressed ? 90 : 260),
            curve: Curves.easeOutCubic,
            child: widget.child,
          ),
        ),
      ),
    );
  }
}

class _HomeZoom extends StatelessWidget {
  const _HomeZoom({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final pressed = _HomePress.of(context);
    final reduce = MediaQuery.disableAnimationsOf(context);
    return AnimatedScale(
      scale: pressed ? 1.045 : 1,
      duration: reduce ? Duration.zero : const Duration(milliseconds: 420),
      curve: Curves.easeOutCubic,
      child: child,
    );
  }
}

class HomePrimaryActions extends StatefulWidget {
  const HomePrimaryActions({
    required this.onCreate,
    required this.onAssistant,
    this.onCreateWithPrompt,
    super.key,
  });

  final VoidCallback onCreate;
  final VoidCallback onAssistant;
  final ValueChanged<String>? onCreateWithPrompt;

  @override
  State<HomePrimaryActions> createState() => _HomePrimaryActionsState();
}

class _HomePrimaryActionsState extends State<HomePrimaryActions> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _create() {
    final prompt = _controller.text.trim();
    if (prompt.isEmpty || widget.onCreateWithPrompt == null) {
      widget.onCreate();
    } else {
      widget.onCreateWithPrompt!(prompt);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return AppGlassSurface(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              key: const Key('home-prompt-input'),
              controller: _controller,
              minLines: 2,
              maxLines: 3,
              maxLength: 20000,
              textInputAction: TextInputAction.newline,
              style: Theme.of(
                context,
              ).textTheme.bodyLarge?.copyWith(height: 1.5),
              decoration: const InputDecoration(
                hintText: '描述你想创作的画面',
                counterText: '',
                filled: false,
                contentPadding: EdgeInsets.zero,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
              ),
            ),
            const SizedBox(height: 16),
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 8,
              children: [
                TextButton.icon(
                  key: const Key('home-assistant-action'),
                  onPressed: widget.onAssistant,
                  icon: const Icon(Icons.auto_awesome_outlined, size: 18),
                  label: const Text('AI 助手'),
                  style: TextButton.styleFrom(
                    foregroundColor: colors.onSurfaceVariant,
                  ),
                ),
                FilledButton.icon(
                  key: const Key('home-create-action'),
                  onPressed: _create,
                  icon: const Icon(Icons.arrow_forward_rounded, size: 18),
                  label: const Text('文生图'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.action,
    this.onAction,
  });

  final String title;
  final String action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final muted = colors.onSurfaceVariant;
    final ink = colors.onSurface;
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 12),
      sliver: SliverToBoxAdapter(
        child: Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: ink,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0,
                ),
              ),
            ),
            const SizedBox(width: 8),
            if (onAction == null)
              Flexible(
                child: Text(
                  action,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.end,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: muted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              )
            else
              _HomePressable(
                key: const Key('all-prompts-action'),
                onTap: onAction,
                child: Text(
                  action,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: colors.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _PromptCategoryStrip extends StatelessWidget {
  const _PromptCategoryStrip({
    required this.categories,
    required this.selected,
    required this.favoritesOnly,
    required this.showFavorites,
    required this.inverted,
    required this.onSelected,
    required this.onFavoritesChanged,
  });

  final AsyncValue<List<PromptCategory>> categories;
  final String? selected;
  final bool favoritesOnly;
  final bool showFavorites;
  final bool inverted;
  final ValueChanged<String?> onSelected;
  final ValueChanged<bool> onFavoritesChanged;

  @override
  Widget build(BuildContext context) {
    return _FilterStrip(
      children: [
        _FlatFilterChip(
          label: const Text('全部'),
          selected: selected == null && !favoritesOnly,
          inverted: inverted,
          onSelected: (_) => onSelected(null),
        ),
        if (showFavorites)
          _FlatFilterChip(
            key: const Key('prompt-favorites-filter'),
            label: const Text('我的收藏'),
            selected: favoritesOnly,
            inverted: inverted,
            onSelected: onFavoritesChanged,
          ),
        ...categories.valueOrNull
                ?.where(
                  (category) => category.count > 0 || selected == category.key,
                )
                .map(
                  (category) => _FlatFilterChip(
                    key: Key('prompt-category-${category.key}'),
                    label: Text('${category.label} ${category.count}'),
                    selected: selected == category.key,
                    inverted: inverted,
                    onSelected: (_) => onSelected(category.key),
                  ),
                ) ??
            const [],
        if (categories.isLoading)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 8, vertical: 10),
            child: _HomeTabBone(),
          ),
      ],
    );
  }
}

class _HomeTabBone extends StatelessWidget {
  const _HomeTabBone();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainer,
        borderRadius: BorderRadius.circular(6),
      ),
      child: SizedBox(width: 36, height: 12),
    );
  }
}

class _GalleryCategoryStrip extends StatelessWidget {
  const _GalleryCategoryStrip({
    required this.categories,
    required this.selected,
    required this.onSelected,
  });

  final AsyncValue<List<GalleryCategory>> categories;
  final String? selected;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    return _FilterStrip(
      children: [
        _FlatFilterChip(
          label: const Text('全部'),
          selected: selected == null,
          onSelected: (_) => onSelected(null),
        ),
        ...categories.valueOrNull?.map(
              (category) => _FlatFilterChip(
                key: Key('gallery-category-${category.id}'),
                label: Text(category.name),
                selected: selected == category.id,
                onSelected: (_) => onSelected(category.id),
              ),
            ) ??
            const [],
        if (categories.isLoading)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 8, vertical: 10),
            child: _HomeTabBone(),
          ),
      ],
    );
  }
}

class _FilterStrip extends StatelessWidget {
  const _FilterStrip({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(22, 0, 22, 12),
      child: Row(spacing: 8, children: children),
    );
  }
}

class _FlatFilterChip extends StatelessWidget {
  const _FlatFilterChip({
    required this.label,
    required this.selected,
    required this.onSelected,
    this.inverted = false,
    super.key,
  });

  final Widget label;
  final bool selected;
  final ValueChanged<bool> onSelected;
  final bool inverted;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return FilterChip(
      label: label,
      selected: selected,
      showCheckmark: false,
      onSelected: onSelected,
      backgroundColor: colors.surfaceContainerLowest,
      selectedColor: colors.primary,
      side: BorderSide.none,
      shape: const StadiumBorder(),
      labelStyle: TextStyle(
        color: selected ? colors.onPrimary : colors.onSurfaceVariant,
        fontWeight: selected ? FontWeight.w600 : FontWeight.w600,
      ),
      visualDensity: VisualDensity.compact,
    );
  }
}

double _homePromptRowHeight(BuildContext context) =>
    144 +
    ((MediaQuery.textScalerOf(context).scale(1) - 1).clamp(0.0, 1.5) * 96);

class _HomePromptRow extends ConsumerWidget {
  const _HomePromptRow({required this.item, required this.onOpen, super.key});
  final PromptItem item;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final imageUrl = ref
        .watch(apiClientProvider)
        .resolveUrl(promptListCoverUrl(item.coverUrl));
    return Semantics(
      button: true,
      label: item.title,
      child: AppPressable(
        onTap: onOpen,
        borderRadius: StarCloudsRadii.card,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: AppGlassSurface(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                height: _homePromptRowHeight(context),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(
                      width: 112,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(16),
                        child: ColoredBox(
                          color: colors.surfaceContainerLow,
                          child: _PublicImage(
                            url: imageUrl,
                            fit: BoxFit.contain,
                            maxDecodePx: 384,
                            fadeIn: false,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            item.title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(
                              context,
                            ).textTheme.titleSmall?.copyWith(height: 1.35),
                          ),
                          const SizedBox(height: 8),
                          Expanded(
                            child: Text(
                              item.prompt,
                              maxLines:
                                  MediaQuery.textScalerOf(context).scale(1) >
                                      1.3
                                  ? 2
                                  : 3,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(
                                context,
                              ).textTheme.bodySmall?.copyWith(height: 1.45),
                            ),
                          ),
                          const SizedBox(height: 8),
                          Wrap(
                            spacing: 12,
                            runSpacing: 4,
                            children: [
                              _HomePromptStat(
                                icon: Icons.favorite_border_rounded,
                                count: item.likeCount,
                              ),
                              _HomePromptStat(
                                icon: Icons.bookmark_border_rounded,
                                count: item.favoriteCount,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HomePromptStat extends StatelessWidget {
  const _HomePromptStat({required this.icon, required this.count});
  final IconData icon;
  final int count;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(
        icon,
        size: 14,
        color: Theme.of(context).colorScheme.onSurfaceVariant,
      ),
      const SizedBox(width: 4),
      Text('$count', style: Theme.of(context).textTheme.labelSmall),
    ],
  );
}

class _HomePromptSkeleton extends StatelessWidget {
  const _HomePromptSkeleton();
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      key: const Key('home-prompt-skeleton'),
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        children: [
          for (var index = 0; index < 2; index++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: AppGlassSurface(
                shadow: false,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: SizedBox(
                    height: _homePromptRowHeight(context),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Container(
                          width: 112,
                          decoration: BoxDecoration(
                            color: colors.surfaceContainerLow,
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                height: 16,
                                color: colors.surfaceContainerLow,
                              ),
                              const SizedBox(height: 12),
                              FractionallySizedBox(
                                widthFactor: .75,
                                child: Container(
                                  height: 12,
                                  color: colors.surfaceContainerLow,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PromptMasonryCard extends ConsumerWidget {
  const _PromptMasonryCard({required this.item, required this.onOpen});

  final PromptItem item;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final imageUrl = ref
        .watch(apiClientProvider)
        .resolveUrl(promptListCoverUrl(item.coverUrl));
    final colors = Theme.of(context).colorScheme;
    final hasCover = imageUrl.isNotEmpty;
    return AppPressable(
      onTap: onOpen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: hasCover ? item.aspectRatio.clamp(0.72, 1.05) : 1.05,
            child: hasCover
                ? _PromptCover(
                    url: imageUrl,
                    zoom: false,
                    liked: item.liked,
                    likeCount: item.likeCount,
                    favorited: item.favorited,
                    favoriteCount: item.favoriteCount,
                  )
                : _PromptTextCover(item: item),
          ),
          const SizedBox(height: 8),
          Text(
            item.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w600,
              height: 1.25,
              letterSpacing: 0,
            ),
          ),
          if (hasCover && item.prompt.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              item.prompt,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
                height: 1.35,
              ),
            ),
          ],
          const SizedBox(height: 8),
          _PromptCardMeta(item: item),
        ],
      ),
    );
  }
}

class _PromptTextCover extends StatelessWidget {
  const _PromptTextCover({required this.item});

  final PromptItem item;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: dark ? Colors.white10 : const Color(0x14000000),
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(15.5),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 40),
              child: Align(
                alignment: Alignment.topLeft,
                child: Text(
                  item.prompt.isNotEmpty ? item.prompt : item.title,
                  maxLines: 6,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSurface,
                    height: 1.45,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            _PromptCoverStats(
              liked: item.liked,
              likeCount: item.likeCount,
              favorited: item.favorited,
              favoriteCount: item.favoriteCount,
            ),
          ],
        ),
      ),
    );
  }
}

class _PromptCardMeta extends StatelessWidget {
  const _PromptCardMeta({required this.item});

  final PromptItem item;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final parts = [
      if (item.category.isNotEmpty) item.category,
      if (item.useCount > 0) '${item.useCount}次使用',
    ];
    final tags = item.tags.take(2).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (parts.isNotEmpty)
          Text(
            parts.join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: colors.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
          ),
        if (tags.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              for (final tag in tags)
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: colors.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 3,
                    ),
                    child: Text(
                      tag,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: colors.onSurfaceVariant,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _PromptCover extends StatelessWidget {
  const _PromptCover({
    required this.url,
    required this.zoom,
    this.liked = false,
    this.likeCount = 0,
    this.favorited = false,
    this.favoriteCount = 0,
  });

  final String url;
  final bool zoom;
  final bool liked;
  final int likeCount;
  final bool favorited;
  final int favoriteCount;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fill = Theme.of(context).colorScheme.surfaceContainerLowest;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: dark ? Colors.white10 : const Color(0x14000000),
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(15.5),
        child: Stack(
          fit: StackFit.expand,
          children: [
            zoom
                ? _HomeZoom(child: _PublicImage(url: url))
                : _PublicImage(url: url),
            _PromptCoverStats(
              liked: liked,
              likeCount: likeCount,
              favorited: favorited,
              favoriteCount: favoriteCount,
            ),
          ],
        ),
      ),
    );
  }
}

class _PromptCoverStats extends StatelessWidget {
  const _PromptCoverStats({
    required this.liked,
    required this.likeCount,
    required this.favorited,
    required this.favoriteCount,
  });

  final bool liked;
  final int likeCount;
  final bool favorited;
  final int favoriteCount;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: IgnorePointer(
        child: DecoratedBox(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0x00000000), Color(0x99000000)],
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 28, 10, 8),
            child: Row(
              children: [
                _PromptCoverStat(
                  icon: liked
                      ? Icons.thumb_up_rounded
                      : Icons.thumb_up_outlined,
                  value: likeCount,
                  active: liked,
                ),
                const SizedBox(width: 12),
                _PromptCoverStat(
                  icon: favorited
                      ? Icons.favorite_rounded
                      : Icons.favorite_border_rounded,
                  value: favoriteCount,
                  active: favorited,
                  activeColor: const Color(0xFFFF8A9B),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PromptCoverStat extends StatelessWidget {
  const _PromptCoverStat({
    required this.icon,
    required this.value,
    this.active = false,
    this.activeColor,
  });

  final IconData icon;
  final int value;
  final bool active;
  final Color? activeColor;

  @override
  Widget build(BuildContext context) {
    final color = active ? (activeColor ?? Colors.white) : Colors.white;
    const shadow = Shadow(
      color: Color(0x8A000000),
      blurRadius: 8,
      offset: Offset(0, 1),
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color, shadows: const [shadow]),
        const SizedBox(width: 4),
        Text(
          '$value',
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
            color: color,
            fontWeight: FontWeight.w700,
            height: 1,
            letterSpacing: 0,
            shadows: const [shadow],
          ),
        ),
      ],
    );
  }
}

class _LoadMoreBand extends StatelessWidget {
  const _LoadMoreBand({
    required this.loading,
    required this.failed,
    required this.onPressed,
    this.noun = '作品',
    super.key,
  });

  final bool loading;
  final bool failed;
  final VoidCallback onPressed;
  final String noun;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final label = loading
        ? '正在加载更多$noun'
        : failed
        ? '加载失败，点击重试'
        : '加载更多$noun';
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
      child: Center(
        child: TextButton(
          onPressed: loading ? null : onPressed,
          style: TextButton.styleFrom(foregroundColor: colors.onSurfaceVariant),
          child: Text(label),
        ),
      ),
    );
  }
}

class PromptDetailSheet extends StatefulWidget {
  const PromptDetailSheet({
    required this.item,
    required this.imageUrl,
    required this.authenticated,
    required this.onEngage,
    required this.onUse,
    required this.onLogin,
    super.key,
  });

  final PromptItem item;
  final String imageUrl;
  final bool authenticated;
  final Future<PromptEngagement> Function(String action, bool active) onEngage;
  final VoidCallback onUse;
  final VoidCallback onLogin;

  @override
  State<PromptDetailSheet> createState() => _PromptDetailSheetState();
}

class _PromptDetailSheetState extends State<PromptDetailSheet> {
  late PromptItem _item = widget.item;
  String? _busyAction;

  Future<void> _copyPrompt() async {
    await Clipboard.setData(ClipboardData(text: _item.prompt));
    if (!mounted) return;
    AppNotice.success(context, '提示词已复制');
  }

  Future<void> _toggle(String action) async {
    if (!widget.authenticated) {
      widget.onLogin();
      return;
    }
    final active = action == 'like' ? !_item.liked : !_item.favorited;
    setState(() => _busyAction = action);
    try {
      final result = await widget.onEngage(action, active);
      if (!mounted) return;
      setState(() {
        _item = _item.copyWith(
          likeCount: result.likeCount,
          favoriteCount: result.favoriteCount,
          useCount: result.useCount,
          liked: action == 'like' ? result.active : _item.liked,
          favorited: action == 'favorite' ? result.active : _item.favorited,
        );
      });
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException ? error.message : '互动更新失败，请稍后重试';
      AppNotice.error(context, message);
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  Future<void> _openFullscreen() async {
    await showDialog<void>(
      context: context,
      useSafeArea: false,
      builder: (context) => GalleryFullscreenViewer(
        imageUrls: [widget.imageUrl],
        initialIndex: 0,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final colors = Theme.of(context).colorScheme;
    final maxHeight = media.size.height * 0.72;
    final tags = _item.tags
        .where((tag) {
          final value = tag.trim();
          return value.isNotEmpty &&
              value != _item.title &&
              value != _item.category;
        })
        .take(4)
        .toList();
    final heroHeight = ((media.size.width - 32) * 0.58).clamp(168.0, 220.0);

    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: maxHeight),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            fit: FlexFit.loose,
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _PromptHero(
                    url: widget.imageUrl,
                    height: heroHeight,
                    liked: _item.liked,
                    likeCount: _item.likeCount,
                    favorited: _item.favorited,
                    favoriteCount: _item.favoriteCount,
                    useCount: _item.useCount,
                    onOpen: _openFullscreen,
                  ),
                  const SizedBox(height: 16),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          _item.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(
                                fontWeight: FontWeight.w600,
                                fontSize: 20,
                                letterSpacing: 0,
                                height: 1.2,
                              ),
                        ),
                      ),
                      if (_item.category.isNotEmpty) ...[
                        const SizedBox(width: 10),
                        Padding(
                          padding: const EdgeInsets.only(top: 3),
                          child: _QuietPill(label: _item.category),
                        ),
                      ],
                    ],
                  ),
                  if (tags.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final tag in tags) _QuietPill(label: '#$tag'),
                      ],
                    ),
                  ],
                  const SizedBox(height: 16),
                  Text(
                    '提示词',
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: colors.onSurfaceVariant,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0,
                    ),
                  ),
                  const SizedBox(height: 8),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: colors.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                      child: SelectableText(
                        _item.prompt,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          height: 1.55,
                          letterSpacing: 0,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          _buildActionBar(context),
        ],
      ),
    );
  }

  Widget _buildActionBar(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final visual = StarCloudsVisualStyle.of(context);
    return DecoratedBox(
      key: const Key('prompt-detail-actions'),
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(
          top: BorderSide(color: visual.hairline.withValues(alpha: .55)),
        ),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          12,
          10,
          16,
          12 + MediaQuery.paddingOf(context).bottom,
        ),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final actions = [
              _PromptIconAction(
                tooltip: '复制提示词',
                icon: Icons.copy_outlined,
                onPressed: _copyPrompt,
              ),
              _PromptIconAction(
                tooltip: _item.liked ? '取消点赞' : '点赞',
                icon: _item.liked
                    ? Icons.thumb_up_rounded
                    : Icons.thumb_up_outlined,
                active: _item.liked,
                busy: _busyAction == 'like',
                onPressed: () => _toggle('like'),
              ),
              _PromptIconAction(
                tooltip: _item.favorited ? '取消收藏' : '收藏',
                icon: _item.favorited
                    ? Icons.favorite_rounded
                    : Icons.favorite_border_rounded,
                active: _item.favorited,
                activeColor: const Color(0xFFE45D73),
                busy: _busyAction == 'favorite',
                onPressed: () => _toggle('favorite'),
              ),
            ];
            final useButton = FilledButton.icon(
              onPressed: widget.onUse,
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 48),
                padding: const EdgeInsets.symmetric(horizontal: 18),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              icon: const Icon(Icons.auto_awesome_rounded, size: 18),
              label: const Text('用这个灵感'),
            );
            if (constraints.maxWidth < 350) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: actions,
                  ),
                  const SizedBox(height: 10),
                  useButton,
                ],
              );
            }
            return Row(
              children: [
                ...actions,
                const SizedBox(width: 8),
                Expanded(child: useButton),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _PromptHero extends StatelessWidget {
  const _PromptHero({
    required this.url,
    required this.height,
    required this.liked,
    required this.likeCount,
    required this.favorited,
    required this.favoriteCount,
    required this.useCount,
    required this.onOpen,
  });

  final String url;
  final double height;
  final bool liked;
  final int likeCount;
  final bool favorited;
  final int favoriteCount;
  final int useCount;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: '全屏预览',
      child: AppPressable(
        onTap: onOpen,
        child: ClipRRect(
          borderRadius: StarCloudsRadii.card,
          child: SizedBox(
            height: height,
            width: double.infinity,
            child: Stack(
              fit: StackFit.expand,
              children: [
                _PublicImage(url: url, maxDecodePx: 1440),
                const Positioned.fill(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment(0, 0.18),
                        end: Alignment.bottomCenter,
                        colors: [Color(0x00000000), Color(0x99000000)],
                      ),
                    ),
                  ),
                ),
                Positioned(
                  left: 10,
                  right: 10,
                  bottom: 10,
                  child: IgnorePointer(
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        _PromptHeroStat(
                          icon: liked
                              ? Icons.thumb_up_rounded
                              : Icons.thumb_up_outlined,
                          label: '点赞 $likeCount',
                          active: liked,
                        ),
                        _PromptHeroStat(
                          icon: favorited
                              ? Icons.favorite_rounded
                              : Icons.favorite_border_rounded,
                          label: '收藏 $favoriteCount',
                          active: favorited,
                          activeColor: const Color(0xFFFF8A9B),
                        ),
                        _PromptHeroStat(
                          icon: Icons.bolt_rounded,
                          label: '使用 $useCount',
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PromptHeroStat extends StatelessWidget {
  const _PromptHeroStat({
    required this.icon,
    required this.label,
    this.active = false,
    this.activeColor,
  });

  final IconData icon;
  final String label;
  final bool active;
  final Color? activeColor;

  @override
  Widget build(BuildContext context) {
    final color = active ? (activeColor ?? Colors.white) : Colors.white;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xA6000000),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 13, color: color),
            const SizedBox(width: 5),
            Text(
              label,
              maxLines: 1,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: color,
                fontWeight: FontWeight.w700,
                height: 1,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuietPill extends StatelessWidget {
  const _QuietPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: StarCloudsRadii.pillAll,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: colors.onSurfaceVariant,
            fontWeight: FontWeight.w600,
            letterSpacing: 0,
          ),
        ),
      ),
    );
  }
}

class _PromptIconAction extends StatelessWidget {
  const _PromptIconAction({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.active = false,
    this.activeColor,
    this.busy = false,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;
  final bool active;
  final Color? activeColor;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final accent = activeColor ?? colors.primary;
    return IconButton(
      tooltip: tooltip,
      onPressed: busy ? null : onPressed,
      style: IconButton.styleFrom(
        foregroundColor: active ? accent : colors.onSurface,
        backgroundColor: colors.surfaceContainerLow,
        minimumSize: const Size.square(44),
        maximumSize: const Size.square(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      icon: busy
          ? SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: colors.primary,
              ),
            )
          : Icon(icon, size: 20),
    );
  }
}

class _GalleryCard extends ConsumerWidget {
  const _GalleryCard({
    required this.item,
    required this.onOpen,
    this.overlay = false,
  });

  final GalleryItem item;
  final VoidCallback onOpen;
  final bool overlay;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final imageUrl = ref
        .watch(apiClientProvider)
        .resolveUrl(item.coverUrl ?? '');
    final cover = Stack(
      fit: StackFit.expand,
      children: [
        _PublicImage(url: imageUrl),
        if (overlay)
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.center,
                end: Alignment.bottomCenter,
                colors: [Colors.transparent, Color(0xB3000000)],
              ),
            ),
          ),
        if (item.featured)
          const Positioned(
            left: 8,
            top: 8,
            child: _GalleryOverlayLabel(
              icon: Icons.workspace_premium,
              label: '精选',
            ),
          ),
        if (item.previewUrls.length > 1)
          Positioned(
            right: 8,
            top: 8,
            child: _GalleryOverlayLabel(
              icon: Icons.collections_outlined,
              label: '${item.previewUrls.length}',
            ),
          ),
        if (overlay)
          Positioned(
            left: 10,
            right: 10,
            bottom: 10,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    height: 1.15,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  item.authorName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
      ],
    );
    final card = AppSoftCard(
      color: Theme.of(context).colorScheme.surface,
      child: overlay
          ? AspectRatio(
              aspectRatio: 0.72 + (item.id.hashCode.abs() % 16) / 100,
              child: cover,
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: cover),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 10, 11),
                  child: Text(
                    item.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
    );
    return AppPressable(onTap: onOpen, child: card);
  }
}

class _GalleryOverlayLabel extends StatelessWidget {
  const _GalleryOverlayLabel({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: Colors.black.withValues(alpha: 0.68),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: Colors.white),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    ),
  );
}

class GalleryDetailSheet extends StatefulWidget {
  const GalleryDetailSheet({
    required this.item,
    required this.imageUrls,
    this.authenticated = false,
    this.currentUserId,
    this.onReport,
    this.onBlock,
    this.onBlocked,
    this.onLogin,
    this.share,
    super.key,
  });

  final GalleryItem item;
  final List<String> imageUrls;
  final bool authenticated;
  final String? currentUserId;
  final Future<void> Function(GalleryReportReason reason, String detail)?
  onReport;
  final Future<void> Function()? onBlock;
  final VoidCallback? onBlocked;
  final VoidCallback? onLogin;
  final Future<void> Function(String text, Rect? origin)? share;

  @override
  State<GalleryDetailSheet> createState() => _GalleryDetailSheetState();
}

class _GalleryDetailSheetState extends State<GalleryDetailSheet> {
  late final PageController _pageController = PageController();
  int _index = 0;
  bool _sharing = false;

  List<String> get _urls =>
      widget.imageUrls.isEmpty ? const [''] : widget.imageUrls;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _openFullscreen() async {
    await showDialog<void>(
      context: context,
      useSafeArea: false,
      builder: (context) =>
          GalleryFullscreenViewer(imageUrls: _urls, initialIndex: _index),
    );
  }

  bool get _canModerate =>
      widget.item.authorId.isNotEmpty &&
      widget.item.authorId != widget.currentUserId;

  Future<void> _share(BuildContext buttonContext) async {
    if (_sharing) return;
    final box = buttonContext.findRenderObject() as RenderBox?;
    final origin = box == null
        ? null
        : box.localToGlobal(Offset.zero) & box.size;
    setState(() => _sharing = true);
    try {
      final text = galleryShareText(widget.item);
      final share = widget.share;
      if (share != null) {
        await share(text, origin);
      } else {
        await SharePlus.instance.share(
          ShareParams(text: text, title: '分享社区作品', sharePositionOrigin: origin),
        );
      }
    } catch (_) {
      if (mounted) AppNotice.error(context, '分享失败，请稍后重试');
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  Future<void> _handleSafetyAction(_GallerySafetyAction action) async {
    if (!widget.authenticated) {
      widget.onLogin?.call();
      return;
    }
    if (action == _GallerySafetyAction.report) {
      final onReport = widget.onReport;
      if (onReport == null) return;
      await showAppDialog<void>(
        context: context,
        builder: (context) => GalleryReportDialog(onSubmit: onReport),
      );
      return;
    }
    final onBlock = widget.onBlock;
    if (onBlock == null) return;
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (dialogContext) => AppDialog(
        icon: const Icon(Icons.person_off_outlined),
        title: Text('屏蔽 ${widget.item.authorName}？'),
        content: const Text('该作者的社区作品将不再向你展示。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('确认屏蔽'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await onBlock();
      if (mounted) widget.onBlocked?.call();
    } catch (error) {
      if (!mounted) return;
      AppNotice.error(
        context,
        error is ApiException ? error.message : '屏蔽失败，请稍后重试',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: 1,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: ColoredBox(
                        color: Colors.black,
                        child: PageView.builder(
                          controller: _pageController,
                          itemCount: _urls.length,
                          onPageChanged: (index) =>
                              setState(() => _index = index),
                          itemBuilder: (context, index) => _PublicImage(
                            url: _urls[index],
                            fit: BoxFit.contain,
                            maxDecodePx: 1440,
                          ),
                        ),
                      ),
                    ),
                    Positioned(
                      right: 10,
                      top: 10,
                      child: IconButton.filled(
                        tooltip: '全屏预览',
                        onPressed: _openFullscreen,
                        style: IconButton.styleFrom(
                          backgroundColor: Colors.black54,
                          foregroundColor: Colors.white,
                        ),
                        icon: const Icon(Icons.fullscreen),
                      ),
                    ),
                    if (_urls.length > 1)
                      Positioned(
                        right: 10,
                        bottom: 10,
                        child: _GalleryOverlayLabel(
                          icon: Icons.collections_outlined,
                          label: '${_index + 1}/${_urls.length}',
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    item.title,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (item.featured) ...[
                  const SizedBox(width: 8),
                  Chip(
                    avatar: const Icon(Icons.workspace_premium, size: 17),
                    label: const Text('精选'),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  child: Text(item.authorName.characters.first.toUpperCase()),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.authorName,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      if (item.createdAt != null)
                        Text(
                          DateFormat('yyyy年M月d日').format(item.createdAt!),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
                Builder(
                  builder: (buttonContext) => IconButton(
                    key: const Key('gallery-share'),
                    tooltip: '分享作品',
                    onPressed: _sharing ? null : () => _share(buttonContext),
                    icon: _sharing
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.ios_share_outlined),
                  ),
                ),
                if (_canModerate)
                  PopupMenuButton<_GallerySafetyAction>(
                    key: const Key('gallery-safety-menu'),
                    tooltip: '社区安全操作',
                    onSelected: _handleSafetyAction,
                    itemBuilder: (context) => const [
                      PopupMenuItem(
                        value: _GallerySafetyAction.report,
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(Icons.flag_outlined),
                          title: Text('举报作品'),
                        ),
                      ),
                      PopupMenuItem(
                        value: _GallerySafetyAction.block,
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(Icons.person_off_outlined),
                          title: Text('屏蔽此作者'),
                        ),
                      ),
                    ],
                    icon: const Icon(Icons.more_horiz_rounded),
                  ),
              ],
            ),
            if (item.categoryName?.isNotEmpty == true ||
                item.tags.isNotEmpty) ...[
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 7,
                children: [
                  if (item.categoryName?.isNotEmpty == true)
                    Chip(
                      avatar: const Icon(Icons.category_outlined, size: 16),
                      label: Text(item.categoryName!),
                      visualDensity: VisualDensity.compact,
                    ),
                  for (final tag in item.tags)
                    Chip(
                      label: Text(tag),
                      visualDensity: VisualDensity.compact,
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String galleryShareText(GalleryItem item) {
  final link = Uri.https('starcloudisai.com', '/share', {'item': item.id});
  return '${item.title}\n来自 ${item.authorName} 的星空云绘社区作品\n$link';
}

enum _GallerySafetyAction { report, block }

class GalleryReportDialog extends StatefulWidget {
  const GalleryReportDialog({required this.onSubmit, super.key});

  final Future<void> Function(GalleryReportReason reason, String detail)
  onSubmit;

  @override
  State<GalleryReportDialog> createState() => _GalleryReportDialogState();
}

class _GalleryReportDialogState extends State<GalleryReportDialog> {
  final _detailController = TextEditingController();
  GalleryReportReason _reason = GalleryReportReason.inappropriate;
  bool _submitting = false;

  @override
  void dispose() {
    _detailController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final detail = _detailController.text.trim();
    if (_reason == GalleryReportReason.other && detail.isEmpty) {
      AppNotice.warning(context, '请补充说明具体问题');
      return;
    }
    setState(() => _submitting = true);
    try {
      await widget.onSubmit(_reason, detail);
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (!mounted) return;
      AppNotice.error(
        context,
        error is ApiException ? error.message : '举报提交失败，请稍后重试',
      );
      setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppDialog(
      icon: const Icon(Icons.flag_outlined),
      title: const Text('举报作品'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('请选择最符合的原因，我们会进行审核。'),
          const SizedBox(height: 14),
          DropdownButtonFormField<GalleryReportReason>(
            key: const Key('gallery-report-reason'),
            initialValue: _reason,
            decoration: const InputDecoration(labelText: '举报原因'),
            items: [
              for (final reason in GalleryReportReason.values)
                DropdownMenuItem(value: reason, child: Text(reason.label)),
            ],
            onChanged: _submitting
                ? null
                : (value) => setState(() => _reason = value ?? _reason),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('gallery-report-detail'),
            controller: _detailController,
            enabled: !_submitting,
            minLines: 2,
            maxLines: 4,
            maxLength: 500,
            decoration: InputDecoration(
              labelText: _reason == GalleryReportReason.other
                  ? '补充说明（必填）'
                  : '补充说明（选填）',
              alignLabelWithHint: true,
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _submitting ? null : () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const Key('gallery-report-submit'),
          onPressed: _submitting ? null : _submit,
          icon: _submitting
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.send_outlined, size: 18),
          label: Text(_submitting ? '提交中' : '提交举报'),
        ),
      ],
    );
  }
}

class GalleryFullscreenViewer extends StatefulWidget {
  const GalleryFullscreenViewer({
    required this.imageUrls,
    required this.initialIndex,
    super.key,
  });

  final List<String> imageUrls;
  final int initialIndex;

  @override
  State<GalleryFullscreenViewer> createState() =>
      _GalleryFullscreenViewerState();
}

class _GalleryFullscreenViewerState extends State<GalleryFullscreenViewer> {
  late final PageController _controller = PageController(
    initialPage: widget.initialIndex,
  );
  late int _index = widget.initialIndex;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Dialog.fullscreen(
    backgroundColor: Colors.black,
    child: SafeArea(
      child: Stack(
        children: [
          Positioned.fill(
            child: PageView.builder(
              controller: _controller,
              itemCount: widget.imageUrls.length,
              onPageChanged: (index) => setState(() => _index = index),
              itemBuilder: (context, index) => InteractiveViewer(
                minScale: 0.5,
                maxScale: 5,
                child: Center(
                  child: _PublicImage(
                    url: widget.imageUrls[index],
                    fit: BoxFit.contain,
                    maxDecodePx: 1920,
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            right: 12,
            top: 8,
            child: IconButton.filled(
              tooltip: '关闭预览',
              onPressed: () => Navigator.pop(context),
              style: IconButton.styleFrom(
                backgroundColor: Colors.black54,
                foregroundColor: Colors.white,
              ),
              icon: const Icon(Icons.close),
            ),
          ),
          if (widget.imageUrls.length > 1)
            Positioned(
              left: 0,
              right: 0,
              bottom: 18,
              child: Center(
                child: _GalleryOverlayLabel(
                  icon: Icons.collections_outlined,
                  label: '${_index + 1}/${widget.imageUrls.length}',
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

class _PublicImage extends StatelessWidget {
  const _PublicImage({
    required this.url,
    this.fit = BoxFit.cover,
    this.maxDecodePx = 720,
    this.fadeIn = true,
  });

  final String url;
  final BoxFit fit;
  final int maxDecodePx;
  final bool fadeIn;

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) return const _ImageFallback();
    return LayoutBuilder(
      builder: (context, constraints) {
        final dpr = MediaQuery.devicePixelRatioOf(context);
        int? cacheWidth;
        final width = constraints.maxWidth;
        if (width.isFinite && width > 0) {
          cacheWidth = (width * dpr).round().clamp(64, maxDecodePx);
        } else {
          final height = constraints.maxHeight;
          if (height.isFinite && height > 0) {
            cacheWidth = (height * dpr).round().clamp(64, maxDecodePx);
          }
        }
        final reduce = MediaQuery.disableAnimationsOf(context);
        return Image.network(
          url,
          width: double.infinity,
          height: double.infinity,
          fit: fit,
          gaplessPlayback: true,
          filterQuality: maxDecodePx <= 720
              ? FilterQuality.low
              : FilterQuality.medium,
          cacheWidth: cacheWidth,
          errorBuilder: (_, _, _) => const _ImageFallback(),
          frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
            if (wasSynchronouslyLoaded || reduce || !fadeIn) return child;
            return AnimatedOpacity(
              opacity: frame == null ? 0 : 1,
              duration: const Duration(milliseconds: 160),
              curve: Curves.easeOut,
              child: child,
            );
          },
        );
      },
    );
  }
}

class _ImageFallback extends StatelessWidget {
  const _ImageFallback();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      child: Center(
        child: Icon(
          Icons.image_outlined,
          color: Theme.of(context).colorScheme.outline,
        ),
      ),
    );
  }
}

class _SectionLoading extends StatelessWidget {
  const _SectionLoading({required this.height});
  final double height;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SizedBox(
      height: height,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(20, 0, 40, 0),
        scrollDirection: Axis.horizontal,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: 3,
        separatorBuilder: (_, _) => const SizedBox(width: 14),
        itemBuilder: (context, index) => SizedBox(
          width: 168,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: colors.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              ColoredBox(
                color: colors.surfaceContainer,
                child: const SizedBox(width: 88, height: 10),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      child: Row(
        children: [
          Icon(Icons.cloud_off_outlined, color: colors.error),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: Theme.of(context).textTheme.bodySmall),
          ),
          IconButton(
            tooltip: '重试',
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
    );
  }
}

class _PromptEmpty extends StatelessWidget {
  const _PromptEmpty({
    required this.filtered,
    required this.onReset,
    this.inverted = false,
  });

  final bool filtered;
  final VoidCallback onReset;
  final bool inverted;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 28, 24, 36),
      child: Column(
        children: [
          Icon(
            Icons.search_off,
            size: 36,
            color: inverted ? Colors.white70 : null,
          ),
          const SizedBox(height: 10),
          Text(
            filtered ? '没有匹配的提示词' : '暂时没有提示词',
            style: TextStyle(color: inverted ? Colors.white : null),
          ),
          if (filtered) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              style: inverted
                  ? OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: Color(0xFF3A3D42)),
                    )
                  : null,
              onPressed: onReset,
              icon: const Icon(Icons.filter_alt_off),
              label: const Text('清除筛选'),
            ),
          ],
        ],
      ),
    );
  }
}

class _SectionEmpty extends StatelessWidget {
  const _SectionEmpty({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(24, 28, 24, 48),
    child: Center(child: Text(message)),
  );
}
