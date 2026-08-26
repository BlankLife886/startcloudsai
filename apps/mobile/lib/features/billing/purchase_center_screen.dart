import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:qr_flutter/qr_flutter.dart';

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
  _PlanKind _kind = _PlanKind.topup;

  Future<void> _refresh() =>
      ref.read(purchaseCenterControllerProvider.notifier).refresh();

  Future<void> _startPurchase(PurchasePlan plan, PlanCatalog catalog) async {
    if (!catalog.paymentEnabled || catalog.paymentMethods.isEmpty) return;
    final method = await showAppSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) =>
          PaymentMethodSheet(plan: plan, methods: catalog.paymentMethods),
    );
    if (method == null || !mounted) return;
    try {
      final order = await ref
          .read(purchaseCenterControllerProvider.notifier)
          .createOrder(plan, method);
      if (mounted) {
        await showPurchaseOrderSheet(
          context: context,
          ref: ref,
          order: order,
          plan: plan,
        );
      }
    } catch (error) {
      if (mounted) showBillingError(context, error, '订单创建失败，请稍后重试');
    }
  }

  void _openOrders() {
    GoRouter.maybeOf(context)?.push('/profile/purchases/orders');
  }

  @override
  Widget build(BuildContext context) {
    final center = ref.watch(purchaseCenterControllerProvider);
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('套餐与订单'),
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
    final kinds = <_PlanKind>{
      for (final plan in state.catalog.items)
        plan.isSubscription ? _PlanKind.subscription : _PlanKind.topup,
    };
    final selectedKind = kinds.contains(_kind)
        ? _kind
        : kinds.firstOrNull ?? _PlanKind.topup;
    final plans = state.catalog.items.where(selectedKind.includes).toList();
    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            sliver: SliverToBoxAdapter(
              child: _PaymentAvailability(catalog: state.catalog),
            ),
          ),
          if (state.subscription.active)
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 18),
              sliver: SliverToBoxAdapter(
                child: _SubscriptionPanel(subscription: state.subscription),
              ),
            ),
          const _BillingSectionTitle(title: '选择套餐', icon: Icons.sell_outlined),
          if (kinds.length > 1)
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
              sliver: SliverToBoxAdapter(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: SegmentedButton<_PlanKind>(
                    segments: _PlanKind.values
                        .map(
                          (kind) => ButtonSegment<_PlanKind>(
                            value: kind,
                            icon: Icon(kind.icon),
                            label: Text(kind.label),
                          ),
                        )
                        .toList(),
                    selected: {selectedKind},
                    showSelectedIcon: false,
                    onSelectionChanged: (selection) =>
                        setState(() => _kind = selection.first),
                  ),
                ),
              ),
            ),
          if (plans.isEmpty)
            const SliverToBoxAdapter(child: BillingEmpty(message: '暂时没有可用套餐'))
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 22),
              sliver: SliverList.separated(
                itemCount: plans.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) => PlanCard(
                  key: Key('plan-${plans[index].id}'),
                  plan: plans[index],
                  paymentEnabled: state.catalog.paymentEnabled,
                  creating: state.creatingPlanId == plans[index].id,
                  onPurchase: () => _startPurchase(plans[index], state.catalog),
                ),
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

enum _PlanKind { topup, subscription }

extension on _PlanKind {
  String get label => switch (this) {
    _PlanKind.topup => '充值包',
    _PlanKind.subscription => '订阅',
  };

  IconData get icon => switch (this) {
    _PlanKind.topup => Icons.toll_outlined,
    _PlanKind.subscription => Icons.workspace_premium_outlined,
  };

  bool includes(PurchasePlan plan) => this == _PlanKind.subscription
      ? plan.isSubscription
      : !plan.isSubscription;
}

class _PaymentAvailability extends StatelessWidget {
  const _PaymentAvailability({required this.catalog});

