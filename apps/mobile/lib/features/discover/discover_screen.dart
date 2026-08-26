import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

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

class DiscoverScreen extends ConsumerStatefulWidget {
  const DiscoverScreen({
    super.key,
    this.searchDebounce = const Duration(milliseconds: 350),
    this.communityOnly = false,
    this.promptLibraryOnly = false,
  });

  final Duration searchDebounce;
  final bool communityOnly;
  final bool promptLibraryOnly;

  @override
  ConsumerState<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends ConsumerState<DiscoverScreen> {
  static const _loadMoreExtent = 360.0;
  static const _masonryCacheExtent = 480.0;

  final _searchController = TextEditingController();
  final _promptScrollController = ScrollController();
  final _galleryScrollController = ScrollController();
  Timer? _searchTimer;
  String _search = '';
  String? _promptCategory;
  String? _galleryCategory;
  bool _favoritesOnly = false;
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

  PromptQuery _homePromptQuery() => const PromptQuery(sort: 'latest', limit: 8);

  PromptQuery _libraryPromptQuery(bool authenticated) => PromptQuery(
    search: _search,
    category: _promptCategory,
    favoritesOnly: authenticated && _favoritesOnly,
  );

  PromptQuery _promptQueryFor(bool authenticated) => widget.promptLibraryOnly
      ? _libraryPromptQuery(authenticated)
      : _homePromptQuery();

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
    _promptScrollController.addListener(_onPromptScroll);
    _galleryScrollController.addListener(_onGalleryScroll);
  }

  @override
  void dispose() {
    _promptScrollController.removeListener(_onPromptScroll);
    _galleryScrollController.removeListener(_onGalleryScroll);
    _promptScrollController.dispose();
    _galleryScrollController.dispose();
    _searchTimer?.cancel();
    _searchController.dispose();
    super.dispose();
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
    if (widget.promptLibraryOnly) {
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
    if (widget.communityOnly) {
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
    final authenticated =
        ref.read(sessionControllerProvider).valueOrNull?.isAuthenticated ==
        true;
    final promptQuery = _promptQueryFor(authenticated);
    final galleryQuery = _galleryQuery;
    setState(() {
      _resetPromptPaginationState();
      _resetGalleryPaginationState();
    });
    ref.invalidate(galleryCategoriesProvider);
    ref.invalidate(
      discoverPromptPageRequestProvider(PromptPageRequest(query: promptQuery)),
    );
    ref.invalidate(
      discoverGalleryPageRequestProvider(
        GalleryPageRequest(query: galleryQuery),
      ),
    );
    ref.invalidate(discoverPromptPageProvider(promptQuery));
    ref.invalidate(discoverGalleryPageProvider(galleryQuery));
    ref.invalidate(discoverFeedProvider);
    await Future.wait([
      ref.read(galleryCategoriesProvider.future),
      ref.read(discoverPromptPageProvider(promptQuery).future),
      ref.read(discoverGalleryPageProvider(galleryQuery).future),
    ]);
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
    if (_galleryPaginationQuery != query) return firstPage.items;
    final seen = <String>{};
    return [
      ...firstPage.items,
      ..._moreGallery,
    ].where((item) => seen.add(item.id)).toList();
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
    if (!widget.promptLibraryOnly) return;
    final authenticated =
        ref.read(sessionControllerProvider).valueOrNull?.isAuthenticated ==
        true;
    final query = _libraryPromptQuery(authenticated);
    final page = ref.read(discoverPromptPageProvider(query)).asData?.value;
    if (page != null) _maybeLoadMorePrompts(page, query);
  }

  void _onGalleryScroll() {
    if (!widget.communityOnly) return;
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
    if (!widget.promptLibraryOnly) return;
    if (_loadingMorePrompts || _promptLoadMoreFailed) return;
    if (_nextPromptCursor(firstPage, query) == null) return;
    if (!_shouldLoadMore(_promptScrollController)) return;
    unawaited(_loadMorePrompts(firstPage, query));
  }

  void _maybeLoadMoreGallery(GalleryPage firstPage, GalleryQuery query) {
    if (!widget.communityOnly) return;
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
    final imageUrls = item.previewUrls
        .map(apiClient.resolveUrl)
        .where((url) => url.isNotEmpty)
        .toList();
    await showAppSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) =>
          GalleryDetailSheet(item: item, imageUrls: imageUrls),
    );
  }

