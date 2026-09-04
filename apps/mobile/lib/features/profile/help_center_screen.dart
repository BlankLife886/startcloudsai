import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/widgets/app_top_bar.dart';

enum HelpServiceState { checking, online, degraded, offline }

@immutable
class HelpServiceStatus {
  const HelpServiceStatus(this.state, this.message);

  const HelpServiceStatus.checking()
    : state = HelpServiceState.checking,
      message = '正在连接线上服务';

  final HelpServiceState state;
  final String message;
}

final helpServiceStatusProvider = FutureProvider.autoDispose<HelpServiceStatus>(
  (ref) async {
    try {
      final data = await ref.watch(apiClientProvider).get('/health');
      final status = data is Map ? data['status']?.toString() : null;
      return status == 'ok'
          ? const HelpServiceStatus(HelpServiceState.online, '创作、助手和同步服务可正常连接')
          : const HelpServiceStatus(
              HelpServiceState.degraded,
              '部分服务暂时异常，请稍后重新检查',
            );
    } on ApiException catch (error) {
      return error.code == 'network_error'
          ? const HelpServiceStatus(HelpServiceState.offline, '请检查设备网络后重新检查')
          : const HelpServiceStatus(
              HelpServiceState.degraded,
              '线上服务暂时异常，请稍后重新检查',
            );
    } catch (_) {
      return const HelpServiceStatus(
        HelpServiceState.degraded,
        '服务状态暂时无法确认，请稍后重试',
      );
    }
  },
);

@immutable
class HelpTopic {
  const HelpTopic({
    required this.title,
    required this.answer,
    required this.icon,
    this.keywords = const [],
  });

  final String title;
  final String answer;
  final IconData icon;
  final List<String> keywords;

  String get searchableText =>
      [title, answer, ...keywords].join(' ').toLowerCase();
}

const helpTopics = <HelpTopic>[
  HelpTopic(
    title: '生成任务长时间处理中怎么办？',
    answer: '可以先进入“我的作品”查看任务状态。App 回到前台时会自动同步；网络恢复后仍无变化，可在作品详情手动刷新或停止仍在运行的任务。',
    icon: Icons.hourglass_top_rounded,
    keywords: ['任务', '卡住', '排队', '刷新', '作品'],
  ),
  HelpTopic(
    title: '生成失败会退回积分吗？',
    answer: '失败任务的积分会按服务端结算结果自动退回。你可以在“我的 > 可用积分 > 积分明细”中查看消费与退回记录。',
    icon: Icons.account_balance_wallet_outlined,
    keywords: ['积分', '扣费', '退款', '余额', '明细'],
  ),
  HelpTopic(
    title: '参考图无法添加或上传失败',
    answer: '请确认照片权限可用，并检查图片数量是否超过当前模型上限。HEIC 等相册图片会自动转换；仍失败时可更换图片或在权限管理中重新授权。',
    icon: Icons.add_photo_alternate_outlined,
    keywords: ['参考图', '上传', '照片', '相册', '权限', 'HEIC'],
  ),
  HelpTopic(
    title: 'AI 助手回复中断如何恢复？',
    answer: '对话会自动尝试恢复实时连接。失败或停止后，可以在当前对话重试最近一次提问；未发送的文字和参考图也会保存在本机草稿中。',
    icon: Icons.auto_awesome_outlined,
    keywords: ['AI', '助手', '断线', '重试', '草稿', '回复'],
  ),
  HelpTopic(
    title: '图片保存后在哪里查看？',
    answer: '保存成功后，图片会进入系统照片图库。若没有找到，请前往“关于星空云绘 > 权限管理”检查照片授权状态。',
    icon: Icons.download_done_rounded,
    keywords: ['保存', '下载', '相册', '图库', '权限'],
  ),
  HelpTopic(
    title: '如何导出数据或注销账号？',
    answer: '进入“我的 > 账号与安全”，可以导出账号数据、管理登录设备或发起永久注销。永久注销需要邮箱验证码和再次确认。',
    icon: Icons.manage_accounts_outlined,
    keywords: ['导出', '注销', '删除账号', '登录设备', '安全'],
  ),
];

List<HelpTopic> searchHelpTopics(Iterable<HelpTopic> topics, String query) {
  final tokens = query
      .trim()
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((token) => token.isNotEmpty)
      .toList();
  if (tokens.isEmpty) return List<HelpTopic>.of(topics);
  return topics
      .where((topic) => tokens.every(topic.searchableText.contains))
      .toList();
}

class HelpCenterScreen extends ConsumerStatefulWidget {
  const HelpCenterScreen({super.key});

  @override
  ConsumerState<HelpCenterScreen> createState() => _HelpCenterScreenState();
}

class _HelpCenterScreenState extends ConsumerState<HelpCenterScreen> {
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _clearSearch() {
    _searchController.clear();
    setState(() => _query = '');
  }

