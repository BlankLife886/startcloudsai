import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';

class DesignScreen extends StatelessWidget {
  const DesignScreen({super.key});

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
                      '从一张图开始',
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.8,
                          ),
                    ),
                    const SizedBox(height: 14),
                    SizedBox(
                      height: 148 + ((textScale - 1).clamp(0.0, .5) * 28),
                      width: double.infinity,
                      child: _DesignFeaturedCard(
                        tool: featured,
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
  const _DesignFeaturedCard({required this.tool, required this.onTap});

  final _DesignTool tool;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '进入${tool.title}',
      button: true,
      child: ExcludeSemantics(
        child: AppPressable(
          key: Key('design-tool-${tool.keyName}'),
          onTap: onTap,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: const Color(0xFFDCE3FF),
              borderRadius: BorderRadius.circular(26),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 18, 18),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(tool.icon, color: tool.accent, size: 26),
                        const Spacer(),
                        Text(
                          tool.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.headlineSmall
                              ?.copyWith(
                                color: const Color(0xFF2548A7),
                                fontWeight: FontWeight.w900,
                                letterSpacing: -0.6,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          tool.subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(
                                color: const Color(
                                  0xFF2548A7,
                                ).withValues(alpha: .72),
                                fontWeight: FontWeight.w600,
                              ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.arrow_outward_rounded,
                    color: tool.accent,
                    size: 22,
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
              borderRadius: BorderRadius.circular(16),
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
