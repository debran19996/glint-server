// KV abstraction - uses Upstash Redis in production, in-memory for dev/fallback
// When deployed to Vercel, set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars

let memoryStore: Record<string, string> = {};

let kvClient: any = null;

async function getKV() {
  if (kvClient) return kvClient;

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const { Redis } = await import("@upstash/redis");
      kvClient = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      return kvClient;
    } catch {
      // fallback to memory
    }
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
  const kv = await getKV();
  return kv.get(key);
}

export async function kvSet(key: string, value: any): Promise<void> {
  const kv = await getKV();
  await kv.set(key, value);
}
