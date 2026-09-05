package lanjingpay

import (
	"context"
	"crypto/md5" // #nosec G501 -- the upstream payment signing protocol mandates MD5.
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
)

const maxResponseBytes = 1 << 20

type PaymentType int

const (
	Wechat PaymentType = 1
	Alipay PaymentType = 2
)

type Client struct {
	baseURL   string
	secret    string
	http      *http.Client
	notifyURL string
}

type CreateOrderInput struct {
	MerchantOrderID string
	Param           string
	Type            PaymentType
	AmountCents     int64
}

type Order struct {
	MerchantOrderID string
	ProviderOrderID string
	Type            PaymentType
	Price           string
	ReallyPrice     string
	PayURL          string
	IsAuto          int
	State           int
	TimeoutMinutes  int
	CreatedAt       time.Time
}

type ServerState struct {
	State         int
	LastHeartbeat time.Time
	LastPayment   time.Time
}

type PaymentConfirmation struct {
	MerchantOrderID string
	Param           string
	Type            PaymentType
	Price           string
	ReallyPrice     string
}

func (o *Order) PriceCents() (int64, error)       { return ParseCents(o.Price) }
func (o *Order) ReallyPriceCents() (int64, error) { return ParseCents(o.ReallyPrice) }

func (o *Order) ExpiresAt() time.Time {
	if o.CreatedAt.IsZero() || o.TimeoutMinutes <= 0 {
		return time.Time{}
	}
	return o.CreatedAt.Add(time.Duration(o.TimeoutMinutes) * time.Minute)
}

type APIError struct {
	Code    int
	Message string
}

func (e *APIError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("lanjing pay request failed (code %d)", e.Code)
	}
	return e.Message
}

func IsTerminalOrderError(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(apiErr.Message))
	for _, marker := range []string{"不存在", "已过期", "已关闭", "not found", "expired", "closed"} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func New(baseURL, secret, notifyURL string, timeout time.Duration, allowPrivate bool) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	secret = strings.TrimSpace(secret)
	notifyURL = strings.TrimSpace(notifyURL)
	if baseURL == "" || secret == "" || notifyURL == "" {
		return nil, errors.New("lanjing pay base URL, secret and notify URL are required")
	}
	if err := netguard.ValidateURL(baseURL, allowPrivate, !allowPrivate); err != nil {
		return nil, fmt.Errorf("lanjing pay base URL: %w", err)
	}
	if err := netguard.ValidateURL(notifyURL, allowPrivate, !allowPrivate); err != nil {
		return nil, fmt.Errorf("lanjing pay notify URL: %w", err)
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &Client{
		baseURL:   baseURL,
		secret:    secret,
		notifyURL: notifyURL,
		http:      netguard.NewHTTPClient(timeout, allowPrivate, !allowPrivate),
	}, nil
}

func MD5(parts ...string) string {
	// #nosec G401 -- compatibility signature required by the upstream payment protocol.
	hash := md5.Sum([]byte(strings.Join(parts, "")))
	return hex.EncodeToString(hash[:])
}

func FormatCents(cents int64) (string, error) {
	if cents <= 0 {
		return "", errors.New("amount must be positive")
	}
	return fmt.Sprintf("%d.%02d", cents/100, cents%100), nil
}

var moneyPattern = regexp.MustCompile(`^([0-9]+)(?:\.([0-9]{1,2}))?$`)

func ParseCents(value string) (int64, error) {
	value = strings.TrimSpace(value)
	parts := moneyPattern.FindStringSubmatch(value)
	if parts == nil {
		return 0, fmt.Errorf("invalid amount %q", value)
	}
	whole, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid amount %q", value)
	}
	fraction := int64(0)
	if parts[2] != "" {
		fraction, err = strconv.ParseInt(parts[2], 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid amount %q", value)
		}
		if len(parts[2]) == 1 {
			fraction *= 10
		}
	}
	if whole > ((1<<63-1)-fraction)/100 {
		return 0, fmt.Errorf("invalid amount %q", value)
	}
	return whole*100 + fraction, nil
}

