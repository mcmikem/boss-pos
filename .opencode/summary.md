# Project Summary

## Goal
- Add an Expenses tab to the bottom bar so expenses can be tracked and categorized by what's taking the most, and give the cookery/Eatery business a custom format (dish variants/pricing) — starting with cookery first as requested.
- Level 2 recipe costing for Eatery dishes (itemized ingredients, batch yield, overhead, waste %, auto COGS/profit/margin, one-tap suggested-price apply) inside the Stock editor.

## Constraints & Preferences
- Bottom nav stays visible on scroll; now includes Expenses (user: "expenses shd b among the bottom bar... see wats taking more")
- Cookery first (user chose "Cookery first (Recommended)") — lightly tune other categories later, don't build printing jobs / library rentals / etc. yet
- Eatery is a snacks business with exact menu: chappati 500, samosa/sumbusa 300 (couple/pair 500, big 500), egg roll 1000, coconut cookies pair 500, shortbread cookies pair 500, cookies on a plate 2500, sausage 1000, half cakes 500 & 1000, meat samosa 1000, black tea 500, milk tea 1000
- Tailoring stays in the Tailoring category (order screen via "Manage Tailor Orders"), NOT a nav tab
- Must run on old Android browsers (legacy build + downleveled CSS already deployed)
- PIN must not be stored in plaintext (SHA-256 with cyrb53 fallback)

## Progress
### Done
- **Expenses tab**: `src/components/Expenses.tsx` — time filter (Today / 7 Days / This Month / All), Total Spent + Top Expense cards, "Where the money goes" ranked category breakdown with color bars + %, expense history with delete, category manager modal, wired to `QuickExpenseModal`
- **App.tsx wiring**: `Wallet` icon, lazy `Expenses`, `activeTab` union extended, "Spend" nav button between Stock and Reports
- **Product variants model**: `ProductVariant { id, label, price, cost? }`, `Product.variants?`, `SaleItem.variantId?/variantLabel?`
- **API variants support**: `variants TEXT` column (CREATE TABLE + guarded ALTER), INSERT/UPDATE persist JSON, `mapProduct` parses
- **Eatery menu seeds**: prod-100..prod-110 + `syncEateryMenu()` (ON CONFLICT DO NOTHING); supplier `sup-5`; variants for samosa/cookies/half cake
- **Sales cart refactor**: composite key `${productId}::${variantId || ''}`; `handleVariantAdd`/`addCartLine`; variant-gated `handleAddToCart`; variant labels shown in main/mobile/quick-sale carts and receipt
- **Sales variant picker**: bottom-sheet modal (z-[90], `animate-slide-up`) rendered after ProfitAnalyzerModal
- **ProductCard**: variant products show `minPrice+` and "Options" badge instead of qty stepper
- **Inventory variant editor**: "Product Options" in both Edit and Add-Product modals (label + price + optional cost)
- **ProfitAnalyzer**: variant-aware rows (per-variant cost/price/profit/margin)
- **Cache version stamp**: `boss_pos_products_cache_v2` so old cached products (without variants/Eatery) are ignored after redeploy
- All committed/pushed/deployed: `22803d3` (feat: expenses + variants), `59d9bc9` (fix: cache version)
- **Recipe costing (Level 2)**: `RecipeIngredient { id, name, qty, unit, unitCost, wastePct }`, `Recipe { ingredients, yield, overhead, targetMarginPct }`, `Product.recipe?`; `src/utils/recipe.ts` (NEW) with `RECIPE_UNITS`, `emptyRecipe()`, `ingredientCost()` (waste-adjusted `qty×cost÷(1−waste%)`), `calculateRecipe()` (batchCost/totalCost/COGS-unit/profit/margin/suggestedPrice/isLoss/isUnderpriced), `suggestedFor()`, `effectiveCost()` (recipe COGS else typed cost)
- **api/index.js**: guarded `recipe TEXT` column, INSERT/UPDATE persist JSON, `mapProduct` parses
- **Inventory.tsx**: `renderRecipeCard` (ingredient rows + unit dropdowns + waste %, yield/overhead/target-margin inputs, live calc panel, "Apply Suggested Prices" button) shown only when category is Eatery in both Add & Edit modals; `sanitizeRecipe()`; category-select seeds `emptyRecipe()` on Eatery; stock list label `COGS` for Eatery via `effectiveCost`
- **ProductCard.tsx**: Eatery margin badge (`+N%` emerald/amber, red `LOSS`); **ProfitAnalyzerModal.tsx**: recipe-aware COGS (`effectiveCost`, per-variant fallback)
- **Cache version v3** so stale products reload. Committed/pushed: `74507f5` (eatery cleanup + catalog sync + offline idempotency + audit trail), `68f8452` (recipe costing)
- **Offline readiness fixes**: `/api/auth/verify` returns the stored PIN `hash` and `authVerify()` caches it to `boss_pos_pin`, so a fresh device that unlocks once online can unlock offline later; `api()` gained a `store` TTL flag so `settingsApi.get` caches settings for 24h (offline boot keeps shop name/categories). Pushed: `bb0b57c`

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Separate "Spend" (Expenses) nav tab for expense tracking, "Reports" keeps analytics overview
- Variants as JSON on the product row (not a separate table) — simplest for offline sync
- Same dish + different variant = separate cart line (composite key) so samosa single/couple/big coexist
- Variant products in Sales show "Options" badge, no qty stepper — tap opens picker
- Eatery menu seeded with ON CONFLICT DO NOTHING so user edits aren't overwritten
- Continue shipped stack: legacy build for old Android, `deLayerCSS` + lightningcss downlevel, SHA-256 PNG hashing