  List<Widget> _buildHomePromptPage(
    PromptPage page,
    PromptQuery query, {
    required bool authenticated,
  }) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final items = _promptItemsFor(page, query).take(8).toList();
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
      SliverToBoxAdapter(
        child: _PromptStrip(
          items: items,
          hasMore: false,
          loadingMore: false,
          loadMoreFailed: false,
          onLoadMore: () {},
          onOpen: (item) =>
              _openPrompt(item, authenticated: authenticated, query: query),
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

  List<Widget> _buildGalleryPage(
    GalleryPage page,
    GalleryQuery query, {
    bool homeLayout = false,
  }) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final items = _galleryItemsFor(page, query);
    if (items.isEmpty) {
      return const [
        SliverToBoxAdapter(child: _SectionEmpty(message: '这个分类暂时没有公开作品')),
      ];
    }
    final hasMore = _nextGalleryCursor(page, query) != null;
    if (homeLayout) {
      return [
        SliverToBoxAdapter(
          child: _HomeGalleryStrip(
            items: items,
            inverted: dark,
            onOpen: _openGallery,
          ),
        ),
        if (hasMore || _loadingMoreGallery || _galleryLoadMoreFailed)
          SliverToBoxAdapter(
            child: _LoadMoreBand(
              key: const Key('load-more-gallery'),
              loading: _loadingMoreGallery,
              failed: _galleryLoadMoreFailed,
              inverted: dark,
              onPressed: () => _loadMoreGallery(page, query),
            ),
          )
        else
          const SliverToBoxAdapter(child: SizedBox(height: 24)),
      ];
    }
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
    return Scaffold(backgroundColor: colors.surface, body: _buildHomeBody());
  }

  Widget _buildHomeBody() {
    final session = ref.watch(sessionControllerProvider);
    final authenticated = session.valueOrNull?.isAuthenticated == true;
    final promptQuery = _homePromptQuery();
    final galleryQuery = _galleryQuery;
    final prompts = ref.watch(discoverPromptPageProvider(promptQuery));
    final gallery = ref.watch(discoverGalleryPageProvider(galleryQuery));
    final galleryCategories = ref.watch(galleryCategoriesProvider);
    final galleryIsKnownEmpty =
        gallery.asData?.value.items.isEmpty == true && _moreGallery.isEmpty;
    final dark = Theme.of(context).brightness == Brightness.dark;

    return CustomScrollView(
      physics: appRefreshScrollPhysics,
      slivers: [
        AppSliverRefresh(onRefresh: _refresh),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
          sliver: SliverToBoxAdapter(
            child: _HomeReveal(
              child: HomePrimaryActions(
                onCreate: () => context.push('/create'),
                onAssistant: () => context.go('/ai'),
              ),
            ),
          ),
        ),
        _SectionHeader(
          title: '提示词',
          action: '全部',
          inverted: dark,
          onAction: () => context.push('/prompts'),
        ),
        ...prompts.when(
          loading: () => [
            SliverToBoxAdapter(
              child: _SectionLoading(
                height: _PromptStrip.height,
                inverted: dark,
                featuredWidth: _PromptStrip.cardWidth,
                itemWidth: _PromptStrip.cardWidth,
              ),
            ),
          ],
          error: (error, stackTrace) => [
            SliverToBoxAdapter(
              child: _InlineError(
                message: '创作灵感加载失败',
                inverted: dark,
                onRetry: () {
                  ref.invalidate(
                    discoverPromptPageRequestProvider(
                      PromptPageRequest(query: promptQuery),
                    ),
                  );
                  ref.invalidate(discoverPromptPageProvider(promptQuery));
                },
              ),
            ),
          ],
          data: (page) => _buildHomePromptPage(
            page,
            promptQuery,
            authenticated: authenticated,
          ),
        ),
        if (!galleryIsKnownEmpty) ...[
          _SectionHeader(
            title: '社区作品',
            action: '去社区',
            inverted: dark,
            actionKey: const Key('home-community-action'),
            onAction: () => context.go('/community'),
          ),
          SliverToBoxAdapter(
            child: _HomeCategoryStrip(
              categories: galleryCategories,
              selected: _galleryCategory,
              inverted: dark,
              onSelected: (value) => setState(() {
                _galleryCategory = value;
                _resetGalleryPaginationState();
              }),
            ),
          ),
          ...gallery.when(
            loading: () => [
              SliverToBoxAdapter(
                child: _SectionLoading(
                  height: 280,
                  inverted: dark,
                  featuredWidth: 226,
                  itemWidth: 158,
                  overlay: true,
                ),
              ),
            ],
            error: (error, stackTrace) => [
              SliverToBoxAdapter(
                child: _InlineError(
                  message: '社区作品加载失败',
                  inverted: dark,
                  onRetry: () {
                    ref.invalidate(
                      discoverGalleryPageRequestProvider(
                        GalleryPageRequest(query: galleryQuery),
                      ),
                    );
                    ref.invalidate(discoverGalleryPageProvider(galleryQuery));
                  },
                ),
              ),
            ],
            data: (page) =>
                _buildGalleryPage(page, galleryQuery, homeLayout: true),
          ),
        ] else
          const SliverToBoxAdapter(child: SizedBox(height: 24)),
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

class _HomeReveal extends StatelessWidget {
  const _HomeReveal({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 340),
      curve: Curves.easeOutCubic,
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(0, 18 * (1 - value)),
            child: child,
          ),
        );
      },
      child: child,
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

class HomePrimaryActions extends StatelessWidget {
  const HomePrimaryActions({
    required this.onCreate,
    required this.onAssistant,
    super.key,
  });

  final VoidCallback onCreate;
  final VoidCallback onAssistant;

  @override
  Widget build(BuildContext context) {
    final textScale = MediaQuery.textScalerOf(context).scale(1);
    final heroHeight = 148 + ((textScale - 1).clamp(0.0, 0.6) * 36);
    final railHeight = 64 + ((textScale - 1).clamp(0.0, 0.6) * 22);
    return Column(
      children: [
        SizedBox(
          height: heroHeight,
          width: double.infinity,
          child: _PrimaryCreationCard(
            key: const Key('home-create-action'),
            onTap: onCreate,
          ),
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: railHeight,
          width: double.infinity,
          child: _AssistantActionCard(
            key: const Key('home-assistant-action'),
            onTap: onAssistant,
          ),
        ),
      ],
    );
  }
}

class _PrimaryCreationCard extends StatelessWidget {
  const _PrimaryCreationCard({required this.onTap, super.key});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    const ink = Color(0xFF2548A7);
    return Semantics(
      button: true,
      label: '进入文生图',
      child: _HomePressable(
        onTap: onTap,
        child: Material(
          color: const Color(0xFFDCE3FF),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(22),
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            fit: StackFit.expand,
            children: [
              Positioned(
                right: 8,
                top: 10,
                bottom: 10,
                width: 140,
                child: IgnorePointer(
                  child: _HomeZoom(
                    child: Image.asset(
                      'assets/images/home_text_to_image_v2.png',
                      key: const Key('home-creation-visual'),
                      width: 140,
                      height: 128,
                      fit: BoxFit.contain,
                      alignment: Alignment.center,
                      filterQuality: FilterQuality.medium,
                      excludeFromSemantics: true,
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 148, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Spacer(),
                    Text(
                      '文生图',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        color: ink,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.8,
                        height: 1,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '从一句描述开始',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: ink.withValues(alpha: 0.68),
                        height: 1.2,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AssistantActionCard extends StatelessWidget {
  const _AssistantActionCard({required this.onTap, super.key});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Semantics(
      button: true,
      label: '进入AI 助手',
      child: _HomePressable(
        onTap: onTap,
        child: Material(
          color: colors.surfaceContainerLow,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          clipBehavior: Clip.antiAlias,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 10, 8),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'AI 助手',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleMedium?.copyWith(
                          color: colors.onSurface,
                          fontWeight: FontWeight.w800,
                          height: 1.05,
                        ),
                      ),
                      Text(
                        '梳理灵感与提示词',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                _HomeZoom(
                  child: Image.asset(
                    'assets/images/home_ai_assistant_v2.png',
                    key: const Key('home-assistant-visual'),
                    width: 48,
                    fit: BoxFit.contain,
                    alignment: Alignment.centerRight,
                    filterQuality: FilterQuality.medium,
                    excludeFromSemantics: true,
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

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.action,
    this.inverted = false,
    this.onAction,
    this.actionKey,
  });

  final String title;
  final String action;
  final bool inverted;
  final VoidCallback? onAction;
  final Key? actionKey;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final muted = inverted ? Colors.white54 : colors.onSurfaceVariant;
    final ink = inverted ? Colors.white : colors.onSurface;
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
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.3,
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
                key: actionKey ?? const Key('all-prompts-action'),
                onTap: onAction,
                child: Text(
                  action,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: inverted
                        ? const Color(0xFFB8C3FF)
                        : colors.onSurfaceVariant,
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

class _HomeCategoryStrip extends StatelessWidget {
  const _HomeCategoryStrip({
    required this.categories,
    required this.selected,
    required this.onSelected,
    this.inverted = false,
  });

  final AsyncValue<List<GalleryCategory>> categories;
  final String? selected;
  final ValueChanged<String?> onSelected;
  final bool inverted;

  @override
  Widget build(BuildContext context) {
    final items = [
      (id: null, label: '全部'),
      ...?categories.valueOrNull?.map(
        (category) => (id: category.id, label: category.name),
      ),
    ];
    if (categories.isLoading && categories.valueOrNull == null) {
      return const _HomeCategorySkeleton();
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 2, 20, 10),
      child: Row(
        children: [
          for (final item in items) ...[
            _HomeTextTab(
              key: item.id == null ? null : Key('gallery-category-${item.id}'),
              label: item.label,
              selected: selected == item.id,
              inverted: inverted,
              onTap: () => onSelected(item.id),
            ),
            const SizedBox(width: 18),
          ],
        ],
      ),
    );
  }
}

class _HomeCategorySkeleton extends StatelessWidget {
  const _HomeCategorySkeleton();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.fromLTRB(20, 8, 20, 14),
      child: Row(
        children: [
          _HomeTabBone(width: 36),
          SizedBox(width: 18),
          _HomeTabBone(width: 44),
          SizedBox(width: 18),
          _HomeTabBone(width: 32),
          SizedBox(width: 18),
          _HomeTabBone(width: 40),
        ],
      ),
    );
  }
}

class _HomeTabBone extends StatelessWidget {
  const _HomeTabBone({this.width = 36});

  final double width;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainer,
        borderRadius: BorderRadius.circular(6),
      ),
      child: SizedBox(width: width, height: 12),
    );
  }
}

class _HomeTextTab extends StatelessWidget {
  const _HomeTextTab({
    required this.label,
    required this.selected,
    required this.onTap,
    this.inverted = false,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final bool inverted;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final color = inverted
        ? (selected ? Colors.white : Colors.white54)
        : (selected ? colors.onSurface : colors.onSurfaceVariant);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: color,
              fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            height: 2,
            width: selected ? 16 : 0,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(99),
            ),
          ),
        ],
      ),
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
      backgroundColor: inverted
          ? const Color(0xFF1A1C20)
          : colors.surfaceContainerLow,
      selectedColor: inverted ? const Color(0xFFB8C3FF) : colors.onSurface,
      side: BorderSide.none,
      shape: const StadiumBorder(),
      labelStyle: TextStyle(
        color: inverted
            ? (selected ? const Color(0xFF17204B) : Colors.white70)
            : (selected ? colors.surface : colors.onSurfaceVariant),
        fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
      ),
      visualDensity: VisualDensity.compact,
    );
  }
}

class _PromptStrip extends ConsumerWidget {
  const _PromptStrip({
    required this.items,
    required this.hasMore,
    required this.loadingMore,
    required this.loadMoreFailed,
    required this.onLoadMore,
    required this.onOpen,
  });

  final List<PromptItem> items;
  final bool hasMore;
  final bool loadingMore;
  final bool loadMoreFailed;
  final VoidCallback onLoadMore;
  final ValueChanged<PromptItem> onOpen;

  static const height = 258.0;
  static const cardWidth = 160.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final apiClient = ref.watch(apiClientProvider);
    return SizedBox(
      height: height,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(20, 0, 28, 0),
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        itemCount:
            items.length + (hasMore || loadingMore || loadMoreFailed ? 1 : 0),
        separatorBuilder: (_, _) => const SizedBox(width: 16),
        itemBuilder: (context, index) {
          if (index == items.length) {
            return SizedBox(
              width: cardWidth,
              child: _PromptLoadMoreCard(
                loading: loadingMore,
                failed: loadMoreFailed,
                onPressed: onLoadMore,
              ),
            );
          }
          final item = items[index];
          return SizedBox(
            width: cardWidth,
            child: _PromptImageCard(
              key: Key('home-prompt-${item.id}'),
              item: item,
              imageUrl: apiClient.resolveUrl(item.coverUrl ?? ''),
              onTap: () => onOpen(item),
              zoomCover: true,
            ),
          );
        },
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
        .resolveUrl(item.coverUrl ?? '');
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
              fontWeight: FontWeight.w800,
              height: 1.25,
              letterSpacing: -0.15,
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
        color: dark ? colors.surfaceContainerHigh : const Color(0xFFF2F2F7),
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

class _PromptImageCard extends StatelessWidget {
  const _PromptImageCard({
    required this.item,
    required this.imageUrl,
    required this.onTap,
    this.zoomCover = false,
    super.key,
  });

  final PromptItem item;
  final String imageUrl;
  final VoidCallback onTap;
  final bool zoomCover;

  @override
  Widget build(BuildContext context) {
    final cover = _PromptCover(
      url: imageUrl,
      zoom: zoomCover,
      liked: item.liked,
      likeCount: item.likeCount,
      favorited: item.favorited,
      favoriteCount: item.favoriteCount,
    );
    final body = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: cover),
        _PromptCardCaption(title: item.title),
      ],
    );
    return Semantics(
      button: true,
      label: item.title,
      child: zoomCover
          ? _HomePressable(onTap: onTap, child: body)
          : AppPressable(onTap: onTap, child: body),
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
    final fill = dark
        ? Theme.of(context).colorScheme.surfaceContainerHigh
        : const Color(0xFFF2F2F7);
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

class _PromptCardCaption extends StatelessWidget {
  const _PromptCardCaption({required this.title, this.titleColor});

  final String title;
  final Color? titleColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 10, 2, 0),
      child: Text(
        title,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
          color: titleColor,
          fontWeight: FontWeight.w700,
          height: 1.25,
          letterSpacing: -0.15,
        ),
      ),
    );
  }
}

class _PromptLoadMoreCard extends StatelessWidget {
  const _PromptLoadMoreCard({
    required this.loading,
    required this.failed,
    required this.onPressed,
  });

  final bool loading;
  final bool failed;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return GestureDetector(
      key: const Key('load-more-prompts'),
      behavior: HitTestBehavior.opaque,
      onTap: loading ? null : onPressed,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Theme.of(context).brightness == Brightness.dark
                    ? colors.surfaceContainerHigh
                    : const Color(0xFFF2F2F7),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? Colors.white10
                      : const Color(0x14000000),
                ),
              ),
              child: Center(
                child: loading
                    ? const SizedBox.shrink()
                    : Icon(
                        failed
                            ? Icons.refresh_rounded
                            : Icons.arrow_forward_rounded,
                        size: 22,
                        color: colors.primary,
                      ),
              ),
            ),
          ),
          _PromptCardCaption(
            title: loading
                ? '正在加载'
                : failed
                ? '重试'
                : '继续浏览',
            titleColor: colors.primary,
          ),
        ],
      ),
    );
  }
}

