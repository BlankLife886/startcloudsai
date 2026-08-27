import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/starclouds_theme.dart';
import '../../app/user_session_cache.dart';
import '../../core/network/api_exception.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../auth/auth.dart';
import 'profile.dart';
import 'profile_avatar.dart';
import 'profile_image_service.dart';

String? validateProfileUsername(String? value) {
  final length = value?.trim().runes.length ?? 0;
  if (length == 0) return '请输入用户名';
  if (length > 64) return '用户名不能超过 64 个字符';
  return null;
}

String? validateProfileLocation(String? value) =>
    (value?.trim().runes.length ?? 0) > 80 ? '所在地不能超过 80 个字符' : null;

String? validateProfileBio(String? value) =>
    (value?.trim().runes.length ?? 0) > 280 ? '个人简介不能超过 280 个字符' : null;

String? validateProfileWebsite(String? value) {
  final website = value?.trim() ?? '';
  if (website.isEmpty) return null;
  if (website.runes.length > 300) return '网站地址不能超过 300 个字符';
  final uri = Uri.tryParse(website);
  if (uri == null ||
      !{'http', 'https'}.contains(uri.scheme.toLowerCase()) ||
      uri.host.isEmpty) {
    return '请输入完整的 HTTP/HTTPS 地址';
  }
  return null;
}

