@AGENTS.md
# Sesco ERP — Proje Context Dosyası
_Son güncelleme: 2026-03-20_

---

## Proje Tanımı

Sesco Cement (Houston merkezli) için chartering ve operasyon yönetim sistemi.
Hedef: iMOS / Dataloy benzeri — voyage yönetimi, laytime, berth scheduling, inventory, claims, P&L takibi.

**Rotalar:** Mısır (Abu Qir / Amreyah) → Houston / Tampa / Wingate

---

## Tech Stack

| Katman | Teknoloji |
|---|---|
| Frontend | Next.js 16.2 (App Router, TypeScript, Tailwind CSS) |
| Backend | Supabase (local dev: `http://127.0.0.1:54321`) |
| DB | PostgreSQL (Supabase local, port 54322) |
| Auth | Supabase Auth (email/password) |
| Studio | `http://localhost:54323` |

**Proje dizinleri:**
- Backend: `C:\Users\rozba\sesco-erp-core` (Supabase project)
- Frontend: `C:\Users\rozba\sesco-frontend` (Next.js)

---

## Kullanıcılar & Roller

**Auth user:** `rossi@sesco.com` / `1111`
**Rol:** `Admin`

**user_role_enum değerleri:**
- `Admin`
- `Ops_Manager`
- `Chartering`
- `Finance`
- `Legal`
- `Terminal_Staff`

**Rol sistemi:** JWT claim'e bakılmıyor. `get_my_roles()` fonksiyonu her sorguda `user_roles` tablosunu anlık okuyor. `SECURITY DEFINER` — recursion riski yok.

---

## DB Schema Özeti

### Tablolar

| Tablo | Açıklama | PK |
|---|---|---|
| `cargo_plans` | Ana cargo kayıtları | `id` |
| `cargo_plan_items` | Kargo tipi bazında breakdown | `item_id` |
| `cargo_types` | Referans: kargo tipleri | `id` |
| `voyages` | Voyage kayıtları | `id` |
| `vessels` | Gemi kayıtları | `id` |
| `vessel_positions` | AIS pozisyon takibi | `id` |
| `berth_schedule` | Rıhtım programı | `berth_schedule_id` |
| `terminals` | Terminal kayıtları | `terminal_id` |
| `ports` | Liman referans tablosu | `id` |
| `companies` | Şirket referans tablosu | `id` |
| `inventory_movements` | Silo/stok hareketleri | `inventory_movement_id` |
| `payment_orders` | Ödeme emirleri | `payment_order_id` |
| `approval_workflows` | Onay akışları | `workflow_id` |
| `user_roles` | Kullanıcı rol atamaları | `user_role_id` |
| `audit_logs` | Değişiklik kayıtları (immutable) | `audit_id` |

### Kritik İlişkiler

```
cargo_plans (id)
  ├── cargo_plan_items (cargo_plan_id → cargo_plans.id)
  │     └── cargo_types (cargo_type_id → cargo_types.id)
  ├── voyages (cargo_plan_id → cargo_plans.id)
  ├── berth_schedule (cargo_plan_id → cargo_plans.id)
  ├── payment_orders (cargo_plan_id → cargo_plans.id)
  └── inventory_movements (cargo_plan_id → cargo_plans.id)

terminals (terminal_id)
  ├── berth_schedule (terminal_id)
  ├── payment_orders (terminal_id)
  ├── inventory_movements (terminal_id)
  └── approval_workflows (terminal_id)

vessels (id)
  ├── vessel_positions (vessel_id)
  ├── voyages (vessel_id)
  └── berth_schedule (vessel_id)
```

### cargo_plans Önemli Kolonlar

