# Plan d'implémentation — MCP Server pour Louez

> Serveur Model Context Protocol permettant aux loueurs de gérer intégralement leur business de location via un assistant IA.

---

## 1. Synthèse du projet Louez

### Architecture existante

| Couche | Technologie |
|--------|-------------|
| Monorepo | Turborepo + pnpm workspaces |
| Runtime | Next.js 16 (App Router), React 19 |
| BDD | MySQL 8, Drizzle ORM |
| Auth | Better Auth (OAuth, Magic Link, OTP) |
| API | oRPC (type-safe RPC) |
| Validation | Zod |
| Paiements | Stripe Connect |

### Modèle de données — Entités principales

```
users ─1:N─ storeMembers ─N:1─ stores
                                  │
          ┌───────────────────────┼──────────────────────────┐
          │                       │                          │
     categories ─1:N─ products   customers              reservations
                        │           │                       │
                   pricingTiers  customerSessions    reservationItems
                   seasonalPricing                    │          │
                   productUnits                  payments   documents
                   productAccessories            activity   inspections
                   productsTulip                              │
                                                        inspectionItems
                                                        inspectionFieldValues
                                                        inspectionPhotos
```

### Modèles détaillés (30+ tables)

**Auth & Users** : `users`, `accounts`, `sessions`, `verification`

**Multi-tenant** : `stores` (config, branding, Stripe Connect, settings JSON), `storeMembers` (owner/member), `storeInvitations`, `subscriptions`

**Catalogue** : `categories`, `products` (pricing mode hour/day/week, stock, unit tracking, booking attributes), `productPricingTiers`, `productSeasonalPricing`, `productSeasonalPricingTiers`, `productUnits`, `productAccessories`, `productsTulip`

**Clients** : `customers` (individual/business, contact, adresse), `customerSessions`, `verificationCodes`

**Réservations** : `reservations` (status workflow: pending→confirmed→ongoing→completed / rejected/cancelled, montants, livraison, promo, Tulip assurance), `reservationItems` (snapshot produit, prix, taxe), `reservationItemUnits`

**Paiements** : `payments` (rental/deposit/deposit_hold/deposit_capture/deposit_return/damage/adjustment × stripe/cash/card/transfer/check/other), `paymentRequests`

**Documents** : `documents` (contract/invoice PDF)

**Communications** : `emailLogs`, `smsLogs`, `discordLogs`, `smsCredits`, `smsTopupTransactions`, `reminderLogs`, `reviewRequestLogs`

**Analytics** : `pageViews`, `storefrontEvents`, `dailyStats`, `productStats`

**Inspections** : `inspectionTemplates`, `inspectionTemplateFields`, `inspections`, `inspectionItems`, `inspectionFieldValues`, `inspectionPhotos`

**Promotions** : `promoCodes`

### API existante (oRPC)

- **Dashboard** : `ping`, `customers.list`, `reservations.*` (20 procédures), `settings.*`, `integrations.*`, `onboarding.*`
- **Storefront** : `storeInfo`, `availability.*`, `reservations.*`
- **Public** : `address.*`

### Patterns de sécurité

- Isolation multi-tenant systématique (`storeId` dans toutes les requêtes)
- Auth via Better Auth (session cookie)
- Rôles : `owner` (accès complet), `member` (lecture/écriture)
- `requirePermission('write')` pour les mutations
- Validation Zod sur tous les inputs

---

## 2. Objectif du MCP Server

Permettre à un assistant IA (Claude, etc.) de **gérer intégralement** le business d'un loueur :
- Consulter et gérer le catalogue (produits, catégories, prix)
- Gérer les réservations (créer, modifier, confirmer, annuler)
- Gérer les clients (consulter, créer, mettre à jour)
- Gérer les paiements (enregistrer, demander, consulter)
- Consulter les analytics et statistiques
- Gérer les paramètres du store (identité, horaires, livraison, notifications)
- Gérer les inspections (états des lieux)
- Gérer les codes promo

---

## 3. Architecture technique

### 3.1 Nouveau package : `packages/mcp`

