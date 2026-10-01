package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/lanjingpay"
)

// fakeLanjing is an in-memory Lanjing provider that follows the documented
// API: fixed-amount QR codes, amount shifting for concurrent equal amounts,
// signed create/close/state calls and unsigned order lookups.
type fakeLanjing struct {
	t      *testing.T
	server *httptest.Server
	secret string

	mu      sync.Mutex
	orders  map[string]*fakeLanjingOrder
	seq     int
	calls   map[string]int
	created []string

	// Knobs a test may change before the call it wants to influence.
	ListenerState int    // /getState state; 1 = online
	IsAuto        int    // isAuto returned by /createOrder
	CreateFailure string // "", "transport" or an API error message
	CloseFailure  string // API error message returned by /closeOrder
	ShiftEqual    bool   // shift reallyPrice when an open order has the same amount (default true)
}

type fakeLanjingOrder struct {
	ID          string
	PayID       string
	Param       string
	Type        int
	Price       string
	ReallyPrice string
	State       int
	Created     time.Time
}

func newFakeLanjing(t *testing.T) *fakeLanjing {
	t.Helper()
	f := &fakeLanjing{t: t, secret: "fake-secret", orders: map[string]*fakeLanjingOrder{}, calls: map[string]int{},
		ListenerState: 1, ShiftEqual: true}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeLanjing) client() *lanjingpay.Client {
	f.t.Helper()
	client, err := lanjingpay.New(f.server.URL, f.secret, "https://app.example/api/v1/payments/lanjing/notify", 2*time.Second, true)
	if err != nil {
		f.t.Fatal(err)
	}
	return client
}

func (f *fakeLanjing) count(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[path]
}

func (f *fakeLanjing) order(id string) fakeLanjingOrder {
	f.mu.Lock()
	defer f.mu.Unlock()
	o := f.orders[id]
	if o == nil {
		f.t.Fatalf("fake provider order %s not found", id)
	}
	return *o
}

func (f *fakeLanjing) setState(id string, state int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.orders[id].State = state
}

// lastCreated returns the most recently created provider order ID.
func (f *fakeLanjing) lastCreated() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.created) == 0 {
		f.t.Fatal("fake provider created no order")
	}
	return f.created[len(f.created)-1]
}

// callbackPath is the signed async notification the provider sends once
// the given order is paid.
func (f *fakeLanjing) callbackPath(id string) string {
	o := f.order(id)
	values := url.Values{"payId": {o.PayID}, "param": {o.Param}, "type": {strconv.Itoa(o.Type)},
		"price": {o.Price}, "reallyPrice": {o.ReallyPrice}}
	values.Set("sign", lanjingpay.MD5(o.PayID, o.Param, strconv.Itoa(o.Type), o.Price, o.ReallyPrice, f.secret))
	return "/api/v1/payments/lanjing/notify?" + values.Encode()
}

func (f *fakeLanjing) reply(w http.ResponseWriter, code int, msg string, data any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"code": code, "msg": msg, "data": data})
}

func (f *fakeLanjing) wire(o *fakeLanjingOrder) map[string]any {
	return map[string]any{"payId": o.PayID, "orderId": o.ID, "payType": o.Type, "price": o.Price,
		"reallyPrice": o.ReallyPrice, "payUrl": "https://qr.alipay.com/fixed-" + o.ReallyPrice, "isAuto": f.IsAuto,
		"state": o.State, "timeOut": 5, "date": o.Created.UnixMilli()}
}

func (f *fakeLanjing) serve(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		f.t.Errorf("parse form: %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls[r.URL.Path]++
	form := r.Form
	switch r.URL.Path {
	case "/getState":
		if form.Get("sign") != lanjingpay.MD5(form.Get("t"), f.secret) {
			f.reply(w, -1, "签名校验不通过", nil)
			return
		}
		f.reply(w, 1, "成功", map[string]any{"state": strconv.Itoa(f.ListenerState),
			"lastheart": strconv.FormatInt(time.Now().UnixMilli(), 10), "lastpay": "0"})
	case "/createOrder":
		if f.CreateFailure == "transport" {
			http.Error(w, "gateway timeout", http.StatusGatewayTimeout)
			return
		}
		if f.CreateFailure != "" {
			f.reply(w, -1, f.CreateFailure, nil)
			return
		}
		payType, _ := strconv.Atoi(form.Get("type"))
		price := form.Get("price")
		if form.Get("sign") != lanjingpay.MD5(form.Get("payId"), form.Get("param"), form.Get("type"), price, f.secret) {
			f.reply(w, -1, "签名校验不通过", nil)
			return
		}
		cents, err := lanjingpay.ParseCents(price)
		if err != nil {
			f.reply(w, -1, "金额格式错误", nil)
			return
		}
		really := cents
		for f.ShiftEqual && f.amountTaken(payType, really) {
			really++
		}
		f.seq++
		o := &fakeLanjingOrder{ID: fmt.Sprintf("cloud-%d", f.seq), PayID: form.Get("payId"), Param: form.Get("param"),
			Type: payType, Price: price, ReallyPrice: fmt.Sprintf("%d.%02d", really/100, really%100), Created: time.Now()}
		f.orders[o.ID] = o
		f.created = append(f.created, o.ID)
		f.reply(w, 1, "成功", f.wire(o))
	case "/getOrder":
		o := f.orders[form.Get("orderId")]
		if o == nil {
			f.reply(w, -1, "云端订单编号不存在", nil)
			return
		}
		f.reply(w, 1, "成功", f.wire(o))
	case "/closeOrder":
		id := form.Get("orderId")
		if form.Get("sign") != lanjingpay.MD5(id, f.secret) {
			f.reply(w, -1, "签名校验不通过", nil)
			return
		}
		o := f.orders[id]
		switch {
		case o == nil:
			f.reply(w, -1, "云端订单编号不存在", nil)
		case f.CloseFailure != "":
			f.reply(w, -1, f.CloseFailure, nil)
		case o.State != 0:
			f.reply(w, -1, "订单状态不允许关闭", nil)
		default:
			o.State = -1
			f.reply(w, 1, "成功", nil)
		}
	default:
		http.NotFound(w, r)
	}
}

func (f *fakeLanjing) amountTaken(payType int, cents int64) bool {
	for _, o := range f.orders {
		if c, _ := lanjingpay.ParseCents(o.ReallyPrice); o.State == 0 && o.Type == payType && c == cents {
			return true
		}
	}
	return false
}
