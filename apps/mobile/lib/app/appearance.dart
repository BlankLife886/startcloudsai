import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum AppAppearance { system, light, dark }

extension AppAppearancePresentation on AppAppearance {
  ThemeMode get themeMode => switch (this) {
    AppAppearance.system => ThemeMode.system,
    AppAppearance.light => ThemeMode.light,
    AppAppearance.dark => ThemeMode.dark,
  };

  String get label => switch (this) {
    AppAppearance.system => '跟随系统',
    AppAppearance.light => '浅色模式',
    AppAppearance.dark => '深色模式',
  };

  String get description => switch (this) {
    AppAppearance.system => '根据设备外观自动切换',
    AppAppearance.light => '始终使用浅色外观',
    AppAppearance.dark => '始终使用深色外观',
  };
}

AppAppearance parseAppAppearance(String? value) => switch (value) {
  'light' => AppAppearance.light,
  'dark' => AppAppearance.dark,
  _ => AppAppearance.system,
};

Brightness effectiveAppearanceBrightness(
  AppAppearance appearance,
  Brightness platformBrightness,
) => switch (appearance) {
  AppAppearance.system => platformBrightness,
  AppAppearance.light => Brightness.light,
  AppAppearance.dark => Brightness.dark,
};

String effectiveAppearanceLabel(
  AppAppearance appearance,
  Brightness platformBrightness,
) =>
    effectiveAppearanceBrightness(appearance, platformBrightness) ==
        Brightness.dark
    ? '深色外观'
    : '浅色外观';

abstract interface class AppearancePreferenceStore {
  Future<String?> read();
  Future<void> write(String value);
}

class SharedPreferencesAppearanceStore implements AppearancePreferenceStore {
  static const _key = 'app_appearance';

  @override
  Future<String?> read() async =>
      (await SharedPreferences.getInstance()).getString(_key);

  @override
  Future<void> write(String value) async {
    final saved = await (await SharedPreferences.getInstance()).setString(
      _key,
      value,
    );
    if (!saved) throw StateError('外观偏好保存失败');
  }
}

final appearancePreferenceStoreProvider = Provider<AppearancePreferenceStore>(
  (ref) => SharedPreferencesAppearanceStore(),
);

class AppearanceController extends AsyncNotifier<AppAppearance> {
  AppearancePreferenceStore get _store =>
      ref.read(appearancePreferenceStoreProvider);

  @override
  Future<AppAppearance> build() async =>
      parseAppAppearance(await _store.read());

  Future<void> setAppearance(AppAppearance appearance) async {
    final previous = state.asData?.value ?? AppAppearance.system;
    if (appearance == previous) return;
    state = AsyncData(appearance);
    try {
      await _store.write(appearance.name);
    } catch (error, stackTrace) {
      state = AsyncData(previous);
      Error.throwWithStackTrace(error, stackTrace);
    }
  }
}

final appearanceControllerProvider =
    AsyncNotifierProvider<AppearanceController, AppAppearance>(
      AppearanceController.new,
    );