  @override
  Widget build(BuildContext context) {
    final results = searchHelpTopics(helpTopics, _query);
    final colors = Theme.of(context).colorScheme;
    final serviceStatus = ref.watch(helpServiceStatusProvider);
    return Scaffold(
      appBar: const AppTopBar(title: Text('帮助中心'), fallbackLocation: '/about'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 32),
        children: [
          Text(
            '有什么可以帮你？',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          Text(
            '搜索常见问题，或展开下方条目查看处理方法。',
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(color: colors.onSurfaceVariant),
          ),
          const SizedBox(height: 16),
          _ServiceStatusBar(
            status: serviceStatus,
            onRefresh: () => ref.invalidate(helpServiceStatusProvider),
          ),
          const SizedBox(height: 16),
          TextField(
            key: const Key('help-search'),
            controller: _searchController,
            textInputAction: TextInputAction.search,
            onChanged: (value) => setState(() => _query = value),
            decoration: InputDecoration(
              hintText: '搜索任务、积分、上传或账号问题',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: _query.trim().isEmpty
                  ? null
                  : IconButton(
                      key: const Key('help-search-clear'),
                      tooltip: '清除搜索',
                      onPressed: _clearSearch,
                      icon: const Icon(Icons.close_rounded),
                    ),
              filled: true,
              fillColor: colors.surfaceContainerLow,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: colors.outlineVariant),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: colors.outlineVariant),
              ),
            ),
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: Text(
                  _query.trim().isEmpty ? '常见问题' : '搜索结果',
                  style: Theme.of(
                    context,
                  ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              Text(
                '${results.length} 项',
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          AnimatedSize(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: results.isEmpty
                ? _NoHelpResults(onClear: _clearSearch)
                : Material(
                    key: const Key('help-topic-group'),
                    color: colors.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(8),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      children: [
                        for (
                          var index = 0;
                          index < results.length;
                          index++
                        ) ...[
                          if (index > 0)
                            Divider(
                              height: 1,
                              indent: 54,
                              color: colors.outlineVariant.withValues(
                                alpha: .7,
                              ),
                            ),
                          _HelpTopicTile(topic: results[index]),
                        ],
                      ],
                    ),
                  ),
          ),
          const SizedBox(height: 26),
          Text(
            '仍需帮助',
            style: Theme.of(
              context,
            ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          Material(
            color: colors.surfaceContainerLow,
            borderRadius: BorderRadius.circular(8),
            clipBehavior: Clip.antiAlias,
            child: ListTile(
              key: const Key('help-feedback'),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 5,
              ),
              leading: const Icon(Icons.feedback_outlined),
              title: const Text(
                '问题反馈',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              subtitle: const Text('提交问题并查看处理进度'),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => context.push('/profile/feedback'),
            ),
          ),
        ],
      ),
    );
  }
}

class _ServiceStatusBar extends StatelessWidget {
  const _ServiceStatusBar({required this.status, required this.onRefresh});

  final AsyncValue<HelpServiceStatus> status;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final value = status.asData?.value ?? const HelpServiceStatus.checking();
    final checking =
        status.isLoading || value.state == HelpServiceState.checking;
    final presentation = switch (value.state) {
      HelpServiceState.checking => (
        label: '正在检查服务状态',
        icon: Icons.sync_rounded,
        color: colors.primary,
      ),
      HelpServiceState.online => (
        label: '线上服务运行正常',
        icon: Icons.check_circle_outline_rounded,
        color: const Color(0xFF16845B),
      ),
      HelpServiceState.degraded => (
        label: '线上服务暂时异常',
        icon: Icons.error_outline_rounded,
        color: colors.error,
      ),
      HelpServiceState.offline => (
        label: '当前设备网络不可用',
        icon: Icons.wifi_off_rounded,
        color: colors.error,
      ),
    };
    return AnimatedContainer(
      key: const Key('help-service-status'),
      duration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 180),
      curve: Curves.easeOutCubic,
      padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
      decoration: BoxDecoration(
        color: presentation.color.withValues(alpha: .09),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          SizedBox.square(
            dimension: 22,
            child: checking
                ? CircularProgressIndicator(
                    strokeWidth: 2,
                    color: presentation.color,
                  )
                : Icon(presentation.icon, size: 21, color: presentation.color),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  presentation.label,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: colors.onSurface,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value.message,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            key: const Key('help-service-refresh'),
            tooltip: '重新检查服务状态',
            onPressed: checking ? null : onRefresh,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
    );
  }
}

class _HelpTopicTile extends StatelessWidget {
  const _HelpTopicTile({required this.topic});

  final HelpTopic topic;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ExpansionTile(
      key: ValueKey(topic.title),
      leading: Icon(topic.icon, size: 21, color: colors.onSurfaceVariant),
      title: Text(
        topic.title,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      iconColor: colors.primary,
      collapsedIconColor: colors.onSurfaceVariant,
      shape: const Border(),
      collapsedShape: const Border(),
      tilePadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 3),
      childrenPadding: const EdgeInsets.fromLTRB(54, 0, 18, 16),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: Text(
            topic.answer,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: colors.onSurfaceVariant,
              height: 1.5,
            ),
          ),
        ),
      ],
    );
  }
}

class _NoHelpResults extends StatelessWidget {
  const _NoHelpResults({required this.onClear});

  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      key: const Key('help-empty'),
      padding: const EdgeInsets.symmetric(vertical: 28),
      child: Column(
        children: [
          Icon(Icons.search_off_rounded, size: 30, color: colors.outline),
          const SizedBox(height: 10),
          const Text('没有找到相关问题'),
          const SizedBox(height: 10),
          TextButton(onPressed: onClear, child: const Text('查看全部问题')),
        ],
      ),
    );
  }
}