```
packages/mcp/
├── package.json              # @louez/mcp
├── tsconfig.json
└── src/
    ├── index.ts              # Point d'entrée (export serveur)
    ├── server.ts             # Création du McpServer + enregistrement tools/resources
    ├── auth/
    │   ├── api-keys.ts       # Validation des clés API par store
    │   └── context.ts        # Résolution du contexte (store, user, permissions)
    ├── tools/
    │   ├── index.ts           # Barrel export
    │   ├── products.ts        # list, get, create, update, archive
    │   ├── categories.ts      # list, get, create, update, delete
    │   ├── reservations.ts    # list, get, create, updateStatus, cancel, updateNotes, update
    │   ├── customers.ts       # list, get, create, update
    │   ├── payments.ts        # list, record, delete, requestPayment, returnDeposit, recordDamage
    │   ├── analytics.ts       # getDashboardStats, getProductStats, getRevenueReport
    │   ├── settings.ts        # getStoreInfo, updateStoreInfo, updateLegal, updateAppearance
    │   ├── promo-codes.ts     # list, get, create, update, delete
    │   ├── inspections.ts     # list, get, getTemplates
    │   └── calendar.ts        # getAvailability, getUpcoming, getOverdue
    ├── resources/
    │   ├── index.ts
    │   ├── store-info.ts      # Resource statique : infos du store connecté
    │   └── business-summary.ts # Resource dynamique : résumé business (KPI)
    ├── prompts/
    │   ├── index.ts
    │   ├── daily-report.ts    # Prompt : rapport quotidien
    │   └── reservation-assist.ts # Prompt : aide à la gestion de réservation
    ├── services/
    │   ├── index.ts
    │   ├── product-service.ts   # Logique métier produits (réutilise @louez/db + @louez/utils)
    │   ├── reservation-service.ts
    │   ├── customer-service.ts
    │   ├── payment-service.ts
    │   ├── analytics-service.ts
    │   ├── settings-service.ts
    │   └── promo-code-service.ts
    ├── utils/
    │   ├── formatting.ts      # Formatage monétaire, dates
    │   ├── pagination.ts      # Helpers pagination
    │   └── errors.ts          # Erreurs MCP standardisées
    └── transports/
        ├── stdio.ts           # Transport stdio (usage CLI)
        └── http.ts            # Transport Streamable HTTP (intégration Next.js)
```

### 3.2 Intégration dans le monorepo

```jsonc
// packages/mcp/package.json
{
  "name": "@louez/mcp",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./stdio": "./src/transports/stdio.ts",
    "./http": "./src/transports/http.ts"
  },
  "dependencies": {
    "@louez/db": "workspace:*",
    "@louez/types": "workspace:*",
    "@louez/utils": "workspace:*",
    "@louez/validations": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.x",
    "zod": "^3.25",
    "nanoid": "^5"
  }
}
```

### 3.3 Route HTTP Next.js

```
apps/web/app/api/mcp/[...path]/route.ts
```

Cette route expose le MCP server via Streamable HTTP, protégée par authentification API key.

### 3.4 Commande CLI

Le transport stdio sera exposé via un script dans `package.json` :

```jsonc
{
  "scripts": {
    "mcp:stdio": "tsx packages/mcp/src/transports/stdio.ts"
  }
}
```

---

## 4. Authentification & Sécurité

### 4.1 Schéma BDD — Nouvelle table `store_api_keys`

```sql
CREATE TABLE store_api_keys (
  id          VARCHAR(21) PRIMARY KEY,  -- nanoid
  store_id    VARCHAR(21) NOT NULL,
  user_id     VARCHAR(21) NOT NULL,     -- créateur de la clé
  name        VARCHAR(100) NOT NULL,    -- ex: "Claude Desktop"
  key_hash    VARCHAR(255) NOT NULL,    -- SHA-256 du secret
  key_prefix  VARCHAR(8) NOT NULL,      -- 8 premiers chars pour identification
  permissions JSON,                     -- permissions granulaires (null = toutes)
  last_used_at TIMESTAMP,
  expires_at   TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMP,              -- null = active

  INDEX (store_id),
  INDEX (key_hash),
  UNIQUE (key_prefix, store_id)
);
```

