import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';
import 'package:starcloudsai_mobile/core/providers.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';
import 'package:starcloudsai_mobile/core/widgets/authenticated_image.dart';

class _DelayedHeaderClient extends ApiClient {
  _DelayedHeaderClient(this.headers)
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'https://example.com',
        ),
        sessionStore: SessionStore(namespace: 'authenticated-image-test'),
      );

  final Completer<Map<String, String>> headers;

  @override
  String resolveUrl(String value) => 'https://example.com/private.jpg';

  @override
  Future<Map<String, String>> authenticatedHeaders() => headers.future;
}

class _RetryHeaderClient extends ApiClient {
  _RetryHeaderClient()
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'https://example.com',
        ),
        sessionStore: SessionStore(namespace: 'authenticated-image-retry-test'),
      );

  int headerRequests = 0;
  final refreshedHeaders = Completer<Map<String, String>>();

  @override
  String resolveUrl(String value) => 'https://example.com/private.jpg';

  @override
  Future<Map<String, String>> authenticatedHeaders() async {
    headerRequests += 1;
    if (headerRequests == 1) throw StateError('temporary auth failure');
    return refreshedHeaders.future;
  }
}

class _ImmediateHeaderClient extends ApiClient {
  _ImmediateHeaderClient()
    : super(
        environment: AppEnvironment.create(
          name: AppEnvironmentName.development,
          baseUrl: 'https://example.com',
        ),
        sessionStore: SessionStore(namespace: 'authenticated-image-url-test'),
      );

  int headerRequests = 0;

  @override
  String resolveUrl(String value) => 'https://example.com$value';

  @override
  Future<Map<String, String>> authenticatedHeaders() async {
    headerRequests += 1;
    return const {'Cookie': 'sc_session=test-token'};
  }
}

void main() {
  testWidgets('private image waits for authentication headers before loading', (
    tester,
  ) async {
    final headers = Completer<Map<String, String>>();
    final client = _DelayedHeaderClient(headers);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: const MaterialApp(
          home: Scaffold(body: AuthenticatedImage(url: '/private.jpg')),
        ),
      ),
    );

    expect(find.byIcon(Icons.image_outlined), findsOneWidget);
    expect(find.byType(Image), findsNothing);

    headers.complete(const {'Cookie': 'sc_session=test-token'});
    await tester.pump();

    final image = tester.widget<Image>(find.byType(Image));
    final provider = image.image as NetworkImage;
    expect(provider.headers, const {'Cookie': 'sc_session=test-token'});
  });

  testWidgets(
    'failed private image retries headers from an inline recovery UI',
    (tester) async {
      final client = _RetryHeaderClient();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [apiClientProvider.overrideWithValue(client)],
          child: const MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 240,
                height: 180,
                child: AuthenticatedImage(url: '/private.jpg'),
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(
        find.byKey(const Key('authenticated-image-failure')),
        findsOneWidget,
      );
      expect(find.text('图片加载失败'), findsOneWidget);
      expect(find.text('点击重新加载'), findsOneWidget);

      await tester.tap(find.byKey(const Key('authenticated-image-retry')));
      await tester.pump();

      expect(client.headerRequests, 2);
      expect(find.byIcon(Icons.image_outlined), findsOneWidget);
      client.refreshedHeaders.complete(const {
        'Cookie': 'sc_session=refreshed-token',
      });
      await tester.pump();
      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image as NetworkImage;
      expect(provider.headers, const {'Cookie': 'sc_session=refreshed-token'});
      expect(provider.url, contains('_mobile_image_retry=1'));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('compact image failure uses an icon without text overflow', (
    tester,
  ) async {
    final client = _RetryHeaderClient();
    await tester.binding.setSurfaceSize(const Size(80, 80));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: const MaterialApp(
          home: Scaffold(
            body: SizedBox.square(
              dimension: 40,
              child: AuthenticatedImage(url: '/avatar.jpg'),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);
    expect(find.text('图片加载失败'), findsNothing);
    expect(find.byKey(const Key('authenticated-image-retry')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('large text keeps a grid thumbnail in compact recovery mode', (
    tester,
  ) async {
    final client = _RetryHeaderClient();
    await tester.binding.setSurfaceSize(const Size(320, 240));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const Scaffold(
            body: SizedBox(
              width: 139,
              height: 115,
              child: AuthenticatedImage(url: '/thumbnail.jpg'),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);
    expect(find.text('图片加载失败'), findsNothing);
    expect(find.byKey(const Key('authenticated-image-retry')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('changing the url fetches headers again instead of stalling', (
    tester,
  ) async {
    final client = _ImmediateHeaderClient();
    Widget image(String url) => ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(client)],
      child: MaterialApp(
        home: Scaffold(body: AuthenticatedImage(url: url)),
      ),
    );

    await tester.pumpWidget(image('/one.jpg'));
    await tester.pump();
    expect(client.headerRequests, 1);
    expect(find.byType(Image), findsOneWidget);

    await tester.pumpWidget(image('/two.jpg'));
    await tester.pump();
    expect(client.headerRequests, 2);
    expect(find.byType(Image), findsOneWidget);
    expect(find.byIcon(Icons.image_outlined), findsNothing);
    final provider =
        tester.widget<Image>(find.byType(Image)).image as NetworkImage;
    expect(provider.url, 'https://example.com/two.jpg');
    expect(tester.takeException(), isNull);
  });
}
