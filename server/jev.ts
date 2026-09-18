import { EMOTIONS, EMOTION_KEYS, type Emotion } from './emotions';

export interface Reading {
  emotions: Record<Emotion, number>; // sums to 1
  dominant: Emotion;
  intensity: number;                 // 0..1
  confidence: number;
  ms: number;
  provider: 'openrouter' | 'typesafe' | 'mock';
}

const INTENSITY_LEVELS = [
  'Quiet: description, transition, nothing much felt.',
  'Mild: a noticeable mood but low stakes.',
  'Strong: characters clearly moved, stakes felt.',
  'Overwhelming: climax, terror, ecstasy or heartbreak.',
];

const LEVELS = ['None', 'A trace', 'Clearly present', 'Dominates the passage'];

// One score question per emotion, answered in parallel by Jev in a single request, so a passage
// can be funny AND wondrous AND tense at once instead of collapsing to one label.
function buildPayload(model: string, text: string, prev: string | null, chapter: string) {
  const questions: Record<string, unknown> = {};
  for (const k of EMOTION_KEYS) {
    questions[k] = { type: 'score', instructions: `How much ${k} does the CURRENT passage carry for a reader? (${EMOTIONS[k].hint})`, criteria: LEVELS };
  }
  questions.intensity = { type: 'score', instructions: 'How intense is the emotional charge of the current passage overall?', criteria: INTENSITY_LEVELS };
  return {
    model,
    state: {
      task: 'A novel is being read passage by passage. Judge the emotional colour of the CURRENT passage. Use the previous passage only as context.',
      chapter,
      previousPassage: prev,
      currentPassage: text,
    },
    questions,
  };
}

function normalise(raw: any, ms: number, provider: Reading['provider']): Reading {
  const answers = raw?.answers;
  if (!answers || typeof answers !== 'object') throw new Error('Jev returned no answers: ' + JSON.stringify(raw).slice(0, 300));
  const maxLevel = LEVELS.length - 1;
  const scores = EMOTION_KEYS.map(k => {
    const s = answers[k]?.score;
    if (typeof s !== 'number') throw new Error(`Jev returned no score for ${k}`);
    return Math.max(0, Math.min(maxLevel, s));
  });
  // Drop the "trace" floor so absent emotions stay dark, then normalise what remains.
  const weights = scores.map(s => Math.max(0, s - 0.45) / (maxLevel - 0.45));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const emotions = Object.fromEntries(EMOTION_KEYS.map((k, i) => [k, weights[i] / sum])) as Record<Emotion, number>;
  const top = Math.max(...scores);
  const dominant = EMOTION_KEYS[scores.indexOf(top)];
  const iq = answers.intensity?.score;
  const intensityQ = typeof iq === 'number' ? iq / (INTENSITY_LEVELS.length - 1) : top / maxLevel;
  const intensity = Math.max(0, Math.min(1, 0.5 * intensityQ + 0.5 * (top / maxLevel)));
  const confidence = typeof answers[dominant]?.confidence === 'number' ? answers[dominant].confidence : 0.5;
  return { emotions, dominant, intensity, confidence, ms, provider };
}

const TIMEOUT_MS = Number(process.env.JEV_TIMEOUT_MS || 8000);
const HEDGE_MS = Number(process.env.JEV_HEDGE_MS || 1500);

class HttpError extends Error { constructor(public status: number, text: string) { super(`HTTP ${status}: ${text}`); } }

// Results are streamed in passage order, so one hung request would stall everything behind it.
// Each attempt is hedged (a duplicate fires if the first has not answered in HEDGE_MS) and capped
// at TIMEOUT_MS; transient failures (429, 529, 5xx, network) are retried with backoff.
async function post(url: string, key: string, body: unknown) {
  const began = performance.now();
  const payload = JSON.stringify(body);
  const once = async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new HttpError(res.status, (await res.text()).slice(0, 300));
    return res.json();
  };
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 400 * 2 ** (attempt - 1) + Math.random() * 200));
    try {
      const raw = await hedged(once, HEDGE_MS);
      return { raw, ms: Math.round(performance.now() - began) };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (lastErr instanceof HttpError && lastErr.status !== 429 && lastErr.status < 500) throw lastErr;
    }
  }
  throw lastErr ?? new Error('Jev request failed');
}

