import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

enum AppPermissionKind { photos, camera, microphone, speechRecognition }

enum AppPermissionState {
  unknown,
  granted,
  limited,
  denied,
  permanentlyDenied,
  restricted,
  notRequired,
  unavailable,
}

abstract class AppPermissionGateway {
  Future<AppPermissionState> status(AppPermissionKind kind);

  Future<AppPermissionState> request(AppPermissionKind kind);

  Future<bool> openSettings();
}

class DeviceAppPermissionGateway implements AppPermissionGateway {
  DeviceAppPermissionGateway({TargetPlatform? platform})
    : _platform = platform ?? defaultTargetPlatform;

  final TargetPlatform _platform;

  Permission? _permission(AppPermissionKind kind) {
    if (_platform == TargetPlatform.iOS) {
      return switch (kind) {
        AppPermissionKind.photos => Permission.photos,
        AppPermissionKind.camera => Permission.camera,
        AppPermissionKind.microphone => Permission.microphone,
        AppPermissionKind.speechRecognition => Permission.speech,
      };
    }
    if (_platform == TargetPlatform.android) {
      return switch (kind) {
        AppPermissionKind.microphone => Permission.microphone,
        _ => null,
      };
    }
    return null;
  }

  AppPermissionState _unsupportedState() {
    if (_platform == TargetPlatform.android) {
      return AppPermissionState.notRequired;
    }
    return AppPermissionState.unavailable;
  }

  @override
  Future<AppPermissionState> status(AppPermissionKind kind) async {
    final permission = _permission(kind);
    if (permission == null) return _unsupportedState();
    return _mapStatus(await permission.status);
  }

  @override
  Future<AppPermissionState> request(AppPermissionKind kind) async {
    final permission = _permission(kind);
    if (permission == null) return _unsupportedState();
    return _mapStatus(await permission.request());
  }

  @override
  Future<bool> openSettings() => openAppSettings();

  AppPermissionState _mapStatus(PermissionStatus status) {
    if (status.isGranted) return AppPermissionState.granted;
    if (status.isLimited) return AppPermissionState.limited;
    if (status.isPermanentlyDenied) {
      return AppPermissionState.permanentlyDenied;
    }
    if (status.isRestricted) return AppPermissionState.restricted;
    return AppPermissionState.denied;
  }
}

final appPermissionGatewayProvider = Provider<AppPermissionGateway>(
  (ref) => DeviceAppPermissionGateway(),
);
