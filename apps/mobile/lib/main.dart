import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/starclouds_app.dart';
import 'app/app_error_fallback.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  configureReleaseErrorFallback();
  runApp(const ProviderScope(child: StarCloudsApp()));
}