### 4.2 Format de la clé API

```
louez_sk_{storeId-prefix}_{random-32-chars}
```

- Préfixe `louez_sk_` pour identification facile
- Le hash SHA-256 est stocké en BDD (jamais le secret en clair)
- La clé complète n'est montrée qu'une seule fois à la création

### 4.3 Flow d'authentification

```
Client MCP → Header: Authorization: Bearer louez_sk_xxx...
       ↓
Route HTTP MCP → Extraire clé → Hash SHA-256
       ↓
Lookup store_api_keys WHERE key_hash = ? AND revoked_at IS NULL
       ↓
Si trouvé → Charger store + user → Vérifier permissions
       ↓
Injecter contexte { store, user, permissions } dans le serveur MCP
```

### 4.4 Permissions granulaires

```typescript
type McpPermissions = {
  products: ('read' | 'write')[]
  categories: ('read' | 'write')[]
  reservations: ('read' | 'write')[]
  customers: ('read' | 'write')[]
  payments: ('read' | 'write')[]
  analytics: ('read')[]
  settings: ('read' | 'write')[]
  promoCodes: ('read' | 'write')[]
  inspections: ('read')[]
}
```

Si `permissions` est `null` dans la table, toutes les permissions sont accordées (clé "admin").

### 4.5 Mesures de sécurité

| Mesure | Description |
|--------|-------------|
| **Isolation multi-tenant** | Toutes les requêtes filtrées par `storeId` (pattern existant) |
| **Hash des clés** | SHA-256 stocké, jamais le secret en clair |
| **Rate limiting** | Limite par clé API (60 req/min par défaut) |
| **Expiration** | Support des clés avec date d'expiration |
| **Révocation** | Possibilité de révoquer instantanément une clé |
| **Audit trail** | `last_used_at` mis à jour à chaque usage |
| **Permissions granulaires** | Contrôle fin par domaine (read/write) |
| **Validation Zod** | Tous les inputs des tools validés avec Zod |

---

## 5. Catalogue des Tools MCP

### 5.1 Produits (`tools/products.ts`)

| Tool | Description | Input | Permission |
|------|-------------|-------|------------|
| `products_list` | Lister les produits du store | `{ status?, categoryId?, search?, limit?, offset? }` | products:read |
| `products_get` | Détail d'un produit | `{ productId }` | products:read |
| `products_create` | Créer un produit | `{ name, description?, categoryId?, price, deposit?, pricingMode, quantity?, images? }` | products:write |
| `products_update` | Modifier un produit | `{ productId, name?, price?, status?, ... }` | products:write |
| `products_archive` | Archiver un produit | `{ productId }` | products:write |
| `products_get_availability` | Vérifier la disponibilité | `{ productId, startDate, endDate }` | products:read |

### 5.2 Catégories (`tools/categories.ts`)

| Tool | Description | Input | Permission |
|------|-------------|-------|------------|
| `categories_list` | Lister les catégories | `{ }` | products:read |
| `categories_create` | Créer une catégorie | `{ name, description? }` | products:write |
| `categories_update` | Modifier une catégorie | `{ categoryId, name?, description? }` | products:write |
| `categories_delete` | Supprimer une catégorie | `{ categoryId }` | products:write |

### 5.3 Réservations (`tools/reservations.ts`)

| Tool | Description | Input | Permission |
|------|-------------|-------|------------|
| `reservations_list` | Lister les réservations | `{ status?, period?, search?, limit?, page? }` | reservations:read |
| `reservations_get` | Détail d'une réservation | `{ reservationId }` | reservations:read |
| `reservations_create` | Créer une réservation manuelle | `{ customerId/newCustomer, startDate, endDate, items[], delivery?, notes? }` | reservations:write |
| `reservations_update_status` | Changer le statut | `{ reservationId, status, rejectionReason? }` | reservations:write |
| `reservations_cancel` | Annuler une réservation | `{ reservationId }` | reservations:write |
| `reservations_update` | Modifier dates/items/prix | `{ reservationId, startDate?, endDate?, items? }` | reservations:write |
| `reservations_update_notes` | Modifier les notes internes | `{ reservationId, notes }` | reservations:write |
| `reservations_send_email` | Envoyer un email au client | `{ reservationId, templateId, customSubject?, customMessage? }` | reservations:write |

