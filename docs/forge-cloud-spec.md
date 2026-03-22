# Forge Cloud — Spec

Forge Cloud, Forge v3 local tool'unun dashboard ve auth backend'idir. Kullanıcıların local Forge instance'larından gelen verileri merkezi bir arayüzde görmelerini sağlar.

---

## Temel Prensipler

- **Forge Cloud veri üretmez.** Sadece Forge v3'ten gelen sync event'lerini alır ve dashboard'da gösterir.
- **Hassas veri gelmez.** Kod, prompt, agent output, system prompt cloud'a gönderilmez. Sadece metadata.
- **Local Forge Cloud olmadan çalışır.** Sync worker cloud'a ulaşamazsa sessizce devam eder.
- **Multi-tenant.** Her kullanıcının verileri birbirinden izole.

---

## Proje Yapısı

```
forge-cloud/
├── src/
│   ├── auth/              # Login, token, callback
│   ├── sync/              # Sync event alımı ve işleme
│   ├── dashboard/         # Dashboard read API
│   ├── server/            # Fastify setup, plugin register
│   └── utils/             # Logger, config
├── prisma/
│   └── schema.prisma      # PostgreSQL schema
├── webui/                 # React + Vite dashboard (ayrı)
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## Tech Stack

| Katman | Teknoloji |
|--------|----------|
| Runtime | Node.js 20+ |
| Framework | Fastify (v3 ile tutarlı) |
| ORM | Prisma |
| DB | PostgreSQL 16 |
| Cache/Queue | Redis 7 (isteğe bağlı, şimdilik yok) |
| Auth | JWT (jsonwebtoken) |
| Container | Docker + docker-compose |

---

## Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: forge_cloud
      POSTGRES_USER: forge_cloud
      POSTGRES_PASSWORD: forge_cloud
    ports:
      - "5434:5432"         # 5433 Forge v3 dev'de kullanılıyor, çakışmasın
    volumes:
      - postgres_data:/var/lib/postgresql/data

  forge-cloud:
    build: .
    ports:
      - "4000:4000"
    environment:
      DATABASE_URL: postgresql://forge_cloud:forge_cloud@postgres:5432/forge_cloud
      JWT_SECRET: ${JWT_SECRET}
      PORT: 4000
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

---

## Prisma Schema (PostgreSQL)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Kullanıcılar
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  instances ForgeInstance[]
  sessions  UserSession[]

  @@map("users")
}

// Kullanıcının local Forge instance'ları (şimdilik 1 kullanıcı = 1 instance)
model ForgeInstance {
  id         String    @id @default(cuid())
  userId     String
  name       String    @default("default")
  lastSyncAt DateTime?
  createdAt  DateTime  @default(now())

  user    User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  agents  CloudAgent[]
  issues  CloudIssue[]
  sprints CloudSprint[]
  budgets CloudBudget[]
  events  SyncEvent[]

  @@unique([userId, name])
  @@map("forge_instances")
}

// Auth token'ları (CLI login session'ları)
model UserSession {
  id        String    @id @default(cuid())
  userId    String
  token     String    @unique
  expiresAt DateTime
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_sessions")
}

// Agent snapshot (son bilinen durum)
model CloudAgent {
  id         String   @id @default(cuid())
  instanceId String
  agentId    String   // local forge'daki id
  slug       String
  name       String
  role       String
  status     String   @default("idle")
  updatedAt  DateTime @updatedAt

  instance ForgeInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@unique([instanceId, agentId])
  @@map("cloud_agents")
}

// Issue snapshot
model CloudIssue {
  id              String   @id @default(cuid())
  instanceId      String
  issueId         String
  title           String
  status          String
  priority        String   @default("normal")
  type            String   @default("feature")
  assignedAgentSlug String?
  sprintId        String?
  updatedAt       DateTime @updatedAt

  instance ForgeInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@unique([instanceId, issueId])
  @@map("cloud_issues")
}

// Sprint snapshot
model CloudSprint {
  id         String    @id @default(cuid())
  instanceId String
  sprintId   String
  number     Int
  goal       String
  status     String    @default("planning")
  startedAt  DateTime?
  closedAt   DateTime?
  updatedAt  DateTime  @updatedAt

  instance ForgeInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@unique([instanceId, sprintId])
  @@map("cloud_sprints")
}

// Budget snapshot (company bazlı aylık özet)
model CloudBudget {
  id         String   @id @default(cuid())
  instanceId String
  month      String   // "2026-03" formatı
  totalUsd   Float    @default(0)
  updatedAt  DateTime @updatedAt

  instance ForgeInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@unique([instanceId, month])
  @@map("cloud_budgets")
}

// Ham event log (audit trail)
model SyncEvent {
  id         String   @id @default(cuid())
  instanceId String
  eventType  String
  payload    Json
  receivedAt DateTime @default(now())

  instance ForgeInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@index([instanceId, eventType, receivedAt])
  @@map("sync_events")
}
```

