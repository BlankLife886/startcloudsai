import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_theme.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';
import 'package:starcloudsai_mobile/features/profile/app_permissions.dart';
import 'package:starcloudsai_mobile/features/profile/app_permissions_screen.dart';

class _FakePermissionGateway implements AppPermissionGateway {
  final states = <AppPermissionKind, AppPermissionState>{
    AppPermissionKind.photos: AppPermissionState.limited,
    AppPermissionKind.camera: AppPermissionState.denied,
    AppPermissionKind.microphone: AppPermissionState.permanentlyDenied,
    AppPermissionKind.speechRecognition: AppPermissionState.granted,
  };
  final statusCalls = <AppPermissionKind>[];
  final requestCalls = <AppPermissionKind>[];
  AppPermissionKind? failedRequest;
  var settingsCalls = 0;

  @override
  Future<AppPermissionState> status(AppPermissionKind kind) async {
    statusCalls.add(kind);
    return states[kind]!;
  }

  @override
  Future<AppPermissionState> request(AppPermissionKind kind) async {
    requestCalls.add(kind);
    if (failedRequest == kind) throw StateError('channel unavailable');
    return states[kind] = AppPermissionState.granted;
  }

  @override
  Future<bool> openSettings() async {
    settingsCalls += 1;
    return true;
  }
}

Widget _app(
  _FakePermissionGateway gateway, {
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) => ProviderScope(
  overrides: [appPermissionGatewayProvider.overrideWithValue(gateway)],
  child: MaterialApp(
    theme: StarCloudsTheme.light(),
    darkTheme: StarCloudsTheme.dark(),
    themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: AppNoticeHost(child: child!),
    ),
    home: const AppPermissionsScreen(),
  ),
);

void main() {
  testWidgets('permissions page fits narrow large text in light and dark', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    for (final brightness in Brightness.values) {
      final gateway = _FakePermissionGateway();
      await tester.pumpWidget(
        KeyedSubtree(
          key: ValueKey(brightness),
          child: _app(gateway, brightness: brightness, textScale: 1.6),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('权限管理'), findsOneWidget);
      expect(find.text('部分照片'), findsOneWidget);
      expect(find.text('未允许，点击申请'), findsOneWidget);
      expect(find.text('已关闭，前往设置'), findsOneWidget);
      expect(find.text('已允许'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('permission can be requested and updates visible status', (
    tester,
  ) async {
    final gateway = _FakePermissionGateway();
    await tester.pumpWidget(_app(gateway));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const Key('permission-camera')),
      warnIfMissed: false,
    );
    await tester.pumpAndSettle();

    expect(gateway.requestCalls, [AppPermissionKind.camera]);
    expect(find.text('权限已允许'), findsOneWidget);
    expect(find.text('已允许'), findsNWidgets(2));
  });

  testWidgets('permanently denied permission opens system settings', (
    tester,
  ) async {
    final gateway = _FakePermissionGateway();
    await tester.pumpWidget(_app(gateway));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const Key('permission-microphone')),
      warnIfMissed: false,
    );
    await tester.pumpAndSettle();

    expect(gateway.settingsCalls, 1);
    expect(gateway.requestCalls, isEmpty);
  });

  testWidgets('permission channel failure clears progress and can retry', (
    tester,
  ) async {
    final gateway = _FakePermissionGateway()
      ..failedRequest = AppPermissionKind.camera;
    await tester.pumpWidget(_app(gateway));
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const Key('permission-camera')),
      warnIfMissed: false,
    );
    await tester.pumpAndSettle();

    expect(find.text('权限请求失败，请稍后重试'), findsOneWidget);
    expect(find.text('处理中'), findsNothing);
    gateway.failedRequest = null;
    await tester.tap(
      find.byKey(const Key('permission-camera')),
      warnIfMissed: false,
    );
    await tester.pumpAndSettle();
    expect(find.text('权限已允许'), findsOneWidget);
  });

  testWidgets('permission state refreshes after returning to the app', (
    tester,
  ) async {
    final gateway = _FakePermissionGateway();
    await tester.pumpWidget(_app(gateway));
    await tester.pumpAndSettle();
    expect(gateway.statusCalls, hasLength(4));

    gateway.states[AppPermissionKind.camera] = AppPermissionState.granted;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();

    expect(gateway.statusCalls, hasLength(8));
    expect(find.text('未允许，点击申请'), findsNothing);
  });
}
