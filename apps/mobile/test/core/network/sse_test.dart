import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/core/network/sse.dart';

void main() {
  test('decodes fragmented UTF-8 task events and heartbeat comments', () async {
    const payload =
        ': ping\n\n'
        'id: event-1\n'
        'data: {"task":{"id":"task-1","prompt":"星空"}}\n\n';
    final bytes = utf8.encode(payload);
    final split = bytes.indexOf(0xE6) + 1;
    final events = await SseDecoder.decode(
      Stream<List<int>>.fromIterable([
        bytes.sublist(0, split),
        bytes.sublist(split, split + 1),
        bytes.sublist(split + 1),
      ]),
    ).toList();

    expect(events, hasLength(1));
    expect(events.single.event, 'message');
    expect(events.single.id, 'event-1');
    expect(events.single.data, contains('星空'));
  });

  test('preserves named events and joins multiple data lines', () async {
    final events = await SseDecoder.decode(
      Stream<List<int>>.value(
        utf8.encode(
          'event: notifications\r\n'
          'data: {"unreadCount":\r\n'
          'data: 3}\r\n\r\n',
        ),
      ),
    ).toList();

    expect(events, hasLength(1));
    expect(events.single.event, 'notifications');
    expect(events.single.data, '{"unreadCount":\n3}');
  });
}
