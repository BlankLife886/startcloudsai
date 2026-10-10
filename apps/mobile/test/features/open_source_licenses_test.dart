import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/features/profile/open_source_licenses_screen.dart';

const _licenses = [
  AppLicenseEntry(
    packages: ['dio'],
    text: 'MIT License\n\nPermission is hereby granted to use this software.',
  ),
  AppLicenseEntry(
    packages: ['flutter_secure_storage', 'secure_storage_platform_interface'],
    text: 'BSD 3-Clause License\n\nRedistribution and use are permitted.',
  ),
];

Widget _app({Brightness brightness = Brightness.light, double textScale = 1}) =>
    MaterialApp(
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
      home: OpenSourceLicensesScreen(loadLicenses: () async => _licenses),
    );

void main() {
  test('license search requires every keyword', () {
    expect(filterLicenseEntries(_licenses, 'secure BSD'), [_licenses[1]]);
    expect(filterLicenseEntries(_licenses, 'dio permission'), [_licenses[0]]);
    expect(filterLicenseEntries(_licenses, 'dio BSD'), isEmpty);
  });

  testWidgets('licenses search and expand on narrow dark large-text UI', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_app(brightness: Brightness.dark, textScale: 1.6));
    await tester.pumpAndSettle();

    expect(find.text('开源许可'), findsOneWidget);
    expect(find.text('3 个组件 · 2 份许可'), findsOneWidget);
    expect(find.text('dio'), findsOneWidget);
    expect(find.textContaining('flutter_secure_storage'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.enterText(
      find.byKey(const Key('license-search')),
      'secure BSD',
    );
    await tester.pump();
    expect(find.text('dio'), findsNothing);
    expect(find.textContaining('flutter_secure_storage'), findsOneWidget);

    await tester.tap(find.textContaining('flutter_secure_storage'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Redistribution and use'), findsOneWidget);
    expect(find.byType(SelectableText), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const Key('license-search-clear')));
    await tester.pumpAndSettle();
    expect(find.text('dio'), findsOneWidget);
  });
}
