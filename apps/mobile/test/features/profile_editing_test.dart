import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:starcloudsai_mobile/features/auth/auth.dart';
import 'package:starcloudsai_mobile/features/create/create.dart';
import 'package:starcloudsai_mobile/features/create/create_screen.dart';
import 'package:starcloudsai_mobile/features/profile/edit_profile_screen.dart';
import 'package:starcloudsai_mobile/features/profile/profile.dart';
import 'package:starcloudsai_mobile/features/profile/profile_avatar.dart';
import 'package:starcloudsai_mobile/features/profile/profile_image_service.dart';

const _profileUser = AppUser(
  id: 'user-1',
  email: 'creator@example.com',
  username: '星空创作者',
  bio: '用图像记录灵感。',
  location: '上海',
  websiteUrl: 'https://example.com/portfolio',
  requireCostConfirm: true,
);

class _ProfileSessionController extends SessionController {
  @override
  FutureOr<SessionState> build() => const SessionState(user: _profileUser);
}

void main() {
  test('parses editable profile fields and cost preference', () {
    final user = AppUser.fromJson({
      'id': 'user-1',
      'email': 'creator@example.com',
      'username': '创作者',
      'avatarUrl': '/api/v1/files/uploads/user-1/original/avatar.jpg',
      'bio': '个人简介',
      'location': '杭州',
      'websiteUrl': 'https://example.com',
      'requireCostConfirm': false,
    });

    expect(user.avatarUrl, '/api/v1/files/uploads/user-1/original/avatar.jpg');
    expect(user.websiteUrl, 'https://example.com');
    expect(user.requireCostConfirm, isFalse);
    expect(user.bio, '个人简介');
    expect(user.location, '杭州');
    expect(AppUser.fromJson({'avatarUrl': ''}).avatarUrl, isNull);
    expect(AppUser.fromJson({'avatarUrl': 'null'}).avatarUrl, isNull);
  });

  test('prefers original upload url and derives a thumb for display', () {
    expect(
      uploadedFileUrl({
        'url': '/api/v1/files/uploads/user-1/original/avatar.jpg',
        'thumbnailUrl': '/api/v1/files/uploads/user-1/thumb/avatar',
      }),
      '/api/v1/files/uploads/user-1/original/avatar.jpg',
    );
    expect(
      uploadedFileUrl({'thumbnailUrl': '/api/v1/files/uploads/user-1/thumb/a'}),
      '/api/v1/files/uploads/user-1/thumb/a',
    );
    expect(uploadedFileUrl(const {}), isEmpty);
    expect(
      profileAvatarThumbUrl('/api/v1/files/uploads/user-1/original/avatar.jpg'),
      '/api/v1/files/uploads/user-1/thumb/avatar',
    );
    expect(
      profileAvatarRemoteUrls(
        '/api/v1/files/uploads/user-1/original/avatar.jpg',
      ),
      [
        '/api/v1/files/uploads/user-1/thumb/avatar',
        '/api/v1/files/uploads/user-1/original/avatar.jpg',
      ],
    );
  });

  test('validates editable profile fields using server limits', () {
    expect(validateProfileUsername('  '), '请输入用户名');
    expect(validateProfileUsername(List.filled(65, '名').join()), isNotNull);
    expect(validateProfileUsername('星空创作者'), isNull);
    expect(validateProfileBio(List.filled(281, '介').join()), isNotNull);
    expect(validateProfileLocation(List.filled(81, '地').join()), isNotNull);
    expect(validateProfileWebsite('example.com'), isNotNull);
    expect(validateProfileWebsite('ftp://example.com'), isNotNull);
    expect(validateProfileWebsite('https://example.com/path?q=1'), isNull);
    expect(validateProfileWebsite(''), isNull);
  });

  test('estimates creation cost within the model image limit', () {
    final model = ImageModelOption.fromJson({
      'id': 'image-pro',
      'name': '专业模型',
      'maxImages': 4,
      'pricePoints': 12,
    });

    expect(estimatedCreationCost(model, 0), 12);
    expect(estimatedCreationCost(model, 3), 36);
    expect(estimatedCreationCost(model, 8), 48);
  });

  testWidgets('profile avatar fallback remains stable with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: const Scaffold(
          body: Center(child: ProfileAvatar(username: '星空创作者', radius: 46)),
        ),
      ),
    );

    expect(find.text('星'), findsOneWidget);
    expect(find.byType(ProfileAvatar), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('keeps a persisted avatar file after the draft is deleted', () async {
    addTearDown(ProfileAvatarStore.reset);
    final directory = await Directory.systemTemp.createTemp('avatar-persist');
    addTearDown(() => directory.delete(recursive: true));
    final file = File('${directory.path}/avatar.jpg');
    await file.writeAsBytes(const [0xFF, 0xD8, 0xFF, 0xD9]);
    ProfileAvatarStore.remember('user-1', file.path);

    expect(ProfileAvatarStore.pathFor('user-1'), file.path);
    expect(
      resolveProfileAvatarSource(
        persistedPath: file.path,
        avatarUrl: '/api/v1/files/uploads/user-1/original/avatar.jpg',
      ),
      ProfileAvatarSource.persisted,
    );
    expect(
      resolveProfileAvatarSource(persistedPath: file.path, avatarUrl: null),
      ProfileAvatarSource.letter,
    );
  });

  testWidgets('profile form fits a narrow phone with large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionControllerProvider.overrideWith(_ProfileSessionController.new),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.6)),
            child: child!,
          ),
          home: const EditProfileScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('编辑资料'), findsOneWidget);
    expect(find.byTooltip('更换头像'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('创作费用确认'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('创作费用确认'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('退出登录'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.byKey(const Key('profile-sign-out')), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '保存资料'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
