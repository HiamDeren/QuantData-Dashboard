# QuantAM GEX Dashboard — Sổ tay hệ thống

Tài liệu onboarding: hệ thống đang có gì, dữ liệu chảy thế nào, từng file/hàm làm
gì, và bắt đầu code thêm từ đâu.

> `README.md` = cách chạy + các quyết định gây tranh cãi.
> File này = giải phẫu code.

---

## 1. Bức tranh 30 giây

Vendor **Quant Data chỉ có REST, không có WebSocket**, key phải giấu server-side,
và ngân sách chung là **240 request/phút**. Nên kiến trúc bắt buộc là:

```
Quant Data REST
      │  (POST, Bearer key, 240/phút)
      ▼
┌─────────────────────── SERVER (Fastify, 1 process) ──────────────────────┐
│  TokenBucketLimiter ──▶ QuantDataClient ──▶ mapper ──▶ deriveStructure    │
│         ▲                                                  │             │
│         │                                                  ▼             │
│  PollScheduler  ◀── subscribe/unsubscribe ──────────  ChannelBus         │
│  (poll theo tier,                                  (snapshot + pub/sub)  │
│   chỉ khi có người xem)                                    │             │
└────────────────────────────────────────────────────────────┼─────────────┘
                                                             ▼
                                              GET /api/stream  (SSE)
                                                             │
┌──────────────────────── CLIENT (React SPA) ────────────────┼─────────────┐
│  StreamProvider (1 EventSource cho cả trang)  ◀────────────┘             │
│         │  useChannel('exposure-by-strike') …                            │
│         ▼                                                                │
│  4 panel: ExposureProfile · Tape · NetDrift · Price                      │
└──────────────────────────────────────────────────────────────────────────┘
```

Ba nguyên tắc xuyên suốt, vi phạm là hỏng kiến trúc:

1. **Browser không bao giờ gọi Quant Data.** Chỉ server gọi.
2. **JSON của vendor không bao giờ chạm React.** Phải qua mapper → DTO trong `shared/`.
3. **Không request nào đi vòng qua limiter.** Kể cả retry.

---

## 2. Bản đồ file

```
shared/contracts.ts          ← module DUY NHẤT cả server lẫn client cùng import
server/
  index.ts                   bootstrap Fastify, chọn mock/live, prod serve SPA
  config.ts                  env qua zod, fail-fast
  auth.ts                    gate 1 user: scrypt + cookie HMAC
  bus.ts                     snapshot nóng + pub/sub
  vendor/
    limiter.ts               token bucket 240/phút
    quantdata/
      endpoints.ts           dataset → tool vendor (allowlist)
      client.ts              LiveQuantDataClient (POST + retry)
      mock.ts                MockQuantDataClient (giả lập phiên)
  domain/
    normalize.ts             chuẩn hoá tên field + hình dạng response
    mappers.ts               raw vendor → DTO
    derive.ts                Call Wall / Put Wall / Gamma Flip / regime
  poller/
    tiers.ts                 cadence T0–T4, cổng giờ giao dịch
    scheduler.ts             vòng đời poll theo subscription
  routes/
    auth.routes.ts           login / me / logout + requireAuth
    stream.routes.ts         SSE endpoint
    meta.routes.ts           health / meta / stats
  scripts/hash-password.ts   sinh AUTH_PASSWORD_HASH
src/
  main.tsx  App.tsx          bootstrap + routing
  auth/                      AuthContext + 2 route guard
  stream/StreamProvider.tsx  client SSE
  hooks/                     useFilters (URL state) · useMeasure (đo SVG)
  lib/                       api (fetch wrapper) · format (số/tiền/giờ)
  components/                Panel · FilterBar · RegimeChip · layout/ · ui/
  panels/                    4 panel
  index.css                  design token (Tailwind v4 @theme)
```

---

## 3. `shared/contracts.ts` — hợp đồng chung

Đây là file nên đọc đầu tiên. Sửa gì ở đây là ảnh hưởng cả hai phía.

