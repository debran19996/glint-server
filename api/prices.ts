import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kvGet, kvSet } from "../lib/kv.js";

const TROY_OZ_TO_GRAMS = 31.1035;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

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
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    let cached = await kvGet<PriceData>("prices");

    // If no cache or stale (>5 min), fetch fresh data on-demand
    const isStale =
      !cached ||
      Date.now() - new Date(cached.updatedAt).getTime() > STALE_THRESHOLD_MS;

    if (isStale) {
      const fresh = await fetchFreshPrices();
      if (fresh) {
        await kvSet("prices", fresh);
        cached = fresh;
      }
    }

    if (cached) {
      // Conditional polling: 304 if client already has latest
      const ifModified = req.headers["if-modified-since"];
      if (ifModified) {
        const clientDate = new Date(ifModified).getTime();
        const serverDate = new Date(cached.updatedAt).getTime();
        if (clientDate >= serverDate) {
          return res.status(304).end();
        }
      }

      res.setHeader("Last-Modified", cached.updatedAt);
      return res.status(200).json(cached);
    }

    // Absolute fallback
    return res.status(200).json({
      gold: 92.5,
      silver: 1.05,
      platinum: 31.2,
      currencies: { ILS: 3.65, EUR: 1.08, GBP: 1.27 },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch prices" });
  }
}

async function fetchFreshPrices(): Promise<PriceData | null> {
  try {
    const [metals, currencies] = await Promise.all([
      fetchMetals(),
      fetchCurrencies(),
    ]);

    return {
      ...metals,
      currencies,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function fetchMetals(): Promise<{
  gold: number;
  silver: number;
  platinum: number;
}> {
  const GOLDAPI_KEY = process.env.GOLDAPI_KEY || "";
  const METALS_DEV_KEY = process.env.METALS_DEV_KEY || "";

  // Try GoldAPI.io
  if (GOLDAPI_KEY) {
    try {
      const headers = {
        "x-access-token": GOLDAPI_KEY,
        "Content-Type": "application/json",
      };
      const [goldRes, silverRes, platRes] = await Promise.all([
        fetch("https://www.goldapi.io/api/XAU/USD", { headers }),
        fetch("https://www.goldapi.io/api/XAG/USD", { headers }),
        fetch("https://www.goldapi.io/api/XPT/USD", { headers }),
      ]);

      if (goldRes.ok && silverRes.ok && platRes.ok) {
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
    } catch {}
  }

  // Fallback: metals.dev
  if (METALS_DEV_KEY) {
    try {
      const r = await fetch(
        `https://api.metals.dev/v1/latest?api_key=${METALS_DEV_KEY}&currency=USD&unit=toz`
      );
      if (r.ok) {
        const data = await r.json();
        const m = data.metals;
        return {
          gold: m.gold / TROY_OZ_TO_GRAMS,
          silver: m.silver / TROY_OZ_TO_GRAMS,
          platinum: m.platinum / TROY_OZ_TO_GRAMS,
        };
      }
    } catch {}
  }

  // Return cached or defaults
  const cached = await kvGet<PriceData>("prices");
  if (cached) return { gold: cached.gold, silver: cached.silver, platinum: cached.platinum };
  return { gold: 92.5, silver: 1.05, platinum: 31.2 };
}

async function fetchCurrencies(): Promise<{
  ILS: number;
  EUR: number;
  GBP: number;
}> {
  try {
    const r = await fetch(
      "https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS,EUR,GBP"
    );
    if (r.ok) {
      const data = await r.json();
      const rates = data.rates;
      return {
        ILS: rates.ILS,
        EUR: 1 / rates.EUR,
        GBP: 1 / rates.GBP,
      };
    }
  } catch {}

  const cached = await kvGet<PriceData>("prices");
  if (cached) return cached.currencies;
  return { ILS: 3.65, EUR: 1.08, GBP: 1.27 };
}
