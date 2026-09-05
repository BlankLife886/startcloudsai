import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/providers.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_notice.dart';
import '../profile/app_info.dart';
import 'meta.dart';

class StartupAnnouncements extends ConsumerStatefulWidget {
  const StartupAnnouncements({
    required this.child,
    this.now,
    this.openExternal,
    this.navigatorContext,
    this.installedVersion,
    this.targetPlatform,
    super.key,
  });

  final Widget child;
  final DateTime Function()? now;
  final Future<bool> Function(Uri uri)? openExternal;
  final BuildContext? Function()? navigatorContext;
  final String? installedVersion;
  final TargetPlatform? targetPlatform;

  @override
  ConsumerState<StartupAnnouncements> createState() =>
      _StartupAnnouncementsState();
}

class _StartupAnnouncementsState extends ConsumerState<StartupAnnouncements> {
  bool _started = false;

  DateTime get _now => (widget.now ?? DateTime.now)();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _present());
  }

  Future<void> _present() async {
    if (_started || !mounted) return;
    _started = true;
    List<AppAnnouncement> announcements;
    try {
      announcements = await ref.read(startupAnnouncementsProvider.future);
    } catch (_) {
      return;
    }
    if (!mounted || announcements.isEmpty) return;
    final platform = widget.targetPlatform ?? defaultTargetPlatform;
    var installedVersion = widget.installedVersion?.trim();
    final needsInstalledVersion = announcements.any(
      (item) =>
          item.latestAppVersion?.isNotEmpty == true ||
          item.minimumSupportedAppVersion?.isNotEmpty == true,
    );
    if ((installedVersion == null || installedVersion.isEmpty) &&
        needsInstalledVersion) {
      try {
        installedVersion = (await ref.read(
          appPackageInfoProvider.future,
        )).version.trim();
      } catch (_) {
        installedVersion = null;
      }
    }
    final store = ref.read(announcementReceiptStoreProvider);
    for (final announcement in announcements) {
      if (!announcementTargetsInstalledApp(
        announcement,
        installedVersion: installedVersion,
        platform: platform,
      )) {
        continue;
      }
      final requiredUpdate = announcementRequiresUpdate(
        announcement,
        installedVersion: installedVersion,
        platform: platform,
      );
      if (!requiredUpdate) {
        final lastShown = await store.lastShown(announcement);
        if (!shouldPresentAnnouncement(announcement, lastShown, _now)) {
          continue;
        }
        await store.recordShown(announcement, _now);
      }
      if (!mounted) return;
      if (announcement.placement == 'banner' && !requiredUpdate) {
        _showBanner(announcement);
      } else {
        await _showModal(announcement, requiredUpdate: requiredUpdate);
      }
      return;
    }
  }

  void _showBanner(AppAnnouncement announcement) {
    final action = announcement.hasAction
        ? () => unawaited(_openAction(announcement))
        : null;
    AppNotice.show(
      context,
      announcement.body,
      title: announcement.title,
      duration: !announcement.allowClose && announcement.hasAction
          ? Duration.zero
          : const Duration(seconds: 8),
      actionLabel: announcement.hasAction ? announcement.ctaText : null,
      onAction: action,
    );
  }

  Future<void> _showModal(
    AppAnnouncement announcement, {
    required bool requiredUpdate,
  }) async {
    final presentationContext = widget.navigatorContext?.call() ?? context;
    final canClose =
        !requiredUpdate && (announcement.allowClose || !announcement.hasAction);
    final action = await showAppDialog<bool>(
      context: presentationContext,
      barrierDismissible: canClose,
      barrierLabel: canClose ? announcement.closeText : '重要公告',
      builder: (dialogContext) => PopScope(
        canPop: canClose,
        child: AppDialog(
          icon: Icon(
            requiredUpdate
                ? Icons.system_update_alt_rounded
                : Icons.campaign_outlined,
          ),
          title: Text(announcement.title),
          content: _AnnouncementContent(
            announcement: announcement,
            requiredUpdate: requiredUpdate,
          ),
          actions: [
            if (canClose)
              TextButton(
                key: const Key('startup-announcement-close'),
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: Text(announcement.closeText),
              ),
            if (announcement.hasAction)
              FilledButton.icon(
                key: const Key('startup-announcement-action'),
                onPressed: requiredUpdate
                    ? () => unawaited(_openAction(announcement))
                    : () => Navigator.of(dialogContext).pop(true),
                icon: Icon(
                  requiredUpdate
                      ? Icons.system_update_alt_rounded
                      : Icons.arrow_forward_rounded,
                  size: 18,
                ),
                iconAlignment: IconAlignment.end,
                label: Text(announcement.ctaText!),
              ),
          ],
        ),
      ),
    );
    if (action == true && mounted) await _openAction(announcement);
  }

  Future<bool> _openAction(AppAnnouncement announcement) async {
    final raw = announcement.ctaUrl?.trim() ?? '';
    final uri = Uri.tryParse(raw);
    if (uri == null || raw.isEmpty) return false;
    if (!uri.hasScheme && raw.startsWith('/')) {
      final router = GoRouter.maybeOf(
        widget.navigatorContext?.call() ?? context,
      );
      if (router != null) {
        router.push(raw);
        return true;
      } else {
        AppNotice.error(context, '暂时无法打开此页面');
        return false;
      }
    }
    if (uri.scheme != 'https' && uri.scheme != 'http') {
      AppNotice.error(context, '公告链接不可用');
      return false;
    }
    try {
      final opened = await (widget.openExternal ?? _launchExternal)(uri);
      if (mounted && !opened) AppNotice.error(context, '暂时无法打开公告链接');
      return opened;
    } catch (_) {
      if (mounted) AppNotice.error(context, '暂时无法打开公告链接');
      return false;
    }
  }

  Future<bool> _launchExternal(Uri uri) =>
      launchUrl(uri, mode: LaunchMode.externalApplication);

  @override
  Widget build(BuildContext context) => widget.child;
}

bool shouldPresentAnnouncement(
  AppAnnouncement announcement,
  DateTime? lastShown,
  DateTime now,
) {
  if (announcement.frequency == 'every_open' ||
      announcement.frequency == 'session_once' ||
      lastShown == null) {
    return true;
  }
  final elapsed = now.difference(lastShown);
  return switch (announcement.frequency) {
    'once_per_version' => false,
    'daily' =>
      now.year != lastShown.year ||
          now.month != lastShown.month ||
          now.day != lastShown.day,
    'dismiss_hours' => elapsed >= Duration(hours: announcement.dismissHours),
    _ => false,
  };
}

class _AnnouncementContent extends ConsumerWidget {
  const _AnnouncementContent({
    required this.announcement,
    required this.requiredUpdate,
  });

  final AppAnnouncement announcement;
  final bool requiredUpdate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final imageUrl = ref
        .watch(apiClientProvider)
        .resolveUrl(announcement.imageUrl ?? '');
    return ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 420),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (requiredUpdate) ...[
              Row(
                children: [
                  Icon(
                    Icons.security_update_warning_outlined,
                    size: 19,
                    color: Theme.of(context).colorScheme.error,
                  ),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      '当前版本已停止支持，需要更新后继续使用',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
            ],
            if (imageUrl.isNotEmpty) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: AspectRatio(
                  aspectRatio: 16 / 7,
                  child: Image.network(
                    imageUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (announcement.body.isNotEmpty)
              SelectableText(
                announcement.body,
                style: const TextStyle(height: 1.5),
              ),
          ],
        ),
      ),
    );
  }
}