| Khai báo | Tác dụng |
|---|---|
| `DATASETS` | Mảng 4 dataset v1. Dùng làm allowlist runtime và nguồn của type `DatasetId`. Thêm panel mới = thêm phần tử ở đây trước tiên. |
| `DatasetId` | `'order-flow' \| 'exposure-by-strike' \| 'net-drift' \| 'price'` |
| `TapePrint` | 1 dòng trên tape: `ts`, `contractType`, `strike`, `dte`, `side`, `tradeType`, `size`, `price`, `premium`, `iv`. |
| `TapeSnapshot` / `TapePatch` | Snapshot = cả buffer; patch = **chỉ các print mới** (tape là kênh duy nhất dùng patch). |
| `ExposureStrike` | 1 strike: `gex`/`dex`/`vex`/`chex` + `callOi`/`putOi`. |
| `ExposureProfile` | Cả profile + số suy diễn: `callWall`, `putWall`, `gammaFlip`, `regime`, `netGex`, `signConvention`. |
| `DataMode` | `'GEX' \| 'DEX' \| 'VEX' \| 'CHEX'` — nút chuyển trên panel exposure. |
| `SignConvention` | `'dealer-short-calls' \| 'dealer-long-calls'`. Xem §7. |
| `DriftBucket` / `NetDrift` | 1 bucket thời gian: call premium, put premium, giá. |
| `PriceBar` / `PriceSeries` | Nến OHLCV. |
| `channelKey(dataset, ticker, date)` | Sinh khoá kênh `qd:{dataset}:{TICKER}:{YYYY-MM-DD}`. **Luôn dùng hàm này**, đừng nối chuỗi tay. |
| `parseChannel(key)` | Ngược lại; trả `null` nếu sai định dạng hoặc dataset lạ → chính là lớp allowlist đầu tiên. |
| `Frame<T>` | Union 3 loại: `snapshot` (payload đầy đủ), `patch` (delta), `status` (chỉ báo lỗi/stale). |
| `FrameBase` | Mọi frame đều có `channel`, `seq`, `ts`, `staleMs`, `state`. |
| `DatasetPayload` | Map dataset → kiểu payload; đây là thứ làm `useChannel('price')` tự suy ra `PriceSeries`. |
| `SessionUser` | `email`, `name`, `initials`. |

**Giao thức frame** — snapshot-then-delta:

- Subscribe → server gửi ngay `snapshot` (last-good trong bus).
- Sau đó chỉ gửi `patch` (hiện chỉ tape dùng).
- `seq` tăng đơn điệu **theo từng kênh**. Client thấy nhảy số ⇒ đã mất frame ⇒ đóng EventSource để lấy snapshot mới.
- Payload trùng hệt frame trước thì **không phát lại** (so sánh hash) — dashboard đứng yên hàng phút, băng thông phải bám thị trường chứ không bám đồng hồ.

---

## 4. Server — từng file

### `config.ts`

| Khai báo | Tác dụng |
|---|---|
| `optionalStr` | Zod helper: chuỗi rỗng ⇒ `undefined`. File `.env` viết "không set" là `QD_API_KEY=`, nên rỗng phải nghĩa là vắng mặt chứ không phải giá trị fail `min(1)`. |
| `Env` | Schema toàn bộ env. |
| `config` | Env đã parse. **Không đọc `process.env` ở chỗ nào khác.** |
| `isProd` | `NODE_ENV === 'production'`. |
| `usesMockVendor` | `!QD_API_KEY` — công tắc mock/live duy nhất trong hệ thống. |

`API_PORT` cố tình **không** tên `PORT`: harness dev và PaaS hay inject `PORT` cho
thứ chúng coi là "app", mà ở dev thứ đó là Vite → trùng tên là API tranh socket với Vite.

Boot fail-fast 2 chỗ: env sai schema, và prod thiếu `AUTH_SECRET`.

### `vendor/limiter.ts`

| Khai báo | Tác dụng |
|---|---|
| `Priority` | `0..4` ứng với T0..T4. Số nhỏ = rút trước. |
| `TokenBucketLimiter` | Bucket refill **liên tục** (`limit/60000` token mỗi ms), không reset theo phút — nếu reset thì một burst lúc giây 59 sẽ tiêu gấp đôi qua ranh giới phút. |
| `.acquire(priority)` | `Promise` resolve khi có token. Hàng đợi sort theo `(priority, thứ tự đến)` nên T0 không bao giờ chết đói sau T3. |
| `.penalize(ms)` | Gọi khi gặp 429 — đóng băng **cả bucket**, không riêng caller. |
| `.stats()` | `available`, `queued`, `utilizationPct` → `/api/stats`. Cảnh báo khi >80%. |
| `quantDataLimiter` | Singleton. Mọi call vendor đi qua đúng cái này. |

### `vendor/quantdata/endpoints.ts`

| Khai báo | Tác dụng |
|---|---|
| `TOOLS` | Map `DatasetId → { group, tool }`. **Nơi duy nhất tên tool vendor xuất hiện.** |
| `toolPath(spec)` | `/{group}/tool/{tool}`. |
| `buildRequest(input)` | Gom `ticker` vào `filter`, chuẩn hoá body. |

