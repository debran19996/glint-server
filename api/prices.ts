import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kvGet } from "../lib/kv.js";

interface PriceData {
  gold: number; // price per gram USD
  silver: number;
  platinum: number;
  currencies: {
    ILS: number; // USD to ILS
    EUR: number; // EUR to USD
    GBP: number; // GBP to USD
  };
  updatedAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const cached = await kvGet<PriceData>("prices");

    if (cached) {
      // Check If-Modified-Since for conditional polling
      const ifModified = req.headers["if-modified-since"];
      if (ifModified && cached.updatedAt) {
        const clientDate = new Date(ifModified).getTime();
        const serverDate = new Date(cached.updatedAt).getTime();
        if (clientDate >= serverDate) {
          return res.status(304).end();
        }
      }

      res.setHeader("Last-Modified", cached.updatedAt);
      return res.status(200).json(cached);
    }

    // No cached data yet - return fallback prices
    const fallback: PriceData = {
      gold: 92.5,
      silver: 1.05,
      platinum: 31.2,
      currencies: { ILS: 3.65, EUR: 1.08, GBP: 1.27 },
      updatedAt: new Date().toISOString(),
    };

    return res.status(200).json(fallback);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch prices" });
  }
}
