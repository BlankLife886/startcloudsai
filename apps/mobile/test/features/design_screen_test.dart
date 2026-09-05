import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/features/create/creation_draft.dart';
import 'package:starcloudsai_mobile/features/design/design_screen.dart';

class _DraftStore implements CreationDraftStore {
  _DraftStore([this.draft]);

  CreationDraft? draft;

  @override
  Future<CreationDraft?> read() async => draft;

  @override
  Future<void> write(CreationDraft draft) async => this.draft = draft;

  @override
  Future<void> clear() async => draft = null;
}

Widget _scope(Widget child, {CreationDraftStore? store}) => ProviderScope(
  overrides: [
    creationDraftStoreProvider.overrideWithValue(store ?? _DraftStore()),
  ],
  child: child,
);

void main() {
  testWidgets('design hub exposes every tool on narrow large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _scope(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const DesignScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('design-tool-text-to-image')), findsOneWidget);
    expect(find.text('文生图'), findsOneWidget);
    expect(find.bySemanticsLabel('进入文生图'), findsOneWidget);
    for (final removed in ['模型设计', '插画染色', '智能去背景']) {
      expect(find.text(removed), findsNothing);
    }
    for (final keyName in ['model-sheet', 'coloring', 'background-remove']) {
      expect(find.byKey(Key('design-tool-$keyName')), findsNothing);
    }
    expect(find.byKey(const Key('design-open-works')), findsOneWidget);
    expect(find.byKey(const Key('design-open-assets')), findsOneWidget);
    final surface = tester.widget<DecoratedBox>(
      find.byKey(const Key('design-featured-surface')),
    );
    final decoration = surface.decoration as BoxDecoration;
    expect(decoration.borderRadius, BorderRadius.circular(8));
    expect(find.byKey(const Key('app-top-bar-back')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('flat creation entry follows light and dark surfaces', (
    tester,
  ) async {
    for (final brightness in Brightness.values) {
      final theme = brightness == Brightness.dark
          ? StarCloudsTheme.dark()
          : StarCloudsTheme.light();
      await tester.pumpWidget(
        _scope(
          MaterialApp(
            theme: StarCloudsTheme.light(),
            darkTheme: StarCloudsTheme.dark(),
            themeMode: brightness == Brightness.dark
                ? ThemeMode.dark
                : ThemeMode.light,
            home: const DesignScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final surface = tester.widget<DecoratedBox>(
        find.byKey(const Key('design-featured-surface')),
      );
      final decoration = surface.decoration as BoxDecoration;
      expect(decoration.color, theme.colorScheme.surfaceContainerLow);
      expect(decoration.borderRadius, BorderRadius.circular(8));
      expect(find.text('从一句描述开始'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('every design tool opens its processing page', (tester) async {
    final destinations = {'text-to-image': '/create'};
    final router = GoRouter(
      initialLocation: '/design',
      routes: [
        GoRoute(
          path: '/design',
          builder: (context, state) => const DesignScreen(),
        ),
        for (final destination in destinations.values)
          GoRoute(
            path: destination,
            builder: (context, state) =>
                Scaffold(body: Center(child: Text('处理页:$destination'))),
          ),
        GoRoute(
          path: '/works',
          builder: (context, state) => const SizedBox.shrink(),
        ),
        GoRoute(
          path: '/profile/assets',
          builder: (context, state) => const SizedBox.shrink(),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(_scope(MaterialApp.router(routerConfig: router)));

    for (final entry in destinations.entries) {
      final tool = find.byKey(Key('design-tool-${entry.key}'));
      await tester.ensureVisible(tool);
      await tester.tap(tool);
      await tester.pumpAndSettle();
      expect(find.text('处理页:${entry.value}'), findsOneWidget);
      router.go('/design');
      await tester.pumpAndSettle();
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('saved creation draft is visible and resumes from the hub', (
    tester,
  ) async {
    final store = _DraftStore(
      CreationDraft(
        prompt: '雨夜霓虹街道，电影感光影与湿润路面反射',
        count: 2,
        updatedAt: DateTime(2026, 8, 26, 10, 30),
      ),
    );
    final router = GoRouter(
      initialLocation: '/design',
      routes: [
        GoRoute(
          path: '/design',
          builder: (context, state) => const DesignScreen(),
        ),
        GoRoute(
          path: '/create',
          builder: (context, state) => const Scaffold(body: Text('草稿创作页')),
        ),
        GoRoute(
          path: '/works',
          builder: (context, state) => const SizedBox.shrink(),
        ),
        GoRoute(
          path: '/profile/assets',
          builder: (context, state) => const SizedBox.shrink(),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      _scope(MaterialApp.router(routerConfig: router), store: store),
    );
    await tester.pumpAndSettle();

    expect(find.text('继续上次创作'), findsOneWidget);
    expect(find.textContaining('雨夜霓虹街道'), findsOneWidget);
    expect(find.bySemanticsLabel('继续文生图草稿'), findsOneWidget);

    await tester.tap(find.byKey(const Key('design-tool-text-to-image')));
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/create');
    expect(find.text('草稿创作页'), findsOneWidget);

    store.draft = CreationDraft(
      prompt: '更新后的海边日落草稿',
      count: 1,
      updatedAt: DateTime(2026, 8, 26, 11),
    );
    router.pop();
    await tester.pumpAndSettle();
    expect(router.state.uri.path, '/design');
    expect(find.textContaining('更新后的海边日落草稿'), findsOneWidget);
    expect(find.textContaining('雨夜霓虹街道'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('saved draft can be cleared before starting a new creation', (
    tester,
  ) async {
    final store = _DraftStore(
      CreationDraft(
        prompt: '需要放弃的旧草稿',
        count: 1,
        updatedAt: DateTime(2026, 9, 2, 10),
      ),
    );
    final router = GoRouter(
      initialLocation: '/design',
      routes: [
        GoRoute(
          path: '/design',
          builder: (context, state) => const DesignScreen(),
        ),
        GoRoute(
          path: '/create',
          builder: (context, state) => const Scaffold(body: Text('空白创作页')),
        ),
        GoRoute(
          path: '/works',
          builder: (context, state) => const SizedBox.shrink(),
        ),
        GoRoute(
          path: '/profile/assets',
          builder: (context, state) => const SizedBox.shrink(),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      _scope(MaterialApp.router(routerConfig: router), store: store),
    );
    await tester.pumpAndSettle();

    expect(find.byTooltip('新建文生图'), findsOneWidget);
    await tester.tap(find.byKey(const Key('design-new-creation')));
    await tester.pumpAndSettle();
    expect(find.text('新建文生图？'), findsOneWidget);
    expect(router.state.uri.path, '/design');

    await tester.tap(find.widgetWithText(FilledButton, '清除并新建'));
    await tester.pumpAndSettle();

    expect(store.draft, isNull);
    expect(router.state.uri.path, '/create');
    expect(find.text('空白创作页'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