### 5.4 Clients (`tools/customers.ts`)

| Tool | Description | Input | Permission |
|------|-------------|-------|------------|
| `customers_list` | Lister les clients | `{ search?, sort?, type? }` | customers:read |
| `customers_get` | Détail d'un client | `{ customerId }` | customers:read |
| `customers_create` | Créer un client | `{ email, firstName, lastName, phone?, customerType?, companyName? }` | customers:write |
| `customers_update` | Modifier un client | `{ customerId, firstName?, lastName?, email?, phone?, address? }` | customers:write |

### 5.5 Paiements (`tools/payments.ts`)

| Tool | Description | Input | Permission |
|------|-------------|-------|------------|
| `payments_list` | Lister les paiements d'une réservation | `{ reservationId }` | payments:read |
| `payments_record` | Enregistrer un paiement | `{ reservationId, type, amount, method, notes? }` | payments:write |
| `payments_delete` | Supprimer un paiement | `{ paymentId }` | payments:write |
| `payments_request` | Envoyer une demande de paiement | `{ reservationId, type, amount?, channels }` | payments:write |
| `payments_return_deposit` | Restituer un dépôt | `{ reservationId, amount, method, notes? }` | payments:write |
| `payments_record_damage` | Enregistrer un dommage | `{ reservationId, amount, method, notes }` | payments:write |

### 5.6 Analytics (`tools/analytics.ts`)

| Tool | Description | Input | Permission |
|------|-------------|-------|------------|
| `analytics_dashboard` | KPI du dashboard (revenus, réservations, visiteurs) | `{ period? }` | analytics:read |
| `analytics_products` | Top produits (vues, réservations, revenus) | `{ period?, limit? }` | analytics:read |
| `analytics_revenue` | Revenus par période | `{ startDate, endDate, granularity? }` | analytics:read |

### 5.7 Paramètres (`tools/settings.ts`)

| Tool | Description | Input | Permission |
|------|-------------|-------|------------|
| `settings_get_store` | Infos du store | `{ }` | settings:read |
| `settings_update_store` | Modifier les infos store | `{ name?, description?, email?, phone?, address? }` | settings:write |
| `settings_update_legal` | Modifier les mentions légales | `{ cgv?, legalNotice? }` | settings:write |
| `settings_update_appearance` | Modifier l'apparence | `{ primaryColor?, mode? }` | settings:write |

### 5.8 Codes Promo (`tools/promo-codes.ts`)

| Tool | Description | Input | Permission |
|------|-------------|-------|------------|
| `promo_codes_list` | Lister les codes promo | `{ }` | promoCodes:read |
| `promo_codes_create` | Créer un code promo | `{ code, type, value, minimumAmount?, maxUsageCount?, startsAt?, expiresAt? }` | promoCodes:write |
| `promo_codes_update` | Modifier un code promo | `{ promoCodeId, isActive?, ... }` | promoCodes:write |
| `promo_codes_delete` | Supprimer un code promo | `{ promoCodeId }` | promoCodes:write |

### 5.9 Calendrier (`tools/calendar.ts`)

| Tool | Description | Input | Permission |
|------|-------------|-------|------------|
| `calendar_upcoming` | Prochains départs/retours | `{ days? }` | reservations:read |
| `calendar_overdue` | Retours en retard | `{ }` | reservations:read |
| `calendar_availability` | Disponibilité sur une période | `{ startDate, endDate, productId? }` | products:read |

### 5.10 Inspections (`tools/inspections.ts`)

