import 'dart:io';

import 'package:flutter/material.dart';

import '../../core/widgets/authenticated_image.dart';
import 'profile_image_service.dart';

/// Prefer the compact thumb variant for `/files/uploads/.../original/...`.
String profileAvatarThumbUrl(String avatarUrl) {
  final raw = avatarUrl.trim();
  if (raw.isEmpty) return raw;
  final uri = Uri.tryParse(raw);
  final path = uri?.path.isNotEmpty == true ? uri!.path : raw;
  final match = RegExp(
    r'^(/api/v1/files/uploads/[^/]+)/original/([^/.]+)',
  ).firstMatch(path);
  if (match == null) return raw;
  final thumbPath = '${match[1]}/thumb/${match[2]}';
  if (uri == null || !uri.hasScheme) return thumbPath;
  return uri.replace(path: thumbPath, query: '').toString();
}

List<String> profileAvatarRemoteUrls(String? avatarUrl) {
  final original = avatarUrl?.trim() ?? '';
  if (original.isEmpty) return const [];
  final thumb = profileAvatarThumbUrl(original);
  if (thumb == original) return [original];
  return [thumb, original];
}

enum ProfileAvatarSource { local, persisted, remote, letter }

ProfileAvatarSource resolveProfileAvatarSource({
  String? localPath,
  String? persistedPath,
  String? avatarUrl,
}) {
  final remotes = profileAvatarRemoteUrls(avatarUrl);
  final local = localPath?.trim() ?? '';
  if (local.isNotEmpty && File(local).existsSync()) {
    return ProfileAvatarSource.local;
  }
  final persisted = persistedPath?.trim() ?? '';
  if (persisted.isNotEmpty &&
      remotes.isNotEmpty &&
      File(persisted).existsSync()) {
    return ProfileAvatarSource.persisted;
  }
  if (remotes.isNotEmpty) return ProfileAvatarSource.remote;
  return ProfileAvatarSource.letter;
}

class ProfileAvatar extends StatelessWidget {
  const ProfileAvatar({
    required this.username,
    this.userId,
    this.avatarUrl,
    this.localPath,
    this.radius = 30,
    super.key,
  });

  final String username;
  final String? userId;
  final String? avatarUrl;
  final String? localPath;
  final double radius;

  Widget _letterFallback(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Center(
        child: Text(
          username.characters.firstOrNull ?? '星',
          style: TextStyle(
            color: Theme.of(context).colorScheme.onPrimaryContainer,
            fontSize: radius * 0.72,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }

  Widget _fileImage(BuildContext context, String path) => Image.file(
    File(path),
    fit: BoxFit.cover,
    gaplessPlayback: true,
    errorBuilder: (context, error, stackTrace) => _letterFallback(context),
  );

  @override
  Widget build(BuildContext context) {
    final size = radius * 2;
    final local = localPath?.trim() ?? '';
    final persisted = ProfileAvatarStore.pathFor(userId);
    final remotes = profileAvatarRemoteUrls(avatarUrl);
    final source = resolveProfileAvatarSource(
      localPath: local,
      persistedPath: persisted,
      avatarUrl: avatarUrl,
    );
    final Widget child;
    if (source == ProfileAvatarSource.local) {
      child = _fileImage(context, local);
    } else if (source == ProfileAvatarSource.persisted && persisted != null) {
      child = _fileImage(context, persisted);
    } else if (source == ProfileAvatarSource.remote && remotes.isNotEmpty) {
      child = _RemoteProfileImage(
        urls: remotes,
        fallback: _letterFallback(context),
      );
    } else {
      child = _letterFallback(context);
    }
    return Semantics(
      image: true,
      label: '用户头像',
      child: ClipOval(
        child: SizedBox.square(dimension: size, child: child),
      ),
    );
  }
}

class _RemoteProfileImage extends StatefulWidget {
  const _RemoteProfileImage({required this.urls, required this.fallback});

  final List<String> urls;
  final Widget fallback;

  @override
  State<_RemoteProfileImage> createState() => _RemoteProfileImageState();
}

class _RemoteProfileImageState extends State<_RemoteProfileImage> {
  var _index = 0;
  var _failed = false;

  @override
  void didUpdateWidget(covariant _RemoteProfileImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.urls.join() != widget.urls.join()) {
      _index = 0;
      _failed = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_failed || _index >= widget.urls.length) return widget.fallback;
    return AuthenticatedImage(
      url: widget.urls[_index],
      fit: BoxFit.cover,
      errorChild: widget.fallback,
      onError: () {
        if (!mounted) return;
        if (_index + 1 < widget.urls.length) {
          setState(() => _index += 1);
        } else {
          setState(() => _failed = true);
        }
      },
    );
  }
}
