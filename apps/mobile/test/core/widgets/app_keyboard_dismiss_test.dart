import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/widgets/app_keyboard_dismiss.dart';

void main() {
  testWidgets('blank taps dismiss the current text input', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final focusNode = FocusNode();
    addTearDown(focusNode.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: AppKeyboardDismiss(
          child: Scaffold(
            body: Column(
              children: [
                TextField(key: const Key('field'), focusNode: focusNode),
                const Expanded(child: SizedBox.expand(key: Key('blank-area'))),
              ],
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('field')));
    await tester.pump();
    expect(focusNode.hasFocus, isTrue);

    await tester.tapAt(const Offset(195, 300));
    await tester.pump();
    expect(focusNode.hasFocus, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('dragging a list dismisses input without consuming the scroll', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final focusNode = FocusNode();
    final scrollController = ScrollController();
    addTearDown(focusNode.dispose);
    addTearDown(scrollController.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: AppKeyboardDismiss(
          child: Scaffold(
            body: Column(
              children: [
                TextField(key: const Key('field'), focusNode: focusNode),
                Expanded(
                  child: ListView.builder(
                    controller: scrollController,
                    itemExtent: 60,
                    itemCount: 30,
                    itemBuilder: (_, index) => Text('结果 $index'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('field')));
    await tester.pump();
    expect(focusNode.hasFocus, isTrue);

    await tester.drag(find.text('结果 3'), const Offset(0, -180));
    await tester.pump(const Duration(milliseconds: 500));
    expect(focusNode.hasFocus, isFalse);
    expect(scrollController.offset, greaterThan(0));
    expect(tester.takeException(), isNull);
  });
}
