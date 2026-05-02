import fs from 'node:fs';

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [
        line.slice(0, index),
        line.slice(index + 1).replace(/^['"]|['"]$/g, ''),
      ];
    }),
);

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
}

const now = new Date();
const start = new Date(now.getTime() - 15 * 60 * 1000);
const url = new URL('/rest/v1/accel_batches', supabaseUrl);

url.searchParams.set('select', 'id,ts,x,y,z,battery_pct');
url.searchParams.append('ts', `gte.${start.toISOString()}`);
url.searchParams.set('order', 'ts.asc');
url.searchParams.set('limit', '1000');

const response = await fetch(url, {
  headers: {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
  },
});

if (!response.ok) {
  throw new Error(`Supabase returned ${response.status}: ${await response.text()}`);
}

const rows = await response.json();
let gaps = 0;

console.log(`window=${start.toISOString()}..${now.toISOString()}`);
console.log(`rows=${rows.length}`);

for (let index = 1; index < rows.length; index += 1) {
  const previous = rows[index - 1];
  const current = rows[index];
  const gapMs = new Date(current.ts).getTime() - new Date(previous.ts).getTime();

  if (gapMs > 8000) {
    gaps += 1;
    console.log(`${previous.id}->${current.id}: ${(gapMs / 1000).toFixed(3)}s`);
  }
}

console.log(`gaps_over_8s=${gaps}`);
