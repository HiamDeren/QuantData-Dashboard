# QuantAM — GEX Flow Dashboard

Dashboard options flow / dealer exposure (lớp GexRadar · Quant Data) chạy trên
Quant Data REST API. **Một project, một `package.json`, một lệnh chạy** — server
và client nằm chung folder.

```bash
npm install
cp .env.example .env
npm run dev
```

→ http://localhost:5173 · `demo@quantam.io` / `quantam123`

Không có `QD_API_KEY` thì server tự chạy `MockQuantDataClient`: toàn bộ UI hoạt
động đầy đủ với **0 đồng API**. Đây là mặc định, và là cách nên dùng để phát
triển giao diện (gói vendor không có free tier).

---

## Tại sao không phải SPA gọi thẳng vendor

Câu hỏi "gộp chung 1 folder, kể cả phần lấy dữ liệu từ QuantData" gộp được, nhưng
**không** theo kiểu browser gọi thẳng API. Ba ràng buộc bắt buộc phải có server:

| Ràng buộc | Hệ quả |
|---|---|
| API key là `Bearer qd_…` | Đưa vào bundle là lộ key cho bất kỳ ai mở DevTools. Key chỉ được nằm server-side. |
| Quant Data **chỉ có REST, không có WebSocket** | "Realtime" phải tự tổng hợp: một poller server-side duy nhất → fan-out cho browser. |
| **240 request/phút**, dùng chung cho mọi panel | N tab mở = N× request nếu browser tự gọi. Phải có một chỗ duy nhất giữ ngân sách. |
| Licence: cá nhân, không phân phối lại | Không được để dữ liệu vendor lộ ra ngoài deployment riêng tư. |

```
Quant Data REST ──poll──▶ PollScheduler ──▶ mapper ──▶ ChannelBus (snapshot + pub/sub)
                          (token bucket)                      │
                                                              ▼
                                                     SSE  /api/stream
                                                              │
                                                              ▼
                                                        Browser (N tab)
```

---

## Cấu trúc

```
shared/contracts.ts     DTO + giao thức frame — module DUY NHẤT cả 2 phía cùng import
server/
  config.ts             env qua zod, fail-fast
  auth.ts               gate 1 user: scrypt + cookie HMAC httpOnly
  bus.ts                snapshot nóng + pub/sub (hình dạng Redis, chạy in-memory)
  vendor/
    limiter.ts          token bucket 240/phút, có ưu tiên theo tier
    quantdata/
      client.ts         POST + retry backoff-jitter, 429 phạt cả bucket
      endpoints.ts      dataset → tên tool vendor (allowlist)
      mock.ts           MockQuantDataClient — phát JSON dạng vendor
  domain/
    normalize.ts        chuẩn hoá 4 cách viết tên field + 2 họ response
    mappers.ts          1 mapper / endpoint — nơi DUY NHẤT biết tên field vendor
    derive.ts           Call Wall / Put Wall / Gamma Flip / regime
  poller/
    tiers.ts            cadence T0–T4 + cổng giờ giao dịch
    scheduler.ts        poll theo subscription, breaker, grace TTL
  routes/               auth · stream (SSE) · meta/health/stats
src/
  stream/               1 EventSource cho cả trang, phát hiện gap seq
  panels/               4 panel v1
  components/           Panel shell, FilterBar, RegimeChip
```

---

## Ngân sách 240 req/phút

Cadence đặt theo **half-life thật** của từng dataset, không theo cảm giác "cho
nó realtime". Refresh cả trang 5s là 96 req/phút cho **một** mã — hai mã là chết.

| Tier | Cadence | Dataset | req/phút |
|---|---|---|---|
| T0 | 4s | `order-flow/consolidated` | 15.0 |
| T1 | 20s | `net-drift` | 3.0 |
| T1 | 20s | `stock-price-over-time` | 3.0 |
| T2 | 90s | `exposure-by-strike` | 0.7 |
| | | **tổng / 1 mã** | **~21.7** |

→ khoảng **10 mã đồng thời** trước khi chạm trần. Bốn cơ chế giữ trần:

1. Token bucket tập trung, refill liên tục — không request nào đi vòng.
2. Hàng đợi ưu tiên: T0 rút trước, T3/T4 nhường khi nghẽn.
3. **Chỉ poll khi có ít nhất 1 client đang subscribe** (+60s grace).
4. Ngoài giờ RTH hạ hết về T4. *Không áp cho mock — mock miễn phí.*

Xem số thực tế: `GET /api/stats` (utilization, số poll, breaker).

---

## Panel v1

| Panel | Endpoint | Tier |
|---|---|---|
| Dealer Exposure Profile — Call Wall / Put Wall / Gamma Flip | `exposure-by-strike` | T2 |
| Live Options Tape | `order-flow/consolidated` | T0 |
| Net Premium Drift | `net-drift` | T1 |
| Giá + mức Gamma | `stock-price-over-time` | T1 |

Filter bar v1: **ticker + sessionDate**, cả hai nằm trong URL nên view chia sẻ và
reload được. Hoãn có chủ đích: heat map, IV surface, max pain, OI, dark pool,
scanner, replay, alert, multi-ticker.

---

## Hai con số cần kiểm chứng trước khi tin