---

## Auth Sistemi

### Kayıt ve Giriş (Email/Password)

**POST /auth/register**
```json
// Request
{ "email": "user@example.com", "password": "..." }

// Response 201
{ "token": "eyJ...", "expiresAt": "2026-04-23T..." }
```

**POST /auth/login**
```json
// Request
{ "email": "user@example.com", "password": "..." }

// Response 200
{ "token": "eyJ...", "expiresAt": "2026-04-23T..." }
```

Password bcrypt ile hash'lenir (saltRounds: 12).

Token: JWT, payload `{ userId, sessionId }`, expiry 30 gün.

**GET /auth/me** — Token doğrulama
```
Authorization: Bearer eyJ...
```
```json
// Response 200
{ "userId": "...", "email": "..." }
```

### CLI Login Flow — `forge login`

```
forge login [--cloud-url http://localhost:4000]
```

1. Forge v3 CLI, rastgele bir port seçer (3200-3299)
2. Local HTTP server başlatır
3. Tarayıcıyı açar: `{cloudUrl}/auth/cli?callback=http://localhost:{port}/callback`
4. Forge Cloud bu sayfada login formu gösterir
5. Kullanıcı login olur
6. Server token üretir, redirect eder: `http://localhost:{port}/callback?token=eyJ...`
7. CLI local server callback'i yakalar
8. Token'ı `~/.forge/credentials.json`'a yazar
9. Local server kapanır

**GET /auth/cli** — Browser-based CLI login başlatma noktası

Query params:
- `callback`: CLI'nin dinlediği URL (`http://localhost:{port}/callback`)

Bu endpoint bir HTML sayfası döner (email/password form). Form submit edilince:
- `/auth/cli/verify` POST'a gider
- Doğruysa `{callback}?token=eyJ...` adresine redirect eder

**POST /auth/cli/verify**
```json
{ "email": "...", "password": "...", "callback": "http://localhost:3247/callback" }
```
Başarılı → `302 Redirect` → `{callback}?token=eyJ...`

---

## Sync API

### POST /sync/events

Forge v3 local'den gelen event'leri alır.