⚠️ Đường dẫn `options` là tài liệu chính thức; đường **`equities`** đang suy theo
đối xứng và **chưa xác minh** — probe trước khi tin panel giá.

### `vendor/quantdata/client.ts`

| Khai báo | Tác dụng |
|---|---|
| `VendorError` | Mang `status` + `retryable`. |
| `QuantDataClient` | Interface `{ kind, fetch(dataset, args) }`. Mock và live cùng implement ⇒ `index.ts` hoán đổi 1 dòng. |
| `backoffMs(attempt)` | Exponential + full jitter, trần 30s. |
| `LiveQuantDataClient` | 4 lần thử; **mỗi lần đều `acquire()` lại** (retry cũng tốn ngân sách, phải tính đúng); 429 → `penalize` cả bucket; timeout 15s. |
| `.once(url, body)` | Một lần fetch: `POST` + `Bearer`, phân loại lỗi retryable. |

### `vendor/quantdata/mock.ts`

Phát **JSON dạng vendor**, không phải DTO — nên mapper và zod chạy y hệt dev lẫn prod.

| Khai báo | Tác dụng |
|---|---|
| `mulberry32(seed)` | PRNG có seed → phiên mock ổn định giữa các lần poll. |
| `hashString(s)` | FNV-1a, biến `"SPY:2026-08-08"` thành seed. |
| `REFERENCE` | Giá/bước giá/vol tham chiếu từng mã. |
| `sessionMinutes(date, now)` | Số phút đã trôi trong phiên RTH. **Ngoài giờ giao dịch chạy đồng hồ tăng tốc** (seed phút 240, +1 phút phiên mỗi giây thực) — không có nó thì tối nào mock cũng rỗng và không dev được UI. |
| `sessionStartMs(date)` | 13:30Z = 09:30 ET. |
| `MockSession` | Một phiên deterministic cho mỗi `(ticker, date)`. |
| `.barsThrough(now)` | Nến 1 phút, dựng **tăng dần**; có vol smile (mở/đóng cửa sôi động hơn giữa phiên). |
| `.spot(now)` | Close của nến cuối. |
| `.clockMs(now)` | Giờ thực → giờ trong phiên. Tape phải dùng cái này, nếu không tape lệch với biểu đồ giá khi đồng hồ tăng tốc chạy. |
| `.strikes(now)` | Thang strike ±8% quanh **spot hiện tại**. Neo vào giá tham chiếu sẽ lệch thang khi spot trôi → thiên lệch tổng exposure call/put → mất gamma flip. |
| `gammaWeight(k, spot, w)` | Chuông gaussian; chỉ tạo hình dạng, không phải mô hình định giá. |
| `exposureByStrike()` | Call dồn trên spot, put dồn dưới; jitter **dùng chung** cho 2 chân (jitter độc lập làm lật dấu GEX giữa các strike liền kề → hàng chục giao điểm flip giả). |
| `orderFlow()` | Print seed theo bucket 4s ⇒ tape tiến đều, không nhảy loạn. |
| `netDrift()` | Bucket 5 phút, **cộng dồn**. |
| `stockPrice()` | Nến dạng bucket-keyed. |
| `MockQuantDataClient` | Có delay 60–200ms giả lập latency để state loading/stale được exercise thật. |

### `domain/normalize.ts`

Vendor nhận 4 cách viết tên field và trả 2 họ response. Chuẩn hoá **một lần ở đây**.

| Khai báo | Tác dụng |
|---|---|
| `field(row, ...aliases)` | Giá trị đầu tiên tồn tại, thử mỗi alias ở cả 4 cách viết (`strikePrice`/`strike_price`/`STRIKE_PRICE`/`strike-price`). |
| `num` / `str` | Bọc `field` + ép kiểu an toàn (`num` trả `0` nếu thiếu). |
| `toRows(data)` | **Bucket-keyed → mảng đã sort**. Object `{ "<epochMs>": {...} }` thành `[{ __key, ... }]` sort tăng dần. React không bao giờ được duyệt key object và hy vọng đúng thứ tự. |
| `payload(raw)` | Bóc `{ data: … }`, chịu được endpoint trả thẳng payload. |

### `domain/mappers.ts`

**Nơi duy nhất biết tên field vendor.** Vendor đổi tên field ⇒ vỡ đúng một file.