  final PlanCatalog catalog;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final enabled = catalog.paymentEnabled && catalog.paymentMethods.isNotEmpty;
    return AppSoftCard(
      color: enabled ? colors.primaryContainer : colors.surface,
      radius: BorderRadius.circular(18),
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Icon(enabled ? Icons.lock_outline : Icons.schedule_outlined),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  enabled ? '支付由加密渠道处理' : '在线购买暂未开放',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 2),
                Text(
                  enabled
                      ? catalog.paymentMethods.map(_paymentLabel).join(' · ')
                      : '仍可浏览套餐、查看历史订单或使用兑换码',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ],
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
    return AppSoftCard(
      radius: BorderRadius.circular(18),
      padding: EdgeInsets.zero,
      child: AppPressable(
        onTap: onTap,
        child: ListTile(
          key: const Key('purchase-orders-entry'),
          leading: CircleAvatar(
            backgroundColor: colors.primaryContainer,
            child: Icon(
              Icons.receipt_long_outlined,
              size: 20,
              color: colors.onPrimaryContainer,
            ),
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

class _BillingSectionTitle extends StatelessWidget {
  const _BillingSectionTitle({required this.title, required this.icon});

  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) => SliverPadding(
    padding: const EdgeInsets.fromLTRB(16, 2, 16, 10),
    sliver: SliverToBoxAdapter(
      child: Row(
        children: [
          Icon(icon, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              title,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    ),
  );
}

class PlanCard extends StatelessWidget {
  const PlanCard({
    required this.plan,
    required this.paymentEnabled,
    required this.creating,
    required this.onPurchase,
    super.key,
  });

  final PurchasePlan plan;
  final bool paymentEnabled;
  final bool creating;
  final VoidCallback onPurchase;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return AppSoftCard(
      color: plan.recommended ? colors.secondaryContainer : colors.surface,
      padding: EdgeInsets.all(plan.recommended ? 20 : 15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  plan.name,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (plan.badge.isNotEmpty)
                Chip(
                  visualDensity: VisualDensity.compact,
                  label: Text(plan.badge),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            plan.isSubscription
                ? '每日 ${plan.dailyGrantPoints} 积分 · ${plan.durationDays} 天'
                : '${plan.totalPoints} 积分${plan.bonusPoints > 0 ? '（含赠送 ${plan.bonusPoints}）' : ''}',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          if (plan.description.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              plan.description,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(height: 1.4),
            ),
          ],
          if (plan.features.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 5,
              children: [
                for (final feature in plan.features.take(4))
                  _PlanFeature(text: feature),
              ],
            ),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Text(
                  _cny(plan.priceCents),
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w900,
                    color: colors.primary,
                  ),
                ),
              ),
              FilledButton.icon(
                onPressed: paymentEnabled && !creating ? onPurchase : null,
                icon: creating
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.qr_code_2),
                label: Text(paymentEnabled ? '立即购买' : '暂未开放'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PlanFeature extends StatelessWidget {
  const _PlanFeature({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(
        Icons.check_circle_outline,
        size: 16,
        color: Theme.of(context).colorScheme.primary,
      ),
      const SizedBox(width: 4),
      ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 230),
        child: Text(text, style: Theme.of(context).textTheme.bodySmall),
      ),
    ],
  );
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
      child: AppSoftCard(
        color: highlighted
            ? colors.primaryContainer.withValues(alpha: 0.42)
            : colors.surface,
        radius: BorderRadius.circular(18),
        child: ListTile(
          onTap: busy ? null : onTap,
          leading: CircleAvatar(
            child: Icon(_orderIcon(order.status), size: 20),
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

class PaymentMethodSheet extends StatefulWidget {
  const PaymentMethodSheet({
    required this.plan,
    required this.methods,
    super.key,
  });

  final PurchasePlan plan;
  final List<String> methods;

  @override
  State<PaymentMethodSheet> createState() => _PaymentMethodSheetState();
}

class _PaymentMethodSheetState extends State<PaymentMethodSheet> {
  late String _method = widget.methods.first;

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        4,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '确认套餐',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 14),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(widget.plan.name),
            subtitle: Text(
              widget.plan.isSubscription
                  ? '${widget.plan.durationDays} 天 · 每日 ${widget.plan.dailyGrantPoints} 积分'
                  : '${widget.plan.totalPoints} 积分',
            ),
            trailing: Text(
              _cny(widget.plan.priceCents),
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: widget.methods
                .map(
                  (method) => ButtonSegment<String>(
                    value: method,
                    icon: Icon(
                      method == 'alipay'
                          ? Icons.account_balance_wallet_outlined
                          : Icons.chat_bubble_outline,
                    ),
                    label: Text(_paymentLabel(method)),
                  ),
                )
                .toList(),
            selected: {_method},
            onSelectionChanged: (selection) =>
                setState(() => _method = selection.first),
          ),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: () => Navigator.pop(context, _method),
            icon: const Icon(Icons.lock_outline),
            label: Text('确认下单 · ${_cny(widget.plan.priceCents)}'),
          ),
        ],
      ),
    ),
  );
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
    final payAmount = _order.payAmountCents ?? _order.amountCents;
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
            if (_order.isPending && _order.payUrl != null) ...[
              const SizedBox(height: 18),
              Center(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: QrImageView(
                      data: _order.payUrl!,
                      size: 210,
                      backgroundColor: Colors.white,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                '扫码支付 ${_cny(payAmount)}',
                textAlign: TextAlign.center,
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
              ),
              if (_order.requiresManualAmount)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    '付款时请确认金额必须为 ${_cny(payAmount)}',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              if (_order.expiresAt != null)
                Padding(
                  padding: const EdgeInsets.only(top: 5),
                  child: Text(
                    '二维码有效至 ${_dateTime(_order.expiresAt!)}',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
            ] else if (_order.isPending) ...[
              const SizedBox(height: 22),
              const Icon(Icons.qr_code_scanner, size: 42),
              const SizedBox(height: 8),
              const Text('支付信息暂不可用', textAlign: TextAlign.center),
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
                label: const Text('我已支付，刷新状态'),
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
          const Text('套餐与订单加载失败'),
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