func (c *Client) CreateSignature(payID, param string, paymentType PaymentType, price string) string {
	return MD5(payID, param, strconv.Itoa(int(paymentType)), price, c.secret)
}

func (c *Client) CallbackSignature(payID, param, paymentType, price, reallyPrice string) string {
	return MD5(payID, param, paymentType, price, reallyPrice, c.secret)
}

func (c *Client) VerifyCallback(payID, param, paymentType, price, reallyPrice, signature string) bool {
	want := c.CallbackSignature(payID, param, paymentType, price, reallyPrice)
	got := strings.ToLower(strings.TrimSpace(signature))
	if len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func (c *Client) CreateOrder(ctx context.Context, input CreateOrderInput) (*Order, error) {
	if input.MerchantOrderID == "" || input.Param == "" {
		return nil, errors.New("merchant order ID and param are required")
	}
	if input.Type != Wechat && input.Type != Alipay {
		return nil, errors.New("unsupported payment type")
	}
	price, err := FormatCents(input.AmountCents)
	if err != nil {
		return nil, err
	}
	values := url.Values{
		"payId":     {input.MerchantOrderID},
		"param":     {input.Param},
		"type":      {strconv.Itoa(int(input.Type))},
		"price":     {price},
		"sign":      {c.CreateSignature(input.MerchantOrderID, input.Param, input.Type, price)},
		"isHtml":    {"0"},
		"notifyUrl": {c.notifyURL},
	}
	return c.orderRequest(ctx, "/createOrder", values)
}

func (c *Client) GetOrder(ctx context.Context, providerOrderID string) (*Order, error) {
	if strings.TrimSpace(providerOrderID) == "" {
		return nil, errors.New("provider order ID is required")
	}
	return c.orderRequest(ctx, "/getOrder", url.Values{"orderId": {providerOrderID}})
}

func (c *Client) CheckOrder(ctx context.Context, providerOrderID string) (*PaymentConfirmation, error) {
	providerOrderID = strings.TrimSpace(providerOrderID)
	if providerOrderID == "" {
		return nil, errors.New("provider order ID is required")
	}
	var response responseEnvelope[string]
	if err := c.postForm(ctx, "/checkOrder", url.Values{"orderId": {providerOrderID}}, &response); err != nil {
		return nil, err
	}
	if response.Code != 1 || strings.TrimSpace(response.Data) == "" {
		return nil, &APIError{Code: response.Code, Message: response.Message}
	}
	callbackURL, err := url.Parse(strings.TrimSpace(response.Data))
	if err != nil || callbackURL.Scheme == "" || callbackURL.Host == "" {
		return nil, fmt.Errorf("lanjing pay /checkOrder: invalid callback URL")
	}
	if callbackURL.Scheme != "http" && callbackURL.Scheme != "https" {
		return nil, fmt.Errorf("lanjing pay /checkOrder: unsupported callback URL scheme")
	}
	values := callbackURL.Query()
	payID, err := requiredSingleQueryValue(values, "payId")
	if err != nil {
		return nil, fmt.Errorf("lanjing pay /checkOrder: %w", err)
	}
	param, err := requiredSingleQueryValue(values, "param")
	if err != nil {
		return nil, fmt.Errorf("lanjing pay /checkOrder: %w", err)
	}
	paymentTypeValue, err := requiredSingleQueryValue(values, "type")
	if err != nil {
		return nil, fmt.Errorf("lanjing pay /checkOrder: %w", err)
	}
	price, err := requiredSingleQueryValue(values, "price")
	if err != nil {
		return nil, fmt.Errorf("lanjing pay /checkOrder: %w", err)
	}
	reallyPrice, err := requiredSingleQueryValue(values, "reallyPrice")
	if err != nil {
		return nil, fmt.Errorf("lanjing pay /checkOrder: %w", err)
	}
	signature, err := requiredSingleQueryValue(values, "sign")
	if err != nil {
		return nil, fmt.Errorf("lanjing pay /checkOrder: %w", err)
	}
	paymentTypeNumber, err := strconv.Atoi(paymentTypeValue)
	if err != nil || (PaymentType(paymentTypeNumber) != Wechat && PaymentType(paymentTypeNumber) != Alipay) {
		return nil, fmt.Errorf("lanjing pay /checkOrder: invalid payment type")
	}
	if _, err := ParseCents(price); err != nil {
		return nil, fmt.Errorf("lanjing pay /checkOrder: invalid price: %w", err)
	}
	if _, err := ParseCents(reallyPrice); err != nil {
		return nil, fmt.Errorf("lanjing pay /checkOrder: invalid paid amount: %w", err)
	}
	if !c.VerifyCallback(payID, param, paymentTypeValue, price, reallyPrice, signature) {
		return nil, fmt.Errorf("lanjing pay /checkOrder: invalid callback signature")
	}
	return &PaymentConfirmation{
		MerchantOrderID: payID,
		Param:           param,
		Type:            PaymentType(paymentTypeNumber),
		Price:           price,
		ReallyPrice:     reallyPrice,
	}, nil
}

func requiredSingleQueryValue(values url.Values, key string) (string, error) {
	items := values[key]
	if len(items) != 1 || strings.TrimSpace(items[0]) == "" {
		return "", fmt.Errorf("callback parameter %s must appear exactly once", key)
	}
	return strings.TrimSpace(items[0]), nil
}

func (c *Client) CloseOrder(ctx context.Context, providerOrderID string) error {
	providerOrderID = strings.TrimSpace(providerOrderID)
	if providerOrderID == "" {
		return errors.New("provider order ID is required")
	}
	var response responseEnvelope[json.RawMessage]
	err := c.postForm(ctx, "/closeOrder", url.Values{
		"orderId": {providerOrderID},
		"sign":    {MD5(providerOrderID, c.secret)},
	}, &response)
	if err != nil {
		return err
	}
	if response.Code != 1 {
		return &APIError{Code: response.Code, Message: response.Message}
	}
	return nil
}

func (c *Client) GetServerState(ctx context.Context) (*ServerState, error) {
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	var response responseEnvelope[*wireServerState]
	if err := c.postForm(ctx, "/getState", url.Values{
		"t":    {timestamp},
		"sign": {MD5(timestamp, c.secret)},
	}, &response); err != nil {
		return nil, err
	}
	if response.Code != 1 || response.Data == nil {
		return nil, &APIError{Code: response.Code, Message: response.Message}
	}
	state, err := parseRawInt(response.Data.State)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay /getState: invalid state: %w", err)
	}
	lastHeartbeat, err := parseRawMillis(response.Data.LastHeartbeat)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay /getState: invalid heartbeat: %w", err)
	}
	lastPayment, err := parseRawMillis(response.Data.LastPayment)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay /getState: invalid payment timestamp: %w", err)
	}
	return &ServerState{State: int(state), LastHeartbeat: lastHeartbeat, LastPayment: lastPayment}, nil
}

