import 'package:flutter/material.dart';

import '../../core/widgets/authenticated_image.dart';
import 'gallery.dart';
import '../../core/widgets/app_chrome.dart';

class GallerySubmissionDraft {
  const GallerySubmissionDraft({required this.title, this.categoryId});

  final String title;
  final String? categoryId;
}

Future<GallerySubmissionDraft?> showGallerySubmissionSheet(
  BuildContext context, {
  required String previewUrl,
  required String initialTitle,
  required List<GalleryCategory> categories,
}) => showAppSheet<GallerySubmissionDraft>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (context) => _GallerySubmissionSheet(
    previewUrl: previewUrl,
    initialTitle: initialTitle,
    categories: categories,
  ),
);

String defaultGalleryTitle(String prompt) {
  final normalized = prompt.trim();
  if (normalized.length <= 120) return normalized;
  return '${normalized.substring(0, 120)}…';
}

class GallerySubmissionStatusPanel extends StatelessWidget {
  const GallerySubmissionStatusPanel({required this.submission, super.key});

  final GallerySubmission submission;

  @override
  Widget build(BuildContext context) {
    final style = gallerySubmissionStyle(submission.status);
    final detail = switch (submission.status) {
      'approved' => '作品已经展示在发现页的社区作品中',
      'rejected' =>
        submission.rejectReason?.isNotEmpty == true
            ? submission.rejectReason!
            : '本次投稿未通过审核，可撤回后调整并重新投稿',
      'removed' =>
        submission.rejectReason?.isNotEmpty == true
            ? submission.rejectReason!
            : '作品已从社区下架，可撤回后重新投稿',
      _ => '审核通过后将展示在发现页的社区作品中',
    };
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: style.color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: style.color.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(style.icon, size: 21, color: style.color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  style.panelLabel,
                  style: TextStyle(
                    color: style.color,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(detail, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

({String buttonLabel, String panelLabel, IconData icon, Color color})
gallerySubmissionStyle(String status) => switch (status) {
  'approved' => (
    buttonLabel: '已发布',
    panelLabel: '已发布到社区',
    icon: Icons.public,
    color: const Color(0xFF0F766E),
  ),
  'rejected' => (
    buttonLabel: '未通过',
    panelLabel: '投稿未通过',
    icon: Icons.error_outline,
    color: const Color(0xFFDC2626),
  ),
  'removed' => (
    buttonLabel: '已下架',
    panelLabel: '社区作品已下架',
    icon: Icons.visibility_off_outlined,
    color: const Color(0xFF64748B),
  ),
  _ => (
    buttonLabel: '审核中',
    panelLabel: '投稿审核中',
    icon: Icons.hourglass_top,
    color: const Color(0xFFD97706),
  ),
};

class _GallerySubmissionSheet extends StatefulWidget {
  const _GallerySubmissionSheet({
    required this.previewUrl,
    required this.initialTitle,
    required this.categories,
  });

  final String previewUrl;
  final String initialTitle;
  final List<GalleryCategory> categories;

  @override
  State<_GallerySubmissionSheet> createState() =>
      _GallerySubmissionSheetState();
}

class _GallerySubmissionSheetState extends State<_GallerySubmissionSheet> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _titleController;
  String _categoryId = '';

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.initialTitle);
  }

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.pop(
      context,
      GallerySubmissionDraft(
        title: _titleController.text.trim(),
        categoryId: _categoryId.isEmpty ? null : _categoryId,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(20, 10, 20, 20 + keyboardInset),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.outlineVariant,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  '投稿到社区',
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                Text(
                  '审核通过后，其他用户可以在发现页看到这件作品。',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 18),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: SizedBox.square(
                        dimension: 72,
                        child: widget.previewUrl.isEmpty
                            ? ColoredBox(
                                color: Theme.of(
                                  context,
                                ).colorScheme.surfaceContainerHighest,
                                child: const Icon(Icons.image_outlined),
                              )
                            : AuthenticatedImage(
                                url: widget.previewUrl,
                                fit: BoxFit.cover,
                              ),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: TextFormField(
                        controller: _titleController,
                        autofocus: widget.initialTitle.isEmpty,
                        minLines: 2,
                        maxLines: 3,
                        maxLength: 200,
                        textInputAction: TextInputAction.next,
                        validator: (value) =>
                            value?.trim().isEmpty == true ? '请输入作品标题' : null,
                        decoration: const InputDecoration(
                          labelText: '作品标题',
                          alignLabelWithHint: true,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (widget.categories.isEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 13,
                      vertical: 11,
                    ),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.category_outlined, size: 20),
                        SizedBox(width: 9),
                        Expanded(child: Text('暂未设置分类，将投稿到全部作品')),
                      ],
                    ),
                  )
                else
                  AppSelectField<String>(
                    label: '作品分类（可选）',
                    prefixIcon: Icons.category_outlined,
                    value: _categoryId,
                    options: [
                      const AppSelectOption(value: '', label: '不选择分类'),
                      for (final category in widget.categories)
                        AppSelectOption(
                          value: category.id,
                          label: category.name,
                        ),
                    ],
                    onChanged: (value) =>
                        setState(() => _categoryId = value ?? ''),
                  ),
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: _submit,
                  icon: const Icon(Icons.public),
                  label: const Text('确认投稿'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
