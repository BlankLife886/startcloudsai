import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/features/profile/legal_document_screen.dart';

void main() {
  test('legal documents expose dated, structured offline content', () {
    expect(termsOfServiceDocument.updatedAt, '2026-09-02');
    expect(privacyPolicyDocument.updatedAt, '2026-09-02');
    expect(termsOfServiceDocument.sections.length, greaterThanOrEqualTo(8));
    expect(privacyPolicyDocument.sections.length, greaterThanOrEqualTo(8));
    expect(privacyPolicyDocument.summary, contains('不进行跨应用跟踪'));
    expect(
      privacyPolicyDocument.sections.map((section) => section.body).join(),
      contains('Keychain'),
    );
  });

  testWidgets('legal pages fit narrow large text in light and dark modes', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    for (final brightness in [Brightness.light, Brightness.dark]) {
      for (final kind in LegalDocumentKind.values) {
        await tester.pumpWidget(
          MaterialApp(
            key: ValueKey('$brightness-$kind'),
            theme: StarCloudsTheme.light(),
            darkTheme: StarCloudsTheme.dark(),
            themeMode: brightness == Brightness.dark
                ? ThemeMode.dark
                : ThemeMode.light,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(1.6)),
              child: child!,
            ),
            home: LegalDocumentScreen(kind: kind),
          ),
        );
        await tester.pumpAndSettle();

        final document = legalDocumentFor(kind);
        expect(find.text(document.title), findsOneWidget);
        expect(find.byTooltip('返回'), findsOneWidget);
        expect(find.text('更新日期：${document.updatedAt}'), findsOneWidget);
        await tester.scrollUntilVisible(
          find.text(document.sections.last.title),
          280,
          scrollable: find.byType(Scrollable).first,
        );
        expect(find.text(document.sections.last.title), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
    }
  });
}
