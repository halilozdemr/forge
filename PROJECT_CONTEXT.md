# AI Execution System – Single Source of Truth

## 1. Core Principles
- Tek resmi giriş `intake` katmanıdır.
- Tek resmi akış `pipeline` akışıdır.
- `pipeline` kimliği olmayan yürütme resmi iş değildir.
- Resmi state sahipliği `pipeline` katmanındadır.
- Resmi sonuç sahipliği tek otoritatif sonuç kaydındadır.

---

## 2. System Architecture (Conceptual)
- Intake:
  - Dış talebi alır.
  - Talebi resmi iş kaydına bağlar.
  - İşi `pipeline` olarak başlatır.
- Pipeline:
  - İşi tanımlı stage dizisinde yürütür.
  - Stage bağımlılıklarını ve geçiş koşullarını uygular.
- Dispatcher:
  - Uygun stage’i kuyruğa verir.
  - Stage tamamlanma, başarısızlık, iptal ve tekrar koşullarını yönetir.
- Queue/Worker:
  - Atanan stage girdisini çalıştırır.
  - Stage çıktısını geri döner.
- Pipeline State:
  - İşin resmi durumunu taşır.
  - İşin aktif stage, tamamlanma ve hata bilgisini tutar.

---

## 3. Governance Rules

### 3.1 Official Entry Rule
- Resmi iş yalnızca intake üzerinden başlar.
- Intake dışından başlatılan yürütmeler resmi iş modeli değildir.

### 3.2 Execution Rule
- Resmi iş yalnızca pipeline içinde yürür.
- Stage dışı serbest yürütme resmi akış sayılmaz.

### 3.3 State Ownership Rule
- State değişikliği yalnızca pipeline state tarafından belirlenir.
- Yardımcı kanallar state değiştirme yetkisine sahip değildir.

### 3.4 Result Ownership Rule
- İşin nihai sonucu tek otoritatif kayıtta tutulur.
- Ara stage çıktıları destekleyici artefakt olarak kalır.

### 3.5 Responsibility Rule
- Her stage’in tek sorumlusu vardır.
- Stage sorumlusu yalnızca kendi stage çıktısını üretir.

### 3.6 Escalation Rule
- Belirsizlik yeni işe dönüşmez.
- Belirsizlik mevcut iş içinde `decision_request` veya `escalation_request` olarak ele alınır.
- Escalation karar kapısıdır ve resmi akış içinde çözülür.

### 3.7 Timeout Rule
- Tüm yürütmeler bounded execution kurallarına tabidir.
- Bekleme, tekrar ve çalışma süreleri sınırsız olamaz.
- Tanımlı sınır aşıldığında süreç `explicit_failure` üretir.

### 3.8 Signal vs State Rule
- Event/signal gözlemleme verisidir.
- Signal, state değişikliği yerine geçmez.
- State değişikliği yalnızca resmi state kaydında geçerlidir.

---

## 4. Forbidden Behaviors
- Resmi akışı bypass ederek iş başlatmak.
- Aynı iş için paralel state yazımı yapmak.
- Birden fazla sonuç otoritesi üretmek.
- Yardımcı kanalları resmi yürütme yolu gibi kullanmak.
- Belirsizlikten yeni iş üretmek.
- State değişmeden state benzeri sinyal üretmek.

---

## 5. Agent Execution Model

### 5.1 Capabilities
- Agent yalnızca atanmış stage girdisini işler.
- Agent yalnızca kendi stage çıktısını üretir.
- Agent blokaj durumunda karar talebi üretir.

### 5.2 Restrictions
- Agent başka agent ile serbest konuşmaz.
- Agent dispatch/handoff/assign yapmaz.
- Agent yeni task veya yeni iş üretmez.
- Agent resmi state değiştirmez.
- Agent nihai sonuç kaydını yazmaz.

### 5.3 Stage Model
- Agent stage-bound çalışır.
- Stage dışı süreç yönetimi yapmaz.
- `next task`, `handoff`, `assign` davranışları yasaktır.

### 5.4 Output Contract
- `artifact`
- `decision_request` / `escalation_request`
- `explicit_failure`

### 5.5 Decision Logic
- Kritik belirsizlik tespit edildiğinde agent durur.
- Belirsizlik karar gerektiriyorsa `decision_request` üretir.
- Yetki sınırı aşılıyorsa `escalation_request` üretir.
- Stage içinde çözülemeyen hata durumunda `explicit_failure` döner.

