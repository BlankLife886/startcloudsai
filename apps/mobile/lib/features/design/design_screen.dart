import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../create/creation_draft.dart';

class DesignScreen extends ConsumerStatefulWidget {
  const DesignScreen({super.key});

  @override
  ConsumerState<DesignScreen> createState() => _DesignScreenState();
}

class _DesignScreenState extends ConsumerState<DesignScreen> {
  CreationDraft? _draft;
  var _wasVisible = false;
  var _draftRequest = 0;

  static const _tools = [
    _DesignTool(
      keyName: 'text-to-image',
      title: '文生图',
      subtitle: '文字创作',
      location: '/create',
      icon: Icons.auto_awesome_outlined,
      accent: Color(0xFF4F67D6),
    ),
  ];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final visible = TickerMode.valuesOf(context).enabled;
    if (visible && !_wasVisible) unawaited(_refreshDraft());
    _wasVisible = visible;
  }

  Future<void> _refreshDraft() async {
    final request = ++_draftRequest;
    CreationDraft? draft;
    try {
      draft = await ref.read(creationDraftStoreProvider).read();
    } catch (_) {
      draft = null;
    }
    if (!mounted || request != _draftRequest) return;
    setState(() => _draft = draft);
  }

  @override
  Widget build(BuildContext context) {
    final featured = _tools.first;
    final rest = _tools.skip(1).toList();
    return Scaffold(
      appBar: const AppTopBar(title: Text('设计'), showBackButton: false),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final textScale = MediaQuery.textScalerOf(context).scale(1);
          final horizontalPadding = constraints.maxWidth < 380 ? 14.0 : 20.0;
          return SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(
              horizontalPadding,
              8,
              horizontalPadding,
              28,
            ),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 720),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '创作工具',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 126 + ((textScale - 1).clamp(0.0, .6) * 36),
                      width: double.infinity,
                      child: _DesignFeaturedCard(
                        tool: featured,
                        draft: _draft,
                        onTap: () => context.push(featured.location),
                      ),
                    ),
                    if (rest.isNotEmpty) ...[
                      const SizedBox(height: 22),
                      Text(
                        '其他工具',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 10),
                      for (final tool in rest) ...[
                        _DesignToolRow(
                          tool: tool,
                          onTap: () => context.push(tool.location),
                        ),
                        const SizedBox(height: 8),
                      ],
                    ],
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        Expanded(
                          child: _DesignUtilityAction(
                            key: const Key('design-open-works'),
                            icon: Icons.history,
                            label: '历史记录',
                            onTap: () => context.push('/works'),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _DesignUtilityAction(
                            key: const Key('design-open-assets'),
                            icon: Icons.collections_outlined,
                            label: '我的素材',
                            onTap: () => context.push('/profile/assets'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _DesignFeaturedCard extends StatelessWidget {
  const _DesignFeaturedCard({
    required this.tool,
    required this.draft,
    required this.onTap,
  });

  final _DesignTool tool;
  final CreationDraft? draft;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final hasDraft = draft != null && !draft!.isEmpty;
    return Semantics(
      label: hasDraft ? '继续${tool.title}草稿' : '进入${tool.title}',
      button: true,
      child: ExcludeSemantics(
        child: AppPressable(
          key: Key('design-tool-${tool.keyName}'),
          onTap: onTap,
          child: DecoratedBox(
            key: const Key('design-featured-surface'),
            decoration: BoxDecoration(
              color: colors.surfaceContainerLow,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: colors.outlineVariant),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 14, 14),
              child: Row(
                children: [
                  Expanded(
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 220),
                      switchInCurve: Curves.easeOutCubic,
                      switchOutCurve: Curves.easeInCubic,
                      child: Column(
                        key: ValueKey(hasDraft),
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Row(
                            children: [
                              Icon(tool.icon, color: tool.accent, size: 20),
                              const SizedBox(width: 7),
                              Text(
                                tool.title,
                                style: Theme.of(context).textTheme.labelLarge
                                    ?.copyWith(
                                      color: tool.accent,
                                      fontWeight: FontWeight.w800,
                                    ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Text(
                            hasDraft ? '继续上次创作' : '从一句描述开始',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleLarge
                                ?.copyWith(fontWeight: FontWeight.w900),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            hasDraft ? draft!.prompt.trim() : tool.subtitle,
                            maxLines: hasDraft ? 2 : 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  color: colors.onSurfaceVariant,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Icon(
                    Icons.arrow_forward_rounded,
                    color: colors.onSurfaceVariant,
                    size: 20,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DesignToolRow extends StatelessWidget {
  const _DesignToolRow({required this.tool, required this.onTap});

  final _DesignTool tool;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      label: '进入${tool.title}',
      button: true,
      child: ExcludeSemantics(
        child: AppPressable(
          key: Key('design-tool-${tool.keyName}'),
          onTap: onTap,
          child: AppSoftCard(
            radius: BorderRadius.circular(18),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: tool.accent.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(tool.icon, size: 22, color: tool.accent),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        tool.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      Text(
                        tool.subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: colors.onSurfaceVariant,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DesignUtilityAction extends StatelessWidget {
  const _DesignUtilityAction({
    required this.icon,
    required this.label,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      label: label,
      button: true,
      child: ExcludeSemantics(
        child: AppPressable(
          onTap: onTap,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: colors.surfaceContainerLow,
              borderRadius: BorderRadius.circular(8),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 52),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: Row(
                  children: [
                    Icon(icon, size: 20, color: colors.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        label,
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DesignTool {
  const _DesignTool({
    required this.keyName,
    required this.title,
    required this.subtitle,
    required this.location,
    required this.icon,
    required this.accent,
  });

  final String keyName;
  final String title;
  final String subtitle;
  final String location;
  final IconData icon;
  final Color accent;
}
