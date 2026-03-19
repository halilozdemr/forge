# Forge v3 — WebUI Geliştirme Planı

## 1. Hedef ve Kapsam

v1'deki statik HTML dashboard (755 satır, v2'de yok) v3'te **canlı veri** gösteren tam fonksiyonlu bir yönetim paneline dönüşüyor. Kullanıcı terminal açmadan:

- Agent işe al / işten çıkar / duraklat
- Issue oluştur, pipeline başlat
- Aktif queue job'larını izle
- Sprint yönet
- Bütçe durumunu gör

---

## 2. Teknik Tercih: Vanilla TS + Vite (SPA)

| Seçenek | Artı | Eksi | Karar |
|---------|------|------|-------|
| Tek HTML dosyası (v1 tarzı) | Sıfır build | Karmaşıklık → spaghetti; no type safety | ✗ |
| React + Vite | Ekosistem, component izolasyonu | Overhead, paket boyutu | ✗ |
| **Vanilla TS + Vite** | Minimal bağımlılık, tam type safety, hızlı build, v3 ile aynı dil | Manuel state yönetimi | ✓ |
| HTMX + Fastify SSR | Progressive enhancement | Fastify template engine kurmak gerekir | ✗ |

### Bağımlılıklar

```
dependencies:
  (yok — native fetch + EventSource yeterli)

devDependencies:
  vite ^6          ← build + dev server
  typescript ^5    ← tip güvenliği
```

Tüm UI native DOM API + CSS Custom Properties. Framework yok.

---

## 3. Dosya Yapısı

```
v3/
├── src/
│   └── ...                 ← mevcut backend
├── webui/
│   ├── index.html          ← Vite entry point
│   ├── vite.config.ts      ← proxy: localhost:3131 → /api
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.ts         ← uygulama başlangıcı, router
│   │   ├── api/
│   │   │   ├── client.ts   ← fetch wrapper (base URL, auth header)
│   │   │   ├── agents.ts   ← GET/POST/PUT/DELETE /v1/agents
│   │   │   ├── issues.ts   ← /v1/issues
│   │   │   ├── sprints.ts  ← /v1/sprints
│   │   │   ├── budget.ts   ← /v1/budget/...
│   │   │   ├── queue.ts    ← /v1/queue/...
│   │   │   └── health.ts   ← /health
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── sidebar.ts      ← nav
│   │   │   │   ├── topbar.ts       ← breadcrumb + health badge
│   │   │   │   └── shell.ts        ← layout bağlayıcı
│   │   │   ├── shared/
│   │   │   │   ├── badge.ts        ← status/model badge'leri
│   │   │   │   ├── card.ts         ← surface kart
│   │   │   │   ├── modal.ts        ← form modal
│   │   │   │   ├── toast.ts        ← bildirimler
│   │   │   │   ├── spinner.ts      ← loading
│   │   │   │   └── empty-state.ts  ← boş liste placeholder
│   │   │   └── pages/
│   │   │       ├── overview.ts     ← Dashboard
│   │   │       ├── agents.ts       ← Agent Roster
│   │   │       ├── issues.ts       ← Issue Board
│   │   │       ├── sprints.ts      ← Sprint Board
│   │   │       ├── queue.ts        ← Live Queue
│   │   │       └── budget.ts       ← Budget & Cost
│   │   ├── store/
│   │   │   └── store.ts    ← minimal reaktif store (signal pattern)
│   │   ├── router/
│   │   │   └── router.ts   ← hash-based SPA router
│   │   └── styles/
│   │       ├── tokens.css   ← v1'den miras CSS custom properties
│   │       ├── base.css     ← reset + typography
│   │       └── components.css ← card, badge, modal stilleri
│   └── public/
│       └── favicon.svg
└── package.json            ← "webui:dev" ve "webui:build" script'leri
```

---

## 4. Sayfalar ve İçerikler

### 4.1 Overview (Dashboard) — `/`

**Amaç:** Tek bakışta sistem durumu.

