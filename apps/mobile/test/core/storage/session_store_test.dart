import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/storage/session_store.dart';

void main() {
  test('isolates secure session keys by environment', () {
    expect(
      SessionStore.tokenKeyFor('development'),
      'starclouds.user_session.development',
    );
    expect(
      SessionStore.tokenKeyFor('production'),
      'starclouds.user_session.production',
    );
  });

  test('extracts the user session from Set-Cookie', () {
    const header =
        'sc_session=secret-token; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax';
    expect(SessionStore.parseSessionToken(header), 'secret-token');
  });

  test('recognizes a cleared session', () {
    const header = 'sc_session=; Path=/; Max-Age=0; HttpOnly';
    expect(SessionStore.parseSessionToken(header), '');
  });
}
