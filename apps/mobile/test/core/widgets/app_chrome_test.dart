import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/core/widgets/app_chrome.dart';
import 'package:starcloudsai_mobile/features/shell/app_shell.dart';

void main() {
  testWidgets('common picker controls expose state and keyboard actions', (
    tester,
  ) async {
    String selected = '快速';
    var pillSelected = false;
    var filterSelected = false;
    var backCount = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: StarCloudsTheme.light(),
        home: StatefulBuilder(
          builder: (context, setState) => Scaffold(
            body: Column(
              children: [
                AppBackButton(onPressed: () => backCount += 1),
                AppPickerTile(label: '深度思考', selected: true, onTap: () {}),
                AppSelectField<String>(
                  label: '推理强度',
                  value: selected,
                  options: const [
                    AppSelectOption(value: '快速', label: '快速'),
                    AppSelectOption(value: '深入', label: '深入'),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => selected = value);
                  },
                ),
                AppChoicePill(
                  semanticLabel: '只看未读',
                  label: const Text('未读'),
                  selected: pillSelected,
                  onSelected: (value) => setState(() => pillSelected = value),
                ),
                AppFilterChip(
                  label: '只看收藏',
                  icon: Icons.bookmark_outline,
                  selected: filterSelected,
                  onTap: () => setState(() => filterSelected = true),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    final pickerSemantics = tester
        .getSemantics(find.bySemanticsLabel('深度思考，已选择'))
        .getSemanticsData();
    expect(pickerSemantics.label, '深度思考，已选择');
    expect(pickerSemantics.flagsCollection.isButton, isTrue);
    expect(pickerSemantics.flagsCollection.isSelected, Tristate.isTrue);

    final selectSemantics = tester
        .getSemantics(find.bySemanticsLabel('推理强度，快速'))
        .getSemanticsData();
    expect(selectSemantics.label, '推理强度，快速');
    expect(selectSemantics.flagsCollection.isButton, isTrue);

    final pillSemantics = tester
        .getSemantics(find.bySemanticsLabel('只看未读'))
        .getSemanticsData();
    expect(pillSemantics.label, '只看未读');
    expect(pillSemantics.flagsCollection.isSelected, Tristate.isFalse);

    final filterSemantics = tester
        .getSemantics(find.bySemanticsLabel('只看收藏'))
        .getSemanticsData();
    expect(filterSemantics.flagsCollection.isButton, isTrue);
    expect(filterSemantics.flagsCollection.isSelected, Tristate.isFalse);
    final filterBox = tester.widget<AnimatedContainer>(
      find.byKey(const Key('app-filter-chip-surface')),
    );
    expect(filterBox.constraints?.maxHeight, 36);

    await tester.tap(find.byType(AppChoicePill));
    await tester.pump();
    expect(pillSelected, isTrue);
    expect(
      tester
          .getSemantics(find.bySemanticsLabel('只看未读'))
          .getSemanticsData()
          .flagsCollection
          .isSelected,
      Tristate.isTrue,
    );

    await tester.tap(find.byType(AppFilterChip));
    await tester.pumpAndSettle();
    expect(filterSelected, isTrue);
    expect(
      tester
          .getSemantics(find.bySemanticsLabel('只看收藏，已选择'))
          .getSemanticsData()
          .flagsCollection
          .isSelected,
      Tristate.isTrue,
    );

    await tester.tap(find.byType(AppBackButton));
    await tester.pump();
    expect(backCount, 1);

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('app sheets cover a parent bottom navigation bar', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        theme: StarCloudsTheme.light(),
        home: AppSidebarScaffold(
          bottomNavigationBar: AppBottomNavigationBar(
            selectedIndex: 0,
            onDestinationSelected: (_) {},
            activeCount: 0,
            unreadNotifications: 0,
          ),
          body: Navigator(
            onGenerateRoute: (settings) => MaterialPageRoute<void>(
              builder: (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    key: const Key('open-sheet'),
                    onPressed: () => showAppSheet<void>(
                      context: context,
                      builder: (_) => const SizedBox(
                        height: 240,
                        child: Text('sheet-body'),
                      ),
                    ),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('open-sheet')));
    await tester.pumpAndSettle();

    expect(find.text('sheet-body'), findsOneWidget);
    final sheetBounds = tester.getRect(find.byType(AppSheetScaffold));
    final navigationBounds = tester.getRect(
      find.byKey(const Key('app-bottom-navigation')),
    );
    expect(sheetBounds.bottom, greaterThanOrEqualTo(navigationBounds.bottom));
    expect(find.byKey(const Key('app-sheet-handle')), findsOneWidget);
    expect(find.byKey(const Key('app-sheet-close')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('app sheet chrome can close from the top-right action', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        theme: StarCloudsTheme.light(),
        home: Scaffold(
          body: Center(
            child: Builder(
              builder: (context) => TextButton(
                key: const Key('open-sheet'),
                onPressed: () => showAppSheet<void>(
                  context: context,
                  builder: (_) =>
                      const SizedBox(height: 200, child: Text('sheet-body')),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('open-sheet')));
    await tester.pumpAndSettle();

    expect(find.text('sheet-body'), findsOneWidget);
    final handle = tester.getRect(find.byKey(const Key('app-sheet-handle')));
    final close = tester.getRect(find.byKey(const Key('app-sheet-close')));
    final sheet = tester.getRect(find.byType(AppSheetScaffold));
    expect(handle.center.dx, closeTo(195, 12));
    expect(handle.width, 64);
    expect(handle.height, 5);
    expect(handle.top - sheet.top, lessThan(12));
    expect(close.right, greaterThan(handle.right));
    expect(close.width, 28);
    expect(close.height, 28);

    await tester.tap(find.byKey(const Key('app-sheet-close')));
    await tester.pumpAndSettle();

    expect(find.text('sheet-body'), findsNothing);
    expect(find.byType(AppSheetScaffold), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('app dialog opens centered and closes with a short motion', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        theme: StarCloudsTheme.light(),
        home: AppSidebarScaffold(
          bottomNavigationBar: AppBottomNavigationBar(
            selectedIndex: 0,
            onDestinationSelected: (_) {},
            activeCount: 0,
            unreadNotifications: 0,
          ),
          body: Navigator(
            onGenerateRoute: (settings) => MaterialPageRoute<void>(
              builder: (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    key: const Key('open-dialog'),
                    onPressed: () => showAppDialog<void>(
                      context: context,
                      builder: (_) => const AppDialog(
                        title: Text('确认删除'),
                        content: Text('删除后无法恢复'),
                        actions: [Text('取消')],
                      ),
                    ),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('open-dialog')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));
    expect(find.text('确认删除'), findsOneWidget);
    expect(find.text('删除后无法恢复'), findsOneWidget);
    expect(find.byType(Dialog), findsNothing);

    final dialog = tester.getRect(find.byKey(const Key('app-dialog-card')));
    final navigation = tester.getRect(
      find.byKey(const Key('app-bottom-navigation')),
    );
    expect(dialog.center.dx, closeTo(195, 8));
    expect(dialog.bottom, lessThan(navigation.top));

    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(12, 12));
    await tester.pumpAndSettle();
    expect(find.text('确认删除'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