| Bileşen | Veri Kaynağı | Yenileme |
|---------|-------------|----------|
| Health bar (DB / Redis / Worker) | `GET /health` | 10s polling |
| Active jobs sayacı | `GET /v1/queue/stats` | 5s polling |
| Bu ay toplam maliyet | `GET /v1/budget/usage` | sayfa yüklenince |
| Agent durum özeti (idle/active/paused) | `GET /v1/agents` | sayfa yüklenince |
| Son 10 ActivityLog | `GET /v1/activity?limit=10` | 15s polling |
| Pipeline akış diyagramı | statik (v1'den miras) | — |

**Notlar:**
- Health bar renk kodlaması: yeşil (healthy) / sarı (degraded) / kırmızı (down)
- Pipeline diyagramı v1'deki `agent-card + arrow` pattern'ini korur
- Sayfa yüklenince tüm widget'lar paralel fetch

---

### 4.2 Agents — `/agents`

**Amaç:** Agent roster yönetimi.

**Liste görünümü:**

```
┌─────────────────────────────────────────────────────────┐
│ [hire agent]                              [search box]  │
├──────────┬──────────┬────────────┬────────┬─────────────┤
│ Agent    │ Model    │ Status     │ Cost   │ Actions     │
├──────────┼──────────┼────────────┼────────┼─────────────┤
│ architect│ sonnet   │ ● idle     │ $0.00  │ Edit  Fire  │
│ engineer │ kimi-k2  │ ● active   │ $1.24  │ Edit  Pause │
│ reviewer │ deepseek │ ⏸ paused   │ $0.84  │ Edit  Resume│
└──────────┴──────────┴────────────┴────────┴─────────────┘
```

**Detay paneli** (sağda açılır, full page değil):
- Agent prompt (kod bloğu, sadece okuma)
- Escalation chain görselleştirmesi (kimden kime raporluyor)
- Bu ayki maliyet breakdown (input / output token)
- Son 5 iş (issue bağlantısıyla)

**Hire Agent Modalı:**
```
slug          [text]
name          [text]
model         [select: bridge/claude-cli-sonnet, openrouter/kimi-k2.5, ...]
reportsTo     [select: mevcut agent'lar]
permissions   [checkbox group: read, edit, write, bash, task]
heartbeatCron [text, opsiyonel]
promptFile    [file path, opsiyonel]
```

**API bağlantısı:**
- `GET /v1/agents` → liste
- `GET /v1/agents/:slug` → detay
- `POST /v1/agents` → hire
- `PUT /v1/agents/:slug` → edit / status geçişi
- `DELETE /v1/agents/:slug` → fire

---

### 4.3 Issues — `/issues`

**Amaç:** Issue takibi ve pipeline başlatma.

**Görünüm:** Kanban (sütunlar: open / in_progress / review / done)

```
[open]          [in_progress]   [review]        [done]
┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
│#42 Auth    │  │#43 DB perf │  │#41 Header  │  │#40 Login   │
│feature     │  │bug         │  │refactor    │  │feature     │
│→ engineer  │  │→ debugger  │  │→ reviewer  │  │            │
└────────────┘  └────────────┘  └────────────┘  └────────────┘
```

**Issue Kart:**
- Tip badge (feature/bug/refactor/release) renk kodlamalı
- Atanan agent adı
- Iteration sayısı (eğer > 1 ise kırmızı — review döngüsünde)
- Job ID varsa → Queue sayfasına link

**Create Issue Modalı:**
```
title         [text]
type          [select: feature | bug | refactor | release | chore]
body          [textarea]
projectId     [select]
sprintId      [select, opsiyonel]
pipeline      [select: auto (type'a göre) | manual]
agentSlug     [select, sadece manual ise]
```

"Create & Run" butonu → `/v1/issues` + orchestrator pipeline başlatır.

**Filtreler:** type, status, sprint, assigned agent

**API bağlantısı:**
- `GET /v1/issues?status=&projectId=&sprintId=` → liste
- `GET /v1/issues/:id` → detay (sub-issues, job geçmişi)
- `POST /v1/issues` → oluştur
- `PUT /v1/issues/:id` → güncelle (status, atama)

---

### 4.4 Sprints — `/sprints`

**Amaç:** Sprint lifecycle yönetimi.

**Liste:**
- Aktif sprint en üstte, büyük kart
- Backlog sayısı, tamamlanan/toplam issue oranı, ilerleme bar

**Sprint Detay:**
- Issue listesi (kanban mini-view veya flat list toggle)
- Sprint'e issue ekle / çıkar
- Status geçişi butonu: planning → Start Sprint → Complete Sprint

**API bağlantısı:**
- `GET /v1/sprints` + `GET /v1/sprints/:id`
- `POST /v1/sprints`, `PUT /v1/sprints/:id`

---

### 4.5 Queue — `/queue`

**Amaç:** BullMQ job'larını canlı izle.

**Görünüm:** Auto-refresh liste (3s), SSE için hazır (gelecekte)

```
┌──────────┬──────────────┬────────────┬──────────┬──────────┐
│ Job ID   │ Agent        │ Status     │ Attempts │ Duration │
├──────────┼──────────────┼────────────┼──────────┼──────────┤
│ j_abc123 │ engineer     │ ● active   │ 1/3      │ 01:24    │
│ j_def456 │ reviewer     │ ○ waiting  │ 0/3      │ —        │
│ j_ghi789 │ architect    │ ✓ done     │ 1/3      │ 00:47    │
│ j_jkl012 │ debugger     │ ✗ failed   │ 3/3      │ 02:11    │
└──────────┴──────────────┴────────────┴──────────┴──────────┘
```

**Job Detay (modal):**
- Input (agent'a verilen görev metni)
- Output (agent'ın sonucu) — scroll edilebilir kod bloğu
- Hata mesajı (eğer failed)
- Cost: input/output token sayısı + USD
- nextAction varsa → sonraki job linki

**API bağlantısı:**
- `GET /v1/queue/status/:jobId`
- `GET /v1/queue/result/:jobId`
- Polling: 3s interval, sadece Queue sayfası aktifken çalışır

---

### 4.6 Budget — `/budget`

**Amaç:** Maliyet takibi ve limit yönetimi.

**Üst Panel:**

```
┌──────────────────┬──────────────────┬──────────────────┐
│  Bu Ay Toplam    │  En Pahalı Agent │  Tahmini Ay Sonu │
│  $4.82           │  engineer $2.10  │  ~$9.60          │
└──────────────────┴──────────────────┴──────────────────┘
```

**Kullanım Grafiği:** Son 30 günün günlük maliyet çubuk grafiği
- Native `<canvas>` ile, kütüphane yok
- Çubuk rengi: yeşil → sarı → kırmızı (bütçe dolunca)

**Policy Tablosu:**

```
┌──────────────┬────────┬───────────┬─────────────┬────────────┐
│ Scope        │ Limit  │ Soft %    │ Hard %      │ Aksiyon    │
├──────────────┼────────┼───────────┼─────────────┼────────────┤
│ company      │ $50/mo │ 80% → uyar│ 100% → durdur│ Edit      │
│ agent:eng..  │ $10/mo │ 80% → uyar│ 100% → durdur│ Edit  Del │
└──────────────┴────────┴───────────┴─────────────┴────────────┘
```

**Policy Modalı:**
```
scope           [radio: company | agent]
agentSlug       [select, sadece agent scope]
monthlyLimit    [number, USD]
softLimitPct    [range 50-95, default 80]
hardLimitPct    [range 80-100, default 100]
action          [select: warn | pause | block]
```

**API bağlantısı:**
- `GET /v1/budget/usage`
- `GET /v1/budget/policies`, `POST /v1/budget/policies`

---

## 5. Tasarım Sistemi

v1'den miras CSS token'ları, genişletilmiş:

```css
:root {
  /* Yüzeyler */
  --bg:        #0a0a0f;
  --surface:   #111118;
  --surface2:  #16161f;
  --border:    #1e1e2e;
  --border2:   #2e2e44;

  /* Metin */
  --text:      #e2e8f0;
  --text2:     #64748b;
  --text3:     #94a3b8;

  /* Model renkleri (v1'den) */
  --kimi:      #3b82f6;
  --deepseek:  #06b6d4;
  --sonnet:    #8b5cf6;

  /* Durum renkleri */
  --green:     #10b981;
  --red:       #ef4444;
  --amber:     #f59e0b;
  --indigo:    #6366f1;

  /* Boyutlar */
  --r:         10px;
  --r-sm:      6px;
  --sidebar-w: 220px;
  --topbar-h:  56px;
}
```

**Layout:** Sol sidebar (220px) + üst bar (56px) + içerik alanı.
Mobil breakpoint: 768px'de sidebar hamburger menüye dönüşür.

---

## 6. State Yönetimi

Framework yok, minimal signal pattern:

```typescript
// store/store.ts
type Listener<T> = (value: T) => void;

class Signal<T> {
  private listeners: Set<Listener<T>> = new Set();
  constructor(private _value: T) {}

  get value() { return this._value; }

  set(next: T) {
    this._value = next;
    this.listeners.forEach(fn => fn(next));
  }

  subscribe(fn: Listener<T>) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

// Global store
export const agents   = new Signal<Agent[]>([]);
export const issues   = new Signal<Issue[]>([]);
export const health   = new Signal<HealthStatus | null>(null);
export const toasts   = new Signal<Toast[]>([]);
```

Sayfa component'ları store'a subscribe olur, API çağrısı sonucu `store.set()` ile günceller.

---

## 7. Routing

Hash-based SPA router (backend route çakışması yok):

```typescript
// router/router.ts
const routes: Record<string, () => HTMLElement> = {
  '#/':        () => new OverviewPage(),
  '#/agents':  () => new AgentsPage(),
  '#/issues':  () => new IssuesPage(),
  '#/sprints': () => new SprintsPage(),
  '#/queue':   () => new QueuePage(),
  '#/budget':  () => new BudgetPage(),
};

window.addEventListener('hashchange', () => render());
```

---

## 8. API Client

```typescript
// api/client.ts

const BASE = import.meta.env.VITE_API_URL ?? '';  // dev'de Vite proxy

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status, await res.json());
  return res.json();
}
```

Vite proxy (`vite.config.ts`):
```typescript
server: {
  proxy: {
    '/v1':   'http://localhost:3131',
    '/api':  'http://localhost:3131',
    '/health': 'http://localhost:3131',
  }
}
```

Production'da WebUI statik dosyalar olarak Fastify'ın `/public` dizininden serve edilir. Ayrı port yok.

---

## 9. Polling Stratejisi

Real-time WebSocket yerine interval polling (yeterli, sıfır ek altyapı):

| Sayfa | Veri | Interval |
|-------|------|----------|
| Overview | health, active jobs | 10s |
| Queue | tüm job'lar | 3s (sadece aktif iken) |
| Overview | activity log | 15s |
| Agents | agent status | 30s |

**Kural:** Sayfa görünür olmadığında (`document.visibilityState === 'hidden'`) polling durur, geri döndüğünde yeniden başlar.

**SSE hazırlığı:** v3 backend ileride `GET /v1/events` SSE stream ekleyebilir. `QueuePage` bu stream'i `EventSource` ile dinleyecek şekilde placeholder ile bitirilir.

---

## 10. Fastify Entegrasyonu

WebUI build çıktısı (`webui/dist/`) `forge start` ile otomatik serve edilir:

```
v3/src/server/routes/static.ts  (yeni route)

GET /*  →  webui/dist/ klasöründen statik dosya
           (Fastify @fastify/static plugin)
```

Geliştirme sırasında:
- `forge start` — backend :3131
- `npm run webui:dev` — Vite :5173 (proxy ile :3131'e yönlendirir)

Production `package.json` script'leri:
```json
"webui:dev":   "vite --config webui/vite.config.ts",
"webui:build": "vite build --config webui/vite.config.ts",
"build":       "tsc -p tsconfig.build.json && npm run webui:build"
```

---

## 11. Uygulama Sırası

### Faz 1 — Temel Altyapı
1. `webui/` dizini, `vite.config.ts`, `tsconfig.json`, `package.json` script eklemeleri
2. CSS token dosyaları (v1'den port et + genişlet)
3. Layout shell (sidebar + topbar + content slot)
4. Router (hash-based, 6 rota)
5. API client (fetch wrapper + hata yönetimi)
6. Toast bileşeni

### Faz 2 — Overview ve Agents
7. Health polling + health bar
8. Overview sayfası (tüm widget'lar)
9. Agents listesi (tablo)
10. Agent detay paneli
11. Hire / Edit / Fire modal'ları

### Faz 3 — Issues ve Sprints
12. Issues kanban (4 sütun)
13. Issue kart bileşeni
14. Create Issue modalı (pipeline başlatma dahil)
15. Sprint listesi
16. Sprint detay + lifecycle butonları

### Faz 4 — Queue ve Budget
17. Queue listesi (3s polling)
18. Job detay modalı
19. Budget özet kartları
20. Maliyet grafiği (canvas)
21. Policy tablosu + CRUD modal

### Faz 5 — Entegrasyon ve Polish
22. Fastify static route (`@fastify/static`)
23. `forge start` içinde webui build'i serve et
24. Responsive (mobil breakpoint)
25. Keyboard navigasyon (modal Escape, focus trap)
26. Error boundary (API hata → toast)

---

## 12. v1 → v3 WebUI Karşılaştırması

| Özellik | v1 | v3 |
|---------|----|----|
| Veri | Statik | Canlı API |
| Agent yönetimi | Yok | Hire / Edit / Pause / Fire |
| Issue takibi | Yok | Kanban, pipeline başlatma |
| Sprint | Yok | Planning / Active / Complete |
| Job izleme | Yok | Queue sayfası, 3s polling |
| Bütçe | Yok | Aylık maliyet, limitler |
| Build | Yok (tek HTML) | Vite + TypeScript |
| Boyut | 755 satır HTML | ~25 küçük TypeScript modülü |
| Bağımlılık | Sıfır | Vite + tsc (dev only) |
