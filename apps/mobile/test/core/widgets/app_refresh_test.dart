import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/widgets/app_refresh.dart';

void main() {
  testWidgets('custom refresh uses a thin arc instead of the material disc', (
    tester,
  ) async {
    var refreshed = 0;
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CustomScrollView(
            physics: appRefreshScrollPhysics,
            slivers: [
              AppSliverRefresh(
                onRefresh: () async {
                  refreshed += 1;
                  await Future<void>.delayed(const Duration(milliseconds: 40));
                },
              ),
              const SliverToBoxAdapter(
                child: SizedBox(height: 1200, child: Text('refresh-body')),
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.byType(RefreshIndicator), findsNothing);
    expect(find.text('refresh-body'), findsOneWidget);

    await tester.drag(
      find.byType(CustomScrollView),
      const Offset(0, 240),
      touchSlopY: 0,
    );
    await tester.pump();
    expect(find.byKey(const Key('app-refresh-indicator')), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);

    await tester.pumpAndSettle();
    expect(refreshed, 1);
    expect(tester.takeException(), isNull);
  });
}
