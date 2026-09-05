import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/app/starclouds_app.dart';
import 'package:starcloudsai_mobile/core/network/api_client.dart';

void main() {
  test('startup network status does not duplicate page-level errors', () {
    expect(
      shouldShowNetworkStatusNotice(null, ApiNetworkStatus.unavailable),
      isFalse,
    );
    expect(
      shouldShowNetworkStatusNotice(
        ApiNetworkStatus.unknown,
        ApiNetworkStatus.unavailable,
      ),
      isFalse,
    );
    expect(
      shouldShowNetworkStatusNotice(
        ApiNetworkStatus.unknown,
        ApiNetworkStatus.available,
      ),
      isFalse,
    );
  });

  test('runtime disconnect and recovery remain visible', () {
    expect(
      shouldShowNetworkStatusNotice(
        ApiNetworkStatus.available,
        ApiNetworkStatus.unavailable,
      ),
      isTrue,
    );
    expect(
      shouldShowNetworkStatusNotice(
        ApiNetworkStatus.unavailable,
        ApiNetworkStatus.available,
      ),
      isTrue,
    );
    expect(
      shouldShowNetworkStatusNotice(
        ApiNetworkStatus.available,
        ApiNetworkStatus.available,
      ),
      isFalse,
    );
  });
}
