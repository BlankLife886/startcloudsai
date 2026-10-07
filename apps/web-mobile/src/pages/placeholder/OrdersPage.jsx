import { ReceiptIcon } from "@mobile/components/icons.jsx";
import { ComingSoon } from "@mobile/components/ComingSoon.jsx";

export default function OrdersPage() {
  return (
    <ComingSoon
      title="订单"
      icon={ReceiptIcon}
      headline="购买记录一目了然"
      points={["查看积分套餐与会员的购买记录", "支付状态、到账积分实时同步", "未完成的订单可以继续支付"]}
      desktopPath="/orders"
    />
  );
}