```sql
id                          uuid PK
cargo_ref                   text UNIQUE  -- örn: GPA107-26
planning_stage              enum: PLANNING / FIXTURE / EXECUTION / COMPLETED
status                      enum: PLANNED / OPEN_FOR_FIXTURE / VESSEL_NOMINATED /
                                  FIXTURED / LOADING / SAILED / DISCHARGING /
                                  COMPLETED / CANCELLED / LAYCAN_NOMINATED
shipper                     text
charterer                   text
consignee                   text
cargo_description           text
quantity_mt                 numeric
quantity_st                 numeric
load_port                   text        -- serbest text (FK yok)
discharge_port              text        -- serbest text (FK yok)
terminal_id                 uuid FK → terminals.terminal_id
laycan_start                date
laycan_end                  date
laycan_nomination_due_date  date        -- trigger: laycan_start - 25 gün
discharge_eta               date        -- preliminary: laycan_start + 32 gün
vessel_name                 text
vessel_id                   uuid FK → vessels.id
freight_rate                numeric
tc_daily_rate               numeric
estimated_demurrage_exposure numeric
cp_ref                      text
demurrage_party             text
```

### cargo_types Referans Verileri (mevcut)

- Gray Portland Bulk
- Gray Portland SS
- Gray Masonry
- White Masonry
- White Portland
- Slag
- White Portland SS 525R
- White Portland SS C150
- White Masonry SS
- Lime
- Steel

---

## RLS Yapısı

**Tüm tablolar `{authenticated}` role + `get_my_roles()` / `is_admin()` / `has_role()` kullanıyor.**

Eski `{public}` role + `auth.role() = 'admin'` pattern'i temizlendi (işlevsizdi).

### Yardımcı Fonksiyonlar

```sql
get_my_roles()     -- TEXT[]  — kullanıcının aktif rollerini döner
is_admin()         -- boolean — Admin rolü var mı?
has_role(p_role)   -- boolean — belirli rol var mı?
is_own_user_role_row(p_user_id) -- boolean — kendi satırı mı?
```

### Erişim Matrisi (özet)

| Tablo | Admin | Chartering | Ops_Manager | Finance | Legal |
|---|---|---|---|---|---|
| cargo_plans | ALL | ALL | SELECT | SELECT | SELECT |
| cargo_plan_items | ALL | ALL | SELECT | SELECT | SELECT |
| voyages | ALL | ALL | SELECT | SELECT | SELECT |
| berth_schedule | ALL | — | ALL | — | — |
| payment_orders | ALL | — | SELECT | ALL | — |
| terminals | ALL | SELECT | UPDATE* | SELECT | SELECT |
| vessels | ALL | INSERT | — | — | — |
| user_roles | ALL | — | — | — | — |

*Ops_Manager terminal_name, terminal_type, port_id, terminal_code değiştiremez (trigger koruması)

---

## Trigger'lar

| Trigger | Tablo | Olay | Fonksiyon |
|---|---|---|---|
| `erp_audit_*` | Tüm tablolar | INSERT/UPDATE | `erp_audit_trigger_fn()` |
| `trg_audit_logs_immutable` | audit_logs | UPDATE/DELETE | `audit_logs_immutability_fn()` |
| `cargo_laycan_due_date` | cargo_plans | INSERT/UPDATE | `set_laycan_due_date()` |
| `trg_terminals_restricted_update` | terminals | UPDATE | `terminals_restricted_update_fn()` |
| `trg_user_roles_immutable_fields` | user_roles | UPDATE | `user_roles_immutable_fields_fn()` |

**Audit trigger PK mapping:** user_roles, terminals, approval_workflows, inventory_movements, berth_schedule, payment_orders, cargo_plans, voyages, cargo_plan_items

---

## Frontend Dosya Yapısı

```
C:\Users\rozba\sesco-frontend\
├── .env.local
│     NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
│     NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQH1ZjBrEguHvfOxg_3BJgxAaH
├── lib\
│     supabase.ts          -- createClient() (browser client)
├── app\
│     layout.tsx           -- root layout
│     page.tsx             -- Next.js default (henüz değiştirilmedi)
│     login\
│         page.tsx         -- email/password login → /dashboard
│     dashboard\
│         page.tsx         -- ana dashboard (stats + modül menüsü)
│         cargo-plans\
│             page.tsx     -- cargo plans listesi + yeni plan formu
│             import\
│                 page.tsx -- Excel import (drag&drop, parse, upsert)
```

---

## Excel Import Mantığı

**Kaynak dosya:** VS_Structured.xlsx (Vessel Schedule)
- Sheet: "VS Restructured (2)"
- Header row: satır 4 (0-indexed: 3)
- Data: satır 5'ten itibaren
- 59 kolon, ~54 satır