| Hàm | Tác dụng |
|---|---|
| `mapExposureByStrike(raw, ctx)` | → `ExposureProfile`. Đọc strike/greeks/OI, lấy `spot` ở cấp trên cùng, rồi gọi `deriveStructure`. |
| `mapOrderFlow(raw, ctx)` | → `TapeSnapshot`. Validate enum về giá trị an toàn, tự tính `premium` nếu vendor không trả, **sort mới nhất trước**. |
| `mapNetDrift(raw, ctx)` | → `NetDrift`. |
| `mapPrice(raw, ctx)` | → `PriceSeries`. |
| `MAPPERS` | Bảng tra dataset → mapper; scheduler gọi qua bảng này nên thêm dataset không phải sửa scheduler. |

### `domain/derive.ts` — phần "thông minh"

| Khai báo | Tác dụng |
|---|---|
| `DerivedStructure` | `{ callWall, putWall, gammaFlip, regime, netGex }`. |
| `deriveStructure(strikes, spot, convention)` | Suy ra cấu trúc. **Không tính lại gamma** — vendor đã ship exposure có trọng số greek rồi. |
| `interpolateGexSignChange(...)` | Tìm flip. |

Điểm cốt lõi, dễ sửa sai nhất trong repo:

- **Wall và flip đọc từ GEX thô, KHÔNG lật dấu.** Chúng là mức tập trung gamma trong chain; đổi giả định dealer đứng phía nào không làm dịch cấu trúc đó. Đảo dấu toàn series cũng không dịch được điểm đổi dấu.
- **Chỉ nhãn regime phụ thuộc quy ước**, vì chỉ câu hỏi "dealer đang nén hay khuếch đại" mới phụ thuộc phía của họ.
- Bản trước lật dấu **trước khi** tìm wall → đảo luôn phía spot mà mỗi wall được tìm → cả hai wall trả `null` trên chain bình thường. Đừng làm lại.

Công thức flip (có trong tooltip UI):

```
flip = Kᵢ + (0 − GEXᵢ) / (GEXᵢ₊₁ − GEXᵢ) × (Kᵢ₊₁ − Kᵢ)
```

lấy cặp strike liền kề nơi GEX đổi dấu, **gần spot nhất**.

### `bus.ts` — `ChannelBus`

| Method | Tác dụng |
|---|---|
| `publishSnapshot(channel, data)` | Lưu payload đầy đủ + phát. Trả `false` nếu nội dung y hệt lần trước (chỉ reset độ tươi, không tốn băng thông). |
| `publishPatch(channel, delta, merge)` | Phát delta, đồng thời `merge` vào snapshot đang lưu để client vào sau vẫn nhận view đầy đủ. |
| `publishError(channel, message)` | Phát `status` state `error`. **Không xoá snapshot** — panel giữ last-good. |
| `snapshotFrame(channel)` | Frame cho client vừa subscribe, kèm `staleMs` tính tại thời điểm gọi. |
| `subscribe(channel, listener)` | Trả hàm huỷ đăng ký. |
| `bus` | Singleton. |

Chạy in-memory vì v1 là **một process cho một người dùng** — Redis không mua thêm
gì cho tới khi có nhiều process. Interface cố tình đúng hình dạng Redis (get
snapshot / publish / subscribe) nên đổi sang `ioredis` chỉ chạm file này.

### `poller/tiers.ts`

| Khai báo | Tác dụng |
|---|---|
| `TIERS` | Map dataset → `{ priority, intervalMs, label }`. |
| `jitter(ms)` | ±10% — nếu không, các tier trùng pha thành burst đập vào bucket. |
| `marketWindow(now)` | `{ open, extended }`; chặn cuối tuần + ngày lễ. |
| `effectiveInterval(dataset)` | Cadence thực tế. Ngoài RTH hạ về T4. **Không áp cho mock** — mock miễn phí, gate nó thì tối không dev được. |

### `poller/scheduler.ts` — `PollScheduler`

Trái tim của phần "realtime".

| Method | Tác dụng |
|---|---|
| `subscribe(channel)` | Validate + allowlist ticker, tạo job nếu chưa có, `+1` subscriber, huỷ grace timer, **poll ngay lập tức** (nên tab mới không phải chờ hết một tier). Trả `false` nếu từ chối. |
| `unsubscribe(channel)` | `-1`; về 0 thì hẹn dừng sau `SUBSCRIPTION_GRACE_MS` (60s) — chuyển trang không nên trả giá bằng một lần khởi động lạnh. |
| `runNow(job)` | Fetch → map → publish. Breaker mở thì bỏ qua call nhưng giữ vòng lặp sống để còn probe. |
| `schedule(job)` | Hẹn lần kế; lỗi liên tiếp **kéo giãn** interval (`2^n`, trần ×8) để endpoint chết không đốt ngân sách. |
| `publishTape(job, snapshot)` | Tape append-only: chỉ phát print mới hơn `lastPrintTs`, gộp vào buffer và cắt còn 2 000 dòng. |
| `stats()` | Trạng thái limiter + từng job. |
| `shutdown()` | Dọn mọi timer. |

