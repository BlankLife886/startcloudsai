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
    final platformBrightness = MediaQuery.platformBrightnessOf(context);
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
              platformBrightness: platformBrightness,
              onSelected: (next) => _select(context, ref, next),
            ),
            const SizedBox(height: 18),
            _AppearancePreview(
              appearance: value,
              platformBrightness: platformBrightness,
            ),
          ],
        ),
      ),
    );
  }
}

class AppearanceSelectionPanel extends StatelessWidget {
  const AppearanceSelectionPanel({
    required this.appearance,
    required this.platformBrightness,
    required this.onSelected,
    super.key,
  });

  final AppAppearance appearance;
  final Brightness platformBrightness;
  final ValueChanged<AppAppearance> onSelected;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '选择界面外观',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            Icon(
              effectiveAppearanceBrightness(appearance, platformBrightness) ==
                      Brightness.dark
                  ? Icons.dark_mode_outlined
                  : Icons.light_mode_outlined,
              size: 16,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                '当前生效：${effectiveAppearanceLabel(appearance, platformBrightness)}',
                key: const Key('appearance-effective-label'),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        for (final item in AppAppearance.values) ...[
          _AppearanceTile(
            appearance: item,
            selected: item == appearance,
            platformBrightness: platformBrightness,
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
    required this.platformBrightness,
    required this.onTap,
  });

  final AppAppearance appearance;
  final bool selected;
  final Brightness platformBrightness;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final detail = appearance == AppAppearance.system && selected
        ? '设备当前为${effectiveAppearanceLabel(appearance, platformBrightness)}'
        : appearance.description;
    return Semantics(
      button: true,
      selected: selected,
      label: '${appearance.label}，$detail',
      child: AppPressable(
        onTap: onTap,
        child: AnimatedContainer(
          key: Key('appearance-option-${appearance.name}'),
          duration: reduceMotion ? Duration.zero : AppMotion.appear,
          curve: AppMotion.ease,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            color: selected
                ? scheme.primaryContainer.withValues(alpha: .55)
                : scheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: selected ? scheme.primary : scheme.outlineVariant,
            ),
          ),
          child: Row(
            children: [
              Icon(
                _appearanceIcon(appearance),
                key: Key('appearance-${appearance.name}'),
                color: selected ? scheme.primary : scheme.onSurfaceVariant,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      appearance.label,
                      style: TextStyle(
                        color: scheme.onSurface,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      detail,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              AnimatedSwitcher(
                duration: reduceMotion
                    ? Duration.zero
                    : const Duration(milliseconds: 180),
                child: selected
                    ? Icon(
                        Icons.check_circle_rounded,
                        key: const ValueKey('selected'),
                        color: scheme.primary,
                      )
                    : const SizedBox.square(
                        key: ValueKey('unselected'),
                        dimension: 24,
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AppearancePreview extends StatelessWidget {
  const _AppearancePreview({
    required this.appearance,
    required this.platformBrightness,
  });

  final AppAppearance appearance;
  final Brightness platformBrightness;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final brightness = effectiveAppearanceBrightness(
      appearance,
      platformBrightness,
    );
    final preview = ColorScheme.fromSeed(
      seedColor: colors.primary,
      brightness: brightness,
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '界面预览 · ${effectiveAppearanceLabel(appearance, platformBrightness)}',
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 14),
            AnimatedContainer(
              key: Key('appearance-preview-${brightness.name}'),
              duration: MediaQuery.disableAnimationsOf(context)
                  ? Duration.zero
                  : AppMotion.appear,
              curve: AppMotion.ease,
              height: 112,
              decoration: BoxDecoration(
                color: preview.surface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: preview.outlineVariant),
              ),
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Icon(
                        _appearanceIcon(appearance),
                        size: 18,
                        color: preview.onSurface,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Container(
                          height: 8,
                          decoration: BoxDecoration(
                            color: preview.onSurfaceVariant.withValues(
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
                            color: preview.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(7),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Container(
                        width: 72,
                        height: 34,
                        decoration: BoxDecoration(
                          color: preview.primary,
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
      ),
    );
  }
}

IconData _appearanceIcon(AppAppearance appearance) => switch (appearance) {
  AppAppearance.system => Icons.brightness_auto_outlined,
  AppAppearance.light => Icons.light_mode_outlined,
  AppAppearance.dark => Icons.dark_mode_outlined,
};
