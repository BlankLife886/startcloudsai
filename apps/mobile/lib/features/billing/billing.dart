import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/providers.dart';

/// Store-distributed mobile builds must not unlock digital features through
/// external payment links, QR codes or redemption keys.
const mobileStoreExternalCommerceEnabled = false;

class PurchasePlan {
  const PurchasePlan({
    required this.id,
    required this.code,
    required this.name,
    required this.description,
    required this.badge,
    required this.kind,
    required this.priceCents,
    required this.grantPoints,
    required this.bonusPoints,
    required this.durationDays,
    required this.dailyGrantPoints,
    required this.features,
    required this.recommended,
    required this.sort,
  });

  factory PurchasePlan.fromJson(Map<String, dynamic> json) => PurchasePlan(
    id: json['id']?.toString() ?? '',
    code: json['code']?.toString() ?? '',
    name: json['name']?.toString().trim() ?? '',
    description: json['description']?.toString().trim() ?? '',
    badge: json['badge']?.toString().trim() ?? '',
    kind: json['kind']?.toString() ?? 'topup',
    priceCents: (json['priceCents'] as num?)?.toInt() ?? 0,
    grantPoints:
        ((json['grantPoints'] ?? json['grantCents']) as num?)?.toInt() ?? 0,
    bonusPoints:
        ((json['bonusPoints'] ?? json['bonusCents']) as num?)?.toInt() ?? 0,
    durationDays: (json['durationDays'] as num?)?.toInt() ?? 0,
    dailyGrantPoints:
        ((json['dailyGrantPoints'] ?? json['dailyGrantCents']) as num?)
            ?.toInt() ??
        0,
    features:
        (json['features'] as List?)
            ?.map((item) => item.toString().trim())
            .where((item) => item.isNotEmpty)
            .toList() ??
        const [],
    recommended: json['recommended'] == true,
    sort: (json['sort'] as num?)?.toInt() ?? 0,
  );

  final String id;
  final String code;
  final String name;
  final String description;
  final String badge;
  final String kind;
  final int priceCents;
  final int grantPoints;
  final int bonusPoints;
  final int durationDays;
  final int dailyGrantPoints;
  final List<String> features;
  final bool recommended;
  final int sort;

  bool get isSubscription => kind == 'subscription';
  int get totalPoints => grantPoints + bonusPoints;
}

class PlanCatalog {
  const PlanCatalog({
    required this.items,
    required this.paymentEnabled,
    required this.paymentMethods,
  });

  factory PlanCatalog.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    final items = map['items'] is List
        ? (map['items'] as List)
              .whereType<Map>()
              .map(
                (item) =>
                    PurchasePlan.fromJson(Map<String, dynamic>.from(item)),
              )
              .where(
                (item) =>
                    item.id.isNotEmpty &&
                    item.name.isNotEmpty &&
                    item.priceCents >= 0,
              )
              .toList()
        : <PurchasePlan>[];
    items.sort((a, b) {
      final bySort = a.sort.compareTo(b.sort);
      return bySort == 0 ? a.name.compareTo(b.name) : bySort;
    });
    const supported = {'alipay', 'wechat'};
    return PlanCatalog(
      items: items,
      paymentEnabled: map['paymentEnabled'] == true,
      paymentMethods:
          (map['paymentMethods'] as List?)
              ?.map((item) => item.toString().toLowerCase().trim())
              .where(supported.contains)
              .toSet()
              .toList() ??
          const [],
    );
  }

  final List<PurchasePlan> items;
  final bool paymentEnabled;
  final List<String> paymentMethods;
}

class UserSubscription {
  const UserSubscription({
    required this.active,
    required this.planName,
    required this.dailyGrantPoints,
    required this.grantedToday,
    this.endsAt,
  });

  factory UserSubscription.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return UserSubscription(
      active: map['active'] == true,
      planName: map['planName']?.toString().trim() ?? '',
      endsAt: _date(map['endsAt']),
      dailyGrantPoints:
          ((map['dailyGrantPoints'] ?? map['dailyGrantCents']) as num?)
              ?.toInt() ??
          0,
      grantedToday: map['grantedToday'] == true,
    );
  }

  final bool active;
  final String planName;
  final DateTime? endsAt;
  final int dailyGrantPoints;
  final bool grantedToday;
}

class PurchaseOrder {
  const PurchaseOrder({
    required this.id,
    required this.planId,
    required this.status,
    required this.amountCents,
    required this.grantPoints,
    required this.bonusPoints,
    required this.provider,
    required this.createdAt,
    this.payUrl,
    this.paymentMethod,
    this.payAmountCents,
    this.requiresManualAmount = false,
    this.expiresAt,
    this.paidAt,
    this.completedAt,
  });