`TAPE_LIMIT = 2000` — ring buffer, ngày sôi động không được phình vô hạn.

**Đây là cơ chế khiến nhiều mã khả thi trong 240/phút:** poll chỉ chạy khi thực sự
có người xem.

### `auth.ts`

Gate 1 user. Nhiệm vụ là giữ deployment riêng tư, **không phải quản lý user** —
nên không đăng ký, không role, không multi-tenant.

| Khai báo | Tác dụng |
|---|---|
| `COOKIE_NAME` | `qam_session`. |
| `user` | Đối tượng user duy nhất, `initials` suy từ `AUTH_NAME`. |
| `hashPassword(pw, salt?)` | scrypt → `"salt:hash"`. Dùng bởi `npm run hash-password`. |
| `verifyPassword(pw)` | So sánh `timingSafeEqual`; fallback `AUTH_DEV_PASSWORD` khi chưa set hash. |
| `authenticate(email, pw)` | **Luôn chạy check mật khẩu** kể cả email sai, để sai-email không nhanh hơn sai-mật-khẩu. |
| `issueToken()` | `base64url(email\|expiresAt) + "." + HMAC`. |
| `verifyToken(token)` | Verify HMAC constant-time + hạn dùng. |
| `cookieOptions` | `httpOnly` (XSS không đọc được phiên), `sameSite=lax`, `secure` khi prod. |

`CLAIM_SEP = '|'`: email chứa dấu chấm nên **không** được dùng `.` làm dấu phân
tách claim — bug này từng làm mọi phiên fail verify.

### `routes/`

| Route | Tác dụng |
|---|---|
| `POST /api/auth/login` | Set cookie. Khoá 60s sau 5 lần sai. |
| `GET /api/auth/me` | Khôi phục phiên khi F5. |
| `POST /api/auth/logout` | Xoá cookie, `204`. |
| `requireAuth(request)` | Helper ném lỗi `statusCode 401`. Dùng cho mọi route dữ liệu. |
| `GET /api/stream?channels=…` | SSE. Xem dưới. |
| `GET /api/health` | Không cần auth — dùng cho probe/uptime. |
| `GET /api/meta` | Danh sách ticker, quy ước dấu, mock/live. Client không hardcode. |
| `GET /api/stats` | Utilization + counter từng job. |

`stream.routes.ts` có 4 điểm đáng chú ý:

1. **Allowlist hai lớp**: `parseChannel` + `TICKER_ALLOWLIST`. Chuỗi người dùng gửi lên không bao giờ thành đường dẫn vendor.
2. Trần `MAX_CHANNELS_PER_CONNECTION = 8`.
3. Heartbeat `: ping` mỗi 15s giữ kết nối qua proxy; `X-Accel-Buffering: no` cấm reverse proxy đệm stream.
4. `cleanup` **idempotent**: `close` và `error` có thể cùng bắn cho một lần ngắt; không có cờ `cleaned` thì lần thứ hai trừ mất subscriber mà kết nối này chưa từng giữ → dừng job người khác đang xem. Chỉ nhả `subscribed[]`, không nhả kênh subscribe thất bại.

### `index.ts`

Thứ tự có ý nghĩa: `setErrorHandler` **phải trước** `register` — mỗi plugin
context chụp lại handler tại thời điểm đăng ký, đặt sau thì plugin vẫn dùng
handler mặc định.

Prod: cùng process serve luôn SPA từ `dist/` + `setNotFoundHandler` fallback
`index.html` cho deep link (nhưng `/api/*` vẫn 404 JSON).

---

## 5. Client — từng file

### `stream/StreamProvider.tsx`

**Một `EventSource` cho cả trang**, mang cả 4 kênh. Mỗi panel mở một kết nối
riêng sẽ nhân bão reconnect và server mất khả năng nhìn chúng như một view.

| Khai báo | Tác dụng |
|---|---|
| `StreamProvider({ ticker, sessionDate })` | Mở stream, gom `data` + `status` theo dataset. |
| `useStream()` | `{ data, status, connected }`. |
| `useChannel(dataset)` | Accessor có type: `useChannel('price')` tự ra `PriceSeries`. |

Ba hành vi quan trọng:

