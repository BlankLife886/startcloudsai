package lanjingpay

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"
)

func TestMoneyConversion(t *testing.T) {
	for _, test := range []struct {
		value string
		cents int64
	}{
		{"0.1", 10},
		{"10", 1000},
		{"10.01", 1001},
	} {
		got, err := ParseCents(test.value)
		if err != nil || got != test.cents {
			t.Fatalf("ParseCents(%q) = %d, %v", test.value, got, err)
		}
	}
	if got, err := FormatCents(1001); err != nil || got != "10.01" {
		t.Fatalf("FormatCents = %q, %v", got, err)
	}
	for _, invalid := range []string{"", "-1", "1.001", "abc"} {
		if _, err := ParseCents(invalid); err == nil {
			t.Fatalf("ParseCents(%q) should fail", invalid)
		}
	}
}

func TestParseUnixTimestampSupportsSecondsAndMilliseconds(t *testing.T) {
	want := time.Date(2026, time.September, 1, 12, 30, 45, 0, time.UTC)
	for _, value := range []int64{want.Unix(), want.UnixMilli()} {
		if got := parseUnixTimestamp(value); !got.Equal(want) {
			t.Fatalf("parseUnixTimestamp(%d) = %s, want %s", value, got, want)
		}
	}
}

func TestNormalizePaymentURL(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		want    string
		wantErr bool
	}{
		{name: "plain HTTPS", value: "HTTPS://QR.ALIPAY.COM/FKX035", want: "https://QR.ALIPAY.COM/FKX035"},
		{name: "percent encoded", value: "https%3A%2F%2Fqr.alipay.com%2Ffkx035", want: "https://qr.alipay.com/fkx035"},
		{name: "encoded query remains encoded", value: "https://pay.example/start?return=https%3A%2F%2Fapp.example", want: "https://pay.example/start?return=https%3A%2F%2Fapp.example"},
		{name: "unsafe scheme", value: "javascript:alert(1)", wantErr: true},
		{name: "missing scheme", value: "qr.alipay.com/fkx035", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizePaymentURL(test.value)
			if test.wantErr {
				if err == nil {
					t.Fatalf("normalizePaymentURL(%q) = %q, want error", test.value, got)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("normalizePaymentURL(%q) = %q, %v; want %q", test.value, got, err, test.want)
			}
		})
	}
}

func TestCreateOrderSignsExactFormValues(t *testing.T) {
	secret := "test-secret"
	var form url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/createOrder" || r.Method != http.MethodPost {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		form = r.PostForm
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":1,"msg":"成功","data":{"payId":"local-order","orderId":"cloud-order","payType":2,"price":10,"reallyPrice":10.01,"payUrl":"HTTPS://QR.ALIPAY.COM/TEST","isAuto":1,"state":0,"timeOut":5,"date":1547130014777}}`))
	}))
	defer server.Close()

	client, err := New(server.URL, secret, server.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	order, err := client.CreateOrder(context.Background(), CreateOrderInput{
		MerchantOrderID: "local-order",
		Param:           "local-order",
		Type:            Alipay,
		AmountCents:     1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if form.Get("price") != "10.00" || form.Get("isHtml") != "0" {
		t.Fatalf("form = %#v", form)
	}
	wantSign := MD5("local-order", "local-order", "2", "10.00", secret)
	if form.Get("sign") != wantSign {
		t.Fatalf("sign = %q, want %q", form.Get("sign"), wantSign)
	}
	if order.ProviderOrderID != "cloud-order" || order.ReallyPrice != "10.01" {
		t.Fatalf("order = %#v", order)
	}
}

func TestGetOrderAcceptsStringTimestamp(t *testing.T) {
	createdAt := time.Date(2026, time.September, 1, 14, 24, 32, 0, time.UTC)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/getOrder" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"code":1,"msg":"成功","data":{"payId":"local-order","orderId":"cloud-order","payType":"2","price":"0.01","reallyPrice":"0.01","payUrl":"https%3A%2F%2Fqr.alipay.com%2Ftest","isAuto":"1","state":"0","timeOut":"5","date":"` + strconv.FormatInt(createdAt.UnixMilli(), 10) + `"}}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "secret", server.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	order, err := client.GetOrder(context.Background(), "cloud-order")
	if err != nil {
		t.Fatal(err)
	}
	if !order.CreatedAt.Equal(createdAt) || order.PayURL != "https://qr.alipay.com/test" || order.IsAuto != 1 {
		t.Fatalf("order = %#v", order)
	}
}

func TestCheckOrderParsesAndVerifiesConfirmation(t *testing.T) {
	secret := "check-secret"
	var form url.Values
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/checkOrder" || r.Method != http.MethodPost {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		form = r.PostForm
		values := url.Values{
			"payId": {"local-order"}, "param": {"local-order"}, "type": {"2"},
			"price": {"10.00"}, "reallyPrice": {"10.00"},
		}
		values.Set("sign", MD5("local-order", "local-order", "2", "10.00", "10.00", secret))
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 1, "msg": "成功", "data": server.URL + "/notify?" + values.Encode(),
		})
	}))
	defer server.Close()

	client, err := New(server.URL, secret, server.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	confirmation, err := client.CheckOrder(context.Background(), "cloud-order")
	if err != nil {
		t.Fatal(err)
	}
	if len(form) != 1 || form.Get("orderId") != "cloud-order" {
		t.Fatalf("check form = %#v", form)
	}
	if confirmation.MerchantOrderID != "local-order" || confirmation.Param != "local-order" ||
		confirmation.Type != Alipay || confirmation.Price != "10.00" || confirmation.ReallyPrice != "10.00" {
		t.Fatalf("confirmation = %#v", confirmation)
	}
}

