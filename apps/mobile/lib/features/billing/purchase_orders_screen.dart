import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/widgets/app_top_bar.dart';
import 'billing.dart';
import 'purchase_center_screen.dart';

class PurchaseOrdersScreen extends ConsumerStatefulWidget {
  const PurchaseOrdersScreen({this.initialOrderId, super.key});

  final String? initialOrderId;

  @override
  ConsumerState<PurchaseOrdersScreen> createState() =>
      _PurchaseOrdersScreenState();
}

class _PurchaseOrdersScreenState extends ConsumerState<PurchaseOrdersScreen> {
  final _scrollController = ScrollController();
  String? _openedInitialOrderId;
  PurchaseOrderFilter _filter = PurchaseOrderFilter.all;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant PurchaseOrdersScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialOrderId != widget.initialOrderId) {
      _openedInitialOrderId = null;
    }
  }

  void _onScroll() {
    if (!_scrollController.hasClients ||
        _scrollController.position.extentAfter > 260) {
      return;
    }
    unawaited(_loadMore());
  }

  Future<void> _refresh() =>
      ref.read(purchaseCenterControllerProvider.notifier).refresh();

  Future<void> _loadMore() async {
    try {
      await ref.read(purchaseCenterControllerProvider.notifier).loadMore();
    } catch (error) {
      if (mounted) showBillingError(context, error, '订单加载失败，请稍后重试');
    }
  }

  void _maybeOpenInitialOrder() {
    final orderId = widget.initialOrderId?.trim();
    if (orderId == null ||
        orderId.isEmpty ||
        _openedInitialOrderId == orderId) {
      return;
    }
    _openedInitialOrderId = orderId;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        unawaited(
          openPurchaseOrderById(context: context, ref: ref, orderId: orderId),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final center = ref.watch(purchaseCenterControllerProvider);
    return Scaffold(
      appBar: AppTopBar(
        title: const Text('我的订单'),
        fallbackLocation: '/profile/purchases',
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
        data: _buildOrders,
      ),
    );
  }

  Widget _buildOrders(PurchaseCenterState state) {
    final plansById = {for (final plan in state.catalog.items) plan.id: plan};
    final orders = state.orders.where(_filter.includes).toList();
    _maybeOpenInitialOrder();
    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          if (state.orders.isEmpty)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: BillingEmpty(message: '还没有套餐订单'),
            )
          else ...[
            SliverToBoxAdapter(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  children: [
                    for (final filter in PurchaseOrderFilter.values) ...[
                      if (filter != PurchaseOrderFilter.values.first)
                        const SizedBox(width: 8),
                      _OrderFilterButton(
                        filter: filter,
                        selected: _filter == filter,
                        onTap: () => setState(() => _filter = filter),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            if (orders.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: BillingEmpty(message: '${_filter.label}暂无订单'),
              )
            else ...[
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                sliver: SliverList.separated(
                  itemCount: orders.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final order = orders[index];
                    return OrderCard(
                      key: Key('order-${order.id}'),
                      order: order,
                      plan: plansById[order.planId],
                      busy: state.busyOrderIds.contains(order.id),
                      highlighted: order.id == widget.initialOrderId?.trim(),
                      onTap: () => openPurchaseOrder(
                        context: context,
                        ref: ref,
                        order: order,
                        plan: plansById[order.planId],
                      ),
                    );
                  },
                ),
              ),
              SliverToBoxAdapter(
                child: OrderFooter(
                  hasMore: state.hasMore,
                  loading: state.isLoadingMore,
                  onLoadMore: _loadMore,
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

enum PurchaseOrderFilter { all, pending, completed, closed }

extension PurchaseOrderFilterPresentation on PurchaseOrderFilter {
  String get label => switch (this) {
    PurchaseOrderFilter.all => '全部',
    PurchaseOrderFilter.pending => '待处理',
    PurchaseOrderFilter.completed => '已完成',
    PurchaseOrderFilter.closed => '已关闭',
  };

  bool includes(PurchaseOrder order) => switch (this) {
    PurchaseOrderFilter.all => true,
    PurchaseOrderFilter.pending =>
      order.status == 'pending' || order.status == 'paid',
    PurchaseOrderFilter.completed => order.status == 'completed',
    PurchaseOrderFilter.closed =>
      order.status == 'expired' || order.status == 'failed',
  };
}

class _OrderFilterButton extends StatelessWidget {
  const _OrderFilterButton({
    required this.filter,
    required this.selected,
    required this.onTap,
  });

  final PurchaseOrderFilter filter;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: selected ? colors.onSurface : colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(
          color: selected ? colors.onSurface : colors.outlineVariant,
        ),
      ),
      child: InkWell(
        key: Key('order-filter-${filter.label}'),
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          child: Text(
            filter.label,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: selected ? colors.surface : colors.onSurface,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}
