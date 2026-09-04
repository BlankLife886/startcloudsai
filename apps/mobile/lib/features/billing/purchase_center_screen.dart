import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/widgets/app_chrome.dart';
import '../../core/widgets/app_notice.dart';
import '../../core/widgets/app_top_bar.dart';
import '../../core/widgets/app_visual.dart';
import '../notifications/notifications.dart';
import '../profile/profile.dart';
import '../wallet/wallet.dart';
import 'billing.dart';

Future<void> showPurchaseOrderSheet({
  required BuildContext context,
  required WidgetRef ref,
  required PurchaseOrder order,
  PurchasePlan? plan,
}) async {
  final completed = await showAppSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (context) => PaymentOrderSheet(
      order: order,
      plan: plan,
      onRefresh: (id) =>
          ref.read(purchaseCenterControllerProvider.notifier).refreshOrder(id),
      onClose: (id) =>
          ref.read(purchaseCenterControllerProvider.notifier).closeOrder(id),
    ),
  );
  if (completed == true) {
    ref.invalidate(walletProvider);
    ref.invalidate(profileOverviewProvider);
    ref.invalidate(walletCenterControllerProvider);
    ref.invalidate(notificationSummaryProvider);
    if (context.mounted) {
      AppNotice.success(context, '订单已完成，积分状态正在同步');
    }
  }
}

Future<void> openPurchaseOrder({
  required BuildContext context,
  required WidgetRef ref,
  required PurchaseOrder order,
  PurchasePlan? plan,
}) async {
  var current = order;
  if (order.isPending) {
    try {
      current = await ref
          .read(purchaseCenterControllerProvider.notifier)
          .refreshOrder(order.id);
    } catch (_) {
      // The cached order still gives the user access to its known state.
    }
  }
  if (context.mounted) {
    await showPurchaseOrderSheet(
      context: context,
      ref: ref,
      order: current,
      plan: plan,
    );
  }
}

Future<void> openPurchaseOrderById({
  required BuildContext context,
  required WidgetRef ref,
  required String orderId,
}) async {
  try {
    final order = await ref
        .read(purchaseCenterControllerProvider.notifier)
        .refreshOrder(orderId);
    if (!context.mounted) return;
    final state = ref.read(purchaseCenterControllerProvider).asData?.value;
    final plan = state?.catalog.items
        .where((item) => item.id == order.planId)
        .firstOrNull;
    await showPurchaseOrderSheet(
      context: context,
      ref: ref,
      order: order,
      plan: plan,
    );
  } catch (error) {
    if (context.mounted) {
      showBillingError(context, error, '关联订单加载失败，请稍后重试');
    }
  }
}

void showBillingError(BuildContext context, Object error, String fallback) {
  final message = error is ApiException ? error.message : fallback;
  AppNotice.error(context, message);
}

class PurchaseCenterScreen extends ConsumerStatefulWidget {
  const PurchaseCenterScreen({super.key});

  @override
  ConsumerState<PurchaseCenterScreen> createState() =>
      _PurchaseCenterScreenState();
}

class _PurchaseCenterScreenState extends ConsumerState<PurchaseCenterScreen> {
  Future<void> _refresh() =>
      ref.read(purchaseCenterControllerProvider.notifier).refresh();

  void _openOrders() {
    GoRouter.maybeOf(context)?.push('/profile/purchases/orders');
  }

  @override
  Widget build(BuildContext context) {
    final center = ref.watch(purchaseCenterControllerProvider);
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('会员与订单'),
        fallbackLocation: '/profile',
        actions: [
          IconButton(
            tooltip: '刷新',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: center.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => BillingError(onRetry: _refresh),
        data: _buildCenter,
      ),
    );
  }

