#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║     BigCommerce — Bulk Remove Meta Keywords from Products    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node remove-meta-keywords.js            → Full run (all products)
 *   node remove-meta-keywords.js --test     → Test mode (1 product only)
 *
 * What it does:
 *   1. Asks for your Store Hash and API Access Token
 *   2. Fetches all product IDs from your store
 *   3. Splits them into batches of 10 (API limit)
 *   4. Sends a PUT request per batch with meta_keywords: []
 *   5. Only touches meta_keywords — nothing else changes
 */

import readline from "readline";

// ─────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────
const BATCH_SIZE = 10;       // BigCommerce hard limit
const PAGE_LIMIT = 250;      // Products per GET page (max allowed)
const DELAY_MS   = 300;      // Pause between PUT requests (rate-limit safety)

const isTestMode = process.argv.includes("--test");

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function log(msg)        { console.log(`  ${msg}`); }
function logStep(msg)    { console.log(`\n▶  ${msg}`); }
function logSuccess(msg) { console.log(`  ✅ ${msg}`); }
function logWarn(msg)    { console.log(`  ⚠️  ${msg}`); }
function logError(msg)   { console.error(`  ❌ ${msg}`); }

// ─────────────────────────────────────────────
//  Prompt Helper
// ─────────────────────────────────────────────

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden) {
      // Hide token input from terminal
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      let input = "";
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", function handler(char) {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", handler);
          process.stdout.write("\n");
          rl.close();
          resolve(input);
        } else if (char === "\u0003") {
          process.exit(); // Ctrl+C
        } else if (char === "\u007F") {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(question + "*".repeat(input.length));
          }
        } else {
          input += char;
          process.stdout.write("*");
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

// ─────────────────────────────────────────────
//  BigCommerce API Calls
// ─────────────────────────────────────────────

function buildHeaders(token) {
  return {
    "X-Auth-Token": token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Fetch ALL product IDs by paging through GET /v3/catalog/products
 * Only requests id field to keep responses tiny and fast.
 */
async function fetchAllProductIds(storeHash, token) {
  const headers = buildHeaders(token);
  let page = 1;
  let totalPages = 1;
  const allIds = [];

  do {
    const url =
      `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products` +
      `?include_fields=id&limit=${PAGE_LIMIT}&page=${page}`;

    const res = await fetch(url, { method: "GET", headers });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GET /products failed (${res.status}): ${body}`);
    }

    const json = await res.json();
    const ids = (json.data || []).map((p) => p.id);
    allIds.push(...ids);

    // Read pagination info
    const pagination = json.meta?.pagination;
    if (pagination) {
      totalPages = pagination.total_pages;
      log(`  Fetched page ${page}/${totalPages} — ${ids.length} products`);
    }

    page++;
  } while (page <= totalPages);

  return allIds;
}

/**
 * Send a single batch of up to 10 products to clear their meta_keywords.
 * Only sends: { id, meta_keywords: [] } — nothing else.
 */
async function clearMetaKeywordsBatch(storeHash, token, productIds) {
  const headers = buildHeaders(token);
  const url = `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products`;

  const body = productIds.map((id) => ({
    id,
    meta_keywords: [],
  }));

  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`PUT /products failed (${res.status}): ${errBody}`);
  }

  const json = await res.json();
  return json.data || [];
}

// ─────────────────────────────────────────────
//  Test Mode: verify on a single product
// ─────────────────────────────────────────────

async function runTestMode(storeHash, token, productId) {
  logStep(`TEST MODE — Running on Product ID: ${productId}`);

  // 1. Fetch current state
  log("Fetching current meta_keywords for this product...");
  const getUrl =
    `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${productId}` +
    `?include_fields=id,name,meta_keywords`;

  const getRes = await fetch(getUrl, {
    method: "GET",
    headers: buildHeaders(token),
  });

  if (!getRes.ok) {
    const body = await getRes.text();
    throw new Error(`GET product failed (${getRes.status}): ${body}`);
  }

  const { data: product } = await getRes.json();
  const currentKeywords = product.meta_keywords || [];

  log(`Product Name   : ${product.name}`);
  log(`Product ID     : ${product.id}`);
  log(
    `Current keywords (${currentKeywords.length}): ${
      currentKeywords.length > 0 ? currentKeywords.join(", ") : "(none)"
    }`
  );

  if (currentKeywords.length === 0) {
    logWarn("This product already has no meta keywords. Test will still run.");
  }

  // 2. Confirm
  const confirm = await prompt("\n  Proceed to clear keywords on this product? (yes/no): ");
  if (confirm.toLowerCase() !== "yes") {
    log("Test cancelled.");
    return;
  }

  // 3. Clear
  log("Sending PUT request...");
  await clearMetaKeywordsBatch(storeHash, token, [productId]);

  // 4. Verify
  log("Verifying result...");
  const verifyRes = await fetch(getUrl, {
    method: "GET",
    headers: buildHeaders(token),
  });
  const { data: updated } = await verifyRes.json();
  const afterKeywords = updated.meta_keywords || [];

  if (afterKeywords.length === 0) {
    logSuccess("Test PASSED! meta_keywords are now empty.");
    log(`Product name is still: "${updated.name}" (unchanged ✅)`);
    log(`Product ID is still  : ${updated.id} (unchanged ✅)`);
  } else {
    logError(`Test FAILED — keywords still present: ${afterKeywords.join(", ")}`);
  }
}

// ─────────────────────────────────────────────
//  Full Run: all products in batches
// ─────────────────────────────────────────────

async function runFullMode(storeHash, token) {
  // 1. Fetch all IDs
  logStep("Fetching all product IDs from your store...");
  const allIds = await fetchAllProductIds(storeHash, token);
  log(`\n  Total products found: ${allIds.length}`);

  if (allIds.length === 0) {
    logWarn("No products found. Nothing to update.");
    return;
  }

  // 2. Batch
  const batches = chunk(allIds, BATCH_SIZE);
  log(`  Batches of ${BATCH_SIZE}     : ${batches.length} batches`);

  // 3. Confirm
  console.log("");
  const confirm = await prompt(
    `  ⚠️  This will clear meta_keywords on ALL ${allIds.length} products.\n` +
    `  Type "yes" to continue or anything else to cancel: `
  );

  if (confirm.toLowerCase() !== "yes") {
    log("Operation cancelled. No changes were made.");
    return;
  }

  // 4. Process batches
  logStep(`Processing ${batches.length} batches...`);
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    const progress = Math.round((batchNum / batches.length) * 100);

    process.stdout.write(
      `\r  Batch ${batchNum}/${batches.length} (${progress}%) — IDs: [${batch.join(", ")}]   `
    );

    try {
      await clearMetaKeywordsBatch(storeHash, token, batch);
      successCount += batch.length;
    } catch (err) {
      console.log(""); // newline
      logError(`Batch ${batchNum} failed: ${err.message}`);
      logWarn(`Affected IDs: ${batch.join(", ")} — skipping and continuing...`);
      failCount += batch.length;
    }

    // Rate-limit delay between batches (skip after last batch)
    if (i < batches.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // 5. Summary
  console.log("\n");
  console.log("  ─────────────────────────────────────────");
  console.log("  📊 RESULTS SUMMARY");
  console.log("  ─────────────────────────────────────────");
  logSuccess(`Products updated : ${successCount}`);
  if (failCount > 0) {
    logError(`Products failed  : ${failCount}`);
    logWarn(`Re-run the script for failed batches, or check your API token.`);
  } else {
    logSuccess("All products updated successfully!");
  }
  console.log("  ─────────────────────────────────────────\n");
}

// ─────────────────────────────────────────────
//  Main Entry
// ─────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  if (isTestMode) {
    console.log("║       BigCommerce — Remove Meta Keywords  [TEST MODE]    ║");
  } else {
    console.log("║       BigCommerce — Remove Meta Keywords  [FULL RUN]     ║");
  }
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  if (isTestMode) {
    log("TEST MODE: Will run on a single product only. Safe to use first.");
  } else {
    log("FULL MODE: Will process ALL products in your store.");
    logWarn("Run with --test first to verify everything works!\n");
  }

  // ── Credentials ──
  logStep("Enter your BigCommerce credentials");
  const storeHash  = await prompt("  Store Hash    : ");
  const token      = await prompt("  Access Token  : ", { hidden: true });

  if (!storeHash || !token) {
    logError("Store Hash and Access Token are required.");
    process.exit(1);
  }

  // ── Validate credentials quickly ──
  logStep("Validating credentials...");
  try {
    const testUrl = `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products?limit=1&include_fields=id`;
    const testRes = await fetch(testUrl, {
      method: "GET",
      headers: buildHeaders(token),
    });

    if (testRes.status === 401 || testRes.status === 403) {
      logError("Invalid credentials. Check your Store Hash and Access Token.");
      process.exit(1);
    }
    if (!testRes.ok) {
      logError(`Unexpected error (${testRes.status}). Check your Store Hash.`);
      process.exit(1);
    }
    const testJson = await testRes.json();
    const total = testJson.meta?.pagination?.total || "unknown";
    logSuccess(`Credentials valid! Store has ${total} total products.`);
  } catch (err) {
    logError(`Network error: ${err.message}`);
    process.exit(1);
  }

  // ── Run ──
  try {
    if (isTestMode) {
      const idInput = await prompt("\n  Enter a Product ID to test on: ");
      const productId = parseInt(idInput, 10);
      if (isNaN(productId) || productId <= 0) {
        logError("Invalid product ID.");
        process.exit(1);
      }
      await runTestMode(storeHash, token, productId);
    } else {
      await runFullMode(storeHash, token);
    }
  } catch (err) {
    console.log("");
    logError(`Unexpected error: ${err.message}`);
    process.exit(1);
  }
}

main();