async function hedged<T>(run: () => Promise<T>, delay: number): Promise<T> {
  const first = run();
  const settled = first.then(v => ({ v }), e => ({ e }));
  const winner = await Promise.race([settled, new Promise<'hedge'>(r => setTimeout(() => r('hedge'), delay))]);
  if (winner !== 'hedge') { if ('e' in winner) throw winner.e; return winner.v; }
  try { return await Promise.any([first, run()]); }
  catch (e) { throw (e as AggregateError).errors?.[0] ?? e; }
}

export type Reader = (text: string, prev: string | null, chapter: string, i: number) => Promise<Reading>;

export function makeReader(): { reader: Reader; provider: Reading['provider'] } {
  const or = process.env.OPENROUTER_API_KEY?.trim();
  const ts = process.env.TYPESAFE_AI_API_KEY?.trim();
  if (or) {
    const model = process.env.JEV_MODEL || 'typesafe/jev-1.13';
    return { provider: 'openrouter', reader: async (text, prev, chapter) => {
      const { raw, ms } = await post('https://openrouter.ai/api/alpha/decisions', or, buildPayload(model, text, prev, chapter));
      return normalise(raw, ms, 'openrouter');
    } };
  }
  if (ts) {
    const model = process.env.JEV_MODEL || 'jev-latest';
    return { provider: 'typesafe', reader: async (text, prev, chapter) => {
      const { raw, ms } = await post('https://api.typesafe.ai/v1/systemone', ts, buildPayload(model, text, prev, chapter));
      return normalise(raw, ms, 'typesafe');
    } };
  }
  return { provider: 'mock', reader: mockReader() };
}

// Keyword-driven mock so the visual can be developed without a key. Smoothed so it drifts like a real read.
function mockReader(): Reader {
  const cues: Record<Emotion, RegExp> = {
    wonder: /curious|strange|wonder|magic|marvel|golden|shining|enormous|vanish|appear/gi,
    joy: /delight|glad|laugh|happy|pleased|smil|cheer|dance|feast/gi,
    humor: /nonsense|ridiculous|absurd|giggl|joke|silly|hatter|riddle|pun/gi,
    tenderness: /dear|kind|gentle|love|friend|home|sister|kiss|soft/gi,
    calm: /sat|quiet|still|slowly|garden|afternoon|tea|thought|considered/gi,
    suspense: /suddenly|hurr|quick|late|whisper|danger|door|dark|lock|trial/gi,
    fear: /afraid|fright|terrib|scream|shriek|tremb|drown|fall|dreadful|panic/gi,
    sadness: /cried|tears|sad|alone|sigh|lonely|miserable|sorrow|weep|melanchol/gi,
    anger: /angry|furious|shout|off with|severe|snapp|growl|temper|cruel|savage/gi,
  };
  let last: number[] | null = null;
  return async (text) => {
    const counts = EMOTION_KEYS.map(k => 0.35 + (text.match(cues[k])?.length ?? 0) + Math.random() * 0.6);
    let probs = counts.map(c => c / counts.reduce((a, b) => a + b, 0));
    if (last) probs = probs.map((p, i) => 0.55 * p + 0.45 * last![i]);
    last = probs;
    const sum = probs.reduce((a, b) => a + b, 0);
    const emotions = Object.fromEntries(EMOTION_KEYS.map((k, i) => [k, probs[i] / sum])) as Record<Emotion, number>;
    const dominant = EMOTION_KEYS[probs.indexOf(Math.max(...probs))];
    await new Promise(r => setTimeout(r, 90 + Math.random() * 160));
    const punch = (text.match(/!|\?/g)?.length ?? 0);
    return { emotions, dominant, intensity: Math.min(1, 0.2 + punch * 0.08 + Math.random() * 0.3), confidence: Math.max(...probs) * 1.4, ms: 120, provider: 'mock' };
  };
}