class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _bioController = TextEditingController();
  final _locationController = TextEditingController();
  final _websiteController = TextEditingController();
  bool _initialized = false;
  bool _requireCostConfirm = true;
  bool _selectingAvatar = false;
  bool _saving = false;
  bool _removeAvatar = false;
  ProfileImageDraft? _avatarDraft;

  @override
  void dispose() {
    _usernameController.dispose();
    _bioController.dispose();
    _locationController.dispose();
    _websiteController.dispose();
    _deleteDraft();
    super.dispose();
  }

  void _initialize(AppUser user) {
    if (_initialized) return;
    _initialized = true;
    _usernameController.text = user.username;
    _bioController.text = user.bio;
    _locationController.text = user.location;
    _websiteController.text = user.websiteUrl;
    _requireCostConfirm = user.requireCostConfirm;
  }

  Future<void> _chooseAvatar(AppUser user) async {
    final action = await showAppSheet<_AvatarAction>(
      context: context,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '更换头像',
                style: Theme.of(
                  context,
                ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 12),
              _AvatarSheetAction(
                icon: Icons.photo_library_outlined,
                title: '从相册选择',
                onTap: () => Navigator.pop(context, _AvatarAction.gallery),
              ),
              _AvatarSheetAction(
                icon: Icons.photo_camera_outlined,
                title: '拍照',
                onTap: () => Navigator.pop(context, _AvatarAction.camera),
              ),
              if (_avatarDraft != null ||
                  (!_removeAvatar && user.avatarUrl?.isNotEmpty == true))
                _AvatarSheetAction(
                  icon: Icons.delete_outline,
                  title: '移除头像',
                  destructive: true,
                  onTap: () => Navigator.pop(context, _AvatarAction.remove),
                ),
            ],
          ),
        ),
      ),
    );
    if (action == null || !mounted) return;
    if (action == _AvatarAction.remove) {
      await _removeAvatarNow(user);
      return;
    }
    setState(() => _selectingAvatar = true);
    try {
      final image = await ref
          .read(profileImageServiceProvider)
          .pick(
            action == _AvatarAction.gallery
                ? ProfileImageSource.gallery
                : ProfileImageSource.camera,
          );
      if (image == null || !mounted) return;
      _deleteDraft();
      final persisted = await ref
          .read(profileImageServiceProvider)
          .persistAvatar(user.id, image);
      final draft = persisted == null
          ? image
          : ProfileImageDraft(localPath: persisted, filename: image.filename);
      if (persisted != null && persisted != image.localPath) {
        File(image.localPath).delete().ignore();
      }
      setState(() {
        _avatarDraft = draft;
        _removeAvatar = false;
      });
      final avatarUrl = await ref
          .read(profileRepositoryProvider)
          .uploadAvatar(draft);
      await _commitProfile(user, avatarUrl: avatarUrl, updateAvatar: true);
      if (!mounted) return;
      setState(() => _avatarDraft = null);
      AppNotice.success(context, '头像已更新');
    } catch (error) {
      if (mounted) _showError(error, fallback: '头像上传失败，请稍后重试');
    } finally {
      if (mounted) setState(() => _selectingAvatar = false);
    }
  }

  Future<void> _removeAvatarNow(AppUser user) async {
    _deleteDraft();
    setState(() {
      _avatarDraft = null;
      _removeAvatar = true;
      _selectingAvatar = true;
    });
    try {
      await ref.read(profileImageServiceProvider).clearPersistedAvatar(user.id);
      await _commitProfile(user, avatarUrl: '', updateAvatar: true);
      if (!mounted) return;
      setState(() => _removeAvatar = false);
      AppNotice.success(context, '头像已移除');
    } catch (error) {
      if (mounted) _showError(error, fallback: '头像移除失败，请稍后重试');
    } finally {
      if (mounted) setState(() => _selectingAvatar = false);
    }
  }

  Future<AppUser> _commitProfile(
    AppUser user, {
    String? avatarUrl,
    bool updateAvatar = false,
  }) async {
    final updated = await ref
        .read(profileRepositoryProvider)
        .updateProfile(
          username: _usernameController.text,
          bio: _bioController.text,
          location: _locationController.text,
          websiteUrl: _websiteController.text,
          requireCostConfirm: _requireCostConfirm,
          avatarUrl: avatarUrl,
          updateAvatar: updateAvatar,
        );
    final saved = AppUser(
      id: updated.id,
      email: updated.email,
      username: updated.username,
      avatarUrl: updateAvatar
          ? ((avatarUrl == null || avatarUrl.trim().isEmpty)
                ? null
                : (updated.avatarUrl?.trim().isNotEmpty == true
                      ? updated.avatarUrl
                      : avatarUrl))
          : updated.avatarUrl,
      bio: updated.bio,
      location: updated.location,
      websiteUrl: updated.websiteUrl,
      requireCostConfirm: updated.requireCostConfirm,
    );
    ref.read(sessionControllerProvider.notifier).replaceUser(saved);
    return saved;
  }

  void _deleteDraft() {
    final path = _avatarDraft?.localPath;
    if (path == null || path.isEmpty) return;
    if (ProfileAvatarStore.containsPath(path)) return;
    File(path).delete().ignore();
  }

  Future<void> _save(AppUser user) async {
    if (!_formKey.currentState!.validate() || _saving) return;
    setState(() => _saving = true);
    try {
      String? avatarUrl;
      final updateAvatar = _removeAvatar || _avatarDraft != null;
      if (_removeAvatar) {
        await ref
            .read(profileImageServiceProvider)
            .clearPersistedAvatar(user.id);
      }
      if (_avatarDraft != null) {
        avatarUrl = await ref
            .read(profileRepositoryProvider)
            .uploadAvatar(_avatarDraft!);
        await ref
            .read(profileImageServiceProvider)
            .persistAvatar(user.id, _avatarDraft!);
      }
      await _commitProfile(
        user,
        avatarUrl: avatarUrl,
        updateAvatar: updateAvatar,
      );
      if (!mounted) return;
      AppNotice.success(context, '个人资料已更新');
      context.pop(true);
    } catch (error) {
      if (mounted) _showError(error, fallback: '资料保存失败，请稍后重试');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _showError(Object error, {required String fallback}) {
    final message = error is ApiException
        ? error.message
        : error is FormatException
        ? error.message
        : fallback;
    AppNotice.error(context, message);
  }

  Future<void> _signOut() async {
    if (_saving) return;
    await ref.read(sessionControllerProvider.notifier).signOut();
    ref.read(userSessionCacheProvider).clear();
    if (mounted) context.go('/discover');
  }

  Future<void> _confirmSignOut() async {
    if (_saving) return;
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (dialogContext) => AppDialog(
        icon: const Icon(Icons.logout_rounded),
        title: const Text('退出当前账号？'),
        content: const Text('本机登录状态将被清除，作品、积分和素材仍保存在账号中。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('取消'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(dialogContext).colorScheme.error,
              foregroundColor: Theme.of(dialogContext).colorScheme.onError,
            ),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('确认退出'),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) await _signOut();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider);
    final user = session.asData?.value.user;
    if (user != null) _initialize(user);
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const AppTopBar(
        title: Text('编辑资料'),
        fallbackLocation: '/profile',
      ),
      body: session.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => const Center(child: Text('账号资料加载失败')),
        data: (state) => state.user == null
            ? const Center(child: Text('请先登录'))
            : _buildForm(state.user!),
      ),
      bottomNavigationBar: user == null
          ? null
          : _EditSaveBar(saving: _saving, onSave: () => _save(user)),
    );
  }

  Widget _buildForm(AppUser user) {
    final colors = Theme.of(context).colorScheme;
    return Form(
      key: _formKey,
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          _EditHero(
            child: Column(
              children: [
                _EditAvatarButton(
                  username: _usernameController.text,
                  userId: _removeAvatar ? null : user.id,
                  avatarUrl: _removeAvatar ? null : user.avatarUrl,
                  localPath: _avatarDraft?.localPath,
                  selecting: _selectingAvatar,
                  onPressed: _selectingAvatar
                      ? null
                      : () => _chooseAvatar(user),
                ),
                const SizedBox(height: 12),
                Text(
                  _usernameController.text.trim().isEmpty
                      ? '设置头像与昵称'
                      : _usernameController.text.trim(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  user.email,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const _EditSectionTitle(title: '账号'),
                const SizedBox(height: 10),
                _EditCard(
                  key: const Key('edit-account-surface'),
                  children: [
                    _EditFieldRow(
                      icon: Icons.person_outline,
                      accent: const Color(0xFF4F67D6),
                      label: '用户名',
                      child: TextFormField(
                        controller: _usernameController,
                        onChanged: (_) => setState(() {}),
                        maxLength: 64,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.name],
                        validator: validateProfileUsername,
                        decoration: _editInput(hint: '怎么称呼你'),
                      ),
                    ),
                    _EditFieldRow(
                      icon: Icons.alternate_email,
                      accent: const Color(0xFF64748B),
                      label: '登录邮箱',
                      trailing: _EditLockPill(text: '用于登录'),
                      child: Text(
                        user.email,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                          height: 1.3,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                const _EditSectionTitle(title: '资料'),
                const SizedBox(height: 10),
                _EditCard(
                  key: const Key('edit-profile-surface'),
                  children: [
                    _EditFieldRow(
                      icon: Icons.location_on_outlined,
                      accent: const Color(0xFF0F766E),
                      label: '所在地',
                      child: TextFormField(
                        controller: _locationController,
                        maxLength: 80,
                        textInputAction: TextInputAction.next,
                        validator: validateProfileLocation,
                        decoration: _editInput(hint: '选填'),
                      ),
                    ),
                    _EditFieldRow(
                      icon: Icons.link,
                      accent: const Color(0xFFB45309),
                      label: '个人网站',
                      child: TextFormField(
                        controller: _websiteController,
                        maxLength: 300,
                        keyboardType: TextInputType.url,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.url],
                        validator: validateProfileWebsite,
                        decoration: _editInput(hint: '选填，需包含 https://'),
                      ),
                    ),
                    _EditFieldRow(
                      icon: Icons.notes_outlined,
                      accent: const Color(0xFF7C3AED),
                      label: '个人简介',
                      alignTop: true,
                      child: TextFormField(
                        controller: _bioController,
                        minLines: 3,
                        maxLines: 6,
                        maxLength: 280,
                        textInputAction: TextInputAction.newline,
                        validator: validateProfileBio,
                        decoration: _editInput(hint: '选填'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                const _EditSectionTitle(title: '偏好'),
                const SizedBox(height: 10),
                _EditPreferenceCard(
                  enabled: _requireCostConfirm,
                  onChanged: _saving
                      ? null
                      : (value) => setState(() => _requireCostConfirm = value),
                ),
                const SizedBox(height: 28),
                TextButton.icon(
                  key: const Key('profile-sign-out'),
                  style: TextButton.styleFrom(
                    foregroundColor: colors.error,
                    minimumSize: const Size.fromHeight(48),
                  ),
                  onPressed: _saving ? null : _confirmSignOut,
                  icon: const Icon(Icons.logout),
                  label: const Text('退出登录'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

InputDecoration _editInput({required String hint}) => InputDecoration(
  isDense: true,
  hintText: hint,
  counterText: '',
  filled: false,
  border: InputBorder.none,
  enabledBorder: InputBorder.none,
  focusedBorder: InputBorder.none,
  errorBorder: InputBorder.none,
  focusedErrorBorder: InputBorder.none,
  contentPadding: const EdgeInsets.only(top: 2, bottom: 2),
);

class _EditHero extends StatelessWidget {
  const _EditHero({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
        child: child,
      ),
    );
  }
}

class _EditAvatarButton extends StatelessWidget {
  const _EditAvatarButton({
    required this.username,
    required this.userId,
    required this.avatarUrl,
    required this.localPath,
    required this.selecting,
    required this.onPressed,
  });

  final String username;
  final String? userId;
  final String? avatarUrl;
  final String? localPath;
  final bool selecting;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final ring = colors.surface;
    return Tooltip(
      message: '更换头像',
      child: AppPressable(
        onTap: onPressed,
        child: SizedBox.square(
          dimension: 108,
          child: Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.center,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: colors.outlineVariant),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(2),
                  child: ProfileAvatar(
                    username: username,
                    userId: userId,
                    avatarUrl: avatarUrl,
                    localPath: localPath,
                    radius: 46,
                  ),
                ),
              ),
              Positioned(
                right: 2,
                bottom: 2,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: colors.primary,
                    shape: BoxShape.circle,
                    border: Border.all(color: ring, width: 2),
                  ),
                  child: SizedBox.square(
                    dimension: 32,
                    child: selecting
                        ? Padding(
                            padding: const EdgeInsets.all(7),
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: colors.onPrimary,
                            ),
                          )
                        : Icon(
                            Icons.photo_camera_outlined,
                            size: 15,
                            color: colors.onPrimary,
                          ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EditCard extends StatelessWidget {
  const _EditCard({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
        child: Column(
          children: [
            for (var i = 0; i < children.length; i++) ...[
              if (i > 0)
                Divider(
                  height: 1,
                  color: colors.outlineVariant.withValues(alpha: .65),
                ),
              children[i],
            ],
          ],
        ),
      ),
    );
  }
}

class _EditFieldRow extends StatelessWidget {
  const _EditFieldRow({
    required this.icon,
    required this.accent,
    required this.label,
    required this.child,
    this.trailing,
    this.alignTop = false,
  });

  final IconData icon;
  final Color accent;
  final String label;
  final Widget child;
  final Widget? trailing;
  final bool alignTop;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: alignTop
            ? CrossAxisAlignment.start
            : CrossAxisAlignment.center,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              color: accent.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: SizedBox.square(
              dimension: 40,
              child: Icon(icon, color: accent, size: 20),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        label,
                        style: Theme.of(context).textTheme.labelMedium
                            ?.copyWith(
                              color: colors.onSurfaceVariant,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                    ),
                    ?trailing,
                  ],
                ),
                const SizedBox(height: 2),
                child,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EditLockPill extends StatelessWidget {
  const _EditLockPill({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.lock_outline_rounded, size: 13, color: colors.outline),
        const SizedBox(width: 4),
        Text(
          text,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: colors.onSurfaceVariant,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _EditPreferenceCard extends StatelessWidget {
  const _EditPreferenceCard({required this.enabled, required this.onChanged});

  final bool enabled;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      key: const Key('edit-preference-surface'),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 12, 16),
        child: Row(
          children: [
            const DecoratedBox(
              decoration: BoxDecoration(
                color: Color(0x220F766E),
                borderRadius: BorderRadius.all(Radius.circular(8)),
              ),
              child: SizedBox.square(
                dimension: 40,
                child: Icon(
                  Icons.price_check_outlined,
                  color: Color(0xFF0F766E),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '创作费用确认',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '提交付费创作前显示预计积分',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                      height: 1.3,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Switch.adaptive(value: enabled, onChanged: onChanged),
          ],
        ),
      ),
    );
  }
}

class _EditSaveBar extends StatelessWidget {
  const _EditSaveBar({required this.saving, required this.onSave});

  final bool saving;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surface,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(
              color: StarCloudsVisualStyle.of(
                context,
              ).hairline.withValues(alpha: .45),
            ),
          ),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
            child: FilledButton(
              onPressed: saving ? null : onSave,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: Text(saving ? '保存中' : '保存资料'),
            ),
          ),
        ),
      ),
    );
  }
}

class _EditSectionTitle extends StatelessWidget {
  const _EditSectionTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) => Text(
    title,
    style: Theme.of(
      context,
    ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
  );
}

class _AvatarSheetAction extends StatelessWidget {
  const _AvatarSheetAction({
    required this.icon,
    required this.title,
    required this.onTap,
    this.destructive = false,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final color = destructive ? colors.error : colors.onSurface;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: AppPressable(
        onTap: onTap,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: colors.surfaceContainerLow,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: colors.outlineVariant),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            child: Row(
              children: [
                Icon(icon, color: color),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: color,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

enum _AvatarAction { gallery, camera, remove }
