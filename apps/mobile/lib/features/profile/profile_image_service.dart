import 'dart:io';

import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

enum ProfileImageSource { gallery, camera }

class ProfileImageDraft {
  const ProfileImageDraft({required this.localPath, required this.filename});

  final String localPath;
  final String filename;
}

/// In-memory path of the last saved avatar so the profile page can keep
/// showing the photo after the edit screen deletes its temporary draft.
abstract final class ProfileAvatarStore {
  static final Map<String, String> _paths = {};

  static void remember(String userId, String path) {
    final id = userId.trim();
    if (id.isEmpty || path.trim().isEmpty) return;
    _paths[id] = path;
  }

  static String? pathFor(String? userId) {
    final id = userId?.trim() ?? '';
    if (id.isEmpty) return null;
    final path = _paths[id];
    if (path == null || !File(path).existsSync()) {
      _paths.remove(id);
      return null;
    }
    return path;
  }

  static void forget(String userId) => _paths.remove(userId.trim());

  static bool containsPath(String path) => _paths.containsValue(path);

  static void reset() => _paths.clear();
}

class ProfileImageService {
  ProfileImageService({ImagePicker? picker})
    : _picker = picker ?? ImagePicker();

  static const _uuid = Uuid();
  static const _maxUploadBytes = 15 * 1024 * 1024;
  final ImagePicker _picker;

  static String persistedFileName(String userId) =>
      'avatar-${userId.trim()}.jpg';

  Future<ProfileImageDraft?> pick(ProfileImageSource source) async {
    final selected = await _picker.pickImage(
      source: source == ProfileImageSource.gallery
          ? ImageSource.gallery
          : ImageSource.camera,
      maxWidth: 2048,
      maxHeight: 2048,
      imageQuality: 95,
      requestFullMetadata: false,
    );
    if (selected == null) return null;
    return _prepare(selected);
  }

  Future<Directory> _stableDirectory() async {
    try {
      return await getApplicationSupportDirectory();
    } catch (_) {
      return getTemporaryDirectory();
    }
  }

  Future<ProfileImageDraft> _prepare(XFile source) async {
    final directory = await _stableDirectory();
    final filename = 'avatar-${_uuid.v4()}.jpg';
    final targetPath = '${directory.path}/$filename';
    var normalized = await _compress(source.path, targetPath, quality: 88);
    if (normalized == null) {
      throw const FormatException('头像无法读取，请选择 PNG、JPG、WebP 或 HEIC 图片');
    }
    if (await normalized.length() > _maxUploadBytes) {
      try {
        await File(normalized.path).delete();
      } catch (_) {}
      normalized = await _compress(source.path, targetPath, quality: 68);
    }
    if (normalized == null || await normalized.length() > _maxUploadBytes) {
      throw const FormatException('头像处理后仍超过 15MB，请选择较小的图片');
    }
    return ProfileImageDraft(localPath: normalized.path, filename: filename);
  }

  Future<String?> persistAvatar(String userId, ProfileImageDraft draft) async {
    final id = userId.trim();
    final source = File(draft.localPath);
    if (id.isEmpty || !source.existsSync()) return null;
    try {
      final directory = await getApplicationSupportDirectory();
      final dest = File('${directory.path}/${persistedFileName(id)}');
      await source.copy(dest.path);
      ProfileAvatarStore.remember(id, dest.path);
      return dest.path;
    } catch (_) {
      if (source.existsSync()) {
        ProfileAvatarStore.remember(id, source.path);
        return source.path;
      }
      return null;
    }
  }

  Future<String?> persistedPath(String userId) async {
    final remembered = ProfileAvatarStore.pathFor(userId);
    if (remembered != null) return remembered;
    final id = userId.trim();
    if (id.isEmpty) return null;
    try {
      final directory = await getApplicationSupportDirectory();
      final file = File('${directory.path}/${persistedFileName(id)}');
      if (!await file.exists()) return null;
      ProfileAvatarStore.remember(id, file.path);
      return file.path;
    } catch (_) {
      return null;
    }
  }

  Future<void> clearPersistedAvatar(String userId) async {
    final id = userId.trim();
    final remembered = ProfileAvatarStore.pathFor(id);
    ProfileAvatarStore.forget(id);
    if (id.isEmpty) return;
    try {
      final directory = await getApplicationSupportDirectory();
      await File('${directory.path}/${persistedFileName(id)}').delete();
    } catch (_) {}
    if (remembered != null) {
      try {
        await File(remembered).delete();
      } catch (_) {}
    }
  }

  Future<XFile?> _compress(
    String sourcePath,
    String targetPath, {
    required int quality,
  }) => FlutterImageCompress.compressAndGetFile(
    sourcePath,
    targetPath,
    minWidth: 2048,
    minHeight: 2048,
    quality: quality,
    autoCorrectionAngle: true,
    format: CompressFormat.jpeg,
    keepExif: false,
  );
}
