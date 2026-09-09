import 'dart:io';

import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

class ReferenceImageDraft {
  const ReferenceImageDraft({
    required this.localPath,
    required this.filename,
    this.remoteKey,
    this.remoteUrl,
    this.sourceAssetId,
  });

  final String localPath;
  final String filename;
  final String? remoteKey;
  final String? remoteUrl;
  final String? sourceAssetId;

  bool get isRemote => remoteKey?.isNotEmpty == true;

  ReferenceImageDraft withRemoteKey(String key) => ReferenceImageDraft(
    localPath: localPath,
    filename: filename,
    remoteKey: key,
    remoteUrl: remoteUrl,
    sourceAssetId: sourceAssetId,
  );
}

final referenceImageServiceProvider = Provider<ReferenceImageService>(
  (ref) => ReferenceImageService(),
);

class ReferenceImageService {
  ReferenceImageService({ImagePicker? picker})
    : _picker = picker ?? ImagePicker();

  static const _uuid = Uuid();
  static const _maxUploadBytes = 15 * 1024 * 1024;
  final ImagePicker _picker;

  Future<List<ReferenceImageDraft>> pickFromGallery(int limit) async {
    final files = await _picker.pickMultiImage(
      limit: limit,
      maxWidth: 4096,
      maxHeight: 4096,
      imageQuality: 95,
      requestFullMetadata: false,
    );
    return _prepareMany(files);
  }

  Future<List<ReferenceImageDraft>> takePhoto() async {
    final file = await _picker.pickImage(
      source: ImageSource.camera,
      maxWidth: 4096,
      maxHeight: 4096,
      imageQuality: 95,
      requestFullMetadata: false,
    );
    return file == null ? const [] : _prepareMany([file]);
  }

  Future<List<ReferenceImageDraft>> recoverLostImages() async {
    final response = await _picker.retrieveLostData();
    if (response.isEmpty || response.files == null) return const [];
    return _prepareMany(response.files!);
  }

  Future<List<ReferenceImageDraft>> _prepareMany(List<XFile> files) async {
    final result = <ReferenceImageDraft>[];
    for (final file in files) {
      result.add(await _prepare(file));
    }
    return result;
  }

  Future<ReferenceImageDraft> _prepare(XFile source) async {
    final tempDirectory = await getTemporaryDirectory();
    final filename = 'reference-${_uuid.v4()}.jpg';
    final targetPath = '${tempDirectory.path}/$filename';
    var normalized = await _compress(source.path, targetPath, quality: 92);
    if (normalized == null) {
      throw const FormatException('参考图无法读取，请选择 PNG、JPG、WebP 或 HEIC 图片');
    }
    if (await normalized.length() > _maxUploadBytes) {
      try {
        await File(normalized.path).delete();
      } catch (_) {
        // The next encode can overwrite the temporary file.
      }
      normalized = await _compress(source.path, targetPath, quality: 72);
    }
    if (normalized == null || await normalized.length() > _maxUploadBytes) {
      throw const FormatException('参考图处理后仍超过 15MB，请选择较小的图片');
    }
    return ReferenceImageDraft(localPath: normalized.path, filename: filename);
  }

  Future<XFile?> _compress(
    String sourcePath,
    String targetPath, {
    required int quality,
  }) {
    return FlutterImageCompress.compressAndGetFile(
      sourcePath,
      targetPath,
      minWidth: 4096,
      minHeight: 4096,
      quality: quality,
      autoCorrectionAngle: true,
      format: CompressFormat.jpeg,
      keepExif: false,
    );
  }
}