  factory PurchaseOrder.fromJson(Map<String, dynamic> json) => PurchaseOrder(
    id: json['id']?.toString() ?? '',
    planId: json['planId']?.toString() ?? '',
    status: json['status']?.toString() ?? 'pending',
    amountCents: (json['amountCents'] as num?)?.toInt() ?? 0,
    grantPoints:
        ((json['grantPoints'] ?? json['grantCents']) as num?)?.toInt() ?? 0,
    bonusPoints:
        ((json['bonusPoints'] ?? json['bonusCents']) as num?)?.toInt() ?? 0,
    provider: json['provider']?.toString() ?? '',
    payUrl: _optional(json['payUrl']),
    paymentMethod: _optional(json['paymentMethod']),
    payAmountCents: (json['payAmountCents'] as num?)?.toInt(),
    requiresManualAmount: json['requiresManualAmount'] == true,
    expiresAt: _date(json['expiresAt']),
    paidAt: _date(json['paidAt']),
    completedAt: _date(json['completedAt']),
    createdAt: _date(json['createdAt']),
  );

  final String id;
  final String planId;
  final String status;
  final int amountCents;
  final int grantPoints;
  final int bonusPoints;
  final String provider;
  final String? payUrl;
  final String? paymentMethod;
  final int? payAmountCents;
  final bool requiresManualAmount;
  final DateTime? expiresAt;
  final DateTime? paidAt;
  final DateTime? completedAt;
  final DateTime? createdAt;

  bool get isPending => status == 'pending' || status == 'paid';
  bool get isCompleted => status == 'completed';
  int get creditedPoints => grantPoints + bonusPoints;
}

class OrderPage {
  const OrderPage({required this.items, this.nextCursor});

  factory OrderPage.fromJson(dynamic data) {
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : const <String, dynamic>{};
    return OrderPage(
      items: map['items'] is List
          ? (map['items'] as List)
                .whereType<Map>()
                .map(
                  (item) =>
                      PurchaseOrder.fromJson(Map<String, dynamic>.from(item)),
                )
                .where((item) => item.id.isNotEmpty)
                .toList()
          : const [],
      nextCursor: _optional(map['nextCursor']),
    );
  }

  final List<PurchaseOrder> items;
  final String? nextCursor;
}

class PurchaseCenterState {
  const PurchaseCenterState({
    required this.catalog,
    required this.subscription,
    required this.orders,
    this.nextCursor,
    this.isLoadingMore = false,
    this.creatingPlanId,
    this.busyOrderIds = const {},
  });

  final PlanCatalog catalog;
  final UserSubscription subscription;
  final List<PurchaseOrder> orders;
  final String? nextCursor;
  final bool isLoadingMore;
  final String? creatingPlanId;
  final Set<String> busyOrderIds;

  bool get hasMore => nextCursor != null;

  PurchaseCenterState copyWith({
    PlanCatalog? catalog,
    UserSubscription? subscription,
    List<PurchaseOrder>? orders,
    String? nextCursor,
    bool clearCursor = false,
    bool? isLoadingMore,
    String? creatingPlanId,
    bool clearCreatingPlan = false,
    Set<String>? busyOrderIds,
  }) => PurchaseCenterState(
    catalog: catalog ?? this.catalog,
    subscription: subscription ?? this.subscription,
    orders: orders ?? this.orders,
    nextCursor: clearCursor ? null : nextCursor ?? this.nextCursor,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    creatingPlanId: clearCreatingPlan
        ? null
        : creatingPlanId ?? this.creatingPlanId,
    busyOrderIds: busyOrderIds ?? this.busyOrderIds,
  );
}

class BillingRepository {
  const BillingRepository(this._apiClient);

  final ApiClient _apiClient;

  Future<PlanCatalog> plans() async =>
      PlanCatalog.fromJson(await _apiClient.get('/plans'));

  Future<UserSubscription> subscription() async =>
      UserSubscription.fromJson(await _apiClient.get('/me/subscription'));

  Future<OrderPage> orders({String? cursor, int limit = 20}) async =>
      OrderPage.fromJson(
        await _apiClient.get(
          '/orders',
          queryParameters: {
            'limit': limit,
            if (cursor?.isNotEmpty == true) 'cursor': cursor,
          },
        ),
      );