type responseEnvelope[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"msg"`
	Data    T      `json:"data"`
}

type wireOrder struct {
	MerchantOrderID string          `json:"payId"`
	ProviderOrderID string          `json:"orderId"`
	Type            json.RawMessage `json:"payType"`
	Price           json.RawMessage `json:"price"`
	ReallyPrice     json.RawMessage `json:"reallyPrice"`
	PayURL          string          `json:"payUrl"`
	IsAuto          json.RawMessage `json:"isAuto"`
	State           json.RawMessage `json:"state"`
	TimeoutMinutes  json.RawMessage `json:"timeOut"`
	Date            json.RawMessage `json:"date"`
}

type wireServerState struct {
	LastPayment   json.RawMessage `json:"lastpay"`
	LastHeartbeat json.RawMessage `json:"lastheart"`
	State         json.RawMessage `json:"state"`
}

func parseRawInt(raw json.RawMessage) (int64, error) {
	value := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	if value == "" || value == "null" {
		return 0, nil
	}
	return strconv.ParseInt(value, 10, 64)
}

func parseRawString(raw json.RawMessage) (string, error) {
	value := strings.TrimSpace(string(raw))
	if value == "" || value == "null" {
		return "", nil
	}
	if strings.HasPrefix(value, `"`) {
		var decoded string
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return "", err
		}
		return strings.TrimSpace(decoded), nil
	}
	return value, nil
}