**Planning sheet → cargo_plans mapping:**

| Excel Kolon | Index | DB Kolonu |
|---|---|---|
| Source | 0 | `load_port` |
| Shipper | 1 | `shipper` |
| Vessel | 4 | `vessel_name` |
| Cargo Ref | 12 | `cargo_ref` (upsert key) |
| Qty (mts) | 14 | `quantity_mt` |
| Consignee | 10 | `consignee` |
| Load Laycan Start | 23 | `laycan_start` |
| Load Laycan End | 24 | `laycan_end` |
| Quarter | 46 | notes alanına yazılıyor |

**Houston arrival:** `laycan_start + 32 gün` (preliminary transit süresi)

**cargo_plan_items mapping (kolon index → cargo_type):**

| Index | Kargo Tipi |
|---|---|
| 47 | Gray Portland Bulk |
| 48 | Gray Portland SS |
| 49 | Gray Masonry |
| 50 | White Masonry |
| 51 | White Portland |
| 52 | Slag |
| 53 | White Portland SS 525R |
| 54 | White Portland SS C150 |
| 55 | White Masonry SS |
| 56 | Lime |

**Upsert strategy:** `cargo_ref` unique conflict → update (planning güncellemelerinde çalışır)

---

## İş Mantığı Notları

### Transit Süresi
- Abu Qir → Houston: **32 gün** (preliminary)
- Gemi atandıktan sonra gerçek ETA armator/acenta emailinden güncellenir
- Güncelleme: `berth_schedule.eta` (live) — `cargo_plans.discharge_eta` değişmez

### Laycan Nomination
- `laycan_nomination_due_date` = `laycan_start - 25 gün` (DB trigger otomatik hesaplar)
- Chartering ekibi nomination yapar → status `LAYCAN_NOMINATED`

### Veri Akışı
1. **Planning** → Excel'den import (Cargo Ref, Qty, Laycan, Vessel, Consignee)
2. **Chartering** → CP Ref, freight rate, demurrage, agents ekler
3. **Operations** → Berth schedule, ETA updates, ops start/end
4. **Finance** → Payment orders, claims

### Kargo Breakdown
- Her cargo plan için birden fazla kargo tipi olabilir (`cargo_plan_items`)
- Inventory takibinde kargo tipine göre silo hareketi yapılacak
- Steel de dahil edilecek (ilerleyen dönem)

---

## Sıradaki Adımlar (öncelik sırasına göre)

1. **Import sayfası test** — VS_Structured.xlsx'i yükle, 54 satırı import et
2. **Cargo Plans detay sayfası** — satıra tıklayınca açılsın, cargo_plan_items göstersin
3. **Status güncelleme** — Cargo plan status'unu değiştirme (PLANNED → OPEN_FOR_FIXTURE vb.)
4. **Terminals & Ports veri girişi** — Houston, Tampa, Wingate, Abu Qir terminal kayıtları
5. **Voyages sayfası** — cargo plan'a voyage bağla
6. **Berth Schedule** — Gantt chart, ETA takibi
7. **Vessel nomination flow** — cargo plan'dan vessel ata → status güncelle
8. **Inventory modülü** — silo seviyeleri, kargo tipi bazında hareket
9. **Laytime hesabı** — NOR, ops start/end, allowed time, demurrage/despatch
10. **Payment Orders** — finance modülü
11. **Dashboard KPI'ları** — gerçek sayılar (şu an hepsi 0)

---

## Bilinen Sorunlar / Dikkat Edilecekler

1. `cargo_plans.load_port` ve `discharge_port` serbest text — FK bağlantısı yok. İleride `ports` tablosuna bağlanacak.
2. `voyages` tablosunda `cargo_ref` text kolonu var — `cargo_plans.id` FK'sı da var, ikisi birden kullanılıyor, temizlenecek.
3. Excel import'ta `discharge_port` hardcoded `'Houston'` — çoklu port desteği eklenecek.
4. `npm audit` 1 high severity vulnerability (xlsx paketi) — production'da `exceljs` ile replace edilecek.
5. `app/page.tsx` hâlâ Next.js default sayfası — `/login`'e redirect eklenecek.