**Auth:** `Authorization: Bearer {token}` (forge login token'ı)

**Request:**
```json
{
  "events": [
    {
      "id": "cuid",
      "eventType": "issue.updated",
      "occurredAt": "2026-03-23T20:00:00Z",
      "data": {
        "issueId": "cuid",
        "title": "...",
        "status": "in_progress",
        "assignedAgentSlug": "engineer",
        "sprintId": "cuid",
        "companyId": "cuid"
      }
    }
  ]
}
```

**Response 200:**
```json
{ "received": 3, "processed": 3 }
```

### Event İşleme Mantığı

Her event tipi için server ilgili Cloud snapshot tablosunu günceller (upsert):

| Event | İşlem |
|-------|-------|
| `agent.updated` | `CloudAgent` upsert (instanceId + agentId) |
| `issue.created` | `CloudIssue` insert |
| `issue.updated` | `CloudIssue` upsert (instanceId + issueId) |
| `sprint.created` | `CloudSprint` insert |
| `sprint.updated` | `CloudSprint` upsert (instanceId + sprintId) |
| `budget.updated` | `CloudBudget` upsert (instanceId + month) |
| `heartbeat.completed` | Sadece `SyncEvent` log'una yazılır |

Ayrıca tüm event'ler ham olarak `SyncEvent` tablosuna kaydedilir.

**Instance Belirleme:** Token'dan `userId` alınır, `ForgeInstance` `userId` ile bulunur. İlk sync'te instance yoksa otomatik oluşturulur.

---

## Dashboard API

Tüm endpoint'ler `Authorization: Bearer {token}` gerektirir.

**GET /dashboard/agents**
```json
{
  "agents": [
    { "agentId": "...", "slug": "engineer", "name": "...", "role": "engineer", "status": "running" }
  ]
}
```

**GET /dashboard/issues**

Query params: `status`, `sprintId`, `assignedAgentSlug`, `limit` (default 50)

```json
{
  "issues": [
    { "issueId": "...", "title": "...", "status": "in_progress", "priority": "high", "assignedAgentSlug": "engineer" }
  ]
}
```

**GET /dashboard/sprints**
```json
{
  "sprints": [
    { "sprintId": "...", "number": 3, "goal": "...", "status": "active", "startedAt": "..." }
  ]
}
```

**GET /dashboard/budget**

Query params: `month` (default: mevcut ay, format: `2026-03`)

```json
{
  "month": "2026-03",
  "totalUsd": 4.72,
  "lastUpdated": "2026-03-23T20:00:00Z"
}
```

**GET /dashboard/summary**

Tek seferde hepsini döner (dashboard ana sayfası için):
```json
{
  "agents": { "total": 5, "running": 2, "idle": 3 },
  "issues": { "open": 12, "inProgress": 3, "done": 47 },
  "activeSprint": { "number": 3, "goal": "..." },
  "budget": { "month": "2026-03", "totalUsd": 4.72 }
}
```

---

## Dashboard WebUI

Forge Cloud WebUI ayrı bir Vite projesi olarak `forge-cloud/webui/` altında yer alır.

**Stack:** React + Vite (v3 webui ile aynı yapı)

**Sayfalar:**

| Sayfa | Route | İçerik |
|-------|-------|--------|
| Login | `/login` | Email + password form |
| Dashboard | `/` | Summary kartları |
| Agents | `/agents` | Agent listesi + durumlar |
| Issues | `/issues` | Issue board (kanban veya liste) |
| Sprints | `/sprints` | Sprint listesi |
| Budget | `/budget` | Aylık harcama grafik |

**API bağlantısı:** Tüm sayfalar `Authorization: Bearer {token}` ile `/dashboard/*` endpoint'lerine istek atar. Token `localStorage`'da saklanır.

**Build:** `npm run webui:build` → `forge-cloud/webui/dist/`
Fastify static olarak serve eder (`/` prefix).

---

## Ortam Değişkenleri

`.env.example`:

```bash
DATABASE_URL=postgresql://forge_cloud:forge_cloud@localhost:5434/forge_cloud
JWT_SECRET=change-me-in-production-min-32-chars
PORT=4000
NODE_ENV=development
```

---

## Forge v3 Tarafındaki Config

Forge v3'ün sync worker'ı şu env var'ları okur:

```bash
FORGE_CLOUD_URL=http://localhost:4000   # Cloud URL
```

Token `~/.forge/credentials.json`'dan okunur. Bu dosya yoksa sync çalışmaz (sessizce skip).

---

## Geliştirme Ortamı

```bash
# Forge Cloud ayağa kaldır
cd forge-cloud
docker compose up -d postgres
npm install
npm run db:push
npm run dev   # localhost:4000

# Forge v3 (ayrı terminal)
cd v3
forge login --cloud-url http://localhost:4000
forge start
```

---

## Kapsam Dışı (Bu Versiyon)

Aşağıdakiler şu an build edilmeyecek:

- OAuth (Google, GitHub login) — email/password yeterli
- WebSocket realtime — polling yeterli (30s interval)
- Team/organization desteği — tek kullanıcı
- Multi-instance (bir kullanıcının birden fazla Forge'u) — tek instance
- Plugin sistemi
- Billing / subscription
- Admin panel
