import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/core/network/api_exception.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';
import 'package:starcloudsai_mobile/features/discover/discover.dart';
import 'package:starcloudsai_mobile/features/discover/discover_screen.dart';
import 'package:starcloudsai_mobile/features/gallery/gallery.dart';
import 'package:starcloudsai_mobile/features/shell/app_shell.dart';

class _FakeSessionController extends SessionController {
  _FakeSessionController({this.authenticated = false});

  final bool authenticated;

  @override
  SessionState build() => SessionState(
    user: authenticated
        ? const AppUser(
            id: 'user-1',
            email: 'mobileqa@gmail.com',
            username: '星空用户',
          )
        : null,
  );
}

const _promptCategories = [
  PromptCategory(key: 'poster', label: '海报', count: 8, sort: 10),
  PromptCategory(key: 'portrait', label: '人像', count: 5, sort: 20),
];

const _galleryCategories = [
  GalleryCategory(id: 'gallery-poster', name: '海报', sort: 10),
  GalleryCategory(id: 'gallery-photo', name: '摄影', sort: 20),
];

PromptPage _promptPage(PromptQuery query, {String? nextCursor}) {
  final noMatch = query.search == '没有结果';
  final title = query.category == 'portrait'
      ? '人像灵感'
      : query.search.isEmpty
      ? '默认灵感'
      : '${query.search}灵感';
  return PromptPage(
    items: noMatch
        ? const []
        : [
            PromptItem(
              id: 'prompt-${query.search}-${query.category}',
              title: title,
              prompt: '电影感光影，浅景深，细腻色彩，高质量商业人像',
              taskType: 't2i',
              category: '人像人物',
              tags: const ['测试', '灵感'],
              likeCount: 2,
              favoriteCount: 4,
              useCount: 9,
            ),
          ],
    total: noMatch
        ? 0
        : nextCursor == null
        ? 1
        : 2,
    categoryCounts: const {'poster': 8, 'portrait': 5},
    tags: const ['测试'],
    nextCursor: nextCursor,
  );
}

GalleryPage _galleryPage(GalleryQuery query, {String? nextCursor}) =>
    GalleryPage(
      items: [
        GalleryItem(
          id: 'gallery-${query.category}',
          title: query.category == 'gallery-photo' ? '摄影作品' : '默认作品',
          authorId: 'author-1',
          authorName: '星空用户',
          featured: true,
          tags: const ['精选'],
          categoryId: query.category ?? 'gallery-poster',
          categoryName: query.category == 'gallery-photo' ? '摄影' : '海报',
          mediaDisplayUrls: const ['', ''],
          createdAt: DateTime(2026, 8, 24),
        ),
      ],
      nextCursor: nextCursor,
    );

Widget _app({
  required List<PromptQuery> promptRequests,
  required List<GalleryQuery> galleryRequests,
  double textScale = 1,
  bool authenticated = false,
  bool paginated = false,
  bool failPromptLoadMoreOnce = false,
  bool emptyGallery = false,
  bool communityOnly = false,
  bool promptLibraryOnly = false,
  Brightness brightness = Brightness.light,
  List<PromptPageRequest>? promptPageRequests,
  List<GalleryPageRequest>? galleryPageRequests,
}) {
  var promptLoadMoreAttempts = 0;
  final screen = DiscoverScreen(
    searchDebounce: const Duration(milliseconds: 100),
    communityOnly: communityOnly,
    promptLibraryOnly: promptLibraryOnly,
  );
  return ProviderScope(
    overrides: [
      sessionControllerProvider.overrideWith(
        () => _FakeSessionController(authenticated: authenticated),
      ),
      discoverPromptCategoriesProvider.overrideWith(
        (ref) async => _promptCategories,
      ),
      galleryCategoriesProvider.overrideWith((ref) async => _galleryCategories),
      discoverPromptPageProvider.overrideWith((ref, query) async {
        promptRequests.add(query);
        return _promptPage(query, nextCursor: paginated ? 'prompt-next' : null);
      }),
      discoverGalleryPageProvider.overrideWith((ref, query) async {
        galleryRequests.add(query);
        if (emptyGallery) return const GalleryPage(items: []);
        return _galleryPage(
          query,
          nextCursor: paginated ? 'gallery-next' : null,
        );
      }),
      discoverPromptPageRequestProvider.overrideWith((ref, request) async {
        promptPageRequests?.add(request);
        promptLoadMoreAttempts += 1;
        if (failPromptLoadMoreOnce && promptLoadMoreAttempts == 1) {
          throw Exception('temporary prompt paging failure');
        }
        final first = _promptPage(request.query).items.single;
        return PromptPage(
          items: [
            first,
            PromptItem(
              id: 'prompt-more-${request.query.category}',
              title: '更多灵感',
              prompt: '第二页提示词',
              taskType: 't2i',
              tags: const ['分页'],
            ),
          ],
          total: 2,
          categoryCounts: const {},
          tags: const [],
        );
      }),
      discoverGalleryPageRequestProvider.overrideWith((ref, request) async {
        galleryPageRequests?.add(request);
        final first = _galleryPage(request.query).items.single;
        return GalleryPage(
          items: [
            first,
            GalleryItem(
              id: 'gallery-more-${request.query.category}',
              title: '更多作品',
              authorId: 'author-2',
              authorName: '第二位创作者',
              featured: false,
              tags: const ['分页'],
            ),
          ],
        );
      }),
    ],
    child: MaterialApp(
      theme: StarCloudsTheme.light(),
      darkTheme: StarCloudsTheme.dark(),
      themeMode: brightness == Brightness.dark
          ? ThemeMode.dark
          : ThemeMode.light,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: screen,
    ),
  );
}

