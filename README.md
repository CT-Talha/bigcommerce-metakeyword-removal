# BigCommerce — Bulk Remove Meta Keywords

A Node.js CLI tool to bulk-clear `meta_keywords` from all products in your BigCommerce store using the API.

---

## Requirements

- **Node.js v18+** (uses native `fetch` — no `npm install` needed)
- A BigCommerce **API Account** with scope: `Products → Modify`

---

## Setup — Create an API Account

1. Go to your BigCommerce Admin → **Settings → API Accounts → Create API Account**
2. Set the name (e.g. "Meta Keywords Cleanup")
3. Under OAuth Scopes, set **Products** → `Modify`
4. Save and copy your **Store Hash** and **Access Token**

---

## Usage

### Step 1 — Test on a single product first (recommended)

```bash
node remove-meta-keywords.js --test
```

This will:
- Ask for your Store Hash and Access Token
- Ask for a specific Product ID
- Show you the current meta_keywords on that product
- Clear them and verify the result
- Confirm your name/ID/other data is untouched

### Step 2 — Run on all products

```bash
node remove-meta-keywords.js
```

This will:
- Validate your credentials
- Fetch every product ID in your store
- Group them into batches of 10
- Send a `PUT` request per batch with `meta_keywords: []`
- Ask for confirmation before making any changes
- Show a live progress counter and final summary

---

## What Gets Changed?

| Field | Changed? |
|---|---|
| `meta_keywords` | ✅ Cleared to `[]` |
| Product name | ❌ Never touched |
| Product ID | ❌ Never touched (read-only) |
| Price, SKU, description | ❌ Never touched |
| Images, categories | ❌ Never touched |
| `meta_description` | ❌ Never touched |
| Any other field | ❌ Never touched |

The API only updates fields you explicitly include in the request body.

---

## Rate Limits & Safety

- 300ms delay between each batch of 10 products
- If a batch fails, the script logs the error and continues with remaining batches
- Failed product IDs are reported at the end so you can retry

---

## Example Output

```
╔══════════════════════════════════════════════════════════╗
║       BigCommerce — Remove Meta Keywords  [TEST MODE]    ║
╚══════════════════════════════════════════════════════════╝

▶  Enter your BigCommerce credentials
  Store Hash    : abc123xyz
  Access Token  : **********************

▶  Validating credentials...
  ✅ Credentials valid! Store has 847 total products.

  Enter a Product ID to test on: 101

▶  TEST MODE — Running on Product ID: 101
  Fetching current meta_keywords...
  Product Name   : Blue Running Shoes
  Product ID     : 101
  Current keywords (3): shoes, running, sport

  Proceed to clear keywords on this product? (yes/no): yes
  Sending PUT request...
  Verifying result...
  ✅ Test PASSED! meta_keywords are now empty.
  Product name is still: "Blue Running Shoes" (unchanged ✅)
  Product ID is still  : 101 (unchanged ✅)
```