func TestCheckOrderRejectsUnpaidTamperedAndMalformedResponses(t *testing.T) {
	secret := "check-secret"
	tests := []struct {
		name     string
		response func(string) any
		apiCode  int
	}{
		{name: "unpaid", apiCode: -1, response: func(string) any { return nil }},
		{name: "tampered signature", apiCode: 1, response: func(baseURL string) any {
			return baseURL + "/notify?payId=local-order&param=local-order&type=2&price=10.00&reallyPrice=10.00&sign=invalid"
		}},
		{name: "malformed callback URL", apiCode: 1, response: func(string) any { return "not-a-callback-url" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code": test.apiCode, "msg": "not paid", "data": test.response(server.URL),
				})
			}))
			defer server.Close()
			client, err := New(server.URL, secret, server.URL+"/notify", time.Second, true)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := client.CheckOrder(context.Background(), "cloud-order"); err == nil {
				t.Fatal("CheckOrder should reject response")
			} else if test.apiCode == -1 {
				var apiErr *APIError
				if !errors.As(err, &apiErr) || apiErr.Code != -1 {
					t.Fatalf("unpaid error = %v", err)
				}
			}
		})
	}
}

func TestVerifyCallback(t *testing.T) {
	client := &Client{secret: "secret"}
	signature := MD5("pay", "param", "2", "10", "10.01", "secret")
	if !client.VerifyCallback("pay", "param", "2", "10", "10.01", signature) {
		t.Fatal("valid callback signature rejected")
	}
	if client.VerifyCallback("pay", "param", "2", "10", "9.99", signature) {
		t.Fatal("tampered callback signature accepted")
	}
}

func TestGetServerStateSignsTimestamp(t *testing.T) {
	secret := "state-secret"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/getState" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		timestamp := r.PostForm.Get("t")
		if r.PostForm.Get("sign") != MD5(timestamp, secret) {
			t.Fatal("invalid state signature")
		}
		_, _ = w.Write([]byte(`{"code":1,"msg":"成功","data":{"lastpay":"1547394640856","lastheart":1547613873755,"state":"1"}}`))
	}))
	defer server.Close()
	client, err := New(server.URL, secret, server.URL+"/notify", time.Second, true)
	if err != nil {
		t.Fatal(err)
	}
	state, err := client.GetServerState(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if state.State != 1 || state.LastHeartbeat.IsZero() || state.LastPayment.IsZero() {
		t.Fatalf("state = %#v", state)
	}
}
