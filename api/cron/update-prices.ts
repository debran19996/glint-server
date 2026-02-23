import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kvSet, kvGet } from "../../lib/kv.js";

const TROY_OZ_TO_GRAMS = 31.1035;

// GoldAPI.io - set GOLDAPI_KEY in Vercel env vars
const GOLDAPI_KEY = process.env.GOLDAPI_KEY || "";

// Metals.dev - set METALS_DEV_KEY in Vercel env vars (fallback)
const METALS_DEV_KEY = process.env.METALS_DEV_KEY || "";

interface PriceData {
  gold: number;
  silver: number;
  platinum: number;
  currencies: {
    ILS: number;
    EUR: number;
    GBP: number;
  };
  updatedAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret in production
  if (
    process.env.CRON_SECRET &&
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Fetch metals and currencies in parallel
    const [metals, currencies] = await Promise.all([
      fetchMetalPrices(),
      fetchCurrencyRates(),
    ]);

    const priceData: PriceData = {
      gold: metals.gold,
      silver: metals.silver,
      platinum: metals.platinum,
      currencies,
      updatedAt: new Date().toISOString(),
    };

    await kvSet("prices", priceData);

    return res.status(200).json({ ok: true, data: priceData });
  } catch (error: any) {
    console.error("Cron update-prices failed:", error.message);
    return res.status(500).json({ error: error.message });
  }
}

async function fetchMetalPrices(): Promise<{
  gold: number;
  silver: number;
  platinum: number;
}> {
  // Try GoldAPI.io first (best data quality)
  if (GOLDAPI_KEY) {
    try {
      return await fetchFromGoldApi();
    } catch (e: any) {
      console.warn("GoldAPI failed, trying metals.dev:", e.message);
    }
  }

  // Fallback: metals.dev
  if (METALS_DEV_KEY) {
    try {
      return await fetchFromMetalsDev();
    } catch (e: any) {
      console.warn("metals.dev failed:", e.message);
    }
  }

  // Last resort: return cached or defaults
  const cached = await kvGet<PriceData>("prices");
  if (cached) {
    return { gold: cached.gold, silver: cached.silver, platinum: cached.platinum };
  }
  return { gold: 92.5, silver: 1.05, platinum: 31.2 };
}

async function fetchFromGoldApi(): Promise<{
  gold: number;
  silver: number;
  platinum: number;
}> {
  const headers = {
    "x-access-token": GOLDAPI_KEY,
    "Content-Type": "application/json",
  };

  // Fetch all 3 metals in parallel (3 API calls)
  const [goldRes, silverRes, platRes] = await Promise.all([
    fetch("https://www.goldapi.io/api/XAU/USD", { headers }),
    fetch("https://www.goldapi.io/api/XAG/USD", { headers }),
    fetch("https://www.goldapi.io/api/XPT/USD", { headers }),
  ]);

  if (!goldRes.ok) throw new Error(`GoldAPI gold: ${goldRes.status}`);
  if (!silverRes.ok) throw new Error(`GoldAPI silver: ${silverRes.status}`);
  if (!platRes.ok) throw new Error(`GoldAPI platinum: ${platRes.status}`);

  const [gold, silver, plat] = await Promise.all([
    goldRes.json(),
    silverRes.json(),
    platRes.json(),
  ]);

  return {
    gold: gold.price / TROY_OZ_TO_GRAMS,
    silver: silver.price / TROY_OZ_TO_GRAMS,
    platinum: plat.price / TROY_OZ_TO_GRAMS,
  };
}

async function fetchFromMetalsDev(): Promise<{
  gold: number;
  silver: number;
  platinum: number;
}> {
  const url = `https://api.metals.dev/v1/latest?api_key=${METALS_DEV_KEY}&currency=USD&unit=toz`;
  const response = await fetch(url);

  if (!response.ok) throw new Error(`metals.dev: ${response.status}`);

  const data = await response.json();
  const metals = data.metals;

  return {
    gold: metals.gold / TROY_OZ_TO_GRAMS,
    silver: metals.silver / TROY_OZ_TO_GRAMS,
    platinum: metals.platinum / TROY_OZ_TO_GRAMS,
  };
}

async function fetchCurrencyRates(): Promise<{
  ILS: number;
  EUR: number;
  GBP: number;
}> {
  try {
    // Frankfurter: free, unlimited, no key
    const response = await fetch(
      "https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS,EUR,GBP"
    );

    if (!response.ok) throw new Error(`Frankfurter: ${response.status}`);

    const data = await response.json();
    const rates = data.rates;

    return {
      ILS: rates.ILS, // USD → ILS
      EUR: 1 / rates.EUR, // EUR → USD (invert because Frankfurter gives USD→EUR)
      GBP: 1 / rates.GBP, // GBP → USD
    };
  } catch (e) {
    // Fallback to cached
    const cached = await kvGet<PriceData>("prices");
    if (cached) return cached.currencies;
    return { ILS: 3.65, EUR: 1.08, GBP: 1.27 };
  }
}