## Next Steps
- Ask user to verify on device (hard refresh loads fresh products due to cache v3)
- If user wants: default Sales category to Eatery when `shopType === 'eatery'`; variant-aware sales history/Analytics export
- Later: lightly tune other categories (printing jobs, library rentals, etc.) when user requests
- If user wants deeper costing: track ingredient stock / auto-deduct on sale (Level 3)

## Critical Context
- Commits pushed: `bb0b57c` (HEAD, offline settings cache + cached-PIN unlock), `68f8452` (recipe costing), `74507f5` (eatery cleanup + catalog sync + offline idempotency + audit trail), `59d9bc9` (cache v2), `22803d3` (expenses + variants), `178269c` (tailoring + fixes), `9291e4a` (old Android support), `dafd0dc` (tailor into Tailoring)
- Vercel prod: `https://imac-pos.vercel.app` (project `imac-pos`, CLI 51.7.0 at `/usr/local/bin/vercel`)
- Old-Android stack already live: `@vitejs/plugin-legacy@^6.1.1` (NOT v8), `lightningcss@^1.33.0`, `deLayerCSS()` unwraps `@layer` + converts `oklch()`→`rgb()`, targets `Android >= 5 / Chrome >= 49 / iOS >= 12 / Safari >= 12`, all 107 `color-mix` guarded by `@supports`
- `src/utils/crypto.ts`: SHA-256 via `crypto.subtle` with `cyrb53` fallback prefixed `fb_`
- Old plaintext PINs won't match new hashes — users must clear/re-set PIN
- `products.imageurl` + `variants` via CREATE TABLE + guarded ALTER TABLE; upload 200px / JPEG 0.6 / max 100KB
- Recipe costing: `recipe TEXT` column (guarded ALTER); suggested price = `COGS/unit ÷ (1 − targetMargin/100)`; waste lowers ingredient cost via `÷(1−waste/100)`
- Tailoring: routes `GET/POST /api/tailoring-orders`, `PUT/DELETE /api/tailoring-orders/:id`; workTypes `repair | custom | sportswear`; statuses `pending | in_progress | completed | delivered`
- Caches: `boss_pos_products_cache_v3` (30min localStorage), `boss_api_cache_*` (5min API)

## Relevant Files
- `src/utils/recipe.ts` (NEW): recipe math + unit options + `effectiveCost`
- `src/components/Inventory.tsx`: Recipe Costing card in Add/Edit modals (Eatery only), `sanitizeRecipe`, COGS label
- `src/components/ProductCard.tsx`: Eatery margin badge
- `src/components/ProfitAnalyzerModal.tsx`: recipe-aware COGS
- `src/components/Expenses.tsx` (NEW): expenses tab — breakdown, history, QuickExpenseModal, category manager
- `src/App.tsx`: Expenses lazy route + "Spend" nav button
- `src/types.ts`: `ProductVariant`, `Product.variants`, `SaleItem.variantId/variantLabel`
- `api/index.js`: `variants` column, product INSERT/UPDATE/mapProduct, EATERY_MENU seeds, `syncEateryMenu()`
- `src/components/Sales.tsx`: `variantProduct` state, `addCartLine`/`handleVariantAdd`, composite keys, variant picker modal, variant labels in carts
- `src/components/ProductCard.tsx`: variant-aware card — `hasVariants`/`minPrice`, "Options" badge
- `src/components/Inventory.tsx`: Product Options editor in Edit + Add modals
- `src/components/ProfitAnalyzerModal.tsx`: per-variant profit rows
- `src/components/Dashboard.tsx`: receipt shows variantLabel
- `src/utils/cache.ts`: versioned products cache key
- `vite.config.ts`: legacy plugin + `deLayerCSS()` + lightningcss downlevel
- `src/utils/crypto.ts`: SHA-256 hashPin with cyrb53 fallback
