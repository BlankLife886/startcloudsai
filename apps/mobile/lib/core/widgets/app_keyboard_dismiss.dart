import 'package:flutter/material.dart';

class AppKeyboardDismiss extends StatelessWidget {
  const AppKeyboardDismiss({required this.child, super.key});

  final Widget child;

  void _dismiss() {
    FocusManager.instance.primaryFocus?.unfocus();
  }

  @override
  Widget build(BuildContext context) {
    return NotificationListener<ScrollStartNotification>(
      onNotification: (notification) {
        if (notification.dragDetails != null) _dismiss();
        return false;
      },
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: _dismiss,
        child: child,
      ),
    );
  }
}
