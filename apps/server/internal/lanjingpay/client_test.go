package lanjingpay

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
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
