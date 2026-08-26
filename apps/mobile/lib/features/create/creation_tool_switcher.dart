import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

enum CreationTool { image }

class CreationToolSwitcher extends StatelessWidget {
  const CreationToolSwitcher({required this.selected, super.key});

  final CreationTool selected;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: colors.surfaceContainerLow,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(
            color: colors.outlineVariant.withValues(alpha: .55),
          ),
        ),
        child: Row(
          children: [
            _ToolButton(
              key: const Key('creation-tool-image'),
              selected: selected == CreationTool.image,
              icon: Icons.auto_awesome_outlined,
              label: '文生图',
              onTap: () => _go(context, CreationTool.image),
            ),
          ],
        ),
      ),
    );
  }

  void _go(BuildContext context, CreationTool tool) {
    if (tool == selected) return;
    context.go('/create');
  }
}

class _ToolButton extends StatelessWidget {
  const _ToolButton({
    required this.selected,
    required this.icon,
    required this.label,
    required this.onTap,
    super.key,
  });

  final bool selected;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(right: 4),
      child: Material(
        color: selected ? colors.primary : Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: selected ? null : onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  icon,
                  size: 18,
                  color: selected ? colors.onPrimary : colors.onSurfaceVariant,
                ),
                const SizedBox(width: 7),
                Text(
                  label,
                  style: TextStyle(
                    color: selected
                        ? colors.onPrimary
                        : colors.onSurfaceVariant,
                    fontWeight: selected ? FontWeight.w900 : FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
