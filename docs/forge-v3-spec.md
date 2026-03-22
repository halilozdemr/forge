# Forge v3 — Local Spec

Bu doküman Forge v3'ün mevcut kodundan ne değişeceğini, ne ekleneceğini ve nasıl çalışacağını tanımlar. Antigravity bu dokümanı referans alarak implementasyonu yapar.

---

## Hedef

`forge start` komutu çalıştığında Docker, PostgreSQL, Redis kurulu olmak zorunda kalınmamalı. Tüm altyapı binary içine gömülü gelir. Kullanıcının yapması gereken tek şey:

```bash
npm i -g forge-agency
forge init
forge start
```

---

## Değişiklik 1 — PostgreSQL → SQLite

### Prisma Schema

`prisma/schema.prisma` dosyasında iki değişiklik yapılacak:

**Önce:**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Sonra:**
```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

### Decimal → Float

SQLite `Decimal` tipini desteklemez. Schema'daki tüm `Decimal` alanlar `Float` olarak değiştirilecek:

| Model | Alan | Önce | Sonra |
|-------|------|------|-------|
| `CostEvent` | `costUsd` | `Decimal @default(0) @db.Decimal(10, 6)` | `Float @default(0)` |
| `BudgetPolicy` | `monthlyLimitUsd` | `Decimal @db.Decimal(10, 2)` | `Float` |

`@db.Decimal(...)` anotasyonları silinecek. SQLite'da `@db.*` anotasyonu kullanılmaz.

### Json → String

SQLite `Json` tipini native desteklemez, Prisma bunu `String` olarak saklar. Schema'da `Json` alanlar `String` olarak değiştirilecek, uygulama kodunda `JSON.parse()` / `JSON.stringify()` ile yönetilecek:

| Model | Alan |
|-------|------|
| `Agent` | `permissions` |
| `Project` | `config` |
| `Issue` | `metadata` |
| `QueueJob` | `result` |
| `ActivityLog` | `metadata` |
| `ConfigEntry` | `value` |

**Önce:**
```prisma
permissions Json @default("{}")
```

**Sonra:**
```prisma
permissions String @default("{}")
```

### Default DATABASE_URL

`src/utils/config.ts` dosyasında `databaseUrl` default değeri şu şekilde ayarlanacak:

```typescript
import { homedir } from "os";
import { join } from "path";

const DEFAULT_DB_PATH = join(homedir(), ".forge", "forge.db");

const DEFAULT_CONFIG: FirmConfig = {
  // ...
  databaseUrl: `file:${DEFAULT_DB_PATH}`,
};
```

`~/.forge/` dizini yoksa `forge start` sırasında otomatik oluşturulacak.

### DATABASE_URL Zorunluluğu Kalkıyor

`src/cli/commands/start.ts` içindeki şu kontrol silinecek:

```typescript
// SİLİNECEK:
if (!config.databaseUrl) {
  log.error("DATABASE_URL is required. Set it in environment or pass --pg-url.");
  process.exit(1);
}
```

---

## Değişiklik 2 — Redis + BullMQ → SQLite Queue

BullMQ ve `ioredis` kütüphaneleri kaldırılacak. Yerlerine Prisma üzerinde çalışan, polling tabanlı bir SQLite queue sistemi yazılacak.

### Neden BullMQ Kaldırılıyor

- Redis bağımlılığı ortadan kalkar
- `forge start` için dış servis gerekmez
- Mevcut `QueueJob` tablosu zaten var, üzerine inşa edilir

### Prisma Schema — QueueJob Güncellemesi

Mevcut `QueueJob` modelindeki `bullmqJobId` alanı kaldırılacak, yeni alanlar eklenecek:

```prisma
model QueueJob {
  id          String    @id @default(cuid())
  companyId   String
  agentSlug   String
  issueId     String?
  type        String    @default("agent_task")   // agent_task | heartbeat
  payload     String    @default("{}")            // JSON string
  status      String    @default("pending")       // pending | running | completed | failed
  attempts    Int       @default(0)
  maxAttempts Int       @default(3)
  result      String?
  error       String?
  scheduledAt DateTime  @default(now())
  startedAt   DateTime?
  completedAt DateTime?
  queuedAt    DateTime  @default(now())

  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  issue   Issue?  @relation(fields: [issueId], references: [id])

  @@index([status, scheduledAt])
  @@index([companyId, status])
  @@map("queue_jobs")
}
```

### Prisma Schema — ScheduledJob (Heartbeat için)

Repeatable job'ları (heartbeat cron'larını) yönetmek için yeni tablo:

```prisma
model ScheduledJob {
  id             String    @id @default(cuid())
  jobKey         String    @unique   // "heartbeat:{companyId}:{agentSlug}"
  companyId      String
  agentSlug      String
  cronExpression String
  nextRunAt      DateTime
  lastRunAt      DateTime?
  enabled        Boolean   @default(true)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([enabled, nextRunAt])
  @@map("scheduled_jobs")
}
```

### Queue API (src/bridge/queue.ts)

BullMQ'nun `Queue` class'ı yerine geçecek yeni interface:

```typescript
// Yeni interface — BullMQ'ya benzer API
export async function addJob(params: {
  companyId: string;
  agentSlug: string;
  issueId?: string;
  payload?: Record<string, unknown>;
  scheduledAt?: Date;
}): Promise<string>   // job id döner

