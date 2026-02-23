import { Redis } from "@upstash/redis";

let memoryStore: Record<string, string> = {};
let kvClient: any = null;

function getKV() {
  if (kvClient) return kvClient;

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    kvClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    return kvClient;
  }

  // In-memory fallback for local dev
  kvClient = {
    get: async (key: string) => {
      const val = memoryStore[key];
      return val ? JSON.parse(val) : null;
    },
    set: async (key: string, value: any) => {
      memoryStore[key] = JSON.stringify(value);
    },
  };
  return kvClient;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const kv = getKV();
  return kv.get(key);
}

export async function kvSet(key: string, value: any): Promise<void> {
  const kv = getKV();
  await kv.set(key, value);
}
