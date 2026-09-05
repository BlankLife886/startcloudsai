import 'dart:convert';

class SseEvent {
  const SseEvent({required this.event, required this.data, this.id});

  final String event;
  final String data;
  final String? id;
}

abstract final class SseDecoder {
  static Stream<SseEvent> decode(Stream<List<int>> input) async* {
    var buffer = '';
    var eventName = 'message';
    String? eventId;
    final dataLines = <String>[];

    SseEvent? dispatch() {
      if (dataLines.isEmpty) {
        eventName = 'message';
        eventId = null;
        return null;
      }
      final event = SseEvent(
        event: eventName.isEmpty ? 'message' : eventName,
        data: dataLines.join('\n'),
        id: eventId,
      );
      eventName = 'message';
      eventId = null;
      dataLines.clear();
      return event;
    }

    void consume(String rawLine) {
      final line = rawLine.endsWith('\r')
          ? rawLine.substring(0, rawLine.length - 1)
          : rawLine;
      if (line.isEmpty || line.startsWith(':')) return;
      final separator = line.indexOf(':');
      final field = separator < 0 ? line : line.substring(0, separator);
      var value = separator < 0 ? '' : line.substring(separator + 1);
      if (value.startsWith(' ')) value = value.substring(1);
      switch (field) {
        case 'event':
          eventName = value;
        case 'data':
          dataLines.add(value);
        case 'id':
          eventId = value;
      }
    }

    await for (final chunk in utf8.decoder.bind(input)) {
      buffer += chunk;
      var newline = buffer.indexOf('\n');
      while (newline >= 0) {
        final line = buffer.substring(0, newline);
        buffer = buffer.substring(newline + 1);
        if (line.isEmpty || line == '\r') {
          final event = dispatch();
          if (event != null) yield event;
        } else {
          consume(line);
        }
        newline = buffer.indexOf('\n');
      }
    }

    if (buffer.isNotEmpty) consume(buffer);
    final event = dispatch();
    if (event != null) yield event;
  }
}