- **Đổi filter ⇒ xoá sạch state** trước khi subscribe lại, để không bao giờ hiện số SPY dưới header QQQ.
- **Phát hiện gap `seq`**: patch đến không đúng `seq+1` ⇒ view đã sai ⇒ đóng EventSource; nó tự reconnect và server gửi snapshot mới.
- Tape merge = prepend rồi cắt `TAPE_LIMIT`.

`DashboardPage` dùng `key={ticker:date}` trên provider — đổi filter là **remount**,
xé kết nối và state mọi panel cùng lúc.

### `auth/`

| File | Tác dụng |
|---|---|
| `AuthContext.tsx` | `AuthProvider` + `useAuth()`. Cookie là nguồn sự thật ⇒ boot lên gọi `/api/auth/me` hỏi server. Không giữ token trong JS. |
| `ProtectedRoute.tsx` | Chưa đăng nhập → `/login`, nhớ `location` để quay lại đúng chỗ. |
| `PublicOnlyRoute.tsx` | Đã đăng nhập thì chặn vào lại `/login`. |

Cả hai guard chờ `initializing` xong mới quyết định — nếu không, F5 sẽ nháy về login.

### `hooks/`

| Hook | Tác dụng |
|---|---|
| `useFilters()` | `{ filters, setFilters }`. **URL search param là nguồn sự thật** nên mọi view chia sẻ và reload được. Ghi bằng `replace: true` để đổi filter không chất đống history. |
| `todaySession()` | `YYYY-MM-DD` hôm nay. |
| `useMeasure<T>()` | `{ ref, width }` qua `ResizeObserver`. SVG vẽ theo pixel thật; scale bằng `viewBox` sẽ làm méo độ dày nét. |

### `lib/`

| Hàm | Tác dụng |
|---|---|
| `api.login/me/logout/meta` | Fetch wrapper. Không gắn token — cookie tự đi kèm vì same-origin cả dev lẫn prod. |
| `ApiError` | Mang `status`. |
| `abbrev(v)` | `24.3M`. Tooltip vẫn giữ số đầy đủ. |
| `fmtPrice` `fmtStrike` `fmtInt` `fmtClock` `fmtHm` `fmtStale` | Định dạng hiển thị. |

### `components/`

| Component | Tác dụng |
|---|---|
| `Panel` | Khung chuẩn: tiêu đề, nhãn tier, badge tình trạng. |
| `StaleBadge` (trong `Panel`) | **Ngưỡng lấy từ tier, không phải đồng hồ cố định**: panel T2 ở 40s là bình thường, panel T0 ở 40s là hỏng. Vàng khi quá 1 cadence, đỏ khi quá 3×. |
| `PanelEmpty` | Trạng thái chờ. |
| `FilterBar` | ticker + sessionDate + regime chip + trạng thái stream + logout. |
| `RegimeChip` | **Pixel giá trị nhất trang**: spot đang ở phía nào của gamma flip. Chữ + dấu mang nghĩa, màu chỉ củng cố. Tooltip ghi rõ `netGex` và quy ước dấu đang áp dụng. |
| `RouteFallback` / `Spinner` | Fallback cho `Suspense` và guard. |

**Panel không bao giờ trắng khi lỗi** — giữ lần render tốt cuối cùng và gắn badge.

### `panels/`

| Panel | Ghi chú kỹ thuật |
|---|---|
| `ExposureProfilePanel` | Bar ngang theo strike, strike tăng dần lên trên như thang giá. Lọc ±6% quanh spot (đuôi chỉ là nhiễu và làm bẹt các bar quan trọng). `useEffect` tự **cuộn canh spot** khi đổi mã, và chỉ khi đổi mã — để không giành cuộn với người dùng ở mỗi lần poll. Chiều cao **cố định**, không phải `min-height`: thang ~90 dòng, không chặn trần thì panel vượt viewport và cuộn nội bộ không bao giờ kích hoạt. Hit target hover full chiều rộng vì bar 11px quá nhỏ để trỏ trúng. |
| `TapePanel` | Virtual hoá bằng `@tanstack/react-virtual`. Chiều cao **cố định** vì virtualizer đặt spacer bằng cả buffer (2 000 × 26px ≈ 52 000px) — không chặn trần thì spacer thành chiều cao document. Flash 150ms chỉ cho dòng **mới đến lượt render này** (`seenRef`), flash cả buffer sẽ nhấp nháy loạn. `heatOpacity` cho premium lớn rail đậm hơn, không phóng to chữ. |
| `NetDriftPanel` | **Hai khung xếp chồng chung một trục x, KHÔNG phải dual-axis.** Premium và giá khác thang; chồng hai trục y cho phép cùng dữ liệu kể bất kỳ câu chuyện nào. Call vẽ **lên**, put vẽ **xuống** — hướng mang nghĩa call/put, không phải màu. |
| `PricePanel` | `lightweight-charts`, tạo instance **một lần** rồi điều khiển imperative; tạo lại mỗi frame sẽ mất zoom của người dùng và đọc như lag. Call Wall / Put Wall / Flip vẽ bằng `createPriceLine` để so trực tiếp trên cùng thang giá. |

