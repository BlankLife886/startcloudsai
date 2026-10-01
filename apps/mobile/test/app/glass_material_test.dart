import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/glass_material.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/core/widgets/app_visual.dart';

void main() {
  testWidgets('neutral capsule buttons retain hit targets and press feedback', (
    tester,
  ) async {
    var taps = 0;
    final states = WidgetStatesController();
    addTearDown(states.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: StarCloudsTheme.dark(),
        home: Scaffold(
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                FilledButton(
                  key: const Key('primary'),
                  statesController: states,
                  onPressed: () => taps++,
                  child: const Text('Start project'),
                ),
                const OutlinedButton(onPressed: null, child: Text('Disabled')),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final button = find.byKey(const Key('primary'));
    final bounds = tester.getRect(button);
    expect(bounds.height, greaterThanOrEqualTo(52));
    expect(
      find.descendant(of: button, matching: find.byType(GlassBevel)),
      findsNothing,
    );
    expect(
      find.descendant(
        of: find.byType(OutlinedButton),
        matching: find.byType(GlassBevel),
      ),
      findsNothing,
    );
    final gesture = await tester.startGesture(bounds.center);
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.getRect(button), bounds);
    expect(states.value, contains(WidgetState.pressed));
    await gesture.up();
    await tester.pumpAndSettle();
    expect(taps, 1);
    expect(states.value, isNot(contains(WidgetState.pressed)));
    expect(tester.binding.transientCallbackCount, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'shared cards do not use colored bevels in either contrast mode',
    (tester) async {
      for (final contrast in [false, true]) {
        await tester.pumpWidget(
          MaterialApp(
            theme: StarCloudsTheme.light(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(highContrast: contrast),
              child: child!,
            ),
            home: const Scaffold(
              body: Center(
                child: AppGlassSurface(
                  child: Padding(
                    padding: EdgeInsets.all(20),
                    child: Text('Glass card'),
                  ),
                ),
              ),
            ),
          ),
        );
        expect(find.byType(GlassBevel), findsNothing);
        expect(find.byType(BackdropFilter), findsNothing);
        expect(tester.takeException(), isNull);
      }
    },
  );

  test('static bevel does not request repaints for unchanged material', () {
    final a = GlassBevelPainter(
      radius: BorderRadius.circular(24),
      cyan: StarCloudsPalette.cyan,
      violet: StarCloudsPalette.rose,
      pressed: false,
      sheen: false,
    );
    final b = GlassBevelPainter(
      radius: BorderRadius.circular(24),
      cyan: StarCloudsPalette.cyan,
      violet: StarCloudsPalette.rose,
      pressed: false,
      sheen: false,
    );
    expect(a.shouldRepaint(b), isFalse);
  });
}
