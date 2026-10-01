import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

@immutable
class AppImageCacheSnapshot {
  const AppImageCacheSnapshot({
    required this.bytes,
    required this.entries,
    required this.liveEntries,
  });

  final int bytes;
  final int entries;
  final int liveEntries;
}

class AppImageCacheService {
  AppImageCacheService({ImageCache? cache}) : _cache = cache;

  final ImageCache? _cache;

  ImageCache get _effectiveCache =>
      _cache ?? PaintingBinding.instance.imageCache;

  AppImageCacheSnapshot snapshot() {
    final cache = _effectiveCache;
    return AppImageCacheSnapshot(
      bytes: cache.currentSizeBytes,
      entries: cache.currentSize,
      liveEntries: cache.liveImageCount,
    );
  }

  AppImageCacheSnapshot clear() {
    final cache = _effectiveCache;
    cache.clear();
    cache.clearLiveImages();
    return snapshot();
  }
}

final appImageCacheServiceProvider = Provider<AppImageCacheService>(
  (ref) => AppImageCacheService(),
);

String formatCacheSize(int bytes) {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    final kilobytes = bytes / 1024;
    return '${kilobytes < 10 ? kilobytes.toStringAsFixed(1) : kilobytes.round()} KB';
  }
  final megabytes = bytes / (1024 * 1024);
  return '${megabytes < 10 ? megabytes.toStringAsFixed(1) : megabytes.round()} MB';
}

int cachedImageCount(AppImageCacheSnapshot snapshot) =>
    snapshot.entries > snapshot.liveEntries
    ? snapshot.entries
    : snapshot.liveEntries;
