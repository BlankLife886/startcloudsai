import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/widgets/app_notice.dart';

Widget _app({
  required Widget child,
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) => MaterialApp(
  theme: ThemeData(colorSchemeSeed: Colors.blue),
  darkTheme: ThemeData(
    brightness: Brightness.dark,
    colorSchemeSeed: Colors.blue,
  ),
  themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
  builder: (context, appChild) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: AppNoticeHost(child: appChild!),
  ),
  home: Scaffold(body: child),
);

void main() {
  testWidgets(
    'notice is centered, replaces the previous item and runs action',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(400, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      late BuildContext noticeContext;
      var actionCount = 0;
      await tester.pumpWidget(
        _app(
          child: Builder(
            builder: (context) {
              noticeContext = context;
              return const SizedBox.expand();
            },
          ),
        ),
      );

      AppNotice.success(noticeContext, '素材已保存');
      await tester.pumpAndSettle();

      final card = find.byKey(const Key('app-notice-card'));
      expect(card, findsOneWidget);
      expect(find.text('素材已保存'), findsOneWidget);
      expect(find.byKey(const Key('app-notice-success')), findsOneWidget);
      expect(tester.getCenter(card).dx, closeTo(200, 1));
      expect(tester.getCenter(card).dy, closeTo(400, 1));

      AppNotice.show(
        noticeContext,
        '请重新验证邮箱',
        title: '登录已过期',
        type: AppNoticeType.warning,
        duration: const Duration(minutes: 1),
        actionLabel: '重新登录',
        onAction: () => actionCount += 1,
      );
      await tester.pumpAndSettle();

      expect(find.text('素材已保存'), findsNothing);
      expect(find.text('登录已过期'), findsOneWidget);
      expect(find.byKey(const Key('app-notice-warning')), findsOneWidget);
      await tester.tap(find.byKey(const Key('app-notice-action')));
      await tester.pumpAndSettle();
      expect(actionCount, 1);
      expect(card, findsNothing);
    },
  );

  testWidgets('notice fits narrow large text in light and dark themes', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final brightness in Brightness.values) {
      late BuildContext noticeContext;
      await tester.pumpWidget(
        _app(
          brightness: brightness,
          textScale: 1.6,
          child: Builder(
            builder: (context) {
              noticeContext = context;
              return const SizedBox.expand();
            },
          ),
        ),
      );
      AppNotice.error(noticeContext, '网络连接失败，请检查网络后重新尝试');
      await tester.pumpAndSettle();
      expect(find.textContaining('网络连接失败'), findsOneWidget);
      expect(tester.takeException(), isNull);
      AppNotice.hide(noticeContext);
      await tester.pumpAndSettle();
    }
  });

  testWidgets('notice automatically disappears', (tester) async {
    late BuildContext noticeContext;
    await tester.pumpWidget(
      _app(
        child: Builder(
          builder: (context) {
            noticeContext = context;
            return const SizedBox.expand();
          },
        ),
      ),
    );
    AppNotice.show(
      noticeContext,
      '短提示',
      duration: const Duration(milliseconds: 500),
    );
    await tester.pumpAndSettle();
    expect(find.text('短提示'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 700));
    await tester.pumpAndSettle();
    expect(find.text('短提示'), findsNothing);
  });
}