func parseRawMillis(raw json.RawMessage) (time.Time, error) {
	value, err := parseRawInt(raw)
	if err != nil || value <= 0 {
		return time.Time{}, err
	}
	return parseUnixTimestamp(value), nil
}

func parseUnixTimestamp(value int64) time.Time {
	if value <= 0 {
		return time.Time{}
	}
	if value < 100_000_000_000 {
		return time.Unix(value, 0).UTC()
	}
	return time.UnixMilli(value).UTC()
}

func NormalizePaymentURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	for attempt := 0; attempt < 2; attempt++ {
		parsed, err := url.Parse(value)
		if err == nil && parsed.Scheme != "" {
			return validatedPaymentURL(parsed)
		}
		decoded, decodeErr := url.PathUnescape(value)
		if decodeErr != nil {
			return "", fmt.Errorf("decode payment URL: %w", decodeErr)
		}
		decoded = strings.TrimSpace(decoded)
		if decoded == value {
			break
		}
		value = decoded
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" {
		return "", fmt.Errorf("invalid payment URL")
	}
	return validatedPaymentURL(parsed)
}

func validatedPaymentURL(parsed *url.URL) (string, error) {
	scheme := strings.ToLower(parsed.Scheme)
	switch scheme {
	case "http", "https":
		if parsed.Host == "" {
			return "", fmt.Errorf("payment URL has no host")
		}
	case "alipay", "alipays", "weixin":
		if parsed.Host == "" && parsed.Opaque == "" && parsed.Path == "" {
			return "", fmt.Errorf("payment URL has no target")
		}
	default:
		return "", fmt.Errorf("unsupported payment URL scheme %q", parsed.Scheme)
	}
	parsed.Scheme = scheme
	return parsed.String(), nil
}

func (c *Client) orderRequest(ctx context.Context, path string, values url.Values) (*Order, error) {
	var response responseEnvelope[*wireOrder]
	if err := c.postForm(ctx, path, values, &response); err != nil {
		return nil, err
	}
	if response.Code != 1 || response.Data == nil {
		return nil, &APIError{Code: response.Code, Message: response.Message}
	}
	wire := response.Data
	paymentType, err := parseRawInt(wire.Type)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay %s: invalid payment type: %w", path, err)
	}
	price, err := parseRawString(wire.Price)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay %s: invalid price: %w", path, err)
	}
	reallyPrice, err := parseRawString(wire.ReallyPrice)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay %s: invalid paid amount: %w", path, err)
	}
	isAuto, err := parseRawInt(wire.IsAuto)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay %s: invalid manual amount flag: %w", path, err)
	}
	state, err := parseRawInt(wire.State)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay %s: invalid order state: %w", path, err)
	}
	timeoutMinutes, err := parseRawInt(wire.TimeoutMinutes)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay %s: invalid timeout: %w", path, err)
	}
	createdAtValue, err := parseRawInt(wire.Date)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay %s: invalid order timestamp: %w", path, err)
	}
	payURL, err := NormalizePaymentURL(wire.PayURL)
	if err != nil {
		return nil, fmt.Errorf("lanjing pay %s: invalid payment URL: %w", path, err)
	}
	return &Order{
		MerchantOrderID: wire.MerchantOrderID,
		ProviderOrderID: wire.ProviderOrderID,
		Type:            PaymentType(paymentType),
		Price:           price,
		ReallyPrice:     reallyPrice,
		PayURL:          payURL,
		IsAuto:          int(isAuto),
		State:           int(state),
		TimeoutMinutes:  int(timeoutMinutes),
		CreatedAt:       parseUnixTimestamp(createdAtValue),
	}, nil
}

func (c *Client) postForm(ctx context.Context, path string, values url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("lanjing pay %s: %w", path, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxResponseBytes))
		return fmt.Errorf("lanjing pay %s: HTTP %d", path, response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxResponseBytes))
	decoder.UseNumber()
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("lanjing pay %s: decode response: %w", path, err)
	}
	return nil
}