| Tool | Description | Input | Permission |
|------|-------------|-------|------------|
| `inspections_list` | Lister les inspections d'une réservation | `{ reservationId }` | inspections:read |
| `inspections_get` | Détail d'une inspection | `{ inspectionId }` | inspections:read |
| `inspections_get_templates` | Lister les templates d'inspection | `{ }` | inspections:read |

---

## 6. Resources MCP

| Resource | URI | Description |
|----------|-----|-------------|
| `store-info` | `louez://store/info` | Informations du store (nom, contact, config) |
| `business-summary` | `louez://store/summary/{period}` | Résumé business : revenus, réservations en cours, taux d'occupation |

---

## 7. Prompts MCP

| Prompt | Description | Arguments |
|--------|-------------|-----------|
| `daily-report` | Génère un rapport quotidien structuré | `{ date? }` |
| `reservation-assist` | Aide à gérer une réservation spécifique | `{ reservationId }` |

---

## 8. Plan d'implémentation — Phases

### Phase 1 : Fondations (Priorité haute)

**Objectif** : Package MCP fonctionnel avec auth et premiers tools

| # | Tâche | Fichiers | Détails |
|---|-------|----------|---------|
| 1.1 | Créer le package `@louez/mcp` | `packages/mcp/package.json`, `tsconfig.json` | Dépendances : `@modelcontextprotocol/sdk`, `@louez/db`, `@louez/types`, `@louez/utils`, `@louez/validations`, `zod` |
| 1.2 | Schéma BDD `store_api_keys` | `packages/db/src/schema.ts` | Ajouter table + relations + migration |
| 1.3 | Module d'authentification API key | `packages/mcp/src/auth/api-keys.ts`, `context.ts` | Hash SHA-256, lookup, validation expiration/révocation |
| 1.4 | Création du serveur MCP | `packages/mcp/src/server.ts` | Instance `McpServer` avec configuration |
| 1.5 | Transport stdio | `packages/mcp/src/transports/stdio.ts` | Pour usage local (Claude Desktop, CLI) |
| 1.6 | Transport HTTP | `packages/mcp/src/transports/http.ts` | Pour intégration web |
| 1.7 | Route Next.js MCP | `apps/web/app/api/mcp/[...path]/route.ts` | Endpoint HTTP avec auth API key |
| 1.8 | Utils : erreurs, formatage, pagination | `packages/mcp/src/utils/*` | Helpers réutilisables |

### Phase 2 : Tools de lecture (Priorité haute)

**Objectif** : Tous les tools de consultation (read)

| # | Tâche | Fichiers | Détails |
|---|-------|----------|---------|
| 2.1 | Service + tool produits (list, get, availability) | `services/product-service.ts`, `tools/products.ts` | Réutiliser les queries Drizzle existantes |
| 2.2 | Service + tool catégories (list) | `services/product-service.ts`, `tools/categories.ts` | |
| 2.3 | Service + tool réservations (list, get) | `services/reservation-service.ts`, `tools/reservations.ts` | Réutiliser `getDashboardReservationsList`, `getDashboardReservationById` de `@louez/api/services` |
| 2.4 | Service + tool clients (list, get) | `services/customer-service.ts`, `tools/customers.ts` | |
| 2.5 | Service + tool paiements (list) | `services/payment-service.ts`, `tools/payments.ts` | |
| 2.6 | Service + tool analytics | `services/analytics-service.ts`, `tools/analytics.ts` | Queries sur `dailyStats`, `productStats` |
| 2.7 | Service + tool settings (get) | `services/settings-service.ts`, `tools/settings.ts` | |
| 2.8 | Tool calendrier (upcoming, overdue, availability) | `tools/calendar.ts` | |
| 2.9 | Tool inspections (list, get, templates) | `tools/inspections.ts` | |
| 2.10 | Tool codes promo (list) | `tools/promo-codes.ts` | |
| 2.11 | Resources : store-info, business-summary | `resources/*` | |
| 2.12 | Prompts : daily-report, reservation-assist | `prompts/*` | |

### Phase 3 : Tools d'écriture (Priorité moyenne)

