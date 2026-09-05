import 'dart:ui' show SemanticsAction;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/widgets/app_visual.dart';

void main() {
  testWidgets(
    'pressable exposes a button role and supports keyboard activation',
    (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: AppPressable(
                onTap: () => taps += 1,
                child: const SizedBox(
                  key: Key('pressable-content'),
                  width: 160,
                  height: 48,
                  child: Center(child: Text('打开收藏')),
                ),
              ),
            ),
          ),
        ),
      );

      final semantics = tester
          .getSemantics(find.byType(AppPressable))
          .getSemanticsData();
      expect(semantics.flagsCollection.isButton, isTrue);
      expect(semantics.hasAction(SemanticsAction.tap), isTrue);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      final focusDecoration =
          tester
                  .widget<AnimatedContainer>(find.byType(AnimatedContainer))
                  .foregroundDecoration!
              as BoxDecoration;
      expect(
        focusDecoration.border?.top.color,
        Theme.of(tester.element(find.byType(AppPressable))).colorScheme.primary,
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();

      expect(taps, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('pressable removes animation when reduce motion is enabled', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: Scaffold(
          body: AppPressable(onTap: () {}, child: const Text('操作')),
        ),
      ),
    );

    expect(
      tester.widget<AnimatedScale>(find.byType(AnimatedScale)).duration,
      Duration.zero,
    );
    expect(
      tester.widget<AnimatedContainer>(find.byType(AnimatedContainer)).duration,
      Duration.zero,
    );
    expect(tester.takeException(), isNull);
  });
}