### `index.css` — design token

Tailwind v4 `@theme`. Token đặt tên `--color-plane` chứ không phải `--color-base`
vì `text-base` sẽ đụng utility font-size dựng sẵn của Tailwind.

Cặp call/put `#22c55e` / `#ef4444` nằm trong vùng cảnh báo mù màu (deutan ΔE 7.4)
và **không sửa được bằng đổi màu** — làm tối xanh lá còn tụt xuống ΔE 2.5. Vì đây
là quy ước bất di dịch của ngành, màu giữ nguyên và **mã hoá phụ là bắt buộc**:
tape ghi chữ `CALL`/`PUT`, net drift vẽ call lên / put xuống. Không chỗ nào phân
biệt call với put chỉ bằng màu.

---

## 6. Vòng đời một điểm dữ liệu

Ví dụ một print trên tape:

1. `PollScheduler.runNow` tới hạn T0 (4s) cho `qd:order-flow:SPY:2026-08-08`.
2. `LiveQuantDataClient.fetch` → `quantDataLimiter.acquire(0)` → `POST /v1/options/tool/order-flow/consolidated`.
3. `mapOrderFlow` → `TapeSnapshot` (mới nhất trước).
4. `publishTape` lọc print mới hơn `lastPrintTs` → `bus.publishPatch`.
5. `bus` tăng `seq`, merge vào snapshot lưu sẵn, emit.
6. `stream.routes` ghi `data: {...}\n\n` xuống mọi kết nối đang nghe.
7. `StreamProvider.onmessage` kiểm `seq`, prepend, cắt 2 000.
8. `TapePanel` render dòng mới, flash 150ms.

Panel không bao giờ nhận JSON của vendor. Bước 3 là biên giới.

---

## 7. Hai con số là **mô hình**, không phải quan sát

Ghi rõ vì đây là thứ dễ tin nhầm nhất:

**Gamma Flip** — lệch có chủ đích so với mô tả "cumulative GEX crosses zero".
Cách cộng dồn theo strike không cho ra mức neo vào giá: đo trên chain tổng hợp nó
nằm 2–4% trên spot, trượt đơn điệu theo tổng imbalance call/put, và với chain
thiên put (ca index thường gặp) thì **không tồn tại giao điểm nào**. Ở đây flip là
điểm đổi dấu của chính profile GEX.

**`DEALER_SIGN_CONVENTION`** — đảo nhãn regime, và **chỉ** nhãn regime. Nếu quy
ước dấu của vendor ngược lại, đổi biến trong `.env`, không sửa code.

Mọi giá trị suy diễn đều có công thức trong tooltip. Một con số không ai tái lập
được là một khoản nợ.

---

## 8. Chạy & deploy

### Dev

```bash
npm install
cp .env.example .env
npm run dev
```

`concurrently` chạy song song: API `:8000` (`tsx watch`) + Vite `:5173`. Vite proxy
`/api` → `:8000` nên **cùng origin** ở dev, cookie và SSE cư xử y như prod.

Không có `QD_API_KEY` ⇒ `MockQuantDataClient`, **0 đồng API**. Đây là cách nên
dùng để làm UI (gói vendor không có free tier).

> `tsx watch` **chết hẳn** nếu config fail (do `process.exit(1)`). Sửa `.env` sai
> thì phải khởi động lại `npm run dev`, không tự reload.

### Build

```bash
npm run build     # tsc -b (3 project) rồi vite build -> dist/
npm run typecheck # chỉ kiểm kiểu
```

`tsconfig.json` là solution file tham chiếu 3 project: `app` (src+shared, bundler
resolution), `server` (server+shared, NodeNext), `node` (vite.config.ts).

### Production

```bash
npm run build
npm start
```

`npm start` chạy `cross-env NODE_ENV=production` + tsx. Ở prod **một process phục
vụ cả API lẫn SPA** từ `dist/`, deep link fallback về `index.html`, `/api/*` lạ
vẫn trả 404 JSON.

Bắt buộc trước khi mở ra ngoài:

