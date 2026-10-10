package store

// RechargePolicy is the snapshot of a retired custom-amount top-up plan. It is
// kept only to read historical plans and orders.
type RechargePolicy struct {
	PointsPerYuan    int64 `json:"pointsPerYuan"`
	PriceLockMinYuan int64 `json:"priceLockMinYuan"`
}
