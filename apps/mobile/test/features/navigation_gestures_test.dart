import 'dart:ui' show SemanticsAction, Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/app/glass_material.dart';
import 'package:starcloudsai_mobile/features/shell/app_shell.dart';

class _Harness extends StatefulWidget {
  const _Harness({
    this.rtl = false,
    this.reduce = false,
    this.accept = true,
    this.dark = false,
    this.highContrast = false,
    super.key,
  });
  final bool rtl;
  final bool reduce;
  final bool accept;
  final bool dark;
  final bool highContrast;

  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  int selected = 0;
  int unread = 0;
  final selections = <int>[];

  void selectExternally(int value) => setState(() => selected = value);
  void updateBadge() => setState(() => unread = 12);

  @override
  Widget build(BuildContext context) => MaterialApp(
    theme: widget.dark ? StarCloudsTheme.dark() : StarCloudsTheme.light(),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        disableAnimations: widget.reduce,
        highContrast: widget.highContrast,
      ),
      child: Directionality(
        textDirection: widget.rtl ? TextDirection.rtl : TextDirection.ltr,
        child: child!,
      ),
    ),
    home: Scaffold(
      bottomNavigationBar: AppBottomNavigationBar(
        selectedIndex: selected,
        activeCount: 2,
        unreadNotifications: unread,
        onDestinationSelected: (value) {
          selections.add(value);
          if (widget.accept) setState(() => selected = value);
        },
      ),
    ),
  );
}

Finder _item(int index) => find.byKey(Key('bottom-nav-item-$index'));
final _lens = find.byKey(const Key('bottom-nav-selection'));
final _bar = find.byKey(const Key('app-bottom-navigation'));

Future<GlobalKey<_HarnessState>> _mount(
  WidgetTester tester, {
  bool reduce = false,
  bool rtl = false,
  bool accept = true,
  bool dark = false,
  bool highContrast = false,
}) async {
  await tester.binding.setSurfaceSize(const Size(390, 180));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final key = GlobalKey<_HarnessState>();
  await tester.pumpWidget(
    _Harness(
      key: key,
      reduce: reduce,
      rtl: rtl,
      accept: accept,
      dark: dark,
      highContrast: highContrast,
    ),
  );
  await tester.pumpAndSettle();
  return key;
}

