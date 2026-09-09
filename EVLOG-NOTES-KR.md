# evlog 스터디 & 사업 검토 노트 (한국어)

> evlog 저장소를 처음 받아본 사람이 "이게 뭐고, 어떻게 쓰고, 이걸로 뭘 할 수 있나"를
> 한 번에 파악하기 위한 정리 문서.

## 관련 링크

| 구분 | 주소 |
| --- | --- |
| 원본 저장소 (upstream) | https://github.com/evloghq/evlog |
| 내 포크 | https://github.com/bmshin94/evlog |
| 공식 문서 | https://evlog.dev |
| npm - 본체 | https://www.npmjs.com/package/evlog |
| npm - CLI | https://www.npmjs.com/package/@evlog/cli |
| npm - 텔레메트리 | https://www.npmjs.com/package/@evlog/telemetry |
| 제작자 | https://github.com/HugoRCD |
| 영감이 된 글 (Logging Sucks) | https://loggingsucks.com/ |

라이선스: MIT

---

## 1. evlog가 뭔가

TypeScript 로깅 라이브러리. 한 줄로 요약하면 **로그를 "쪽지 여러 장" 대신 "영수증 한 장"으로 남기게 해주는 도구**다.

### 기존 방식의 문제

```typescript
console.log('Request received')
console.log('User:', user.id)
console.log('Cart loaded')
console.log('Payment failed')   // 장애 시각에 이 줄을 찾아내야 한다
throw new Error('Something went wrong')
```

요청 하나가 로그 10줄을 남기고, 다른 요청 로그와 섞인다. 장애가 나면 흩어진 줄을 다시 이어 붙이는 것부터 시작해야 한다.

### evlog 방식 — Wide Event

요청이 진행되는 동안 컨텍스트를 쌓아두었다가, 요청이 끝날 때 **이벤트 하나로 한 번에** 내보낸다.

```typescript
export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  log.set({ user: { id: user.id, plan: 'premium' } })
  log.set({ cart: { items: 3, total: 9999 } })
  log.error(error, { step: 'payment' })
  // 요청 종료 시 자동으로 emit
})
```

출력 (요청 1건 = 이벤트 1건):

```json
{
  "timestamp": "2026-01-24T10:23:45.612Z",
  "level": "error",
  "service": "my-app",
  "method": "POST",
  "path": "/api/checkout",
  "duration": "1.2s",
  "durationMs": 1204,
  "user": { "id": "123", "plan": "premium" },
  "cart": { "items": 3, "total": 9999 },
  "error": { "message": "Card declined", "step": "payment" }
}
```

개발 중에는 트리 형태로 예쁘게, 프로덕션에서는 JSON으로 나간다.

```
16:45:31.060 INFO [my-app] GET /api/checkout 200 in 234ms
  |- user: id=123 plan=premium
  |- cart: items=3 total=9999
  +- payment: id=pay_xyz method=card
```

### 설계 철학 4가지

1. **Wide Events** — 요청 하나에 로그 하나, 컨텍스트 전부
2. **Structured Errors** — 에러가 스스로를 설명한다
3. **Request Scoping** — 컨텍스트를 모았다가 한 번에 내보낸다
4. **Pretty for Dev, JSON for Prod** — 로컬은 사람이, 프로덕션은 기계가 읽는다

---

## 2. 저장소 구조

이건 완성된 앱이 아니라 **라이브러리 소스(pnpm 모노레포)** 다.

```
packages/evlog/       본체 (로거, 에러, 파이프라인, 리댁션)
  src/adapters/       로그 전송 대상 11종
  src/enrichers/      기본 인리처 (UserAgent, Geo, RequestSize, TraceContext)
  src/<framework>/    프레임워크별 통합
packages/cli/         @evlog/cli — init / map / doctor / agents
packages/telemetry/   @evlog/telemetry — CLI 도구용 텔레메트리
packages/nuxthub/     @evlog/nuxthub
apps/docs/            문서 사이트 (Docus)
apps/telemetry/       텔레메트리 대시보드
apps/playground/      개발용 플레이그라운드
examples/             프레임워크별 실행 가능한 예제 20개
skills/               공개 Agent Skill (analyze-logs, build-audit-logs, review-logging-patterns)
.agents/skills/       내부 기여자용 스킬 (create-adapter, create-enricher 등)
```

### 지원 프레임워크

Nuxt, Nitro(v2/v3), Next.js, SvelteKit, NestJS, Express, Fastify, Elysia, Hono, oRPC,
React Router, TanStack Start, Cloudflare Workers, Vite, better-auth, eve

