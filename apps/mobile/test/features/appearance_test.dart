import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/appearance.dart';
import 'package:starcloudsai_mobile/features/profile/appearance_settings_screen.dart';

class _FakeAppearanceStore implements AppearancePreferenceStore {
  _FakeAppearanceStore({this.value, this.failWrites = false});

  String? value;
  bool failWrites;
  final List<String> writes = [];

  @override
  Future<String?> read() async => value;

  @override
  Future<void> write(String value) async {
    if (failWrites) throw StateError('write failed');
    this.value = value;
    writes.add(value);
  }
}

void main() {
  test('parses appearance values and maps theme modes', () {
    expect(parseAppAppearance('light'), AppAppearance.light);
    expect(parseAppAppearance('dark'), AppAppearance.dark);
    expect(parseAppAppearance('invalid'), AppAppearance.system);
    expect(parseAppAppearance(null), AppAppearance.system);
    expect(AppAppearance.system.themeMode, ThemeMode.system);
    expect(AppAppearance.light.themeMode, ThemeMode.light);
    expect(AppAppearance.dark.themeMode, ThemeMode.dark);
  });

  test('appearance controller restores and persists selection', () async {
    final store = _FakeAppearanceStore(value: 'dark');
    final container = ProviderContainer(
      overrides: [appearancePreferenceStoreProvider.overrideWithValue(store)],
    );
    addTearDown(container.dispose);

    expect(
      await container.read(appearanceControllerProvider.future),
      AppAppearance.dark,
    );
    await container
        .read(appearanceControllerProvider.notifier)
        .setAppearance(AppAppearance.light);

    expect(
      container.read(appearanceControllerProvider).requireValue,
      AppAppearance.light,
    );
    expect(store.writes, ['light']);
  });

  test('appearance controller rolls back when persistence fails', () async {
    final store = _FakeAppearanceStore(value: 'light', failWrites: true);
    final container = ProviderContainer(
      overrides: [appearancePreferenceStoreProvider.overrideWithValue(store)],
    );
    addTearDown(container.dispose);
    await container.read(appearanceControllerProvider.future);

    await expectLater(
      container
          .read(appearanceControllerProvider.notifier)
          .setAppearance(AppAppearance.dark),
      throwsStateError,
    );

    expect(
      container.read(appearanceControllerProvider).requireValue,
      AppAppearance.light,
    );
  });

  testWidgets('appearance screen switches mode and fits narrow large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final store = _FakeAppearanceStore();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [appearancePreferenceStoreProvider.overrideWithValue(store)],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const AppearanceSettingsScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('跟随系统'), findsOneWidget);
    await tester.tap(find.byKey(const Key('appearance-dark')));
    await tester.pumpAndSettle();

    expect(find.text('深色模式'), findsOneWidget);
    expect(find.text('始终使用深色外观'), findsOneWidget);
    expect(store.writes, ['dark']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('appearance screen reports save failure and restores mode', (
    tester,
  ) async {
    final store = _FakeAppearanceStore(value: 'light', failWrites: true);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [appearancePreferenceStoreProvider.overrideWithValue(store)],
        child: const MaterialApp(home: AppearanceSettingsScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('appearance-dark')));
    await tester.pumpAndSettle();

    expect(find.text('外观设置保存失败，请稍后重试'), findsOneWidget);
    expect(find.text('浅色模式'), findsOneWidget);
  });
}
