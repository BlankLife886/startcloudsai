import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_environment.dart';
import '../../core/providers.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../meta/meta.dart';
import 'app_info.dart';

final aboutAppUpdateProvider =
    FutureProvider.autoDispose<AppUpdateAvailability?>((ref) async {
      final info = await ref.watch(appPackageInfoProvider.future);
      final announcements = await ref.watch(
        startupAnnouncementsProvider.future,
      );
      return findAvailableAppUpdate(
        announcements,
        installedVersion: info.version,
        platform: defaultTargetPlatform,
      );
    });

typedef AppShareHandler = Future<void> Function(String text, Rect? origin);

final appShareHandlerProvider = Provider<AppShareHandler>(
  (ref) => (text, origin) async {
    await SharePlus.instance.share(
      ShareParams(text: text, title: '分享星空云绘', sharePositionOrigin: origin),
    );
  },
);

const appShareText = '星空云绘 - AI 图像创作与智能助手\nhttps://starcloudisai.com';

class AboutScreen extends ConsumerWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final packageInfo = ref.watch(appPackageInfoProvider);
    final availableUpdate = ref.watch(aboutAppUpdateProvider);
    final environment = ref.watch(appEnvironmentProvider);
    final info = packageInfo.asData?.value;
    final version = packageInfo.when(
      loading: () => '正在读取版本',
      error: (error, stackTrace) => '版本信息不可用',
      data: (info) => installedVersionLabel(info, environment.label),
    );
    Future<void> copyDiagnostics() async {
      if (info == null) return;
      await Clipboard.setData(
        ClipboardData(
          text: supportDiagnosticText(
            info,
            environment,
            Theme.of(context).platform,
          ),
        ),
      );
      if (context.mounted) {
        AppNotice.success(context, '诊断信息已复制');
      }
    }

    Future<void> checkForUpdates() async {
      final current = availableUpdate.asData?.value;
      if (current != null) {
        await _openUpdate(context, current.announcement);
        return;
      }
      ref.invalidate(startupAnnouncementsProvider);
      ref.invalidate(aboutAppUpdateProvider);
      try {
        final update = await ref.read(aboutAppUpdateProvider.future);
        if (!context.mounted) return;
        if (update == null) {
          AppNotice.success(context, '当前已是最新版本');
        } else {
          AppNotice.show(
            context,
            '发现 v${update.latestVersion}，可立即更新',
            title: update.required ? '需要更新' : '发现新版本',
            actionLabel: '立即更新',
            onAction: () =>
                unawaited(_openUpdate(context, update.announcement)),
          );
        }
      } catch (_) {
        if (context.mounted) AppNotice.error(context, '暂时无法检查更新，请稍后重试');
      }
    }

    Future<void> shareApp(BuildContext originContext) async {
      final box = originContext.findRenderObject() as RenderBox?;
      final origin = box == null
          ? null
          : box.localToGlobal(Offset.zero) & box.size;
      try {
        await ref.read(appShareHandlerProvider)(appShareText, origin);
      } catch (_) {
        if (context.mounted) AppNotice.error(context, '暂时无法打开系统分享');
      }
    }

    return Scaffold(
      appBar: const AppTopBar(
        title: Text('关于星空云绘'),
        fallbackLocation: '/profile',
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 32),
        children: [
          _AboutIdentity(version: version),
          const SizedBox(height: 28),
          const _AboutSectionTitle('版本与更新'),
          const SizedBox(height: 8),
          _AboutGroup(
            children: [
              _AboutRow(
                key: const Key('about-installed-version'),
                icon: Icons.verified_outlined,
                title: '当前版本',
                detail: version,
                trailingIcon: Icons.copy_rounded,
                trailingKey: const Key('about-copy-diagnostics'),
                trailingTooltip: '复制诊断信息',
                onTap: info == null ? null : copyDiagnostics,
              ),
              _AboutRow(
                key: const Key('about-updates'),
                icon: Icons.history_rounded,
                title: '公告与更新',
                detail: '查看服务公告和版本记录',
                onTap: () => context.push('/updates'),
              ),
              _AboutRow(
                key: const Key('about-check-update'),
                icon: availableUpdate.asData?.value == null
                    ? Icons.system_update_outlined
                    : Icons.new_releases_outlined,
                title: '检查更新',
                detail: availableUpdate.when(
                  loading: () => '正在检查线上版本',
                  error: (error, stackTrace) => '检查失败，点击重试',
                  data: (update) => update == null
                      ? '已是最新版本'
                      : '发现新版本 v${update.latestVersion}',
                ),
                trailingIcon: availableUpdate.isLoading
                    ? null
                    : availableUpdate.asData?.value == null
                    ? Icons.refresh_rounded
                    : Icons.download_rounded,
                trailingKey: const Key('about-check-update-action'),
                trailingTooltip: availableUpdate.asData?.value == null
                    ? '重新检查更新'
                    : '立即更新',
                onTap: availableUpdate.isLoading
                    ? null
                    : () => unawaited(checkForUpdates()),
              ),
              if (environment.name != AppEnvironmentName.production)
                _AboutRow(
                  icon: Icons.science_outlined,
                  title: '运行环境',
                  detail: environment.label,
                ),
            ],
          ),
          const SizedBox(height: 24),
          const _AboutSectionTitle('帮助与支持'),
          const SizedBox(height: 8),
          _AboutGroup(
            children: [
              _AboutRow(
                key: const Key('about-help-center'),
                icon: Icons.help_outline_rounded,
                title: '帮助中心',
                detail: '搜索常见问题与处理方法',
                onTap: () => context.push('/help'),
              ),
              _AboutRow(
                key: const Key('about-feedback'),
                icon: Icons.feedback_outlined,
                title: '问题反馈',
                detail: '提交问题并查看处理进度',
                onTap: () => context.push('/profile/feedback'),
              ),
              Builder(
                builder: (shareContext) => _AboutRow(
                  key: const Key('about-share-app'),
                  icon: Icons.ios_share_rounded,
                  title: '分享星空云绘',
                  detail: '通过系统分享发送应用官网',
                  onTap: () => unawaited(shareApp(shareContext)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          const _AboutSectionTitle('隐私与权限'),
          const SizedBox(height: 8),
          _AboutGroup(
            children: [
              _AboutRow(
                key: const Key('about-permissions'),
                icon: Icons.admin_panel_settings_outlined,
                title: '权限管理',
                detail: '查看设备授权状态并按需调整',
                onTap: () => context.push('/permissions'),
              ),
              _AboutRow(
                key: const Key('about-privacy-policy'),
                icon: Icons.privacy_tip_outlined,
                title: '隐私政策',
                detail: '了解信息、权限与账号数据如何处理',
                onTap: () => context.push('/legal/privacy'),
              ),
              _AboutRow(
                key: const Key('about-terms'),
                icon: Icons.description_outlined,
                title: '用户协议',
                detail: '查看服务规则与用户责任',
                onTap: () => context.push('/legal/terms'),
              ),
              _AboutRow(
                key: const Key('about-open-source-licenses'),
                icon: Icons.code_rounded,
                title: '开源许可',
                detail: '查看第三方组件及其许可文本',
                onTap: () => context.push('/licenses'),
              ),
              const _AboutRow(
                key: Key('about-data-use'),
                icon: Icons.shield_outlined,
                title: '数据使用',
                detail: '账号与创作内容用于同步和生成服务，不用于跨应用跟踪',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

Future<void> _openUpdate(
  BuildContext context,
  AppAnnouncement announcement,
) async {
  final raw = announcement.ctaUrl?.trim() ?? '';
  if (raw.startsWith('/')) {
    context.push(raw);
    return;
  }
  final uri = Uri.tryParse(raw);
  if (uri == null || (uri.scheme != 'https' && uri.scheme != 'http')) {
    context.push('/updates');
    return;
  }
  try {
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (context.mounted && !opened) AppNotice.error(context, '暂时无法打开更新链接');
  } catch (_) {
    if (context.mounted) AppNotice.error(context, '暂时无法打开更新链接');
  }
}

class _AboutIdentity extends StatelessWidget {
  const _AboutIdentity({required this.version});

  final String version;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: const Color(0xFFF7F8FA),
            borderRadius: BorderRadius.circular(8),
          ),
          child: SizedBox.square(
            dimension: 64,
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Image.asset(
                'assets/brand/brand_mark.png',
                semanticLabel: '星空云绘标识',
                fit: BoxFit.contain,
              ),
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          '星空云绘',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 4),
        Text(
          version,
          textAlign: TextAlign.center,
          style: Theme.of(
            context,
          ).textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
        ),
      ],
    );
  }
}

class _AboutSectionTitle extends StatelessWidget {
  const _AboutSectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Text(
    title,
    style: Theme.of(
      context,
    ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
  );
}

class _AboutGroup extends StatelessWidget {
  const _AboutGroup({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerLow,
      borderRadius: BorderRadius.circular(8),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var index = 0; index < children.length; index++) ...[
            if (index > 0)
              Divider(
                height: 1,
                indent: 56,
                color: colors.outlineVariant.withValues(alpha: .7),
              ),
            children[index],
          ],
        ],
      ),
    );
  }
}

class _AboutRow extends StatelessWidget {
  const _AboutRow({
    required this.icon,
    required this.title,
    required this.detail,
    this.onTap,
    this.trailingIcon,
    this.trailingKey,
    this.trailingTooltip,
    super.key,
  });

  final IconData icon;
  final String title;
  final String detail;
  final VoidCallback? onTap;
  final IconData? trailingIcon;
  final Key? trailingKey;
  final String? trailingTooltip;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      leading: Icon(icon, color: colors.onSurfaceVariant, size: 22),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(detail),
      trailing: onTap == null
          ? null
          : trailingIcon == null
          ? const Icon(Icons.chevron_right_rounded, size: 20)
          : IconButton(
              key: trailingKey,
              tooltip: trailingTooltip,
              onPressed: onTap,
              icon: Icon(trailingIcon, size: 20),
            ),
      onTap: onTap,
    );
  }
}