**Objectif** : Toutes les mutations

| # | Tâche | Fichiers | Détails |
|---|-------|----------|---------|
| 3.1 | Produits : create, update, archive | `services/product-service.ts`, `tools/products.ts` | Validation Zod, insertion Drizzle |
| 3.2 | Catégories : create, update, delete | `tools/categories.ts` | |
| 3.3 | Réservations : create, updateStatus, cancel, update, updateNotes, sendEmail | `tools/reservations.ts` | Réutiliser les patterns du dashboard oRPC (context injection) |
| 3.4 | Clients : create, update | `tools/customers.ts` | |
| 3.5 | Paiements : record, delete, requestPayment, returnDeposit, recordDamage | `tools/payments.ts` | |
| 3.6 | Settings : update store info, legal, appearance | `tools/settings.ts` | |
| 3.7 | Codes promo : create, update, delete | `tools/promo-codes.ts` | |

### Phase 4 : Dashboard de gestion des clés API (Priorité moyenne)

**Objectif** : UI dans le dashboard pour gérer les clés API

| # | Tâche | Fichiers | Détails |
|---|-------|----------|---------|
| 4.1 | Page settings/api-keys | `apps/web/app/(dashboard)/dashboard/settings/api-keys/page.tsx` | Liste des clés, création, révocation |
| 4.2 | Formulaire de création de clé | `apps/web/app/(dashboard)/dashboard/settings/api-keys/api-key-form.tsx` | Nom, permissions, expiration |
| 4.3 | oRPC procedures pour CRUD clés API | `packages/api/src/routers/dashboard/api-keys.ts` | list, create, revoke |
| 4.4 | Affichage unique du secret | Modal modale avec copie en un clic | Ne montrer le secret qu'une seule fois |
| 4.5 | Traductions i18n | `apps/web/messages/fr.json`, `en.json` | Clés pour la section API keys |

### Phase 5 : Qualité & Documentation (Priorité haute)

**Objectif** : Production-ready, exemplaire pour l'open source

| # | Tâche | Fichiers | Détails |
|---|-------|----------|---------|
| 5.1 | Tests unitaires des services MCP | `packages/mcp/src/__tests__/` | Tests pour chaque service (mocks Drizzle) |
| 5.2 | Tests d'intégration du serveur MCP | `packages/mcp/src/__tests__/server.test.ts` | Test end-to-end avec client MCP |
| 5.3 | Documentation README MCP | `packages/mcp/README.md` | Setup, configuration Claude Desktop, liste des tools |
| 5.4 | Documentation API keys | `docs/mcp-api-keys.md` | Guide de sécurité, best practices |
| 5.5 | Type-check et lint | Pipeline Turbo | Intégrer `@louez/mcp` dans les tasks `type-check` et `lint` |
| 5.6 | Rate limiting middleware | `packages/mcp/src/auth/rate-limit.ts` | In-memory rate limiter (60 req/min par clé) |

---

## 9. Détails d'implémentation critiques

### 9.1 Réutilisation maximale du code existant

Le MCP ne doit **pas** dupliquer la logique métier. Stratégie :

1. **Services `@louez/api`** : Réutiliser directement `getDashboardReservationsList`, `getDashboardReservationById`, `getReservationPollData`, `signReservationAsAdmin`, etc.
2. **Schéma `@louez/db`** : Toutes les queries utilisent Drizzle + le schéma existant
3. **Validations `@louez/validations`** : Réutiliser les schémas Zod existants pour l'input des tools
4. **Utils `@louez/utils`** : Réutiliser `hasPermission`, pricing logic, etc.

Pour les mutations qui aujourd'hui passent par le `context.dashboardReservationActions` (server actions injectées), deux approches :
- **Court terme** : Extraire la logique dans des services partagés sous `packages/api/src/services/`
- **Long terme** : Les services MCP appellent directement ces services partagés

### 9.2 Annotations des tools

Chaque tool doit être annoté correctement pour que le client MCP comprenne son comportement :

