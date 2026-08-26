import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/appearance.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';

class AppearanceSettingsScreen extends ConsumerWidget {
  const AppearanceSettingsScreen({super.key});

  Future<void> _select(
    BuildContext context,
    WidgetRef ref,
    AppAppearance appearance,
  ) async {
    try {
      await ref
          .read(appearanceControllerProvider.notifier)
          .setAppearance(appearance);
    } catch (_) {
      if (!context.mounted) return;
      AppNotice.error(context, '外观设置保存失败，请稍后重试');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appearance = ref.watch(appearanceControllerProvider);
    return Scaffold(
      appBar: const AppTopBar(
        title: Text('外观设置'),
        fallbackLocation: '/profile',
      ),
      body: appearance.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Center(
          child: OutlinedButton.icon(
            onPressed: () => ref.invalidate(appearanceControllerProvider),
            icon: const Icon(Icons.refresh),
            label: const Text('重新加载外观设置'),
          ),
        ),
        data: (value) => ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            AppearanceSelectionPanel(
              appearance: value,
              onSelected: (next) => _select(context, ref, next),
            ),
            const SizedBox(height: 18),
            _AppearancePreview(appearance: value),
          ],
        ),
      ),
    );
  }
}

class AppearanceSelectionPanel extends StatelessWidget {
  const AppearanceSelectionPanel({
    required this.appearance,
    required this.onSelected,
    super.key,
  });

  final AppAppearance appearance;
  final ValueChanged<AppAppearance> onSelected;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '选择界面外观',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.w900,
            letterSpacing: -0.6,
          ),
        ),
        const SizedBox(height: 18),
        for (final item in AppAppearance.values) ...[
          _AppearanceTile(
            appearance: item,
            selected: item == appearance,
            onTap: () => onSelected(item),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _AppearanceTile extends StatelessWidget {
  const _AppearanceTile({
    required this.appearance,
    required this.selected,
    required this.onTap,
  });

  final AppAppearance appearance;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AppPressable(
      onTap: onTap,
      child: AnimatedContainer(
        duration: AppMotion.appear,
        curve: AppMotion.ease,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        decoration: BoxDecoration(
          color: selected ? scheme.primary : scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          children: [
            Icon(
              _appearanceIcon(appearance),
              key: Key('appearance-${appearance.name}'),
              color: selected ? scheme.onPrimary : scheme.onSurface,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    appearance.label,
                    style: TextStyle(
                      color: selected ? scheme.onPrimary : scheme.onSurface,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    appearance.description,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: selected
                          ? scheme.onPrimary.withValues(alpha: .78)
                          : scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            if (selected) Icon(Icons.check_rounded, color: scheme.onPrimary),
          ],
        ),
      ),
    );
  }
}

class _AppearancePreview extends StatelessWidget {
  const _AppearancePreview({required this.appearance});

  final AppAppearance appearance;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AppSoftCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('界面预览', style: TextStyle(fontWeight: FontWeight.w900)),
          const SizedBox(height: 14),
          Container(
            height: 112,
            decoration: BoxDecoration(
              color: scheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(18),
            ),
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(_appearanceIcon(appearance), size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Container(
                        height: 8,
                        decoration: BoxDecoration(
                          color: scheme.onSurfaceVariant.withValues(
                            alpha: 0.24,
                          ),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                  ],
                ),
                const Spacer(),
                Row(
                  children: [
                    Expanded(
                      child: Container(
                        height: 34,
                        decoration: BoxDecoration(
                          color: scheme.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(7),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Container(
                      width: 72,
                      height: 34,
                      decoration: BoxDecoration(
                        color: scheme.primary,
                        borderRadius: BorderRadius.circular(7),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

IconData _appearanceIcon(AppAppearance appearance) => switch (appearance) {
  AppAppearance.system => Icons.brightness_auto_outlined,
  AppAppearance.light => Icons.light_mode_outlined,
  AppAppearance.dark => Icons.dark_mode_outlined,
};