export async function getQueue() // mevcut kodu bozmamak için stub
export async function closeQueue() // no-op
```

`addJob` Prisma üzerinden `QueueJob` kaydı oluşturur.

### Worker (src/bridge/worker.ts)

BullMQ Worker yerine polling tabanlı worker:

```typescript
// Her 1 saniyede bir çalışır
// Atomik job claim: SQLite transaction ile
// 1. status='pending' AND scheduledAt <= now olan job'ları bul (LIMIT = concurrency)
// 2. status='running' yap (transaction içinde)
// 3. Job'ı işle
// 4. Başarılıysa status='completed', başarısızsa:
//    - attempts < maxAttempts → status='pending', scheduledAt = now + backoff(attempts)
//    - attempts >= maxAttempts → status='failed'

// Backoff: 2^attempts saniye (2s, 4s, 8s)
```

Concurrency kontrolü: `Promise.all` ile maksimum N job paralel çalıştırılır.

### Heartbeat Scheduler (src/heartbeat/scheduler.ts)

BullMQ repeatable job'lar yerine `ScheduledJob` tablosu kullanılacak:

```typescript
// startHeartbeatScheduler():
// 1. DB'den heartbeatCron'u olan agent'ları çek
// 2. Her agent için ScheduledJob upsert et (jobKey ile deduplicate)
// 3. nextRunAt = cronExpression'dan hesapla (node-cron veya basit cron parser)
// 4. setInterval(30_000) ile poll: nextRunAt <= now olan job'ları bul
// 5. QueueJob oluştur (type: 'heartbeat')
// 6. nextRunAt'ı güncelle (bir sonraki cron tick)
```

Cron hesaplama için `cron-parser` paketi kullanılacak (yeni bağımlılık, hafif).

### Thundering Herd Koruması

SQLite transaction ile atomik claim:

```typescript
// Prisma transaction içinde:
const job = await db.$transaction(async (tx) => {
  const pending = await tx.queueJob.findFirst({
    where: { status: "pending", scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: "asc" },
  });
  if (!pending) return null;
  return tx.queueJob.update({
    where: { id: pending.id },
    data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
  });
});
```

SQLite write'ları seri (serialized) çalıştığı için bu transaction race condition yaratmaz.

---

## Değişiklik 3 — Sync Outbox

Her veri değişikliğinden sonra Forge Cloud'a sync gönderilecek. Cloud erişilemezse yerel biriktirme yapılacak.

### Prisma Schema — SyncOutbox

```prisma
model SyncOutbox {
  id          String    @id @default(cuid())
  eventType   String    // agent.updated | issue.created | issue.updated | sprint.created | sprint.updated | budget.updated | heartbeat.completed
  payload     String    // JSON string — sadece metadata, kod/prompt yok
  status      String    @default("pending")   // pending | sent | failed
  attempts    Int       @default(0)
  lastAttemptAt DateTime?
  sentAt      DateTime?
  createdAt   DateTime  @default(now())

  @@index([status, createdAt])
  @@map("sync_outbox")
}
```

### Sync Worker (src/sync/worker.ts) — YENİ DOSYA

```typescript
// Her 5 saniyede bir çalışır
// 1. status='pending' OR (status='failed' AND attempts < 5) olan kayıtları çek
// 2. Forge Cloud URL'i config'den oku (FORGE_CLOUD_URL env var)
// 3. Token'ı ~/.forge/credentials.json'dan oku
// 4. POST {cloudUrl}/sync/events — payload: { events: [...] }
// 5. Başarılıysa status='sent'
// 6. Başarısızsa status='failed', attempts++, lastAttemptAt güncelle
//    Backoff: 5s, 10s, 20s, 40s, 80s (exponential, attempt bazlı)

// Cloud URL veya token yoksa sync worker hiç başlamaz — sessizce skip
```

### Sync Payload Format

Her event şu formatta gönderilecek:

```typescript
interface SyncEvent {
  id: string;
  eventType: string;
  occurredAt: string;   // ISO timestamp
  data: Record<string, unknown>;
}