Mọi giá trị suy diễn đều có công thức trong tooltip. Hai chỗ là **mô hình, không
phải quan sát** — README ghi rõ để bạn kiểm lại khi có key thật:

**1. Gamma Flip — lệch có chủ đích so với mô tả "cumulative GEX crosses zero".**
Cách cộng dồn theo strike không cho ra một mức neo vào giá: đo trên chain tổng
hợp nó nằm **2–4% trên spot** và trượt đơn điệu theo tổng imbalance call/put, và
với chain thiên put (trường hợp index thường gặp) thì **không tồn tại giao điểm
nào**. Ở đây flip là điểm đổi dấu của **chính profile GEX theo strike**, nội suy
tuyến tính, lấy giao điểm gần spot nhất:

```
flip = Kᵢ + (0 − GEXᵢ) / (GEXᵢ₊₁ − GEXᵢ) × (Kᵢ₊₁ − Kᵢ)
```

Chỉ dùng GEX per-strike của vendor, không cần mô hình định giá, và đúng bằng mức
mà biểu đồ đang vẽ.

**2. `DEALER_SIGN_CONVENTION` đảo nhãn regime.** Mặc định `dealer-short-calls`
(giả định retail chuẩn). Wall và flip **không** phụ thuộc quy ước — chúng là mức
tập trung gamma trong chain, và đảo dấu toàn bộ series không làm dịch điểm đổi
dấu. Chỉ **nhãn regime** đảo, vì chỉ câu hỏi "dealer đang nén hay khuếch đại" mới
phụ thuộc phía của họ. Nếu quy ước dấu của vendor ngược lại, đổi biến này trong
`.env` — không phải sửa code.

---

## Nối vào Quant Data thật

1. Điền `QD_API_KEY` vào `.env`, restart. Poller tự chuyển sang `LiveQuantDataClient`.
2. **Probe checklist** — chạy một lần trong ngày đầu có subscription:
   - Đường dẫn `POST /v1/options/tool/<tool>` là tài liệu chính thức. Đường dẫn
     **equities** (`/v1/equities/tool/stock-price-over-time`) đang suy ra theo
     đối xứng, **chưa xác minh** — probe trước khi tin panel giá.
   - Ghi lại response thô của cả 4 endpoint thành fixture. Shape trong
     `mock.ts` là **mô hình hoá**, không phải shape vendor đã xác minh.
   - Đối chiếu Call Wall / Put Wall / Flip với dữ liệu thật; chỉnh
     `DEALER_SIGN_CONVENTION` nếu regime ngược.

Mapper đã chịu được cả 4 cách viết tên field (`STRIKE_PRICE` = `strikePrice` =
`strike_price` = `strike-price`) và cả 2 họ response (bucket-keyed / row array),
nên sai khác nhỏ về shape sẽ không làm vỡ UI.

---

## Bảo mật

- Key vendor **chỉ ở server**. Không có biến `VITE_*` nào chứa secret.
- `/api/stream` **allowlist** cả dataset lẫn ticker — chuỗi người dùng gửi lên
  không bao giờ trở thành đường dẫn vendor.
- Session là **cookie httpOnly** ký HMAC. Không có token trong `localStorage`,
  nên XSS không lấy được phiên.
- Login khoá 60s sau 5 lần sai; so sánh mật khẩu constant-time.
- Production **bắt buộc** `AUTH_SECRET` (server từ chối boot nếu thiếu) và
  `AUTH_PASSWORD_HASH` (`npm run hash-password -- "mật khẩu"`).

---

## Palette biểu đồ

Chạy qua validator trên nền panel `#111621`:

| Vai trò | Hex | Kết quả |
|---|---|---|
| Gamma dương | `#3b82f6` | pass toàn bộ (CVD ΔE 30.5) |
| Gamma âm | `#ea580c` | pass toàn bộ |
| Call flow | `#22c55e` | **deutan ΔE 7.4** |
| Put flow | `#ef4444` | **deutan ΔE 7.4** |

Cặp xanh-đỏ call/put nằm trong vùng warn và **không sửa được bằng đổi màu** —
làm tối xanh lá còn tụt xuống ΔE 2.5. Vì đây là quy ước bất di dịch của ngành,
màu được giữ nguyên và **mã hoá phụ là bắt buộc ở mọi chỗ**: tape ghi rõ chữ
`CALL`/`PUT`, net drift vẽ call lên trên / put xuống dưới. Không chỗ nào phân
biệt call với put chỉ bằng màu.

---

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | server (`:8000`) + client (`:5173`) song song |
| `npm run build` | typecheck 3 project rồi build SPA vào `dist/` |
| `npm start` | production: một process phục vụ cả API lẫn SPA |
| `npm run typecheck` | chỉ kiểm tra kiểu |
| `npm run hash-password -- "…"` | sinh `AUTH_PASSWORD_HASH` |

`API_PORT` cố tình **không** đặt tên `PORT`: harness dev và PaaS hay inject
`PORT` cho thứ mà chúng coi là "app", mà ở dev thứ đó là Vite — trùng tên là API
sẽ tranh socket với Vite.

---

Công cụ cá nhân, một người dùng, không thương mại. Không phải khuyến nghị đầu tư.