```typescript
server.registerTool('reservations_list', {
  title: 'List Reservations',
  description: 'List reservations for the connected store with optional filters',
  annotations: {
    readOnlyHint: true,           // Pour les tools de lecture
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: z.object({ ... }),
}, handler)
```

### 9.3 Formatage des réponses

Les tools retournent des données formatées pour être facilement lues par un LLM :

```typescript
// Bon : texte structuré lisible
return {
  content: [{
    type: 'text',
    text: `## Réservation #${res.number}\n` +
          `- Client: ${res.customer.firstName} ${res.customer.lastName}\n` +
          `- Statut: ${res.status}\n` +
          `- Période: ${formatDate(res.startDate)} → ${formatDate(res.endDate)}\n` +
          `- Montant: ${formatCurrency(res.totalAmount)}€\n` +
          `- Articles: ${res.items.length} produit(s)`
  }]
}
```

### 9.4 Gestion des erreurs

```typescript
// Erreurs métier → texte descriptif (pas d'exception)
return {
  content: [{ type: 'text', text: 'Erreur : Ce produit n\'a pas assez de stock pour cette période.' }],
  isError: true,
}

// Erreurs système → throw ORPCError
throw new McpError(ErrorCode.InternalError, 'Database connection failed')
```

### 9.5 Transport HTTP — Intégration Next.js

```typescript
// apps/web/app/api/mcp/[...path]/route.ts
import { createMcpServer } from '@louez/mcp'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/node.js'

export async function POST(request: Request) {
  // 1. Extraire et valider la clé API
  const apiKey = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!apiKey) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Résoudre le contexte (store, user, permissions)
  const context = await resolveApiKeyContext(apiKey)
  if (!context) return Response.json({ error: 'Invalid API key' }, { status: 401 })

  // 3. Créer le serveur MCP avec le contexte
  const server = createMcpServer(context)

  // 4. Traiter la requête MCP
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(request)
}
```

---

## 10. Configuration pour les clients MCP

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "louez": {
      "command": "npx",
      "args": ["tsx", "packages/mcp/src/transports/stdio.ts"],
      "env": {
        "LOUEZ_API_KEY": "louez_sk_xxx...",
        "DATABASE_URL": "mysql://..."
      }
    }
  }
}
```

### Via HTTP (cloud/self-hosted)

```json
{
  "mcpServers": {
    "louez": {
      "url": "https://app.louez.io/api/mcp",
      "headers": {
        "Authorization": "Bearer louez_sk_xxx..."
      }
    }
  }
}
```

---

## 11. Ordre d'exécution recommandé

```
Phase 1 (Fondations)     ████████████████████  ~2-3 jours
  1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8

Phase 2 (Tools lecture)   ████████████████████  ~2-3 jours
  2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7 → 2.8 → 2.9 → 2.10 → 2.11 → 2.12

Phase 3 (Tools écriture)  ████████████████████  ~2-3 jours
  3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7

Phase 4 (UI Dashboard)    ██████████            ~1-2 jours
  4.1 → 4.2 → 4.3 → 4.4 → 4.5

Phase 5 (Qualité)         ██████████            ~1-2 jours
  5.1 → 5.2 → 5.3 → 5.4 → 5.5 → 5.6
```

**Total estimé** : ~45 tools, 2 resources, 2 prompts

---

## 12. Principes directeurs

1. **Isolation multi-tenant** : Chaque requête est scopée au `storeId` de la clé API. Zéro accès cross-tenant.
2. **Réutilisation** : Pas de duplication de logique. Les services MCP importent `@louez/db`, `@louez/api/services`, `@louez/validations`.
3. **Sécurité par défaut** : Clés hashées, permissions granulaires, rate limiting, expiration.
4. **Exemplaire pour l'open source** : Types stricts, documentation exhaustive, tests, code lisible.
5. **Conventions Louez** : Respect des patterns existants (nanoid IDs, Drizzle queries, Zod validation, module ownership).
6. **Progressif** : Chaque phase est fonctionnelle indépendamment. Phase 1+2 = déjà utile en lecture seule.