### 어댑터 (로그 전송 대상) 11종

Axiom, OTLP(OpenTelemetry), Datadog, Sentry, PostHog, Better Stack, HyperDX,
Loki, ClickHouse, 파일시스템(fs), 메모리

---

## 3. 설치와 사용법

### 3-1. 설치

자동 (권장):

```bash
npx @evlog/cli init          # 프레임워크 감지 + 설치 + 설정까지
npx @evlog/cli init --dry-run  # 파일을 건드리지 않고 계획만 출력
```

수동:

```bash
pnpm add evlog   # 또는 npm install evlog / yarn add evlog / bun add evlog
```

TypeScript 5.0 이상 필요.

### 3-2. 프레임워크 연결

**Nuxt**

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['evlog/nuxt'],
  evlog: {
    env: { service: 'my-app' },
  },
})
```

`useLogger`, `parseError`는 자동 임포트. 단 `createError`는 반드시 `evlog`에서 직접 임포트해야 한다
(Nuxt 기본 `createError`는 `why` / `fix` / `link`를 버린다).

**Express**

```typescript
import express from 'express'
import { initLogger } from 'evlog'
import { evlog } from 'evlog/express'

initLogger({ env: { service: 'express-api' }, pretty: true })

const app = express()
app.use(evlog())

app.get('/users/:id', (req, res) => {
  req.log.set({ user: { id: req.params.id } })
  res.json({ ok: true })
})
```

**Hono**

```typescript
import { Hono } from 'hono'
import { initLogger } from 'evlog'
import { evlog, type EvlogVariables } from 'evlog/hono'

initLogger({ env: { service: 'hono-api' } })

const app = new Hono<EvlogVariables>()
app.use(evlog())

app.get('/users/:id', (c) => {
  c.get('log').set({ user: { id: c.req.param('id') } })
  return c.json({ ok: true })
})
```

**Next.js (App Router)**

```typescript
// lib/evlog.ts
import { createEvlog } from 'evlog/next'

export const { withEvlog, useLogger, log, createError } = createEvlog({
  service: 'my-app',
})
```

```typescript
// app/api/hello/route.ts
import { withEvlog, useLogger } from '@/lib/evlog'

export const GET = withEvlog(async () => {
  const log = useLogger()
  log.set({ action: 'hello' })
  return Response.json({ message: 'Hello!' })
})
```

**그 외**

```typescript
await app.register(evlog)                        // Fastify  → request.log
new Elysia().use(evlog())                        // Elysia   → ({ log })
@Module({ imports: [EvlogModule.forRoot()] })    // NestJS   → useLogger()
```

**프레임워크 없는 스크립트 / 배치**

```typescript
import { initLogger, createLogger } from 'evlog'

initLogger({ env: { service: 'sync-worker' } })

const log = createLogger({ jobId: 'sync-001', source: 'postgres' })
log.set({ recordsSynced: 150 })
log.emit()   // 스크립트에서는 emit()을 직접 호출해야 한다
```

> 프레임워크 통합을 쓰면 요청 종료 시 `emit()`이 자동. 스크립트에서는 수동.

### 3-3. 핵심 API 3개

**① `log` — console.log 대체**

```typescript
import { log } from 'evlog'

log.info('auth', 'User logged in')                        // 태그 스타일
log.error({ action: 'payment', error: 'card_declined' })  // 구조화 스타일
```

**② `log.set()` — 컨텍스트 누적 (핵심)**

```typescript
const log = useLogger(event)

log.set({ user: { id: user.id, plan: user.plan } })
log.set({ cart: { items: cart.length, total: 9900 } })
log.set({ orderId: order.id })
// 요청 종료 시 위 내용이 전부 합쳐져 이벤트 하나로 나간다
```

**③ `createError()` — 스스로 설명하는 에러**

```typescript
import { createError } from 'evlog'

throw createError({
  message: '결제에 실패했습니다',
  status: 402,
  why: '카드사에서 거절함',
  fix: '다른 카드로 시도하거나 카드사에 문의',
  link: 'https://docs.example.com/payments/declined',
})
```

프론트에서 받기:

```typescript
import { parseError } from 'evlog'

