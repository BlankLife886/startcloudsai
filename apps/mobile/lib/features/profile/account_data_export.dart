import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/providers.dart';

String accountDataExportFilename(DateTime now) {
  final local = now.toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return 'starclouds-data-${local.year}${two(local.month)}${two(local.day)}-'
      '${two(local.hour)}${two(local.minute)}${two(local.second)}.json';
}

class AccountDataExporter {
  AccountDataExporter({
    required Future<List<int>> Function() download,
    Future<Directory> Function()? temporaryDirectory,
    DateTime Function()? now,
  }) : _download = download,
       _temporaryDirectory = temporaryDirectory ?? getTemporaryDirectory,
       _now = now ?? DateTime.now;

  final Future<List<int>> Function() _download;
  final Future<Directory> Function() _temporaryDirectory;
  final DateTime Function() _now;

  Future<File> export() async {
    final bytes = await _download();
    if (bytes.isEmpty) throw const FormatException('导出文件为空，请稍后重试');
    final directory = await _temporaryDirectory();
    final file = File('${directory.path}/${accountDataExportFilename(_now())}');
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }
}

final accountDataExporterProvider = Provider<AccountDataExporter>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return AccountDataExporter(
    download: () => apiClient.getBytes(
      '/me/data-export',
      invalidUrlMessage: '数据导出地址无效',
      downloadFailedMessage: '账号数据导出失败',
    ),
  );
});