### 5.6 Prompt Constraints
- Forbidden phrases:
  - `ask another agent`
  - `handoff to`
  - `assign task`
  - `create new task`
  - `continue conversation`
  - `coordinate with`
  - `check next pending task`
- Required phrases:
  - `You are responsible only for this stage.`
  - `Do not perform orchestration.`
  - `Do not communicate with other agents.`
  - `Do not create new tasks.`
  - `Do not mutate official state.`
  - `If blocked, produce decision_request.`

---

## 6. Skill Model

### 6.1 Scope
- Skill tek işi yapar.
- Skill bounded input/output ile çalışır.
- Skill stage içinde yardımcı görev olarak kullanılır.

### 6.2 Restrictions
- Skill orchestration yapmaz.
- Skill rol dağıtımı yapmaz.
- Skill yeni akış veya yeni iş başlatmaz.
- Skill resmi state değiştirmez.

### 6.3 Output Rules
- Skill çıktısı yalnızca şu tiplerden biri olur:
  - `artifact`
  - `decision_request` / `escalation_request`
  - `explicit_failure`
- Skill çıktısı stage çıktısına destek sağlar.

### 6.4 Anti-patterns
- Sprint planlama.
- Task breakdown ile yeni iş üretme.
- Rol dağıtımı.
- Çok aşamalı workflow üretimi.
- `do this then do that` zinciri.

---

## 7. Specialist Projection Model
- Intake zorunluluğu:
  - Resmi iş talebi intake’e gider.
  - Projection resmi giriş kapısını bypass etmez.
- Direct run sınırlaması:
  - Direct run resmi iş yürütme modeli değildir.
  - Direct run yardımcı kanal sınırında kalır.
- Projection davranışı:
  - Talebi toplar.
  - Resmi girişe yönlendirir.
  - Durum gözlemler ve raporlar.
- Anti-patterns:
  - Her isteği direct run’a çevirmek.
  - Pipeline bypass etmek.
  - Local orchestration yapmak.

---

## 8. State Model
- `Pipeline` state için source of truth’tur.
- `Issue` state türetilmiş görünümdür.
- Çoklu state kaynağı yoktur.
- State sözlüğü tektir ve resmi akışla uyumludur.

---

## 9. Result Model
- İş sonucu tek otoritatif sonuç kaydında tutulur.
- Stage çıktıları destekleyici artefaktlardır.
- Çoklu sonuç otoritesi yoktur.
- Nihai sonuç okunabilir ve tek anlamlıdır.

---

## 10. Decision & Escalation Model
- Belirsizlik tanımı:
  - Stage çıktısını etkileyen kritik eksiklik veya çelişki.
- Ne zaman durulur:
  - Karar olmadan güvenilir çıktı üretilemediğinde.
- Ne zaman devam edilir:
  - Belirsizlik stage sonucunu etkilemiyorsa.
- Decision nasıl üretilir:
  - `decision_request` ile mevcut iş içinde resmi karar talebi açılır.
- Escalation nasıl çalışır:
  - `escalation_request` ile yetki sınırı üst karar noktasına taşınır.
  - Yeni iş açılmaz.

---

## 11. Rewrite Policy

### 11.1 Agent Rewrite Rules
- Tüm agent promptları stage-bound modele göre yazılır.
- Orchestration dili tamamen kaldırılır.
- Cross-agent iletişim kalıpları kaldırılır.
- Output contract zorunlu hale getirilir.
- State/result yazma iddiası prompttan çıkarılır.

### 11.2 Skill Rewrite Rules
- Skill tanımları single-purpose ve bounded hale getirilir.
- Workflow üreten, rol dağıtan ve iş açan kalıplar kaldırılır.
- Output contract zorunlu hale getirilir.

### 11.3 Projection Rewrite Rules
- Projection davranışı intake-first modele bağlanır.
- Direct-run default davranışı kaldırılır.
- Projection içinde local orchestration kalıpları kaldırılır.

---

## 12. System Boundaries
- Bu sistem chat sistemi değildir.
- Bu sistem multi-agent sohbet sistemi değildir.
- Bu sistem task dağıtım sistemi değildir.
- Bu sistem workflow generator değildir.
- Bu sistem deterministic execution pipeline’dır.