void main() {
  testWidgets('home follows light and dark page surfaces', (tester) async {
    for (final brightness in Brightness.values) {
      final expectedTheme = brightness == Brightness.dark
          ? StarCloudsTheme.dark()
          : StarCloudsTheme.light();
      await tester.pumpWidget(
        _app(promptRequests: [], galleryRequests: [], brightness: brightness),
      );
      await tester.pumpAndSettle();

      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
      expect(scaffold.backgroundColor, expectedTheme.colorScheme.surface);
      expect(find.byType(AppBar), findsNothing);
      expect(find.byKey(const Key('home-tabs')), findsNothing);
      expect(find.text('今天，做点新东西'), findsNothing);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('home has no sidebar toggle, account icon, or drawer', (
    tester,
  ) async {
    await tester.pumpWidget(_app(promptRequests: [], galleryRequests: []));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-sidebar-toggle')), findsNothing);
    expect(find.byType(HomeSidebarIcon), findsNothing);
    expect(find.byTooltip('展开侧栏'), findsNothing);
    expect(find.byTooltip('登录'), findsNothing);
    expect(find.byTooltip('我的账号'), findsNothing);
    expect(find.byKey(const Key('home-sidebar')), findsNothing);
    expect(
      find.descendant(
        of: find.byType(AppBar),
        matching: find.byType(IconButton),
      ),
      findsNothing,
    );
    await tester.flingFrom(const Offset(4, 240), const Offset(280, 0), 1200);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('home-sidebar')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('home primary actions expose creation and assistant workflows', (
    tester,
  ) async {
    var createTaps = 0;
    var assistantTaps = 0;
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => AppNoticeHost(child: child!),
        home: Scaffold(
          body: HomePrimaryActions(
            onCreate: () => createTaps += 1,
            onAssistant: () => assistantTaps += 1,
          ),
        ),
      ),
    );

    expect(find.text('文生图'), findsOneWidget);
    expect(find.text('AI 助手'), findsOneWidget);
    expect(find.byKey(const Key('home-creation-visual')), findsOneWidget);
    expect(find.byKey(const Key('home-assistant-visual')), findsOneWidget);
    final createBounds = tester.getRect(
      find.byKey(const Key('home-create-action')),
    );
    final assistantBounds = tester.getRect(
      find.byKey(const Key('home-assistant-action')),
    );
    expect(createBounds.bottom, lessThan(assistantBounds.top));
    expect(createBounds.left, assistantBounds.left);
    expect(createBounds.width, assistantBounds.width);
    expect(createBounds.height, greaterThan(assistantBounds.height));
    expect(createBounds.height, lessThan(190));
    final createMaterial = tester.widget<Material>(
      find
          .descendant(
            of: find.byKey(const Key('home-create-action')),
            matching: find.byType(Material),
          )
          .first,
    );
    final createShape = createMaterial.shape! as RoundedRectangleBorder;
    expect(createShape.borderRadius, BorderRadius.circular(22));
    expect(createMaterial.color, const Color(0xFFDCE3FF));
    final visualBounds = tester.getRect(
      find.byKey(const Key('home-creation-visual')),
    );
    expect(createBounds.contains(visualBounds.topLeft), isTrue);
    expect(createBounds.contains(visualBounds.bottomRight), isTrue);
    await tester.tap(find.byKey(const Key('home-create-action')));
    await tester.tap(find.byKey(const Key('home-assistant-action')));
    expect(createTaps, 1);
    expect(assistantTaps, 1);
  });

  testWidgets('home primary actions fit narrow screens with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: Scaffold(
          body: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: HomePrimaryActions(onCreate: () {}, onAssistant: () {}),
          ),
        ),
      ),
    );

    expect(find.text('文生图'), findsOneWidget);
    expect(find.text('AI 助手'), findsOneWidget);
    expect(find.text('从一句描述开始'), findsOneWidget);
    expect(find.text('梳理灵感与提示词'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'home requests only latest prompts and keeps discovery controls out',
    (tester) async {
      final promptRequests = <PromptQuery>[];
      await tester.pumpWidget(
        _app(promptRequests: promptRequests, galleryRequests: []),
      );
      await tester.pumpAndSettle();

      expect(promptRequests, [const PromptQuery(sort: 'latest', limit: 8)]);
      expect(find.byKey(const Key('home-tabs')), findsNothing);
      expect(find.byKey(const Key('home-tab-home')), findsNothing);
      expect(find.byKey(const Key('home-tab-prompts')), findsNothing);
      expect(find.byKey(const Key('home-tab-community')), findsNothing);
      expect(find.text('提示词'), findsOneWidget);
      expect(find.byKey(const Key('all-prompts-action')), findsOneWidget);
      expect(find.byType(SearchBar), findsNothing);
      expect(find.byKey(const Key('prompt-category-portrait')), findsNothing);
      final card = find.byKey(const Key('home-prompt-prompt--null'));
      expect(card, findsOneWidget);
      final title = find.descendant(of: card, matching: find.text('默认灵感'));
      expect(title, findsOneWidget);
      expect(
        find.descendant(of: card, matching: find.text('2')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: card, matching: find.text('4')),
        findsOneWidget,
      );
      expect(
        tester
            .getCenter(find.descendant(of: card, matching: find.text('2')))
            .dy,
        lessThan(tester.getCenter(title).dy),
      );
      expect(tester.getRect(card).height, 258);
      expect(
        tester.getCenter(title).dy,
        greaterThan(tester.getCenter(card).dy),
      );
      expect(tester.takeException(), isNull);
    },
  );

  test('prompt items and engagement responses preserve interaction state', () {
    final item = PromptItem.fromJson({
      'id': 'prompt-1',
      'title': '商业人像',
      'prompt': '电影感人像提示词',
      'taskType': 't2i',
      'category': 'portrait',
      'tags': ['电影感'],
      'likeCount': 12,
      'favoriteCount': 8,
      'useCount': 30,
      'liked': true,
      'favorited': true,
    });
    final engagement = PromptEngagement.fromJson({
      'action': 'favorite',
      'active': false,
      'likeCount': 12,
      'favoriteCount': 7,
      'useCount': 30,
    });

    expect(item.category, 'portrait');
    expect(item.likeCount, 12);
    expect(item.liked, isTrue);
    expect(item.favorited, isTrue);
    expect(engagement.action, 'favorite');
    expect(engagement.active, isFalse);
    expect(engagement.favoriteCount, 7);
    expect(item.copyWith(favorited: false, favoriteCount: 7).favoriteCount, 7);
  });

  test(
    'gallery items preserve author, category and display media metadata',
    () {
      final item = GalleryItem.fromJson({
        'id': 'gallery-1',
        'title': '  夏日海报  ',
        'coverThumbUrl': '/thumb.jpg',
        'coverDisplayUrl': '/display-cover.jpg',
        'mediaUrls': ['/original-1.jpg', '/original-2.jpg'],
        'mediaDisplayUrls': ['/display-1.jpg', '/display-2.jpg'],
        'author': {
          'id': 'author-1',
          'username': '  ',
          'avatarUrl': '/avatar.jpg',
        },
        'category': {'id': 'category-1', 'name': '视觉设计'},
        'tags': ['海报', '夏日'],
        'featured': true,
        'createdAt': '2026-08-24T08:00:00Z',
      });

      expect(item.title, '夏日海报');
      expect(item.authorName, '星空创作者');
      expect(item.authorAvatarUrl, '/avatar.jpg');
      expect(item.categoryName, '视觉设计');
      expect(item.featured, isTrue);
      expect(item.coverUrl, '/thumb.jpg');
      expect(item.previewUrls, ['/display-1.jpg', '/display-2.jpg']);
      expect(item.createdAt, isNotNull);
    },
  );

  test('discover query value objects use their filter values for identity', () {
    expect(const PromptQuery(search: '海报'), const PromptQuery(search: '海报'));
    expect(
      const PromptQuery(search: '海报'),
      isNot(const PromptQuery(search: '人像')),
    );
    expect(
      const GalleryQuery(category: 'photo'),
      const GalleryQuery(category: 'photo'),
    );
    expect(const PromptQuery(favoritesOnly: true), isNot(const PromptQuery()));
    expect(
      const PromptPageRequest(
        query: PromptQuery(search: '海报'),
        cursor: 'next',
      ),
      const PromptPageRequest(
        query: PromptQuery(search: '海报'),
        cursor: 'next',
      ),
    );
    expect(
      const GalleryPageRequest(
        query: GalleryQuery(category: 'photo'),
        cursor: 'next',
      ),
      isNot(
        const GalleryPageRequest(
          query: GalleryQuery(category: 'photo'),
          cursor: 'other',
        ),
      ),
    );
  });

  testWidgets('prompt library paging merges uniquely and resets by query', (
    tester,
  ) async {
    final promptPageRequests = <PromptPageRequest>[];
    await tester.pumpWidget(
      _app(
        promptRequests: [],
        galleryRequests: [],
        promptLibraryOnly: true,
        paginated: true,
        promptPageRequests: promptPageRequests,
      ),
    );
    await tester.pumpAndSettle();

    expect(promptPageRequests, [
      const PromptPageRequest(query: PromptQuery(), cursor: 'prompt-next'),
    ]);
    expect(find.text('更多灵感'), findsOneWidget);
    expect(find.text('默认灵感'), findsOneWidget);

    await tester.drag(find.byType(CustomScrollView), const Offset(0, 500));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('prompt-category-portrait')));
    await tester.pumpAndSettle();
    expect(find.text('默认灵感'), findsNothing);
    expect(find.text('人像灵感'), findsOneWidget);
    expect(
      promptPageRequests.last,
      const PromptPageRequest(
        query: PromptQuery(category: 'portrait'),
        cursor: 'prompt-next',
      ),
    );

    expect(tester.takeException(), isNull);
  });

  testWidgets('failed prompt paging keeps content and can retry', (
    tester,
  ) async {
    final requests = <PromptPageRequest>[];
    await tester.pumpWidget(
      _app(
        promptRequests: [],
        galleryRequests: [],
        promptLibraryOnly: true,
        paginated: true,
        failPromptLoadMoreOnce: true,
        promptPageRequests: requests,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('默认灵感'), findsOneWidget);
    expect(find.text('加载失败，点击重试'), findsOneWidget);

    await tester.tap(find.byKey(const Key('load-more-prompts')));
    await tester.pumpAndSettle();
    expect(requests, hasLength(2));
    expect(find.text('更多灵感'), findsOneWidget);
    expect(find.text('加载失败，点击重试'), findsNothing);
  });

  testWidgets('signed-in users can filter favorites and open prompt details', (
    tester,
  ) async {
    final promptRequests = <PromptQuery>[];
    await tester.pumpWidget(
      _app(
        promptRequests: promptRequests,
        galleryRequests: [],
        authenticated: true,
        promptLibraryOnly: true,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('prompt-favorites-filter')), findsOneWidget);
    expect(find.byKey(const Key('prompt-library-masonry')), findsOneWidget);
    await tester.tap(find.byKey(const Key('prompt-favorites-filter')));
    await tester.pumpAndSettle();
    expect(promptRequests.last.favoritesOnly, isTrue);
    expect(promptRequests.last.category, isNull);

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('默认灵感'));
    await tester.pumpAndSettle();
    expect(find.byType(PromptDetailSheet), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(PromptDetailSheet),
        matching: find.text('电影感光影，浅景深，细腻色彩，高质量商业人像'),
      ),
      findsOneWidget,
    );
    expect(find.text('点赞 2'), findsOneWidget);
    expect(find.text('收藏 4'), findsOneWidget);
    expect(find.text('使用 9'), findsOneWidget);
  });

  testWidgets('prompt favorites and category filters are exclusive', (
    tester,
  ) async {
    final promptRequests = <PromptQuery>[];
    await tester.pumpWidget(
      _app(
        promptRequests: promptRequests,
        galleryRequests: [],
        authenticated: true,
        promptLibraryOnly: true,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('prompt-favorites-filter')));
    await tester.pumpAndSettle();
    expect(promptRequests.last, const PromptQuery(favoritesOnly: true));

    await tester.tap(find.byKey(const Key('prompt-category-portrait')));
    await tester.pumpAndSettle();
    expect(promptRequests.last, const PromptQuery(category: 'portrait'));
    expect(find.text('人像灵感'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('prompt detail supports copy, like, favorite and use actions', (
    tester,
  ) async {
    final actions = <(String, bool)>[];
    var used = false;
    String? clipboardText;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          clipboardText = (call.arguments as Map)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PromptDetailSheet(
            item: _promptPage(const PromptQuery()).items.single,
            imageUrl: '',
            authenticated: true,
            onEngage: (action, active) async {
              actions.add((action, active));
              return PromptEngagement(
                action: action,
                active: active,
                likeCount: action == 'like' && active ? 3 : 2,
                favoriteCount: action == 'favorite' && active ? 5 : 4,
                useCount: 9,
              );
            },
            onUse: () => used = true,
            onLogin: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byTooltip('复制提示词'));
    await tester.tap(find.byTooltip('复制提示词'));
    await tester.pump();
    expect(clipboardText, contains('电影感光影'));
    expect(find.text('提示词已复制'), findsOneWidget);
    AppNotice.hide(tester.element(find.byType(PromptDetailSheet)));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byTooltip('点赞'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('点赞'));
    await tester.pumpAndSettle();
    expect(actions.first, ('like', true));
    expect(find.text('点赞 3'), findsOneWidget);

    await tester.ensureVisible(find.byTooltip('收藏'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('收藏'));
    await tester.pumpAndSettle();
    expect(actions.last, ('favorite', true));
    expect(find.text('收藏 5'), findsOneWidget);

    await tester.ensureVisible(find.text('用这个灵感'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('用这个灵感'));
    expect(used, isTrue);
  });

  testWidgets('prompt reactions require login and recover from API errors', (
    tester,
  ) async {
    var loginRequested = false;
    var engagementCalls = 0;
    Future<PromptEngagement> failingEngagement(
      String action,
      bool active,
    ) async {
      engagementCalls += 1;
      throw const ApiException(code: 'request_failed', message: '收藏服务暂时不可用');
    }

    Widget detail({required bool authenticated}) => MaterialApp(
      home: Scaffold(
        body: PromptDetailSheet(
          item: _promptPage(const PromptQuery()).items.single,
          imageUrl: '',
          authenticated: authenticated,
          onEngage: failingEngagement,
          onUse: () {},
          onLogin: () => loginRequested = true,
        ),
      ),
    );

    await tester.pumpWidget(detail(authenticated: false));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byTooltip('收藏'));
    await tester.tap(find.byTooltip('收藏'));
    expect(loginRequested, isTrue);
    expect(engagementCalls, 0);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(detail(authenticated: true));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byTooltip('收藏'));
    await tester.tap(find.byTooltip('收藏'));
    await tester.pumpAndSettle();
    expect(engagementCalls, 1);
    expect(find.text('收藏服务暂时不可用'), findsOneWidget);
    expect(find.byTooltip('收藏'), findsOneWidget);
  });

  testWidgets('prompt detail fits a narrow phone with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: Scaffold(
          body: PromptDetailSheet(
            item: _promptPage(const PromptQuery()).items.single,
            imageUrl: '',
            authenticated: true,
            onEngage: (action, active) async => PromptEngagement(
              action: action,
              active: active,
              likeCount: 2,
              favoriteCount: 4,
              useCount: 9,
            ),
            onUse: () {},
            onLogin: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('默认灵感'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('用这个灵感'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('复制提示词'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('prompt detail caps height and pins actions to the bottom', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final base = _promptPage(const PromptQuery()).items.single;
    final item = PromptItem(
      id: base.id,
      title: base.title,
      prompt: List.filled(18, '电影感光影，浅景深，细腻色彩，高质量商业人像').join('\n'),
      taskType: base.taskType,
      category: base.category,
      tags: base.tags,
      likeCount: base.likeCount,
      favoriteCount: base.favoriteCount,
      useCount: base.useCount,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PromptDetailSheet(
            item: item,
            imageUrl: '',
            authenticated: true,
            onEngage: (action, active) async => PromptEngagement(
              action: action,
              active: active,
              likeCount: 2,
              favoriteCount: 4,
              useCount: 9,
            ),
            onUse: () {},
            onLogin: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final sheet = tester.getRect(find.byType(PromptDetailSheet));
    final actions = tester.getRect(
      find.byKey(const Key('prompt-detail-actions')),
    );
    expect(sheet.height, lessThanOrEqualTo(844 * 0.72 + 1));
    expect(actions.bottom, closeTo(sheet.bottom, 1));
    expect(find.byTooltip('复制提示词'), findsOneWidget);
    expect(find.text('用这个灵感'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('prompt detail image opens a fullscreen preview', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PromptDetailSheet(
            item: _promptPage(const PromptQuery()).items.single,
            imageUrl: '',
            authenticated: true,
            onEngage: (action, active) async => PromptEngagement(
              action: action,
              active: active,
              likeCount: 2,
              favoriteCount: 4,
              useCount: 9,
            ),
            onUse: () {},
            onLogin: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('全屏预览'));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryFullscreenViewer), findsOneWidget);
    expect(find.byType(InteractiveViewer), findsWidgets);
    await tester.tap(find.byTooltip('关闭预览'));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryFullscreenViewer), findsNothing);
  });

  testWidgets('community card opens a complete read-only detail sheet', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(promptRequests: [], galleryRequests: [], authenticated: true),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('默认作品'),
      280,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(find.text('默认作品'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('home-community-gallery')), findsOneWidget);
    await tester.tap(find.text('默认作品'));
    await tester.pumpAndSettle();

    expect(find.byType(GalleryDetailSheet), findsOneWidget);
    expect(find.text('星空用户'), findsWidgets);
    expect(find.text('海报'), findsWidgets);
    expect(find.text('2026年8月24日'), findsOneWidget);
    expect(find.byTooltip('全屏预览'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('gallery detail pages media and opens fullscreen at the index', (
    tester,
  ) async {
    final item = _galleryPage(const GalleryQuery()).items.single;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GalleryDetailSheet(item: item, imageUrls: const ['', '']),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('1/2'), findsOneWidget);

    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();
    expect(find.text('2/2'), findsOneWidget);

    await tester.tap(find.byTooltip('全屏预览'));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryFullscreenViewer), findsOneWidget);
    expect(find.byType(InteractiveViewer), findsWidgets);
    expect(
      find.descendant(
        of: find.byType(GalleryFullscreenViewer),
        matching: find.text('2/2'),
      ),
      findsOneWidget,
    );
    await tester.tap(find.byTooltip('关闭预览'));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryFullscreenViewer), findsNothing);
  });

  testWidgets('gallery detail fits narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final base = _galleryPage(const GalleryQuery()).items.single;
    final item = GalleryItem(
      id: base.id,
      title: '一张标题很长的精选社区视觉设计作品',
      authorId: base.authorId,
      authorName: '星空创作者测试账号',
      featured: true,
      tags: const ['视觉设计', '移动端', '长标签布局测试'],
      categoryName: '视觉设计',
      createdAt: DateTime(2026, 8, 24),
    );
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: Scaffold(
          body: GalleryDetailSheet(item: item, imageUrls: const ['']),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(item.title), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('长标签布局测试'));
    await tester.pumpAndSettle();
    expect(find.text(item.authorName), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('prompt search is debounced and only requests the last value', (
    tester,
  ) async {
    final promptRequests = <PromptQuery>[];
    final galleryRequests = <GalleryQuery>[];
    await tester.pumpWidget(
      _app(
        promptRequests: promptRequests,
        galleryRequests: galleryRequests,
        promptLibraryOnly: true,
      ),
    );
    await tester.pumpAndSettle();
    expect(promptRequests, [const PromptQuery()]);

    await tester.enterText(find.byType(SearchBar), '海');
    await tester.enterText(find.byType(SearchBar), '海报');
    await tester.pump(const Duration(milliseconds: 99));
    expect(promptRequests, hasLength(1));

    await tester.pump(const Duration(milliseconds: 1));
    await tester.pumpAndSettle();
    expect(promptRequests.last, const PromptQuery(search: '海报'));
    expect(promptRequests.where((query) => query.search.isNotEmpty), [
      const PromptQuery(search: '海报'),
    ]);
    expect(find.text('海报灵感'), findsOneWidget);
    expect(galleryRequests, isEmpty);
  });

  testWidgets(
    'search clearing and both category filters update independently',
    (tester) async {
      final promptRequests = <PromptQuery>[];
      final galleryRequests = <GalleryQuery>[];
      await tester.pumpWidget(
        _app(
          promptRequests: promptRequests,
          galleryRequests: galleryRequests,
          promptLibraryOnly: true,
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(SearchBar), '没有结果');
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pumpAndSettle();
      expect(find.text('没有匹配的提示词'), findsOneWidget);
      expect(galleryRequests, isEmpty);

      await tester.tap(find.byKey(const Key('clear-prompt-search')));
      await tester.pumpAndSettle();
      expect(find.text('默认灵感'), findsOneWidget);

      await tester.tap(find.byKey(const Key('prompt-category-portrait')));
      await tester.pumpAndSettle();
      expect(promptRequests.last.category, 'portrait');
      expect(find.text('人像灵感'), findsOneWidget);
      expect(galleryRequests, isEmpty);
      expect(promptRequests.last.category, 'portrait');
    },
  );

  testWidgets('discover controls and cards fit narrow width with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _app(
        promptRequests: [],
        galleryRequests: [],
        textScale: 1.6,
        paginated: true,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('提示词'), findsOneWidget);
    expect(find.byKey(const Key('all-prompts-action')), findsOneWidget);
    expect(find.byType(SearchBar), findsNothing);
    expect(find.byKey(const Key('prompt-category-portrait')), findsNothing);
    expect(find.byKey(const Key('load-more-prompts')), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.scrollUntilVisible(
      find.text('社区作品'),
      280,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('默认作品'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(
      find.byKey(const Key('load-more-gallery')),
      280,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('加载更多作品'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty community data does not leave a dead section on home', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(promptRequests: [], galleryRequests: [], emptyGallery: true),
    );
    await tester.pumpAndSettle();

    expect(find.text('提示词'), findsOneWidget);
    expect(find.text('社区作品'), findsNothing);
    expect(find.text('这个分类暂时没有公开作品'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('prompt library is a focused secondary destination', (
    tester,
  ) async {
    final promptRequests = <PromptQuery>[];
    await tester.pumpWidget(
      _app(
        promptRequests: promptRequests,
        galleryRequests: [],
        promptLibraryOnly: true,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('全部提示词'), findsOneWidget);
    expect(find.byKey(const Key('app-top-bar-back')), findsOneWidget);
    expect(find.byType(SearchBar), findsOneWidget);
    expect(find.byKey(const Key('prompt-category-portrait')), findsOneWidget);
    expect(find.textContaining('电影感光影'), findsOneWidget);
    expect(find.text('人像人物 · 9次使用'), findsOneWidget);
    expect(find.text('文生图'), findsNothing);
    expect(find.byKey(const Key('home-tabs')), findsNothing);
    expect(promptRequests, [const PromptQuery()]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('community mode is a dedicated gallery destination', (
    tester,
  ) async {
    final promptRequests = <PromptQuery>[];
    await tester.pumpWidget(
      _app(
        promptRequests: promptRequests,
        galleryRequests: [],
        communityOnly: true,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('社区'), findsOneWidget);
    expect(find.text('默认作品'), findsOneWidget);
    expect(find.byKey(const Key('home-community-gallery')), findsNothing);
    expect(find.text('搜索创作灵感'), findsNothing);
    expect(promptRequests, isEmpty);
    await tester.tap(find.byKey(const Key('gallery-category-gallery-photo')));
    await tester.pumpAndSettle();
    expect(find.text('摄影作品'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