  Future<PurchaseOrder> createOrder({
    required String planId,
    required String paymentMethod,
  }) async {
    final data = await _apiClient.post(
      '/orders',
      data: {'planId': planId, 'paymentMethod': paymentMethod},
    );
    if (data is! Map) throw const FormatException('下单响应无效');
    return PurchaseOrder.fromJson(Map<String, dynamic>.from(data));
  }

  Future<PurchaseOrder> order(String id) async {
    final data = await _apiClient.get('/orders/$id');
    if (data is! Map) throw const FormatException('订单响应无效');
    return PurchaseOrder.fromJson(Map<String, dynamic>.from(data));
  }

  Future<PurchaseOrder> closeOrder(String id) async {
    final data = await _apiClient.post('/orders/$id/close');
    if (data is! Map) throw const FormatException('关闭订单响应无效');
    return PurchaseOrder.fromJson(Map<String, dynamic>.from(data));
  }
}

final billingRepositoryProvider = Provider<BillingRepository>(
  (ref) => BillingRepository(ref.watch(apiClientProvider)),
);

class PurchaseCenterController extends AsyncNotifier<PurchaseCenterState> {
  BillingRepository get _repository => ref.read(billingRepositoryProvider);

  @override
  Future<PurchaseCenterState> build() => _load();

  Future<PurchaseCenterState> _load() async {
    final values = await Future.wait([
      _repository.plans(),
      _repository.subscription(),
      _repository.orders(),
    ]);
    final page = values[2] as OrderPage;
    return PurchaseCenterState(
      catalog: values[0] as PlanCatalog,
      subscription: values[1] as UserSubscription,
      orders: page.items,
      nextCursor: page.nextCursor,
    );
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_load);
  }

  Future<void> loadMore() async {
    final current = state.asData?.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final page = await _repository.orders(cursor: current.nextCursor);
      final known = current.orders.map((item) => item.id).toSet();
      state = AsyncData(
        current.copyWith(
          orders: [
            ...current.orders,
            ...page.items.where((item) => known.add(item.id)),
          ],
          nextCursor: page.nextCursor,
          clearCursor: page.nextCursor == null,
          isLoadingMore: false,
        ),
      );
    } catch (error, stackTrace) {
      state = AsyncData(current.copyWith(isLoadingMore: false));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<PurchaseOrder> createOrder(
    PurchasePlan plan,
    String paymentMethod,
  ) async {
    final current = state.requireValue;
    state = AsyncData(current.copyWith(creatingPlanId: plan.id));
    try {
      final order = await _repository.createOrder(
        planId: plan.id,
        paymentMethod: paymentMethod,
      );
      final latest = state.asData?.value ?? current;
      state = AsyncData(
        latest.copyWith(
          orders: [
            order,
            ...latest.orders.where((item) => item.id != order.id),
          ],
          clearCreatingPlan: true,
        ),
      );
      return order;
    } catch (error, stackTrace) {
      state = AsyncData(current.copyWith(clearCreatingPlan: true));
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<PurchaseOrder> refreshOrder(String id) =>
      _mutateOrder(id, () => _repository.order(id));

  Future<PurchaseOrder> closeOrder(String id) =>
      _mutateOrder(id, () => _repository.closeOrder(id));

  Future<PurchaseOrder> _mutateOrder(
    String id,
    Future<PurchaseOrder> Function() operation,
  ) async {
    final current = state.requireValue;
    state = AsyncData(
      current.copyWith(busyOrderIds: {...current.busyOrderIds, id}),
    );
    try {
      final order = await operation();
      final latest = state.asData?.value ?? current;
      final exists = latest.orders.any((item) => item.id == id);
      state = AsyncData(
        latest.copyWith(
          orders: exists
              ? latest.orders
                    .map((item) => item.id == id ? order : item)
                    .toList()
              : [order, ...latest.orders],
          busyOrderIds: {...latest.busyOrderIds}..remove(id),
        ),
      );
      return order;
    } catch (error, stackTrace) {
      final latest = state.asData?.value ?? current;
      state = AsyncData(
        latest.copyWith(busyOrderIds: {...latest.busyOrderIds}..remove(id)),
      );
      Error.throwWithStackTrace(error, stackTrace);
    }
  }
}

final purchaseCenterControllerProvider =
    AsyncNotifierProvider<PurchaseCenterController, PurchaseCenterState>(
      PurchaseCenterController.new,
    );

DateTime? _date(dynamic value) =>
    DateTime.tryParse(value?.toString() ?? '')?.toLocal();

String? _optional(dynamic value) {
  final text = value?.toString().trim();
  return text == null || text.isEmpty ? null : text;
}