  Widget _buildCenter(PurchaseCenterState state) {
    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            sliver: SliverToBoxAdapter(child: const _MobileStoreNotice()),
          ),
          if (state.subscription.active)
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 18),
              sliver: SliverToBoxAdapter(
                child: _SubscriptionPanel(subscription: state.subscription),
              ),
            ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
            sliver: SliverToBoxAdapter(
              child: _OrdersEntry(
                count: state.orders.length,
                onTap: _openOrders,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MobileStoreNotice extends StatelessWidget {
  const _MobileStoreNotice();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border.all(color: colors.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
        child: Row(
          children: [
            Icon(
              Icons.verified_user_outlined,
              size: 20,
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(width: 9),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '我的会员权益',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    mobileStoreExternalCommerceEnabled
                        ? '可使用已配置的移动端商店购买'
                        : '查看已生效权益、积分余额与历史订单',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SubscriptionPanel extends StatelessWidget {
  const _SubscriptionPanel({required this.subscription});

  final UserSubscription subscription;

  @override
  Widget build(BuildContext context) => AppSoftCard(
    color: Theme.of(context).colorScheme.tertiaryContainer,
    padding: const EdgeInsets.all(14),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.workspace_premium),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                subscription.planName.isEmpty ? '当前订阅' : subscription.planName,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              Text(
                '每日 ${subscription.dailyGrantPoints} 积分 · '
                '${subscription.grantedToday ? '今日已发放' : '今日待发放'}',
              ),
              if (subscription.endsAt != null)
                Text(
                  '有效期至 ${_dateTime(subscription.endsAt!, dateOnly: true)}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _OrdersEntry extends StatelessWidget {
  const _OrdersEntry({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: colors.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: ListTile(
          key: const Key('purchase-orders-entry'),
          leading: Icon(
            Icons.receipt_long_outlined,
            size: 20,
            color: colors.onSurfaceVariant,
          ),
          title: const Text(
            '我的订单',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(
            count == 0 ? '还没有套餐订单' : '$count 笔',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          trailing: const Icon(Icons.chevron_right),
        ),
      ),
    );
  }
}

class OrderCard extends StatelessWidget {
  const OrderCard({
    required this.order,
    required this.plan,
    required this.busy,
    required this.onTap,
    this.highlighted = false,
    super.key,
  });

  final PurchaseOrder order;
  final PurchasePlan? plan;
  final bool busy;
  final VoidCallback onTap;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      container: true,
      explicitChildNodes: true,
      label: highlighted ? '通知关联订单' : null,
      child: Material(
        color: highlighted
            ? colors.primaryContainer.withValues(alpha: 0.28)
            : colors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(
            color: highlighted ? colors.primary : colors.outlineVariant,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: ListTile(
          onTap: busy ? null : onTap,
          leading: Icon(
            _orderIcon(order.status),
            size: 20,
            color: _orderColor(context, order.status),
          ),
          title: Text(
            plan?.name ?? '套餐订单',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${_cny(order.amountCents)} · ${_dateTime(order.createdAt)}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (highlighted) ...[
                const SizedBox(height: 3),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.notifications_active_outlined,
                      size: 15,
                      color: colors.primary,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '通知关联',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: colors.primary,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
          trailing: busy
              ? const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      _orderStatus(order.status),
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: _orderColor(context, order.status),
                      ),
                    ),
                    const Icon(Icons.chevron_right, size: 20),
                  ],
                ),
        ),
      ),
    );
  }
}

class PaymentOrderSheet extends StatefulWidget {
  const PaymentOrderSheet({
    required this.order,
    required this.plan,
    required this.onRefresh,
    required this.onClose,
    super.key,
  });

  final PurchaseOrder order;
  final PurchasePlan? plan;
  final Future<PurchaseOrder> Function(String id) onRefresh;
  final Future<PurchaseOrder> Function(String id) onClose;

  @override
  State<PaymentOrderSheet> createState() => _PaymentOrderSheetState();
}

class _PaymentOrderSheetState extends State<PaymentOrderSheet> {
  late PurchaseOrder _order = widget.order;
  bool _busy = false;
  String? _error;

  Future<void> _refresh() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final order = await widget.onRefresh(_order.id);
      if (!mounted) return;
      setState(() => _order = order);
      if (order.isCompleted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _close() async {
    final confirmed = await showAppDialog<bool>(
      context: context,
      builder: (context) => AppDialog(
        icon: const Icon(Icons.close),
        title: const Text('关闭待支付订单？'),
        content: const Text('关闭后二维码将失效，如需购买可重新下单。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认关闭'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final order = await widget.onClose(_order.id);
      if (mounted) setState(() => _order = order);
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    widget.plan?.name ?? '套餐订单',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                _OrderStatusLabel(status: _order.status),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '订单金额 ${_cny(_order.amountCents)} · '
              '${_paymentLabel(_order.paymentMethod ?? '')}',
            ),
            const SizedBox(height: 10),
            DecoratedBox(
              decoration: BoxDecoration(
                border: Border.all(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 2, 2, 2),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '订单号 ${_order.id}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                    IconButton(
                      key: const Key('copy-order-id'),
                      tooltip: '复制订单号',
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: _order.id));
                        if (!context.mounted) return;
                        AppNotice.success(context, '订单号已复制');
                      },
                      icon: const Icon(Icons.copy_outlined, size: 18),
                    ),
                  ],
                ),
              ),
            ),
            if (_order.isPending) ...[
              const SizedBox(height: 22),
              const Icon(Icons.receipt_long_outlined, size: 42),
              const SizedBox(height: 8),
              const Text('此版本仅支持查看订单状态', textAlign: TextAlign.center),
            ] else ...[
              const SizedBox(height: 20),
              Icon(_orderIcon(_order.status), size: 52),
              const SizedBox(height: 8),
              Text(
                _orderStatusDescription(_order),
                textAlign: TextAlign.center,
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 20),
            if (_order.isPending)
              FilledButton.icon(
                onPressed: _busy ? null : _refresh,
                icon: _busy
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.sync),
                label: const Text('刷新订单状态'),
              ),
            if (_order.isPending)
              TextButton(
                onPressed: _busy ? null : _close,
                child: const Text('关闭订单'),
              ),
          ],
        ),
      ),
    );
  }
}