catch (err) {
  const error = parseError(err)
  toast.add({ title: error.message, description: error.why })
}
```

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `message` | O | 무슨 일이 일어났는지 (사용자용) |
| `status` | X | HTTP 상태 코드 (기본 500) |
| `why` | X | 기술적 원인 (디버깅용) |
| `fix` | X | 해결 방법 |
| `link` | X | 참고 문서 URL |
| `cause` | X | 원본 에러 |
| `internal` | X | 서버 로그 전용, HTTP 응답에는 포함되지 않음 |

### 3-4. 로그를 파일로 저장하기

기본은 터미널 출력만 된다. 파일로 남겨야 나중에 분석할 수 있다.

```typescript
// Nuxt / Nitro — server/plugins/evlog-drain.ts
import { createFsDrain } from 'evlog/fs'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('evlog:drain', createFsDrain())
})
```

```typescript
// Express / Hono
app.use(evlog({ drain: createFsDrain() }))

// 스크립트
initLogger({ env: { service: 'my-script' }, drain: createFsDrain() })
```

`.evlog/logs/` 아래에 날짜별 NDJSON(`.jsonl`)으로 쌓인다. `.gitignore`에 `.evlog/` 추가할 것.

읽어들이는 방법도 제공된다.

| 방법 | 용도 |
| --- | --- |
| `readFsLogs()` | 과거 로그 replay |
| `tailFsLogs()` | 실시간 follow (tail -f) |
| SSE 스트림 서버 | 실시간 대시보드 |

### 3-5. AI 에이전트 연동

```bash
npx skills add https://www.evlog.dev
```

Claude Code / Cursor 등이 evlog 규약을 학습한다. 이후 "이 엔드포인트에 로깅 추가해줘",
"로그 보고 왜 느린지 분석해줘" 같은 지시가 통한다. `.evlog/logs/`를 직접 읽고 분석할 수 있다.

### 3-6. 자주 쓰는 옵션

```typescript
initLogger({
  env: { service: 'my-app', environment: 'production', version: '1.0.0' },
  pretty: true,              // 개발용 트리 출력, false면 JSON
  include: ['/api/**'],      // 이 경로만 로깅

  sampling: {
    rates: { info: 10 },     // info 로그는 10%만 저장 (비용 절감)
    keep: [
      { duration: 1000 },            // 1초 이상 걸린 요청은 무조건 저장
      { status: 400 },               // 400 이상 응답도 무조건 저장
      { path: '/api/payment/**' },   // 결제 경로도 무조건 저장
    ],
  },
})
```

평소에는 샘플링으로 비용을 줄이고, 문제 있는 요청만 100% 남기는 구조.

### 3-7. CLI

```bash
npx @evlog/cli map       # 관측 점수 측정 (Lighthouse for wide events)
npx @evlog/cli doctor    # 설치/설정 진단
npx @evlog/cli agents    # AGENTS.md에 로깅 규약 작성
```

`evlog map`은 소스를 정적 분석해 엔트리포인트를 `instrumented` / `partial` / `dark`로 분류하고
점수를 매긴다. `--min-score <n>`으로 CI 게이트를, `--baseline`으로 회귀 차단을 걸 수 있다.
지원 프레임워크는 `nuxt`, `nitro`, `next`, `tanstack-start` 4종.

### 3-8. 이 저장소 자체를 돌려보기

```bash
corepack enable
pnpm install
pnpm run dev:prepare     # 필수. 생략하면 lint / typecheck가 실패한다

