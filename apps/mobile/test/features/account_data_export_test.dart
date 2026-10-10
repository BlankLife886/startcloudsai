import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/network/api_exception.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';
import 'package:starcloudsai_mobile/features/profile/account_data_export.dart';
import 'package:starcloudsai_mobile/features/profile/account_data_export_screen.dart';

class _ReadyAccountDataExporter extends AccountDataExporter {
  _ReadyAccountDataExporter(this.file) : super(download: () async => const []);

  final File file;

  @override
  Future<File> export() async => file;
}

class _UnavailableAccountDataExporter extends AccountDataExporter {
  _UnavailableAccountDataExporter() : super(download: () async => const []);

  @override
  Future<File> export() => throw const ApiException(
    statusCode: 404,
    code: 'not_found',
    message: 'Not Found',
  );
}

void main() {
  test('exporter writes a timestamped JSON file', () async {
    final directory = await Directory.systemTemp.createTemp(
      'account-export-test',
    );
    addTearDown(() => directory.delete(recursive: true));
    final exporter = AccountDataExporter(
      download: () async => utf8.encode('{"schemaVersion":1}'),
      temporaryDirectory: () async => directory,
      now: () => DateTime(2026, 9, 2, 14, 5, 7),
    );

    final file = await exporter.export();

    expect(file.path, endsWith('starclouds-data-20260902-140507.json'));
    expect(await file.readAsString(), '{"schemaVersion":1}');
  });

  test('exporter rejects an empty response', () async {
    final exporter = AccountDataExporter(download: () async => const []);
    await expectLater(exporter.export(), throwsA(isA<FormatException>()));
  });

  testWidgets('data export shares the generated file and cleans it up', (
    tester,
  ) async {
    final directory = Directory.systemTemp.createTempSync('account-share-test');
    addTearDown(() {
      if (directory.existsSync()) directory.deleteSync(recursive: true);
    });
    final exportFile = File('${directory.path}/ready.json')
      ..writeAsStringSync('{"schemaVersion":1}');
    File? sharedFile;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          accountDataExporterProvider.overrideWithValue(
            _ReadyAccountDataExporter(exportFile),
          ),
          accountDataShareHandlerProvider.overrideWithValue((
            file,
            origin,
          ) async {
            sharedFile = file;
          }),
        ],
        child: const MaterialApp(
          home: AppNoticeHost(child: AccountDataExportScreen()),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('account-data-export-action')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 320));

    expect(sharedFile, isNotNull);
    expect(sharedFile!.path, exportFile.path);
    expect(find.text('数据副本已生成'), findsOneWidget);
    expect(exportFile.existsSync(), isFalse);
  });

  testWidgets('data export remains aligned on a narrow dark screen', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 680));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          themeMode: ThemeMode.dark,
          darkTheme: ThemeData.dark(useMaterial3: true),
          home: AccountDataExportScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('获取你的数据副本'), findsOneWidget);
    expect(find.text('包含内容'), findsOneWidget);
    expect(find.byKey(const Key('account-data-export-action')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('missing export endpoint becomes an inline upgrade state', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          accountDataExporterProvider.overrideWithValue(
            _UnavailableAccountDataExporter(),
          ),
        ],
        child: const MaterialApp(
          home: AppNoticeHost(child: AccountDataExportScreen()),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('account-data-export-action')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 320));

    expect(find.text('数据导出服务升级中'), findsOneWidget);
    expect(find.byKey(const Key('account-data-export-action')), findsNothing);
    expect(find.bySemanticsLabel('数据导出服务升级中，请稍后再试'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