// Örnek — issue.updated:
{
  id: "cuid",
  eventType: "issue.updated",
  occurredAt: "2026-03-23T20:00:00Z",
  data: {
    issueId: "cuid",
    title: "...",
    status: "in_progress",
    assignedAgentSlug: "engineer",
    sprintId: "cuid",
    companyId: "cuid"
  }
}
```

**Gönderilmeyecek alanlar:** prompt içerikleri, kod çıktıları, `result` alanı, system prompt.

### Outbox Tetikleyicileri

Aşağıdaki noktalara `addSyncEvent(eventType, data)` çağrısı eklenecek:

| Nokta | Event |
|-------|-------|
| Agent status değiştiğinde | `agent.updated` |
| Issue oluşturulduğunda | `issue.created` |
| Issue status/assignment değiştiğinde | `issue.updated` |
| Sprint oluşturulduğunda | `sprint.created` |
| Sprint status değiştiğinde | `sprint.updated` |
| CostEvent kaydedildiğinde | `budget.updated` |
| HeartbeatRun tamamlandığında | `heartbeat.completed` |

---

## Değişiklik 4 — `forge login` Komutu

### Yeni Dosya: src/cli/commands/login.ts

```typescript
// forge login [--cloud-url <url>]
//
// 1. --cloud-url verilmezse FORGE_CLOUD_URL env var'a bak
//    Yoksa default: http://localhost:4000
//
// 2. Random port seç (3200-3299 arası)
// 3. Local HTTP server başlat (callback için)
// 4. Tarayıcıyı aç: {cloudUrl}/auth/cli?callback=http://localhost:{port}/callback
// 5. Callback'i bekle: GET /callback?token=xxx
// 6. Token al, local server kapat
// 7. ~/.forge/credentials.json yaz:
//    { "token": "...", "cloudUrl": "...", "savedAt": "..." }
// 8. "Login successful" yaz
```

### Credentials Dosyası

`~/.forge/credentials.json`:
```json
{
  "token": "eyJ...",
  "cloudUrl": "http://localhost:4000",
  "savedAt": "2026-03-23T20:00:00Z"
}
```

### forge logout Komutu

`~/.forge/credentials.json` dosyasını siler.

---

## Değişiklik 5 — start.ts Temizliği

`src/cli/commands/start.ts` içinden şunlar kaldırılacak:

- `--pg-url` option
- `--redis-url` option
- Redis bağlantı kodu (`new Redis(...)`, `redis.connect()`, `redis.quit()`)
- `const connection = { host, port }` satırı
- Redis'e bağlı tüm `connection` parametreleri

Bunların yerine:

```typescript
// ~/.forge dizini oluştur
await fs.mkdir(join(homedir(), ".forge"), { recursive: true });

// Sync worker başlat (cloud URL varsa)
await startSyncWorker();
```

`start.ts` basit hale gelecek:

```
1. Config yükle (artık sadece port, concurrency, logLevel)
2. ~/.forge dizini oluştur
3. DB migration çalıştır
4. Seed (varsa)
5. Queue worker başlat
6. Heartbeat scheduler başlat
7. Sync worker başlat (sessizce, cloud yoksa skip)
8. HTTP server başlat
9. PID dosyası yaz
```

---

## Yeni Bağımlılıklar

| Paket | Neden |
|-------|-------|
| `cron-parser` | Cron expression'ı parse edip nextRunAt hesaplamak için |

## Kaldırılan Bağımlılıklar

| Paket | Neden |
|-------|-------|
| `bullmq` | SQLite queue ile replace edildi |
| `ioredis` | Redis kaldırıldı |

---

## Etkilenmeyen Kısımlar

Aşağıdakiler değişmeyecek:

- `src/server/` — tüm HTTP routes
- `src/bridge/runners/` — claude-cli, anthropic-api, openrouter
- `src/bridge/worker.ts` içindeki agent çalıştırma mantığı (sadece BullMQ kısmı değişiyor)
- `src/agents/` — agent loader, lifecycle, hierarchy
- `src/heartbeat/handlers.ts` — heartbeat run logic
- `src/orchestrator/` — pipeline'lar
- `webui/` — React dashboard
- `bin/` — CLI entry point
- `prisma/schema.prisma` — tablolar korunuyor, sadece provider + tip değişiklikleri

---

## Dosya Değişiklik Özeti

| Dosya | Değişiklik |
|-------|-----------|
| `prisma/schema.prisma` | provider sqlite, Decimal→Float, Json→String, QueueJob güncelle, ScheduledJob + SyncOutbox ekle |
| `src/utils/config.ts` | Default DATABASE_URL = `~/.forge/forge.db`, Redis config kaldır |
| `src/db/migrate.ts` | Değişmez (prisma db push çalışmaya devam eder) |
| `src/bridge/queue.ts` | BullMQ Queue → Prisma tabanlı addJob() |
| `src/bridge/worker.ts` | BullMQ Worker → SQLite polling worker |
| `src/heartbeat/scheduler.ts` | BullMQ repeatable → ScheduledJob tablosu + setInterval polling |
| `src/cli/commands/start.ts` | Redis kaldır, sync worker ekle, --pg-url/--redis-url kaldır |
| `src/cli/commands/login.ts` | **YENİ** — OAuth callback flow |
| `src/cli/commands/logout.ts` | **YENİ** — credentials sil |
| `src/sync/worker.ts` | **YENİ** — outbox poller |
| `src/cli/index.ts` | login/logout komutları register et |
| `package.json` | bullmq + ioredis kaldır, cron-parser ekle |
