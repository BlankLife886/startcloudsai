import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import 'app_permissions.dart';

class AppPermissionsScreen extends ConsumerStatefulWidget {
  const AppPermissionsScreen({super.key});

  @override
  ConsumerState<AppPermissionsScreen> createState() =>
      _AppPermissionsScreenState();
}

class _AppPermissionsScreenState extends ConsumerState<AppPermissionsScreen>
    with WidgetsBindingObserver {
  final _states = <AppPermissionKind, AppPermissionState>{};
  AppPermissionKind? _busyKind;
  var _refreshing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_refresh()));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_refresh());
  }

  Future<void> _refresh() async {
    if (!mounted || _refreshing) return;
    setState(() => _refreshing = true);
    final gateway = ref.read(appPermissionGatewayProvider);
    final entries = await Future.wait(
      AppPermissionKind.values.map((kind) async {
        try {
          return MapEntry(kind, await gateway.status(kind));
        } catch (_) {
          return MapEntry(kind, AppPermissionState.unavailable);
        }
      }),
    );
    if (!mounted) return;
    setState(() {
      _states.addEntries(entries);
      _refreshing = false;
    });
  }

  Future<void> _openSettings() async {
    var opened = false;
    try {
      opened = await ref.read(appPermissionGatewayProvider).openSettings();
    } catch (_) {
      opened = false;
    }
    if (!mounted || opened) return;
    AppNotice.warning(context, '无法打开系统设置，请手动进入设置修改权限');
  }

  Future<void> _handlePermission(AppPermissionKind kind) async {
    if (_busyKind != null) return;
    final current = _states[kind] ?? AppPermissionState.unknown;
    if (current == AppPermissionState.notRequired) {
      AppNotice.info(context, '当前系统通过照片选择器或相机应用安全授权');
      return;
    }
    if (current == AppPermissionState.unavailable) {
      AppNotice.warning(context, '当前设备不支持管理此权限');
      return;
    }
    if (current == AppPermissionState.restricted) {
      AppNotice.warning(context, '此权限受系统或家长控制限制');
      return;
    }
    if (current == AppPermissionState.permanentlyDenied) {
      await _openSettings();
      return;
    }

    setState(() => _busyKind = kind);
    late AppPermissionState next;
    try {
      next = await ref.read(appPermissionGatewayProvider).request(kind);
    } catch (_) {
      if (!mounted) return;
      setState(() => _busyKind = null);
      AppNotice.error(context, '权限请求失败，请稍后重试');
      return;
    }
    if (!mounted) return;
    setState(() {
      _states[kind] = next;
      _busyKind = null;
    });
    if (next == AppPermissionState.granted ||
        next == AppPermissionState.limited) {
      AppNotice.success(
        context,
        next == AppPermissionState.limited ? '已允许访问所选照片' : '权限已允许',
      );
      return;
    }
    AppNotice.show(
      context,
      '可在系统设置中重新开启',
      title: '权限未允许',
      type: AppNoticeType.warning,
      actionLabel: next == AppPermissionState.permanentlyDenied ? '去设置' : null,
      onAction: next == AppPermissionState.permanentlyDenied
          ? () => unawaited(_openSettings())
          : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('权限管理'),
        fallbackLocation: '/about',
        actions: [
          AppTopBarIconButton(
            tooltip: '刷新权限状态',
            onPressed: () => unawaited(_refresh()),
            icon: AnimatedSwitcher(
              duration: const Duration(milliseconds: 160),
              child: _refreshing
                  ? const SizedBox.square(
                      key: Key('permissions-refreshing'),
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(
                      Icons.refresh_rounded,
                      key: Key('permissions-refresh'),
                    ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 32),
        children: [
          Text(
            '设备权限',
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            '仅在使用对应功能时申请，你可以随时调整。',
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(color: colors.onSurfaceVariant),
          ),
          const SizedBox(height: 14),
          Material(
            color: colors.surfaceContainerLow,
            borderRadius: BorderRadius.circular(8),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (
                  var index = 0;
                  index < AppPermissionKind.values.length;
                  index++
                ) ...[
                  if (index > 0)
                    Divider(
                      height: 1,
                      indent: 54,
                      color: colors.outlineVariant.withValues(alpha: .7),
                    ),
                  _PermissionRow(
                    kind: AppPermissionKind.values[index],
                    state:
                        _states[AppPermissionKind.values[index]] ??
                        AppPermissionState.unknown,
                    busy: _busyKind == AppPermissionKind.values[index],
                    onTap: () =>
                        _handlePermission(AppPermissionKind.values[index]),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.lock_outline_rounded,
                size: 16,
                color: colors.onSurfaceVariant,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '未授权的权限不会影响首页浏览，只会限制对应的拍摄、保存或语音功能。',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                    height: 1.45,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PermissionRow extends StatelessWidget {
  const _PermissionRow({
    required this.kind,
    required this.state,
    required this.busy,
    required this.onTap,
  });

  final AppPermissionKind kind;
  final AppPermissionState state;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final (title, detail, icon) = switch (kind) {
      AppPermissionKind.photos => (
        '照片',
        '选择参考图、头像并保存作品',
        Icons.photo_library_outlined,
      ),
      AppPermissionKind.camera => (
        '相机',
        '拍摄头像或创作参考图',
        Icons.camera_alt_outlined,
      ),
      AppPermissionKind.microphone => (
        '麦克风',
        '采集 AI 助手的语音输入',
        Icons.mic_none_rounded,
      ),
      AppPermissionKind.speechRecognition => (
        '语音识别',
        '将语音转换为输入文字',
        Icons.record_voice_over_outlined,
      ),
    };
    final (statusLabel, statusIcon, statusColor) = _statusVisual(colors);
    return Semantics(
      button: true,
      label: '$title，$statusLabel',
      child: InkWell(
        key: Key('permission-${kind.name}'),
        onTap: busy ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 13, 10, 13),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Icon(icon, size: 22, color: colors.onSurfaceVariant),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      detail,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 6),
                    AnimatedSwitcher(
                      duration: const Duration(milliseconds: 160),
                      child: Row(
                        key: ValueKey('$state-$busy'),
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (busy)
                            SizedBox.square(
                              dimension: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 1.7,
                                color: statusColor,
                              ),
                            )
                          else
                            Icon(statusIcon, size: 15, color: statusColor),
                          const SizedBox(width: 5),
                          Flexible(
                            child: Text(
                              busy ? '处理中' : statusLabel,
                              style: Theme.of(context).textTheme.labelMedium
                                  ?.copyWith(
                                    color: statusColor,
                                    fontWeight: FontWeight.w700,
                                  ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              Padding(
                padding: const EdgeInsets.only(top: 18),
                child: Icon(
                  Icons.chevron_right_rounded,
                  size: 20,
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  (String, IconData, Color) _statusVisual(ColorScheme colors) =>
      switch (state) {
        AppPermissionState.unknown => (
          '检查中',
          Icons.more_horiz_rounded,
          colors.onSurfaceVariant,
        ),
        AppPermissionState.granted => (
          '已允许',
          Icons.check_circle_outline_rounded,
          const Color(0xFF0F766E),
        ),
        AppPermissionState.limited => (
          '部分照片',
          Icons.photo_outlined,
          const Color(0xFFD97706),
        ),
        AppPermissionState.denied => (
          '未允许，点击申请',
          Icons.do_not_disturb_alt_outlined,
          colors.error,
        ),
        AppPermissionState.permanentlyDenied => (
          '已关闭，前往设置',
          Icons.settings_outlined,
          colors.error,
        ),
        AppPermissionState.restricted => (
          '受系统限制',
          Icons.block_outlined,
          colors.error,
        ),
        AppPermissionState.notRequired => (
          '由系统安全管理',
          Icons.shield_outlined,
          colors.onSurfaceVariant,
        ),
        AppPermissionState.unavailable => (
          '当前设备不可用',
          Icons.remove_circle_outline,
          colors.onSurfaceVariant,
        ),
      };
}
