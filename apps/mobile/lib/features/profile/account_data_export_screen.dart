import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import 'account_data_export.dart';

typedef AccountDataShareHandler =
    Future<void> Function(File file, Rect? sharePositionOrigin);

final accountDataShareHandlerProvider = Provider<AccountDataShareHandler>(
  (ref) =>
      (file, origin) => SharePlus.instance.share(
        ShareParams(
          files: [XFile(file.path, mimeType: 'application/json')],
          title: '星空云绘账号数据',
          sharePositionOrigin: origin,
        ),
      ),
);

class AccountDataExportScreen extends ConsumerStatefulWidget {
  const AccountDataExportScreen({super.key});

  @override
  ConsumerState<AccountDataExportScreen> createState() =>
      _AccountDataExportScreenState();
}

class _AccountDataExportScreenState
    extends ConsumerState<AccountDataExportScreen> {
  bool _exporting = false;
  bool _featureUnavailable = false;

  Future<void> _export(BuildContext buttonContext) async {
    if (_exporting) return;
    final box = buttonContext.findRenderObject() as RenderBox?;
    final origin = box == null
        ? null
        : box.localToGlobal(Offset.zero) & box.size;
    File? file;
    setState(() => _exporting = true);
    try {
      file = await ref.read(accountDataExporterProvider).export();
      if (!mounted) return;
      await ref.read(accountDataShareHandlerProvider)(file, origin);
      if (mounted) AppNotice.success(context, '数据副本已生成');
    } catch (error) {
      if (!mounted) return;
      if (error is ApiException && error.isNotFound) {
        setState(() => _featureUnavailable = true);
        AppNotice.warning(context, '数据导出服务正在升级');
      } else {
        AppNotice.error(
          context,
          error is ApiException ? error.message : '账号数据导出失败，请稍后重试',
        );
      }
    } finally {
      if (file != null) {
        try {
          await file.delete();
        } catch (_) {
          // Temporary export cleanup must not mask the share result.
        }
      }
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const AppTopBar(
        title: Text('导出账号数据'),
        fallbackLocation: '/profile/security',
      ),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.file_download_outlined, color: colors.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '获取你的数据副本',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '生成一份便于阅读和迁移的 JSON 文件。',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 28),
            const _ExportSection(
              title: '包含内容',
              rows: [
                (Icons.person_outline_rounded, '账号资料与偏好'),
                (Icons.account_balance_wallet_outlined, '积分、订单与订阅记录'),
                (Icons.auto_awesome_outlined, '创作任务、AI 对话与素材信息'),
                (Icons.forum_outlined, '投稿、反馈与社区安全记录'),
              ],
            ),
            const SizedBox(height: 24),
            const _ExportSection(
              title: '隐私说明',
              rows: [
                (Icons.lock_outline_rounded, '不包含密码、登录凭证和内部安全信息'),
                (Icons.image_not_supported_outlined, '不打包原始图片，仅记录文件信息'),
              ],
            ),
            const SizedBox(height: 32),
            if (_featureUnavailable)
              const _ExportUnavailable()
            else
              Builder(
                builder: (buttonContext) => FilledButton.icon(
                  key: const Key('account-data-export-action'),
                  onPressed: _exporting ? null : () => _export(buttonContext),
                  icon: _exporting
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.ios_share_outlined),
                  label: Text(_exporting ? '正在生成' : '生成并分享数据副本'),
                ),
              ),
            const SizedBox(height: 12),
            Text(
              '数据文件可能包含私人内容，请仅保存到你信任的位置。',
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExportUnavailable extends StatelessWidget {
  const _ExportUnavailable();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      label: '数据导出服务升级中，请稍后再试',
      child: ExcludeSemantics(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.schedule_rounded, size: 20, color: colors.primary),
            const SizedBox(width: 8),
            Text(
              '数据导出服务升级中',
              style: Theme.of(
                context,
              ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExportSection extends StatelessWidget {
  const _ExportSection({required this.title, required this.rows});

  final String title;
  final List<(IconData, String)> rows;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
            color: colors.onSurfaceVariant,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 10),
        ...rows.map(
          (row) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 9),
            child: Row(
              children: [
                Icon(row.$1, size: 20, color: colors.onSurfaceVariant),
                const SizedBox(width: 12),
                Expanded(child: Text(row.$2)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
