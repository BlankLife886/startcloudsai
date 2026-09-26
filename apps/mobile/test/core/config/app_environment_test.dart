import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/config/app_environment.dart';

void main() {
  test('debug builds default to the local API', () {
    final environment = AppEnvironment.fromDefines(isReleaseMode: false);

    expect(environment.name, AppEnvironmentName.development);
    expect(environment.apiBaseUrl, 'http://localhost:8000/api/v1');
  });

  test('release builds default to the production API', () {
    final environment = AppEnvironment.fromDefines(isReleaseMode: true);

    expect(environment.name, AppEnvironmentName.production);
    expect(environment.apiBaseUrl, 'https://starcloudisai.com/api/v1');
  });

  test('debug refuses an accidental production API override', () {
    final environment = AppEnvironment.fromDefines(
      isReleaseMode: false,
      rawName: 'production',
      configuredUrl: 'https://starcloudisai.com/api/v1',
    );

    expect(environment.name, AppEnvironmentName.development);
    expect(environment.apiBaseUrl, 'http://localhost:8000/api/v1');
  });

  test('debug production API override requires an explicit opt-in', () {
    final environment = AppEnvironment.fromDefines(
      isReleaseMode: false,
      rawName: 'production',
      configuredUrl: 'https://starcloudisai.com/api/v1',
      allowProductionApiInDebug: true,
    );

    expect(environment.name, AppEnvironmentName.production);
    expect(environment.apiBaseUrl, 'https://starcloudisai.com/api/v1');
  });

  test('normalizes origin and API prefix', () {
    final environment = AppEnvironment.create(
      name: AppEnvironmentName.staging,
      baseUrl: 'https://staging.example.com/api/v1/',
    );

    expect(environment.origin, 'https://staging.example.com');
    expect(environment.apiBaseUrl, 'https://staging.example.com/api/v1');
    expect(environment.label, '预发布环境');
  });
}
