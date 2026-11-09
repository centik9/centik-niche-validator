export const VOLUME_KEYWORD_SET_ID = "packed-commercial-v1";
export const MAX_PACKED_KEYWORDS = 20;

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function acceptable(phrase) {
  if (phrase.length < 2 || phrase.length > 80) return false;
  if (phrase.split(/\s+/).length > 10) return false;
  return true;
}

function pluralWord(word) {
  if (word.length < 5) return null;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/s$/i.test(word)) return null;
  return `${word}s`;
}

function pluralPhrase(phrase) {
  const words = phrase.split(/\s+/);
  const plural = pluralWord(words[words.length - 1]);
  if (!plural) return null;
  words[words.length - 1] = plural;
  return words.join(" ");
}

function push(list, seen, phrase) {
  const text = clean(phrase);
  if (!acceptable(text)) return;
  const key = text.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  list.push(text);
}

export function buildVolumeKeywords(niche, city) {
  const core = clean(niche);
  const place = clean(city);
  const list = [];
  const seen = new Set();
  const add = (phrase) => {
    if (list.length >= MAX_PACKED_KEYWORDS) return;
    push(list, seen, phrase);
  };
  add(core);
  if (place) {
    add(`${core} ${place}`);
    add(`${place} ${core}`);
    add(`${core} in ${place}`);
    add(`${core} near ${place}`);
    add(`best ${core} ${place}`);
  }
  add(`${core} near me`);
  const plural = pluralPhrase(core);
  if (plural) {
    add(plural);
    if (place) add(`${plural} ${place}`);
  }
  if (core && !/\brepairs?\b/i.test(core) && !/\bservices?\b/i.test(core)) {
    add(`${core} repair`);
  }
  return list;
}
