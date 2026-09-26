import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/widgets/app_privacy_boundary.dart';

Widget _app({
  required VoidCallback onPressed,
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) => MaterialApp(
  theme: ThemeData(brightness: brightness, useMaterial3: true),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: child!,
  ),
  home: AppPrivacyBoundary(
    child: Scaffold(
      body: Center(
        child: FilledButton(
          key: const Key('private-action'),
          onPressed: onPressed,
          child: const Text('creator@example.com 的私密内容'),
        ),
      ),
    ),
  ),
);

void main() {
  test('privacy shield lifecycle mapping covers app switcher states', () {
    expect(appLifecycleNeedsPrivacyShield(AppLifecycleState.resumed), isFalse);
    expect(appLifecycleNeedsPrivacyShield(AppLifecycleState.inactive), isTrue);
    expect(appLifecycleNeedsPrivacyShield(AppLifecycleState.paused), isTrue);
    expect(appLifecycleNeedsPrivacyShield(AppLifecycleState.hidden), isTrue);
    expect(appLifecycleNeedsPrivacyShield(AppLifecycleState.detached), isFalse);
  });

  testWidgets('background state blocks private interaction until resume', (
    tester,
  ) async {
    var presses = 0;
    addTearDown(
      () => tester.binding.handleAppLifecycleStateChanged(
        AppLifecycleState.resumed,
      ),
    );
    await tester.pumpWidget(_app(onPressed: () => presses += 1));

    expect(find.byKey(const Key('app-privacy-shield')), findsNothing);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();

    expect(find.byKey(const Key('app-privacy-shield')), findsOneWidget);
    expect(find.text('内容已隐藏'), findsOneWidget);
    await tester.tap(
      find.byKey(const Key('private-action')),
      warnIfMissed: false,
    );
    expect(presses, 0);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(find.byKey(const Key('app-privacy-shield')), findsNothing);
    await tester.tap(find.byKey(const Key('private-action')));
    expect(presses, 1);
  });

  testWidgets('privacy shield fits narrow dark large-text layout', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 568));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    addTearDown(
      () => tester.binding.handleAppLifecycleStateChanged(
        AppLifecycleState.resumed,
      ),
    );
    await tester.pumpWidget(
      _app(onPressed: () {}, brightness: Brightness.dark, textScale: 1.6),
    );

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();

    expect(find.text('星空云绘'), findsOneWidget);
    expect(find.text('内容已隐藏'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