pnpm run docs            # 문서 사이트 로컬 실행
pnpm run dev             # 플레이그라운드
pnpm run test            # 테스트 (약 1.5초)
pnpm example             # examples/ 중 골라서 실행
```

---

## 4. 사용 판단 기준

**쓰면 좋은 경우**

- Nuxt / Next / Hono 등으로 API 서버, 백엔드를 만들 때
- 프로덕션에서 특정 요청만 실패하는 원인을 추적해야 할 때
- 결제, 주문, 동기화처럼 한 요청에 여러 단계가 있는 로직
- LLM 기능이 있어 토큰 비용 추적이 필요할 때
- 관리자 기능이 있어 "누가 무엇을 바꿨나" 기록이 필요할 때

**굳이 필요 없는 경우**

- 혼자 쓰는 토이 프로젝트, 짧은 스크립트
- 순수 프론트엔드만 있는 프로젝트
- 이미 OpenTelemetry를 풀세팅했고 만족 중일 때

**도입 방식**

한 번에 전부 바꾸지 않아도 된다. `console.log`를 쓰는 라우트와 `log.set()`을 쓰는 라우트가
공존해도 문제없다. 가장 최근에 디버깅으로 고생한 핸들러 하나부터 시작하고,
어디부터 손댈지 모르겠으면 `evlog map`이 순위를 매겨준다.

---

## 5. 수익화 아이디어 검토

### 대전제

1. **라이브러리 자체로는 돈이 안 된다.** MIT라 누구나 무료로 쓴다. 수익은 그 위에 얹는
   저장 / 검색 / 증빙 / 협업 레이어에서 나온다.
2. **포크해서 이름만 바꿔 파는 건 하지 않는다.** 법적으론 가능하지만 업스트림을 따라가지 못하고
   커뮤니티 신뢰를 잃는다. 경쟁재가 아니라 보완재를 만든다.
3. **원저자(HugoRCD)와 적대하지 않는다.** GitHub Sponsors도 열려 있고 개발이 활발하다.

### 티어 1 — 오늘 시작 가능, 리스크 낮음

| # | 아이디어 | 근거 | 현실 수익 | 준비 기간 |
| --- | --- | --- | --- | --- |
| 1 | 한국어 콘텐츠 / 강의 | 국내에 wide event 한국어 자료가 거의 없다. `apps/docs/content/8.compare/`에 pino / OTel / logtape / winston / consola 비교 문서가 이미 있어 소재로 쓸 수 있다 | 월 0~200만원 | 1주 |
| 2 | 로깅 구축 컨설팅 | `evlog map` 점수가 before / after를 숫자로 증명한다. 문서의 비용 계산 근거(바이트 56% 감소, 이벤트 75% 감소)도 결정권자 설득에 쓰인다 | 건당 200~800만원 | 2~4주 |
| 3 | 어댑터 기여 | `examples/community-adapter-skeleton/`과 `.agents/skills/create-adapter/` 템플릿이 있다. 어댑터 11종 중 한국 벤더가 없다 | 직접 수익 0, 신뢰 자산 | 주말 2회 |

### 티어 2 — 실제 제품, 중간 난이도

| # | 아이디어 | 근거 | 현실 수익 | MVP 기간 |
| --- | --- | --- | --- | --- |
| 4 | **감사로그 SaaS (최우선 추천)** | `log.audit()`, `auditDiff()`, `signed()` 해시체인 / HMAC, `auditOnly()`, `auditRedactPreset` 등 프리미티브가 이미 완성돼 있다. 국내 B2B SaaS는 ISMS-P / 개인정보보호법 때문에 감사로그가 사실상 의무고, 컴플라이언스는 예산이 잡혀 있는 항목이라 결제 저항이 낮다. 남는 일은 저장 + 검색 UI + 증빙 리포트 + 보관기간 관리 | 월 10~50만원 × 고객사 | 2~3개월 |
| 5 | LLM 비용 대시보드 | `evlog/ai`가 `inputTokens`, `outputTokens`, `cacheReadTokens`, `model`, `toolCalls`, `msToFirstChunk`, `getEstimatedCost()`까지 캡처한다. 차별점은 요청 wide event 안에 AI 메타가 함께 들어간다는 점. 다만 Langfuse / Helicone과 경쟁 | 월 3~20만원 × 팀 | 1~2개월 |
| 6 | evlog map SaaS (Codecov for logs) | `--json` 출력이 `schemaVersion` 붙은 안정 계약이고 `--baseline`도 있다. GitHub App으로 PR 점수 코멘트 + 회귀 차단. 단 개발자 도구는 유료 전환이 어렵다 | 낮음 | 3~4주 |

### 티어 3 — 권하지 않음

7. **자체 호스팅 백엔드 (Axiom 대항)** — ClickHouse 어댑터가 있어 기술적으론 가능하고
   국내 리전 / 원화 결제 / 한국어 지원이라는 틈도 있다. 하지만 로그 스토리지는 고정비가 크고,
   경쟁사는 자금력이 압도적이다. 팀과 투자가 있을 때만.

### 권장 루트

```
1단계  기술 블로그 5편 (2주)          → 신뢰 확보, 내 이해도 검증
2단계  컨설팅 1건 수주 (1~2개월)      → 현금 확보 + 고객의 진짜 통증 발견
3단계  반복되는 문제를 제품화 (3개월)  → 아마 감사로그
4단계  SaaS
```

컨설팅 단계는 돈벌이보다 **시장조사**가 목적이다. 이걸 건너뛰고 바로 제품을 만들면
아무도 원하지 않는 걸 만들 확률이 높다.

### 코드를 쓰기 전에 할 일

개발자 / CTO 5명에게 물어본다.

> "감사로그 어떻게 관리하세요? 만드는 데 얼마나 걸렸어요? 월 10만원이면 사시겠어요?"

3명 이상이 통증을 호소하면 진행, 반응이 미지근하면 다음 아이디어로 넘어간다.

---

## 6. React / PHP로 만들 수 있는가

질문을 두 개로 분리해야 한다.

| 질문 | 답 |
| --- | --- |
| 제품(대시보드 / SaaS)을 React / PHP로 만들 수 있나 | 둘 다 가능 |
| 내 React / PHP 앱에서 evlog를 쓸 수 있나 | React 계열은 가능, PHP는 불가 |

### React — 가능

**대시보드 UI**: evlog 출력은 JSON이라 화면은 무엇으로 만들든 상관없다.
문서(`6.extend/3.consumer-recipes.md`)에 바닐라 JS 대시보드 예제가 통째로 들어 있어
`EventSource` 부분을 `useEffect`로 옮기면 그대로 React 컴포넌트가 된다.

```javascript
const es = new EventSource(STREAM_URL)
es.onmessage = (e) => {
  const env = JSON.parse(e.data)
  if (env.evlog !== '1') return
  // env.data 가 wide event
}
```

**서버**: React 자체는 서버가 아니므로 서버 프레임워크가 필요하다.

| 스택 | evlog 지원 | 비고 |
| --- | --- | --- |
| Next.js | `evlog/next` 1급 지원 | 권장. `evlog map`도 지원 |
| React Router v7 | `evlog/react-router` | `v8_middleware: true` 필요 |
| TanStack Start | Nitro v3 경유 | 지원 |
| React(Vite) 단독 | 없음 | 별도 백엔드 필요 |

### PHP — 라이브러리는 불가, 제품은 가능

evlog는 TypeScript / JavaScript 전용이다. Node, Bun, Cloudflare Workers, 브라우저에서만 동작하고
PHP 포트는 없다.

다만 evlog가 내보내는 건 JSON 한 줄이므로, **수집 / 저장 / 조회 쪽은 언어가 무엇이든 상관없다.**

```
[고객의 Node 앱] --evlog--> JSON
                              ↓
                    [Laravel 수집 API]
                              ↓
                    [MySQL / ClickHouse]
                              ↓
                    [Laravel 대시보드]
