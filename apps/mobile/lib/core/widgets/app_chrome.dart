import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/starclouds_theme.dart';
import 'app_sheet.dart';
import 'app_visual.dart';

export 'app_sheet.dart';

Future<T?> showAppDialog<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool barrierDismissible = true,
  String barrierLabel = '关闭',
}) {
  final visual = StarCloudsVisualStyle.of(context);
  final reduce = MediaQuery.disableAnimationsOf(context);
  return showGeneralDialog<T>(
    context: context,
    useRootNavigator: true,
    barrierDismissible: barrierDismissible,
    barrierLabel: barrierLabel,
    barrierColor: visual.overlay,
    transitionDuration: reduce
        ? Duration.zero
        : const Duration(milliseconds: 220),
    pageBuilder: (context, animation, secondaryAnimation) => builder(context),
    transitionBuilder: (context, animation, secondaryAnimation, child) {
      if (reduce) return child;
      final appear = CurvedAnimation(
        parent: animation,
        curve: Curves.easeOutCubic,
        reverseCurve: Curves.easeInCubic,
      );
      return FadeTransition(
        opacity: appear,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, 0.028),
            end: Offset.zero,
          ).animate(appear),
          child: ScaleTransition(
            scale: Tween<double>(begin: 0.96, end: 1).animate(appear),
            child: child,
          ),
        ),
      );
    },
  );
}

class AppDialog extends StatelessWidget {
  const AppDialog({
    this.icon,
    this.title,
    this.content,
    this.actions = const [],
    super.key,
  });

