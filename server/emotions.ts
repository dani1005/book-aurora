// The palette is the whole point: every Jev answer becomes a colour.
export const EMOTIONS = {
  wonder:     { color: '#8B5CF6', hint: 'Awe, curiosity, magic, strangeness, discovery.' },
  joy:        { color: '#FBBF24', hint: 'Delight, celebration, warmth, relief, triumph.' },
  humor:      { color: '#FB923C', hint: 'Absurdity, wit, nonsense, comic exchanges.' },
  tenderness: { color: '#F472B6', hint: 'Affection, kindness, longing, friendship, homesickness.' },
  calm:       { color: '#34D399', hint: 'Stillness, description, rest, ordinary daily life.' },
  suspense:   { color: '#F43F5E', hint: 'Tension, danger approaching, uncertainty, urgency.' },
  fear:       { color: '#2563EB', hint: 'Dread, threat, panic, being trapped or chased.' },
  sadness:    { color: '#5B7DB1', hint: 'Grief, loneliness, loss, disappointment, tears.' },
  anger:      { color: '#DC2626', hint: 'Rage, cruelty, quarrels, shouting, injustice.' },
} as const;
export type Emotion = keyof typeof EMOTIONS;
export const EMOTION_KEYS = Object.keys(EMOTIONS) as Emotion[];