void main() {
  testWidgets(
    'all five destinations keep fixed hit targets and assistant stays centered',
    (tester) async {
      final key = await _mount(tester);
      final originalBar = tester.getRect(_bar);
      for (var index = 0; index < 5; index++) {
        await tester.tap(_item(index));
        await tester.pumpAndSettle();
        expect(key.currentState!.selected, index);
        expect(
          tester.getCenter(_lens).dx,
          closeTo(tester.getCenter(_item(index)).dx, .1),
        );
        expect(tester.getSize(_item(index)).width, greaterThanOrEqualTo(48));
        expect(tester.getRect(_bar), originalBar);
        expect(
          tester.getCenter(find.byKey(const Key('bottom-nav-ai-button'))).dx,
          closeTo(originalBar.center.dx, .1),
        );
        expect(
          tester
              .getSemantics(_item(index))
              .getSemanticsData()
              .flagsCollection
              .isSelected,
          Tristate.isTrue,
        );
      }
      expect(key.currentState!.selections, [0, 1, 2, 3, 4]);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'wide layouts constrain the independent dock instead of stretching it',
    (tester) async {
      await _mount(tester);
      await tester.binding.setSurfaceSize(const Size(900, 600));
      await tester.pumpAndSettle();
      final frame = tester.getRect(find.byKey(const Key('bottom-nav-frame')));
      expect(frame.width, 536);
      expect(frame.center.dx, 450);
      expect(tester.getCenter(_item(2)).dx, 450);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'navigation uses white highlights and neutral shadows without a colored bevel',
    (tester) async {
      for (final dark in [false, true]) {
        await _mount(tester, dark: dark);
        final frame =
            tester
                    .widget<DecoratedBox>(
                      find
                          .descendant(
                            of: find.byKey(const Key('bottom-nav-frame')),
                            matching: find.byType(DecoratedBox),
                          )
                          .first,
                    )
                    .decoration
                as BoxDecoration;
        expect(frame.border?.top.width, 1);
        expect(frame.boxShadow, hasLength(1));
        expect(frame.boxShadow!.single.blurRadius, 20);
        final gradient = frame.gradient! as LinearGradient;
        for (final color in gradient.colors) {
          expect(color.computeLuminance(), lessThan(.05));
        }
        expect(
          find.descendant(of: _bar, matching: find.byType(GlassBevel)),
          findsNothing,
        );
        final border = frame.border!.top.color;
        expect(border.r, 1);
        expect(border.g, 1);
        expect(border.b, 1);
        final shadow = frame.boxShadow!.single.color;
        expect(shadow.r, 0);
        expect(shadow.g, 0);
        expect(shadow.b, 0);
        final selection =
            tester
                    .widget<DecoratedBox>(
                      find
                          .descendant(
                            of: _lens,
                            matching: find.byType(DecoratedBox),
                          )
                          .first,
                    )
                    .decoration
                as BoxDecoration;
        expect(selection.border!.top.color, Colors.white.withValues(alpha: .5));
        expect(tester.takeException(), isNull);
      }
    },
  );

  testWidgets(
    'high contrast keeps an opaque frame and clear outline without shadow',
    (tester) async {
      await _mount(tester, highContrast: true);
      final frame =
          tester
                  .widget<DecoratedBox>(
                    find
                        .descendant(
                          of: find.byKey(const Key('bottom-nav-frame')),
                          matching: find.byType(DecoratedBox),
                        )
                        .first,
                  )
                  .decoration
              as BoxDecoration;
      expect(frame.color?.a, 1);
      expect(frame.border?.top.width, 1.5);
      expect(frame.gradient, isNull);
      expect(frame.boxShadow, isNull);
    },
  );

  testWidgets(
    'tap moves one selection lens continuously and exposes accessible actions',
    (tester) async {
      final key = await _mount(tester);
      final start = tester.getCenter(_lens).dx;
      final end = tester.getCenter(_item(4)).dx;
      expect(
        tester
            .getSemantics(_item(4))
            .getSemanticsData()
            .hasAction(SemanticsAction.tap),
        isTrue,
      );
      await tester.tap(_item(4));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 80));
      final moving = tester.getCenter(_lens).dx;
      expect(moving, greaterThan(start));
      expect(moving, lessThan(end));
      expect(_lens, findsOneWidget);
      await tester.pumpAndSettle();
      expect(tester.getCenter(_lens).dx, closeTo(end, .1));
      expect(key.currentState!.selections, [4]);
      expect(tester.binding.transientCallbackCount, 0);
    },
  );

  testWidgets(
    'horizontal drag previews each destination and commits only on release',
    (tester) async {
      final key = await _mount(tester);
      final originalBar = tester.getRect(_bar);
      final gesture = await tester.startGesture(tester.getCenter(_item(0)));
      for (final index in [1, 2, 3, 4]) {
        await gesture.moveTo(tester.getCenter(_item(index)));
        await tester.pump(const Duration(milliseconds: 16));
        expect(key.currentState!.selections, isEmpty);
        expect(
          tester.getCenter(_lens).dx,
          closeTo(tester.getCenter(_item(index)).dx, .1),
        );
      }
      expect(tester.getRect(_bar), originalBar);
      await gesture.up();
      await tester.pumpAndSettle();
      expect(key.currentState!.selections, [4]);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('hold then slide follows the finger and survives badge refresh', (
    tester,
  ) async {
    final key = await _mount(tester, dark: true);
    final gesture = await tester.startGesture(tester.getCenter(_item(0)));
    await tester.pump(const Duration(milliseconds: 600));
    final target = tester.getCenter(_item(2)) + const Offset(12, 0);
    await gesture.moveTo(target);
    await tester.pump(const Duration(milliseconds: 16));
    key.currentState!.updateBadge();
    await tester.pump();
    expect(tester.getCenter(_lens).dx, closeTo(target.dx, .1));
    expect(key.currentState!.selections, isEmpty);
    await gesture.up();
    await tester.pumpAndSettle();
    expect(key.currentState!.selections, [2]);
    expect(
      tester.getCenter(_lens).dx,
      closeTo(tester.getCenter(_item(2)).dx, .1),
    );
  });

  for (final hold in [false, true]) {
    testWidgets(
      'cancelling gesture (hold: $hold) restores the committed selection',
      (tester) async {
        final key = await _mount(tester);
        final start = tester.getCenter(_lens);
        final gesture = await tester.startGesture(tester.getCenter(_item(0)));
        if (hold) await tester.pump(const Duration(milliseconds: 600));
        await gesture.moveTo(tester.getCenter(_item(3)));
        await tester.pump(const Duration(milliseconds: 16));
        await gesture.cancel();
        await tester.pumpAndSettle();
        expect(key.currentState!.selections, isEmpty);
        expect(tester.getCenter(_lens).dx, closeTo(start.dx, .1));
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('external navigation wins over an in-flight drag', (
    tester,
  ) async {
    final key = await _mount(tester);
    final gesture = await tester.startGesture(tester.getCenter(_item(0)));
    await gesture.moveTo(tester.getCenter(_item(3)));
    await tester.pump();
    key.currentState!.selectExternally(1);
    await tester.pump();
    await gesture.up();
    await tester.pumpAndSettle();
    expect(key.currentState!.selections, isEmpty);
    expect(
      tester.getCenter(_lens).dx,
      closeTo(tester.getCenter(_item(1)).dx, .1),
    );
  });

  testWidgets(
    'rejected navigation returns the lens without changing selection',
    (tester) async {
      final key = await _mount(tester, accept: false);
      await tester.tap(_item(3));
      await tester.pumpAndSettle();
      expect(key.currentState!.selections, [3]);
      expect(
        tester.getCenter(_lens).dx,
        closeTo(tester.getCenter(_item(0)).dx, .1),
      );
    },
  );

  testWidgets(
    'right-to-left dragging maps to logical destinations and clamps at the edge',
    (tester) async {
      final key = await _mount(tester, rtl: true);
      final gesture = await tester.startGesture(tester.getCenter(_item(0)));
      await gesture.moveTo(Offset(-60, tester.getCenter(_item(4)).dy));
      await tester.pump();
      await gesture.up();
      await tester.pumpAndSettle();
      expect(key.currentState!.selections, [4]);
      expect(
        tester.getCenter(_lens).dx,
        closeTo(tester.getCenter(_item(4)).dx, .1),
      );
    },
  );

  testWidgets(
    'reduced motion snaps taps immediately but keeps direct manipulation',
    (tester) async {
      final key = await _mount(tester, reduce: true);
      await tester.tap(_item(2));
      await tester.pump();
      expect(
        tester.getCenter(_lens).dx,
        closeTo(tester.getCenter(_item(2)).dx, .1),
      );
      final gesture = await tester.startGesture(tester.getCenter(_item(2)));
      await gesture.moveTo(tester.getCenter(_item(1)));
      await tester.pump();
      expect(
        tester.getCenter(_lens).dx,
        closeTo(tester.getCenter(_item(1)).dx, .1),
      );
      await gesture.up();
      await tester.pumpAndSettle();
      expect(key.currentState!.selections, [2, 1]);
    },
  );

  testWidgets('rapid taps retarget from the current position without a jump', (
    tester,
  ) async {
    final key = await _mount(tester);
    await tester.tap(_item(3));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 80));
    final intermediate = tester.getCenter(_lens).dx;
    await tester.tap(_item(1));
    await tester.pump();
    expect(tester.getCenter(_lens).dx, closeTo(intermediate, .1));
    await tester.pumpAndSettle();
    expect(key.currentState!.selections, [3, 1]);
    expect(
      tester.getCenter(_lens).dx,
      closeTo(tester.getCenter(_item(1)).dx, .1),
    );
  });

  testWidgets(
    'reselect taps still notify but scrubbing back to the same item does not',
    (tester) async {
      final key = await _mount(tester);
      await tester.tap(_item(0));
      await tester.pumpAndSettle();
      final gesture = await tester.startGesture(tester.getCenter(_item(0)));
      await gesture.moveTo(tester.getCenter(_item(2)));
      await tester.pump();
      await gesture.moveTo(tester.getCenter(_item(0)));
      await tester.pump();
      await gesture.up();
      await tester.pumpAndSettle();
      expect(key.currentState!.selections, [0]);
    },
  );

  testWidgets('disposing during a hold releases its gesture and ticker', (
    tester,
  ) async {
    final key = await _mount(tester);
    final events = key.currentState!.selections;
    final gesture = await tester.startGesture(tester.getCenter(_item(0)));
    await tester.pump(const Duration(milliseconds: 600));
    await gesture.moveTo(tester.getCenter(_item(2)));
    await tester.pump();
    await tester.pumpWidget(const SizedBox());
    await gesture.cancel();
    await tester.pumpAndSettle();
    expect(events, isEmpty);
    expect(tester.binding.transientCallbackCount, 0);
    expect(tester.takeException(), isNull);
  });
}