```

PHP 앱 자체에서 wide event를 남기고 싶다면 개념만 가져와 직접 구현한다.
Laravel이면 미들웨어 하나로 끝난다.

```php
// app/Http/Middleware/WideEvent.php
class WideEvent
{
    private array $event = [];
    private float $start;

    public function handle($request, Closure $next)
    {
        $this->start = microtime(true);
        app()->instance('wide_event', $this);
        return $next($request);
    }

    public function set(array $fields): void
    {
        $this->event = array_replace_recursive($this->event, $fields);
    }

    public function terminate($request, $response): void
    {
        $payload = array_merge([
            'timestamp'  => now()->toIso8601String(),
            'service'    => config('app.name'),
            'method'     => $request->method(),
            'path'       => $request->path(),
            'status'     => $response->status(),
            'durationMs' => (int) ((microtime(true) - $this->start) * 1000),
        ], $this->event);

        file_put_contents(
            storage_path('logs/wide.jsonl'),
            json_encode($payload) . PHP_EOL,
            FILE_APPEND
        );
    }
}
```

직접 구현하면 잃는 것:

- 어댑터 11종
- **감사로그 해시체인 / HMAC 서명** (감사로그 SaaS의 핵심 무기)
- 샘플링, 민감정보 마스킹(redact)
- `evlog map` 점수 (PHP 미지원)
- AI SDK 토큰 / 비용 추적
- TypeScript 타입 안전성

### 결론

| 상황 | 선택 |
| --- | --- |
| React / TS가 편하다 | Next.js 단일 스택 |
| PHP / Laravel이 훨씬 빠르다 | Laravel 앱 + Node 수집기 하이브리드 |
| 감사로그 SaaS를 만든다 | Node 계열 (evlog 자산 재사용) |
| 단순 대시보드만 만든다 | PHP도 문제없음 |
| 팀에 PHP 개발자뿐이다 | PHP (스택보다 속도가 중요) |

evlog를 지렛대로 쓰는 게 목적이라면 Node / TypeScript 계열이 압도적으로 유리하다.
PHP로 가면 evlog는 참고 자료가 되고, "제품의 절반이 이미 만들어져 있다"는 장점이 사라진다.

초기에 스택 2개(PHP + Node)를 동시 운영하는 건 권하지 않는다. 배포, 모니터링, 디버깅이 모두 두 배가 된다.
하나로 시작하고 필요할 때 쪼개는 편이 낫다.