  final Widget? icon;
  final Widget? title;
  final Widget? content;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final visual = StarCloudsVisualStyle.of(context);
    final inset = MediaQuery.viewInsetsOf(context);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(28, 24, 28, 24 + inset.bottom),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(8),
                boxShadow: [
                  BoxShadow(
                    color: visual.shadow.withValues(
                      alpha: Theme.of(context).brightness == Brightness.dark
                          ? .28
                          : .1,
                    ),
                    blurRadius: 28,
                    offset: const Offset(0, 12),
                  ),
                ],
              ),
              child: Material(
                key: const Key('app-dialog-card'),
                color: colors.surface,
                elevation: 0,
                shadowColor: Colors.transparent,
                surfaceTintColor: Colors.transparent,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
                clipBehavior: Clip.antiAlias,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(22, 22, 22, 16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (icon != null) ...[
                        Align(
                          alignment: Alignment.centerLeft,
                          child: AppIconWell(child: icon!),
                        ),
                        const SizedBox(height: 16),
                      ],
                      if (title != null)
                        DefaultTextStyle(
                          style: Theme.of(context).textTheme.titleLarge!
                              .copyWith(
                                fontWeight: FontWeight.w800,
                                letterSpacing: -0.2,
                              ),
                          child: title!,
                        ),
                      if (content != null) ...[
                        if (title != null) const SizedBox(height: 10),
                        DefaultTextStyle(
                          style: Theme.of(context).textTheme.bodyMedium!
                              .copyWith(
                                color: colors.onSurfaceVariant,
                                height: 1.45,
                              ),
                          child: content!,
                        ),
                      ],
                      if (actions.isNotEmpty) ...[
                        const SizedBox(height: 22),
                        Wrap(
                          alignment: WrapAlignment.end,
                          spacing: 8,
                          runSpacing: 8,
                          children: actions,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Picked<T> {
  const _Picked(this.value);
  final T value;
}

Future<T?> showAppPicker<T>({
  required BuildContext context,
  required String title,
  required List<T> options,
  required T? current,
  required String Function(T) labelOf,
  String Function(T)? subtitleOf,
}) async {
  final picked = await showAppSheet<_Picked<T>>(
    context: context,
    builder: (context) {
      final colors = Theme.of(context).colorScheme;
      return SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(8, 4, 8, 20),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: Text(
                title,
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            for (final item in options)
              AppPickerTile(
                label: labelOf(item),
                subtitle: subtitleOf?.call(item),
                selected: item == current,
                color: colors.primary,
                onTap: () => Navigator.pop(context, _Picked(item)),
              ),
          ],
        ),
      );
    },
  );
  return picked?.value;
}

class AppPickerTile extends StatelessWidget {
  const AppPickerTile({
    required this.label,
    required this.selected,
    required this.onTap,
    this.subtitle,
    this.color,
    super.key,
  });

  final String label;
  final String? subtitle;
  final bool selected;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final accent = color ?? colors.primary;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      child: Material(
        color: selected
            ? accent.withValues(alpha: .10)
            : colors.surfaceContainerLow,
        borderRadius: StarCloudsRadii.control,
        clipBehavior: Clip.antiAlias,
        child: AppPressable(
          onTap: onTap,
          semanticLabel: selected ? '$label，已选择' : label,
          selected: selected,
          excludeChildSemantics: true,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: selected ? accent : colors.onSurface,
                        ),
                      ),
                      if (subtitle?.isNotEmpty == true) ...[
                        const SizedBox(height: 3),
                        Text(
                          subtitle!,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ],
                  ),
                ),
                if (selected)
                  Icon(Icons.check_circle_rounded, color: accent, size: 22)
                else
                  Icon(
                    Icons.circle_outlined,
                    color: colors.outline.withValues(alpha: .55),
                    size: 20,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class AppSelectOption<T> {
  const AppSelectOption({
    required this.value,
    required this.label,
    this.subtitle,
  });

  final T value;
  final String label;
  final String? subtitle;
}

class AppSelectField<T> extends StatelessWidget {
  const AppSelectField({
    required this.label,
    required this.options,
    required this.onChanged,
    this.value,
    this.prefixIcon,
    this.enabled = true,
    super.key,
  });

  final String label;
  final T? value;
  final List<AppSelectOption<T>> options;
  final ValueChanged<T?>? onChanged;
  final IconData? prefixIcon;
  final bool enabled;

  AppSelectOption<T>? get _selected {
    for (final option in options) {
      if (option.value == value) return option;
    }
    return null;
  }

  Future<void> _open(BuildContext context) async {
    if (!enabled || onChanged == null) return;
    String labelOf(T item) {
      for (final option in options) {
        if (option.value == item) return option.label;
      }
      return '$item';
    }

    String? subtitleOf(T item) {
      for (final option in options) {
        if (option.value == item) return option.subtitle;
      }
      return null;
    }

    final picked = await showAppSheet<_Picked<T>>(
      context: context,
      builder: (context) {
        final colors = Theme.of(context).colorScheme;
        return SafeArea(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 20),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                child: Text(
                  label,
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              for (final option in options)
                AppPickerTile(
                  label: labelOf(option.value),
                  subtitle: subtitleOf(option.value),
                  selected: option.value == value,
                  color: colors.primary,
                  onTap: () => Navigator.pop(context, _Picked(option.value)),
                ),
            ],
          ),
        );
      },
    );
    if (picked == null) return;
    onChanged?.call(picked.value);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final selected = _selected;
    return Material(
      color: enabled ? colors.surfaceContainerLow : colors.surfaceContainer,
      borderRadius: StarCloudsRadii.control,
      clipBehavior: Clip.antiAlias,
      child: AppPressable(
        onTap: enabled ? () => _open(context) : null,
        semanticLabel: '$label，${selected?.label ?? '请选择'}',
        excludeChildSemantics: true,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
          child: Row(
            children: [
              if (prefixIcon != null) ...[
                Icon(prefixIcon, color: colors.onSurfaceVariant),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      selected?.label ?? '请选择',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.keyboard_arrow_down_rounded,
                color: colors.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class AppChoicePill extends StatelessWidget {
  const AppChoicePill({
    required this.label,
    required this.selected,
    this.onSelected,
    this.avatar,
    this.semanticLabel,
    super.key,
  });

  final Widget label;
  final Widget? avatar;
  final bool selected;
  final ValueChanged<bool>? onSelected;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: selected ? colors.primary : colors.surfaceContainerLow,
      shape: const StadiumBorder(),
      clipBehavior: Clip.antiAlias,
      child: AppPressable(
        onTap: onSelected == null ? null : () => onSelected!(!selected),
        semanticLabel: semanticLabel,
        selected: selected,
        excludeChildSemantics: semanticLabel != null,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          child: DefaultTextStyle(
            style: Theme.of(context).textTheme.labelLarge!.copyWith(
              color: selected ? colors.onPrimary : colors.onSurface,
              fontWeight: FontWeight.w700,
            ),
            child: IconTheme(
              data: IconThemeData(
                size: 16,
                color: selected ? colors.onPrimary : colors.onSurfaceVariant,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (avatar != null) ...[avatar!, const SizedBox(width: 8)],
                  label,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class AppFilterChip extends StatelessWidget {
  const AppFilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  void _activate() {
    HapticFeedback.selectionClick();
    onTap();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final reduce = MediaQuery.disableAnimationsOf(context);
    return AppPressable(
      onTap: _activate,
      semanticLabel: selected ? '$label，已选择' : label,
      selected: selected,
      excludeChildSemantics: true,
      child: AnimatedContainer(
        key: const Key('app-filter-chip-surface'),
        height: 36,
        duration: reduce ? Duration.zero : AppMotion.press,
        curve: AppMotion.ease,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? colors.onSurface : colors.surfaceContainerLow,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(
                icon,
                size: 15,
                color: selected ? colors.surface : colors.onSurfaceVariant,
              ),
              const SizedBox(width: 5),
            ],
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  color: selected ? colors.surface : colors.onSurface,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class AppBackButton extends StatelessWidget {
  const AppBackButton({required this.onPressed, super.key});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Tooltip(
      message: '返回',
      child: AppPressable(
        key: const Key('app-top-bar-back'),
        onTap: onPressed,
        semanticLabel: '返回',
        excludeChildSemantics: true,
        child: SizedBox(
          width: 48,
          height: 44,
          child: Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.only(left: 14),
              child: Icon(
                Icons.arrow_back_ios_new_rounded,
                size: 18,
                color: colors.onSurface,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class AppIconWell extends StatelessWidget {
  const AppIconWell({
    required this.child,
    this.color,
    this.size = 44,
    super.key,
  });

  final Widget child;
  final Color? color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final visual = StarCloudsVisualStyle.of(context);
    final colors = Theme.of(context).colorScheme;
    return SizedBox.square(
      dimension: size,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: color ?? visual.brandSoft,
          borderRadius: BorderRadius.circular(8),
        ),
        child: IconTheme(
          data: IconThemeData(color: colors.primary, size: size * 0.48),
          child: Center(child: child),
        ),
      ),
    );
  }
}

class AppStatusView extends StatelessWidget {
  const AppStatusView({
    required this.icon,
    required this.title,
    required this.message,
    this.iconKey,
    this.actionLabel,
    this.actionKey,
    this.actionIcon = Icons.refresh_rounded,
    this.onAction,
    this.primaryAction = false,
    this.embedded = false,
    super.key,
  });

  final IconData icon;
  final Key? iconKey;
  final String title;
  final String message;
  final String? actionLabel;
  final Key? actionKey;
  final IconData actionIcon;
  final VoidCallback? onAction;
  final bool primaryAction;
  final bool embedded;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final content = ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 360),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, key: iconKey, size: 40, color: colors.onSurfaceVariant),
          const SizedBox(height: 16),
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            message,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
              height: 1.45,
            ),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 20),
            if (primaryAction)
              FilledButton.icon(
                key: actionKey,
                onPressed: onAction,
                icon: Icon(actionIcon),
                label: Text(actionLabel!),
              )
            else
              OutlinedButton.icon(
                key: actionKey,
                onPressed: onAction,
                icon: Icon(actionIcon),
                label: Text(actionLabel!),
              ),
          ],
        ],
      ),
    );
    if (embedded) return content;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(28, 40, 28, 40),
        child: content,
      ),
    );
  }
}

class AppSurface extends StatelessWidget {
  const AppSurface({
    required this.child,
    this.padding,
    this.onTap,
    this.color,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return AppSoftCard(
      color: color,
      padding: padding,
      onTap: onTap,
      child: child,
    );
  }
}

class AppGradientButton extends StatelessWidget {
  const AppGradientButton({
    required this.onPressed,
    required this.child,
    this.icon,
    super.key,
  });

  final VoidCallback? onPressed;
  final Widget child;
  final Widget? icon;

  @override
  Widget build(BuildContext context) {
    final visual = StarCloudsVisualStyle.of(context);
    final enabled = onPressed != null;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: enabled ? visual.brandGradient : null,
        color: enabled
            ? null
            : Theme.of(context).disabledColor.withValues(alpha: .18),
        borderRadius: StarCloudsRadii.control,
        boxShadow: enabled
            ? [
                BoxShadow(
                  color: visual.brandStart.withValues(alpha: .28),
                  blurRadius: 16,
                  offset: const Offset(0, 8),
                ),
              ]
            : null,
      ),
      child: FilledButton(
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: Colors.transparent,
          disabledBackgroundColor: Colors.transparent,
          shadowColor: Colors.transparent,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(52),
        ),
        child: icon == null
            ? child
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [icon!, const SizedBox(width: 8), child],
              ),
      ),
    );
  }
}