| Biến | Lý do |
|---|---|
| `AUTH_SECRET` | Server **từ chối boot** nếu thiếu — thiếu là mỗi lần restart cookie thành giả mạo được. |
| `AUTH_PASSWORD_HASH` | `npm run hash-password -- "mật khẩu"`; không có thì rơi về `AUTH_DEV_PASSWORD`. |
| `QD_API_KEY` | Không có thì vẫn chạy mock — dễ vô tình deploy bản mock. |
| HTTPS | `cookieOptions.secure` bật theo `isProd`; chạy HTTP thì trình duyệt bỏ cookie. |

Đã smoke test đường prod: SPA serve từ `dist` (200, có `#root`), deep link
`/dashboard` fallback đúng, `/api/health` sống, `/api/nope` → 404 JSON, và boot
thiếu `AUTH_SECRET` bị chặn với exit 1.

Deploy ở đâu cũng được miễn là **một process Node chạy dài** (không phải
serverless per-request — poller và bus là state trong tiến trình). Reverse proxy
phải **không đệm** `text/event-stream`.

---

## 9. Bắt đầu code thêm

### Thêm một panel mới (checklist)

1. `shared/contracts.ts`: thêm vào `DATASETS`, khai báo DTO, thêm vào `DatasetPayload`.
2. `server/vendor/quantdata/endpoints.ts`: thêm vào `TOOLS` — **tên tool phải có trong tài liệu vendor**, không được bịa.
3. `server/domain/mappers.ts`: viết mapper, đăng ký vào `MAPPERS`.
4. `server/poller/tiers.ts`: chọn tier. **Tính lại ngân sách** — có đẩy tổng quá 80% không?
5. `server/vendor/quantdata/mock.ts`: thêm case để dev không cần key.
6. `src/panels/`: viết component, dùng `useChannel('<dataset>')` + `<Panel>`.
7. `src/pages/DashboardPage.tsx`: đặt vào lưới.
8. Cần control mới? Thêm vào `useFilters` — phải serialize được vào URL.

Không phải sửa `scheduler.ts`, `bus.ts`, `stream.routes.ts` — chúng generic theo
`DatasetId`.

### Ngân sách hiện tại

| Tier | Cadence | Dataset | req/phút |
|---|---|---|---|
| T0 | 4s | `order-flow` | 15.0 |
| T1 | 20s | `net-drift` | 3.0 |
| T1 | 20s | `price` | 3.0 |
| T2 | 90s | `exposure-by-strike` | 0.7 |
| | | **tổng / 1 mã** | **~21.7** |

→ ~10 mã đồng thời trước trần 240. Xem số thật ở `GET /api/stats`.

> Ở chế độ mock, `utilizationPct` luôn 0 vì mock không đi qua limiter. Chỉ có ý
> nghĩa khi chạy live.

### Việc đã hoãn có chủ đích

Heat map, IV surface, term structure, max pain, open interest, dark pool levels,
market scanner, replay mode, alerts, multi-ticker layout, provider registry cho
nguồn thứ hai. Chưa build, không phải quên.

### Trước khi tin dữ liệu live — probe checklist

- [ ] Xác minh đường dẫn **equities** (`/v1/equities/tool/stock-price-over-time`) — đang suy theo đối xứng.
- [ ] Ghi response thô cả 4 endpoint thành fixture; shape trong `mock.ts` là **mô hình hoá**, chưa xác minh với vendor.
- [ ] Đối chiếu Call Wall / Put Wall / Flip với dữ liệu thật.
- [ ] Chỉnh `DEALER_SIGN_CONVENTION` nếu regime hiện ngược.

Mapper đã chịu được cả 4 cách viết tên field và cả 2 họ response, nên sai khác nhỏ
về shape sẽ không làm vỡ UI.

---

## 10. Bẫy đã gặp — đừng đạp lại

| Bẫy | Hậu quả |
|---|---|
| Đặt tên biến port là `PORT` | API tranh socket với Vite ở dev. |
| Dùng `.` phân tách claim trong token | Email chứa dấu chấm ⇒ mọi phiên fail verify. |
| `setErrorHandler` sau `register` | Plugin dùng handler mặc định, response sai format. |
| Zod `.min(1)` cho biến optional trong `.env` | `QD_API_KEY=` rỗng làm server exit. |
| Lật dấu trước khi tìm wall | Cả hai wall trả `null`. |
| `min-height` cho panel có virtual scroll | Document cao 51 000px. |
| Jitter độc lập cho call/put OI trong mock | GEX lật dấu giữa các strike liền kề, hàng chục flip giả. |
| Thang strike neo vào giá tham chiếu | Lệch thang khi spot trôi, mất gamma flip. |
| `cleanup` SSE không idempotent | Trừ nhầm subscriber, dừng job người khác đang xem. |