class _OrderStatusLabel extends StatelessWidget {
  const _OrderStatusLabel({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: _orderColor(context, status).withValues(alpha: 0.13),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      child: Text(
        _orderStatus(status),
        style: TextStyle(
          color: _orderColor(context, status),
          fontWeight: FontWeight.w800,
        ),
      ),
    ),
  );
}

class OrderFooter extends StatelessWidget {
  const OrderFooter({
    super.key,
    required this.hasMore,
    required this.loading,
    required this.onLoadMore,
  });

  final bool hasMore;
  final bool loading;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
    child: Center(
      child: hasMore
          ? TextButton.icon(
              onPressed: loading ? null : onLoadMore,
              icon: loading
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.expand_more),
              label: Text(loading ? '正在加载' : '加载更多订单'),
            )
          : const Text('已显示全部订单'),
    ),
  );
}

class BillingEmpty extends StatelessWidget {
  const BillingEmpty({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(24, 28, 24, 38),
    child: Center(child: Text(message)),
  );
}

class BillingError extends StatelessWidget {
  const BillingError({super.key, required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_outlined, size: 42),
          const SizedBox(height: 12),
          const Text('会员与订单加载失败'),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('重试'),
          ),
        ],
      ),
    ),
  );
}

String _cny(int cents) => NumberFormat.currency(
  locale: 'zh_CN',
  symbol: '¥',
  decimalDigits: 2,
).format(cents / 100);

String _dateTime(DateTime? value, {bool dateOnly = false}) {
  if (value == null) return '时间未知';
  return DateFormat(dateOnly ? 'yyyy.MM.dd' : 'MM.dd HH:mm').format(value);
}

String _paymentLabel(String method) => switch (method) {
  'alipay' => '支付宝',
  'wechat' => '微信支付',
  _ => '在线支付',
};

String _orderStatus(String status) => switch (status) {
  'pending' => '待支付',
  'paid' => '确认中',
  'completed' => '已完成',
  'failed' => '支付失败',
  'expired' => '已关闭',
  _ => '处理中',
};

String _orderStatusDescription(PurchaseOrder order) => switch (order.status) {
  'completed' => '${order.creditedPoints} 积分权益已发放',
  'failed' => '订单支付失败，未产生扣款时可重新下单',
  'expired' => '订单已关闭，二维码不再有效',
  _ => '订单正在处理中',
};

IconData _orderIcon(String status) => switch (status) {
  'pending' => Icons.schedule,
  'paid' => Icons.sync,
  'completed' => Icons.check_circle_outline,
  'failed' => Icons.error_outline,
  'expired' => Icons.cancel_outlined,
  _ => Icons.receipt_long_outlined,
};

Color _orderColor(BuildContext context, String status) => switch (status) {
  'completed' => Colors.green.shade700,
  'failed' => Theme.of(context).colorScheme.error,
  'expired' => Theme.of(context).colorScheme.onSurfaceVariant,
  _ => Theme.of(context).colorScheme.primary,
};

String _message(Object error) =>
    error is ApiException ? error.message : '订单状态更新失败，请稍后重试';