class _LoadMoreBand extends StatelessWidget {
  const _LoadMoreBand({
    required this.loading,
    required this.failed,
    required this.onPressed,
    this.inverted = false,
    this.noun = '作品',
    super.key,
  });

  final bool loading;
  final bool failed;
  final VoidCallback onPressed;
  final bool inverted;
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
          style: TextButton.styleFrom(
            foregroundColor: inverted
                ? Colors.white70
                : colors.onSurfaceVariant,
          ),
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
    final dark = Theme.of(context).brightness == Brightness.dark;
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
                                fontWeight: FontWeight.w800,
                                fontSize: 20,
                                letterSpacing: -0.4,
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
                      letterSpacing: 0.2,
                    ),
                  ),
                  const SizedBox(height: 8),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: dark
                          ? const Color(0xFF1C1E26)
                          : const Color(0xFFF2F2F7),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                      child: SelectableText(
                        _item.prompt,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          height: 1.55,
                          letterSpacing: -0.1,
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF22242C) : const Color(0xFFF2F2F7),
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    final accent = activeColor ?? colors.primary;
    return IconButton(
      tooltip: tooltip,
      onPressed: busy ? null : onPressed,
      style: IconButton.styleFrom(
        foregroundColor: active ? accent : colors.onSurface,
        backgroundColor: dark
            ? const Color(0xFF1C1E26)
            : const Color(0xFFF2F2F7),
        minimumSize: const Size.square(44),
        maximumSize: const Size.square(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
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

class _HomeGalleryStrip extends StatelessWidget {
  const _HomeGalleryStrip({
    required this.items,
    required this.inverted,
    required this.onOpen,
  });

  final List<GalleryItem> items;
  final bool inverted;
  final ValueChanged<GalleryItem> onOpen;

  @override
  Widget build(BuildContext context) => SizedBox(
    key: const Key('home-community-gallery'),
    height: 280,
    child: ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 0, 40, 0),
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      itemCount: items.length,
      separatorBuilder: (_, _) => const SizedBox(width: 14),
      itemBuilder: (context, index) {
        final item = items[index];
        return SizedBox(
          width: index == 0 ? 226 : 158,
          height: 280,
          child: _GalleryCard(
            item: item,
            inverted: inverted,
            overlay: true,
            zoomCover: true,
            fill: true,
            onOpen: () => onOpen(item),
          ),
        );
      },
    ),
  );
}

class _GalleryCard extends ConsumerWidget {
  const _GalleryCard({
    required this.item,
    required this.onOpen,
    this.inverted = false,
    this.overlay = false,
    this.zoomCover = false,
    this.fill = false,
  });

  final GalleryItem item;
  final VoidCallback onOpen;
  final bool inverted;
  final bool overlay;
  final bool zoomCover;
  final bool fill;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final imageUrl = ref
        .watch(apiClientProvider)
        .resolveUrl(item.coverUrl ?? '');
    final cover = Stack(
      fit: StackFit.expand,
      children: [
        zoomCover
            ? _HomeZoom(child: _PublicImage(url: imageUrl))
            : _PublicImage(url: imageUrl),
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
                    fontWeight: FontWeight.w800,
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
    if (fill) {
      return _HomePressable(
        onTap: onOpen,
        child: ClipRRect(borderRadius: BorderRadius.circular(20), child: cover),
      );
    }
    final card = AppSoftCard(
      color: inverted
          ? const Color(0xFF181A1D)
          : Theme.of(context).colorScheme.surface,
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
                    style: TextStyle(
                      color: inverted ? Colors.white : null,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
    );
    return zoomCover
        ? _HomePressable(onTap: onOpen, child: card)
        : AppPressable(onTap: onOpen, child: card);
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
    super.key,
  });

  final GalleryItem item;
  final List<String> imageUrls;

  @override
  State<GalleryDetailSheet> createState() => _GalleryDetailSheetState();
}

class _GalleryDetailSheetState extends State<GalleryDetailSheet> {
  late final PageController _pageController = PageController();
  int _index = 0;

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
                borderRadius: BorderRadius.circular(18),
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
                      fontWeight: FontWeight.w900,
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
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      if (item.createdAt != null)
                        Text(
                          DateFormat('yyyy年M月d日').format(item.createdAt!),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
                if (item.categoryName?.isNotEmpty == true)
                  Chip(
                    label: Text(item.categoryName!),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
            if (item.tags.isNotEmpty) ...[
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 7,
                children: [
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
  });

  final String url;
  final BoxFit fit;
  final int maxDecodePx;

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
            if (wasSynchronouslyLoaded || reduce) return child;
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
  const _SectionLoading({
    required this.height,
    this.inverted = false,
    this.featuredWidth,
    this.itemWidth,
    this.overlay = false,
  });

  final double height;
  final bool inverted;
  final double? featuredWidth;
  final double? itemWidth;
  final bool overlay;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final fallback = inverted ? 260.0 : 168.0;
    return SizedBox(
      height: height,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(20, 0, 40, 0),
        scrollDirection: Axis.horizontal,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: 3,
        separatorBuilder: (_, _) => const SizedBox(width: 14),
        itemBuilder: (context, index) {
          final width = index == 0
              ? (featuredWidth ?? fallback)
              : (itemWidth ?? fallback);
          final block = ColoredBox(
            color: inverted
                ? const Color(0xFF25282D)
                : colors.surfaceContainerLow,
          );
          return ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: SizedBox(
              width: width,
              child: overlay
                  ? block
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: block),
                        const SizedBox(height: 10),
                        ColoredBox(
                          color: inverted
                              ? const Color(0xFF34373C)
                              : colors.surfaceContainer,
                          child: const SizedBox(width: 88, height: 10),
                        ),
                      ],
                    ),
            ),
          );
        },
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({
    required this.message,
    required this.onRetry,
    this.inverted = false,
  });

  final String message;
  final VoidCallback onRetry;
  final bool inverted;

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
            child: Text(
              message,
              style: TextStyle(color: inverted ? Colors.white : null),
            ),
          ),
          IconButton(
            tooltip: '重试',
            onPressed: onRetry,
            icon: Icon(Icons.refresh, color: inverted ? Colors.white : null),
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
