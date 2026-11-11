#!/usr/bin/env node
// mcp-rupiah: Rupiah and Indonesian number utilities over MCP stdio.
// terbilang (number -> Indonesian words), format_rupiah, parse_rupiah (messy text -> number), hitung_ppn (VAT, 2025+ rules).
// One file, no dependencies, Node >= 18, offline, no file writes. Exact decimal math with BigInt (no float rounding drift).
// stdout carries only JSON-RPC messages (newline-delimited); logs go to stderr.
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-06-18';
const MAX_TEXT = 2000;
const MAX_FRACTION_DIGITS = 20;
const LIMIT = 10n ** 18n; // terbilang names groups up to kuadriliun (10^15), so |integer part| < 10^18

class ToolError extends Error {}

function log(...args) {
  process.stderr.write('[mcp-rupiah] ' + args.map(String).join(' ') + '\n');
}

// ---------- exact decimals: { n: BigInt, s: scale }  value = n / 10^s ----------

const P10 = s => 10n ** BigInt(s);
const abs = x => (x < 0n ? -x : x);

function dec(n, s = 0) { return { n: BigInt(n), s }; }

// "-123.4500" -> dec. Only plain digits with an optional "." decimal point.
function decFromPlain(str) {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(str);
  if (!m) throw new ToolError(`Angka tidak valid / invalid number: "${clip(str)}"`);
  const frac = m[3] || '';
  if (frac.length > MAX_FRACTION_DIGITS) throw new ToolError(`Maksimal ${MAX_FRACTION_DIGITS} angka desimal / at most ${MAX_FRACTION_DIGITS} decimal digits.`);
  const n = BigInt(m[2] + frac);
  return { n: m[1] ? -n : n, s: frac.length };
}

function decNormalize(d) {
  let { n, s } = d;
  while (s > 0 && n % 10n === 0n) { n /= 10n; s--; }
  return { n, s };
}

function decToPlain(d) {
  const { n, s } = decNormalize(d);
  const neg = n < 0n;
  let digits = abs(n).toString();
  if (s === 0) return (neg ? '-' : '') + digits;
  digits = digits.padStart(s + 1, '0');
  return (neg ? '-' : '') + digits.slice(0, -s) + '.' + digits.slice(-s);
}

function decMulPow10(d, k) { return k >= 0 ? { n: d.n * P10(k), s: d.s } : { n: d.n, s: d.s - k }; }
function decMulDec(a, b) { return { n: a.n * b.n, s: a.s + b.s }; }

// Round to `places` decimals. mode: half_up (away from zero at .5), down (toward zero... see floor), floor, ceil.
function decRound(d, places, mode = 'half_up') {
  if (d.s <= places) return { n: d.n * P10(places - d.s), s: places };
  const div = P10(d.s - places);
  let q = d.n / div; // truncates toward zero
  const r = d.n % div;
  if (r !== 0n) {
    if (mode === 'half_up') { if (abs(r) * 2n >= div) q += d.n < 0n ? -1n : 1n; }
    else if (mode === 'floor') { if (d.n < 0n) q -= 1n; }
    else if (mode === 'ceil') { if (d.n > 0n) q += 1n; }
  }
  return { n: q, s: places };
}

// JS number -> exact decimal text. Rejects NaN/Infinity and integers beyond 2^53 (precision already lost).
function numberToPlain(v) {
  if (!Number.isFinite(v)) throw new ToolError('Angka harus berhingga / number must be finite.');
  if (Number.isInteger(v) && !Number.isSafeInteger(v)) {
    throw new ToolError('Angka melebihi presisi JSON number (2^53). Kirim sebagai teks, mis. "1000000000000000000" / Number exceeds JSON precision: send it as a string.');
  }
  let t = String(v);
  if (!/e/i.test(t)) return t;
  const m = /^(-)?(\d)(?:\.(\d+))?e([+-]\d+)$/i.exec(t);
  if (!m) throw new ToolError('Angka tidak valid / invalid number.');
  const digits = m[2] + (m[3] || '');
  const exp = Number(m[4]) - (m[3] || '').length;
  const d = exp >= 0 ? { n: BigInt(digits) * P10(exp), s: 0 } : { n: BigInt(digits), s: -exp };
  if (d.s > MAX_FRACTION_DIGITS) throw new ToolError(`Maksimal ${MAX_FRACTION_DIGITS} angka desimal / at most ${MAX_FRACTION_DIGITS} decimal digits.`);
  return (m[1] ? '-' : '') + decToPlain(d);
}

// ---------- rationals for tax math: { p: BigInt, q: BigInt>0 } ----------

function gcd(a, b) { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a || 1n; }
function rat(p, q = 1n) { p = BigInt(p); q = BigInt(q); if (q < 0n) { p = -p; q = -q; } const g = gcd(p, q); return { p: p / g, q: q / g }; }
const rAdd = (a, b) => rat(a.p * b.q + b.p * a.q, a.q * b.q);
const rSub = (a, b) => rat(a.p * b.q - b.p * a.q, a.q * b.q);
const rMul = (a, b) => rat(a.p * b.p, a.q * b.q);
const rDiv = (a, b) => rat(a.p * b.q, a.q * b.p);
const rFromDec = d => rat(d.n, P10(d.s));
function rRound(r, places, mode = 'half_up') {
  // exact: r * 10^places, then integer rounding
  const num = r.p * P10(places), den = r.q;
  let q = num / den;
  const rem = num % den;
  if (rem !== 0n) {
    if (mode === 'half_up') { if (abs(rem) * 2n >= den) q += num < 0n ? -1n : 1n; }
    else if (mode === 'floor') { if (num < 0n) q -= 1n; }
    else if (mode === 'ceil') { if (num > 0n) q += 1n; }
  }
  return { n: q, s: places };
}
const rIsExactAt = (r, places) => (r.p * P10(places)) % r.q === 0n;

// ---------- Indonesian formatting ----------

function groupThousands(intDigits) { return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

// dec rounded to `places` -> "1.234.567,89" (no sign)
function formatIdAbs(d, places) {
  const r = decRound(d, places);
  const plain = decToPlain({ n: abs(r.n), s: r.s });
  const [i, f = ''] = plain.split('.');
  const frac = places > 0 ? ',' + f.padEnd(places, '0') : '';
  return groupThousands(i) + frac;
}

function rp(d, places = 2, trimZeroSen = true) {
  const r = decRound(d, places);
  const p = trimZeroSen && r.n % P10(places) === 0n ? 0 : places;
  return (r.n < 0n ? '-' : '') + 'Rp' + formatIdAbs(r, p);
}

// ---------- terbilang ----------

const ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];
const DIGITS = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];
const SCALES = ['', 'ribu', 'juta', 'miliar', 'triliun', 'kuadriliun'];

function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const out = [];
  if (h === 1) out.push('seratus');
  else if (h > 1) out.push(ONES[h] + ' ratus');
  if (r === 0) { /* nothing */ }
  else if (r < 10) out.push(ONES[r]);
  else if (r === 10) out.push('sepuluh');
  else if (r === 11) out.push('sebelas');
  else if (r < 20) out.push(ONES[r - 10] + ' belas');
  else out.push(ONES[Math.floor(r / 10)] + ' puluh' + (r % 10 ? ' ' + ONES[r % 10] : ''));
  return out.join(' ');
}

export function intToWords(big) {
  let n = BigInt(big);
  if (n < 0n) throw new Error('internal: negative');
  if (n === 0n) return 'nol';
  if (n >= LIMIT) throw new ToolError('Maksimal 999 kuadriliun (di bawah 10^18) / at most 999 kuadriliun (below 10^18).');
  const groups = [];
  while (n > 0n) { groups.push(Number(n % 1000n)); n /= 1000n; }
  const words = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (i === 1 && g === 1) words.push('seribu');
    else words.push(below1000(g) + (SCALES[i] ? ' ' + SCALES[i] : ''));
  }
  return words.join(' ');
}

function applyCase(text, mode) {
  if (mode === 'kecil') return text;
  if (mode === 'besar') return text.toUpperCase();
  if (mode === 'awal') return text.charAt(0).toUpperCase() + text.slice(1);
  if (mode === 'judul') return text.replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase());
  throw new ToolError('"huruf" harus kecil, awal, judul atau besar / must be kecil, awal, judul or besar.');
}

export function terbilang(args) {
  const { d, interpreted } = readNumber(args.angka, 'angka');
  const rupiah = args.rupiah === true;
  const sen = args.sen === true;
  if (sen && !rupiah) throw new ToolError('"sen" hanya berlaku bersama rupiah=true / "sen" requires rupiah=true.');
  const negWord = args.kata_negatif === undefined ? 'minus' : String(args.kata_negatif);
  if (!['minus', 'negatif'].includes(negWord)) throw new ToolError('"kata_negatif" harus minus atau negatif / must be minus or negatif.');
  const norm = decNormalize(d);
  const neg = norm.n < 0n;
  const absN = abs(norm.n);
  const intPart = absN / P10(norm.s);
  const fracDigits = norm.s ? (absN % P10(norm.s)).toString().padStart(norm.s, '0') : '';
  if (intPart >= LIMIT) throw new ToolError('Maksimal 999 kuadriliun (di bawah 10^18) / at most 999 kuadriliun (below 10^18).');
  let words;
  if (sen) {
    if (fracDigits.length > 2) throw new ToolError('Dengan sen=true maksimal 2 angka desimal; bulatkan dulu / with sen=true use at most 2 decimals (round first).');
    const senVal = fracDigits ? Number(fracDigits.padEnd(2, '0')) : 0;
    const parts = [];
    if (intPart > 0n || senVal === 0) parts.push(intToWords(intPart) + ' rupiah');
    if (senVal) parts.push(below1000(senVal) + ' sen');
    words = parts.join(' ');
  } else {
    words = intToWords(intPart);
    if (fracDigits) words += ' koma ' + [...fracDigits].map(c => DIGITS[Number(c)]).join(' ');
    if (rupiah) words += ' rupiah';
  }
  if (neg) words = negWord + ' ' + words;
  const huruf = args.huruf === undefined ? 'kecil' : String(args.huruf);
  return { terbilang: applyCase(words, huruf), angka: decToPlain(norm), dibaca_sebagai: interpreted };
}

// ---------- parsing text -> number ----------

const UNIT = {
  k: 3, rb: 3, ribu: 3,
  jt: 6, juta: 6,
  m: 9, b: 9, bn: 9, miliar: 9, milyar: 9,
  t: 12, triliun: 12, trilyun: 12,
  kuadriliun: 15,
};

// Interprets digits with "." and "," using Indonesian conventions first. Returns { plain, notes } or null.
function interpretDigits(tok, hasUnit) {
  const notes = [];
  const dots = (tok.match(/\./g) || []).length;
  const commas = (tok.match(/,/g) || []).length;
  const grouped = (s, sep) => new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s);
  let intPart, frac = '';
  if (dots && commas) {
    const last = Math.max(tok.lastIndexOf('.'), tok.lastIndexOf(','));
    const decSep = tok[last];
    const grpSep = decSep === ',' ? '.' : ',';
    intPart = tok.slice(0, last);
    frac = tok.slice(last + 1);
    if (intPart.includes(decSep) || !grouped(intPart, grpSep)) return null;
    if (decSep === '.') notes.push('Dibaca gaya Inggris (koma = ribuan, titik = desimal) / read as English style (comma thousands, dot decimal).');
    intPart = intPart.split(grpSep).join('');
  } else if (commas) {
    if (commas > 1) {
      if (!grouped(tok, ',')) return null;
      intPart = tok.replace(/,/g, '');
      notes.push('Koma dibaca sebagai pemisah ribuan (gaya Inggris) / commas read as thousands separators (English style).');
    } else {
      [intPart, frac] = tok.split(',');
      if (frac.length === 3 && !hasUnit) notes.push(`"${tok}" dibaca ${intPart},${frac} (koma = desimal, gaya Indonesia). Jika maksudnya ribuan, tulis ${intPart}.${frac} / read with "," as the decimal mark (Indonesian style); for thousands write ${intPart}.${frac}.`);
    }
  } else if (dots) {
    if (dots > 1) {
      if (!grouped(tok, '.')) return null;
      intPart = tok.replace(/\./g, '');
    } else {
      const [a, b] = tok.split('.');
      if (b.length === 3 && a.length <= 3) {
        intPart = a + b;
        if (hasUnit) notes.push(`"${tok}" dibaca ${a}${b} (titik = ribuan). Jika maksudnya desimal, tulis ${a},${b} / "." read as a thousands separator; for a decimal write ${a},${b}.`);
      } else { intPart = a; frac = b; }
    }
  } else intPart = tok;
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  intPart = intPart.replace(/^0+(?=\d)/, '');
  return { plain: frac ? `${intPart}.${frac}` : intPart, notes };
}

const CANDIDATE_RE = /(\(\s*)?(minus\s+|[-−–]\s*)?(rp\.?|idr)?\s*([-−–])?\s*(\d(?:[\d.,]*\d)?)(\s*(?:,|\.)-{1,2})?(?:\s*(kuadriliun|triliun|trilyun|miliar|milyar|juta|ribu|rb|jt|bn|k|m|b|t)(?![a-z0-9]))?(\s*(?:rupiah|idr)(?![a-z]))?(\s*\))?/gi;

function findNumberCandidates(text) {
  const out = [];
  for (const m of text.matchAll(CANDIDATE_RE)) {
    const [whole, open, neg1, cur, neg2, digits, dash, unitRaw, curAfter, close] = m;
    const unit = unitRaw ? unitRaw.toLowerCase() : null;
    const before = text[m.index - 1];
    let negative = false;
    if (neg1 && !(before && /[\p{L}\p{N}]/u.test(before))) negative = true; // "10.000-20.000" is a range, not a minus
    if (neg2) negative = true;
    if (open && close) negative = true; // accounting style (Rp1.000)
    const parsed = interpretDigits(digits, !!unit);
    if (!parsed) { out.push({ source: whole.trim(), error: `Format angka "${digits}" tidak dikenali / unrecognised digit grouping.` }); continue; }
    let d = decFromPlain(parsed.plain);
    const notes = [...parsed.notes];
    if (unit) {
      d = decMulPow10(d, UNIT[unit]);
      if (unitRaw === 'm') notes.push('"m" dibaca miliar (gaya Indonesia). Jika maksudnya juta (million), tulis "jt" / "m" read as miliar (10^9); for million write "jt".');
      if (unit === 'b' || unit === 'bn') notes.push('"b"/"bn" dibaca miliar (billion = 10^9) / read as billion = 10^9.');
    }
    if (negative) d = { n: -d.n, s: d.s };
    out.push({ source: whole.trim(), value: decNormalize(d), currency: !!(cur || curAfter), unit, notes });
  }
  return out;
}

// Indonesian number words -> dec (accepts what terbilang produces plus common variants).
const WORD_DIGIT = { nol: 0, kosong: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
const WORD_SCALE = { ribu: 3, juta: 6, miliar: 9, milyar: 9, triliun: 12, trilyun: 12, kuadriliun: 15 };
const FILLER = new Set(['rupiah', 'saja', 'rp', 'idr', 'terbilang', 'dan']);

function wordsToInt(tokens) {
  if (tokens.length === 1 && (tokens[0] === 'nol' || tokens[0] === 'kosong')) return 0n;
  let total = 0n, group = 0n, pending = null, lastScale = Infinity, any = false;
  const fail = t => { throw new ToolError(`Kata bilangan tidak dikenali/urutannya salah di "${t}" / unrecognised or misplaced number word "${t}".`); };
  for (let t of tokens) {
    any = true;
    let seScale = null;
    if (t.startsWith('se') && WORD_SCALE[t.slice(2)] !== undefined) { seScale = WORD_SCALE[t.slice(2)]; }
    if (WORD_DIGIT[t] !== undefined && t !== 'nol' && t !== 'kosong') { if (pending !== null) fail(t); pending = BigInt(WORD_DIGIT[t]); }
    else if (t === 'sepuluh') { if (pending !== null || group % 100n) fail(t); group += 10n; }
    else if (t === 'sebelas') { if (pending !== null || group % 100n) fail(t); group += 11n; }
    else if (t === 'belas') { if (pending === null || group % 100n) fail(t); group += 10n + pending; pending = null; }
    else if (t === 'puluh') { if (pending === null || group % 100n) fail(t); group += pending * 10n; pending = null; }
    else if (t === 'seratus') { if (pending !== null || group) fail(t); group += 100n; }
    else if (t === 'ratus') { if (pending === null || group) fail(t); group += pending * 100n; pending = null; }
    else if (WORD_SCALE[t] !== undefined || seScale !== null) {
      const scale = seScale !== null ? seScale : WORD_SCALE[t];
      let v = group + (pending ?? 0n);
      if (seScale !== null) { if (v) fail(t); v = 1n; }
      if (!v || scale >= lastScale) fail(t);
      total += v * P10(scale);
      lastScale = scale; group = 0n; pending = null;
    } else fail(t);
  }
  if (!any) throw new ToolError('Tidak ada kata bilangan / no number words found.');
  return total + group + (pending ?? 0n);
}

export function wordsToDec(text) {
  let tokens = text.toLowerCase().replace(/[-_]/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  let neg = false;
  if (tokens[0] === 'minus' || tokens[0] === 'negatif') { neg = true; tokens = tokens.slice(1); }
  let senTokens = null;
  const senAt = tokens.lastIndexOf('sen');
  if (senAt >= 0) {
    if (senAt !== tokens.length - 1) throw new ToolError('"sen" harus di akhir / "sen" must come last.');
    const rpAt = tokens.lastIndexOf('rupiah');
    senTokens = tokens.slice(rpAt + 1, senAt);
    tokens = rpAt >= 0 ? tokens.slice(0, rpAt) : [];
  }
  tokens = tokens.filter(t => !FILLER.has(t));
  const komaAt = tokens.indexOf('koma');
  let fracDigits = '';
  if (komaAt >= 0) {
    const fr = tokens.slice(komaAt + 1);
    if (!fr.length || fr.some(t => WORD_DIGIT[t] === undefined)) throw new ToolError('Setelah "koma" sebutkan angka satu per satu, mis. "koma dua lima" / after "koma" read digits one by one.');
    fracDigits = fr.map(t => WORD_DIGIT[t]).join('');
    tokens = tokens.slice(0, komaAt);
  }
  let n = tokens.length ? wordsToInt(tokens) : 0n;
  let d = { n: BigInt(String(n) + fracDigits), s: fracDigits.length };
  if (senTokens) {
    if (fracDigits) throw new ToolError('Jangan pakai "koma" dan "sen" bersamaan / do not combine "koma" and "sen".');
    const s = senTokens.length ? wordsToInt(senTokens) : 0n;
    if (s >= 100n) throw new ToolError('Sen harus di bawah 100 / sen must be below 100.');
    d = { n: n * 100n + s, s: 2 };
  }
  if (neg) d.n = -d.n;
  return decNormalize(d);
}

const NUMBER_WORD_RE = /\b(nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|sejuta|semiliar|setriliun|ribu|juta|miliar|milyar|triliun|kuadriliun|puluh|belas|ratus)\b/i;

export function parseRupiah(args) {
  const text = typeof args.teks === 'number' ? numberToPlain(args.teks) : args.teks;
  if (typeof text !== 'string' || !text.trim()) throw new ToolError('"teks" wajib diisi / is required, e.g. "Rp 1.250.000,-" or "1,5 jt".');
  if (text.length > MAX_TEXT) throw new ToolError(`"teks" maksimal ${MAX_TEXT} karakter / at most ${MAX_TEXT} characters.`);
  const clean = text.normalize('NFKC').replace(/[  ]/g, ' ');
  if (!/\d/.test(clean) && NUMBER_WORD_RE.test(clean)) {
    const d = wordsToDec(clean);
    return result(d, { sumber: clean.trim(), metode: 'kata', catatan: [] });
  }
  const cands = findNumberCandidates(clean);
  const good = cands.filter(c => !c.error);
  if (!good.length) {
    const why = cands.length ? ' ' + cands.map(c => c.error).join(' ') : '';
    throw new ToolError('Tidak ditemukan nominal di teks / no amount found in the text.' + why);
  }
  const pick = good.find(c => c.currency) || good[0];
  const out = result(pick.value, { sumber: pick.source, metode: 'angka', catatan: pick.notes });
  if (good.length > 1) {
    out.kandidat = good.map(c => ({ sumber: c.source, nilai: Number(decToPlain(c.value)), teks: decToPlain(c.value), mata_uang: c.currency }));
    out.catatan.push(`Ada ${good.length} angka; dipilih ${pick.currency ? 'yang bertanda Rp/IDR pertama' : 'yang pertama'} / ${good.length} numbers found; picked the ${pick.currency ? 'first one marked Rp/IDR' : 'first one'}.`);
  }
  return out;
}

function result(d, extra) {
  const plain = decToPlain(d);
  const num = Number(plain);
  const out = { nilai: num, teks: plain, rupiah: rp(d, 2), ...extra };
  if (numberToPlainSafe(num) !== plain) {
    out.catatan = [...(out.catatan || []), 'Nilai JSON "nilai" tidak presisi untuk angka ini; pakai "teks" / the JSON number loses precision here; use "teks".'];
  }
  return out;
}

function numberToPlainSafe(n) { try { return numberToPlain(n); } catch { return null; } }

// Reads an input value for terbilang / format / ppn: JSON number, or text (same rules as parse_rupiah, one amount only).
function readNumber(v, name) {
  if (typeof v === 'number') return { d: decFromPlain(numberToPlain(v)), interpreted: null };
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(t) && !/^-?\d{1,3}\.\d{3}$/.test(t)) return { d: decFromPlain(t), interpreted: null };
    const sci = /^(-)?(\d+)(?:\.(\d+))?e([+-]?\d{1,3})$/i.exec(t);
    if (sci) {
      const digits = sci[2] + (sci[3] || '');
      const exp = Number(sci[4]) - (sci[3] || '').length;
      if (exp > 40 || exp < -MAX_FRACTION_DIGITS - 40) throw new ToolError(`"${name}" di luar jangkauan / out of range.`);
      let d = exp >= 0 ? { n: BigInt(digits) * P10(exp), s: 0 } : decNormalize({ n: BigInt(digits), s: -exp });
      if (d.s > MAX_FRACTION_DIGITS) throw new ToolError(`Maksimal ${MAX_FRACTION_DIGITS} angka desimal / at most ${MAX_FRACTION_DIGITS} decimal digits.`);
      if (sci[1]) d = { n: -d.n, s: d.s };
      return { d, interpreted: `"${clip(t)}" -> ${decToPlain(d)}` };
    }
    const r = parseRupiah({ teks: t });
    if (r.kandidat) throw new ToolError(`"${name}" berisi lebih dari satu angka / contains more than one number: ${r.kandidat.map(k => k.sumber).join(', ')}`);
    return { d: decFromPlain(r.teks), interpreted: `"${clip(t)}" -> ${r.teks}` + (r.catatan.length ? ` (${r.catatan.join(' ')})` : '') };
  }
  throw new ToolError(`"${name}" wajib diisi (angka atau teks) / is required (number or text).`);
}

// ---------- format_rupiah ----------

const COMPACT = [
  { k: 12, short: 'T', long: 'triliun' },
  { k: 9, short: 'M', long: 'miliar' },
  { k: 6, short: 'jt', long: 'juta' },
  { k: 3, short: 'rb', long: 'ribu' },
];

export function formatRupiah(args) {
  const { d, interpreted } = readNumber(args.angka, 'angka');
  const simbol = args.simbol !== false;
  const spasi = args.spasi === true;
  const prefix = simbol ? 'Rp' + (spasi ? ' ' : '') : '';
  const neg = d.n < 0n;
  let text;
  if (args.ringkas === true) {
    const places = intOpt(args.ringkas_desimal, 'ringkas_desimal', 1, 0, 3);
    const long = args.ringkas_panjang === true;
    const a = { n: abs(d.n), s: d.s };
    let chosen = null;
    for (let i = 0; i < COMPACT.length; i++) {
      const u = COMPACT[i];
      if (decCompare(a, dec(P10(u.k))) < 0) continue;
      chosen = { u, q: decRound(decMulPow10(a, -u.k), places) };
      // 999.950 rb rounds to 1.000 rb: promote to the next bigger unit
      if (i > 0 && decCompare(chosen.q, dec(1000)) >= 0) chosen = { u: COMPACT[i - 1], q: decRound(decMulPow10(a, -COMPACT[i - 1].k), places) };
      break;
    }
    if (chosen) {
      const q = decNormalize(chosen.q);
      text = prefix + formatIdAbs(q, q.s) + ' ' + (long ? chosen.u.long : chosen.u.short);
    } else {
      const r = decNormalize(decRound(a, places));
      text = prefix + formatIdAbs(r, r.s);
    }
    if (neg && !/^Rp ?0$|^0$/.test(text)) text = '-' + text;
  } else {
    let places;
    if (args.desimal === undefined || args.desimal === null || args.desimal === 'auto') places = decNormalize(d).s === 0 ? 0 : 2;
    else places = intOpt(args.desimal, 'desimal', 0, 0, 4);
    const r = decRound(d, places);
    text = (r.n < 0n ? '-' : '') + prefix + formatIdAbs(r, places);
    if (args.akhiran_strip === true) {
      if (places !== 0) throw new ToolError('"akhiran_strip" (,-) hanya untuk desimal 0 / only with desimal 0.');
      text += ',-';
    }
  }
  return { teks: text, angka: decToPlain(d), dibaca_sebagai: interpreted };
}

function decCompare(a, b) {
  const s = Math.max(a.s, b.s);
  const x = a.n * P10(s - a.s), y = b.n * P10(s - b.s);
  return x < y ? -1 : x > y ? 1 : 0;
}

function intOpt(v, name, dflt, min, max) {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ToolError(`"${name}" harus bilangan bulat ${min}-${max} / must be an integer ${min}-${max}.`);
  return n;
}

// ---------- hitung_ppn ----------
// Rules for deliveries from 1 January 2025 (PMK 131 Tahun 2024, issued 31 Dec 2024):
//   - Pasal 2: luxury goods (objects of PPnBM): PPN = 12% x harga jual / nilai impor (for retail sales to end consumers from 1 Feb 2025).
//   - Pasal 3: all other taxable goods and services: PPN = 12% x DPP nilai lain, DPP nilai lain = 11/12 x harga jual / penggantian / nilai impor
//     => effective 11%.
// Special schemes (besaran tertentu, other nilai lain, PPN DTP, exemptions) are out of scope: use kategori=custom.

const PPN_CATEGORIES = {
  nonmewah: { tarif: rat(12, 100), faktor: rat(11, 12), label: 'Barang/jasa kena pajak selain barang mewah (PMK 131/2024 Pasal 3): 12% x DPP nilai lain 11/12' },
  mewah: { tarif: rat(12, 100), faktor: rat(1), label: 'Barang mewah objek PPnBM (PMK 131/2024 Pasal 2): 12% x harga jual' },
};
const PPN_SOURCES = [
  'PMK 131 Tahun 2024 (ditetapkan 31 Des 2024, berlaku 1 Jan 2025): Pasal 2 barang mewah 12% x harga jual/nilai impor; Pasal 3 selain barang mewah 12% x DPP nilai lain 11/12.',
  'UU 7/2021 (UU HPP): tarif PPN 12% mulai paling lambat 1 Januari 2025.',
  'DJP, "PMK 131/2024: Tarif PPN Sebelas-Dua Belas" (pajak.go.id, 6 Jan 2025).',
  'DDTCNews 10 Sep 2026: Menkeu menyatakan tarif umum PPN tetap 12% (tidak naik, tidak turun).',
];

function readRatio(v, name) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) throw new ToolError(`"${name}" harus > 0 / must be > 0.`);
    return rFromDec(decFromPlain(numberToPlain(v)));
  }
  const t = String(v).trim().replace(',', '.');
  let m;
  if ((m = /^(\d+)\s*\/\s*(\d+)$/.exec(t))) {
    if (m[2] === '0' || /^0+$/.test(m[2])) throw new ToolError(`"${name}" penyebut 0 / zero denominator.`);
    return rat(BigInt(m[1]), BigInt(m[2]));
  }
  if ((m = /^(\d+(?:\.\d+)?)\s*%$/.exec(t))) return rDiv(rFromDec(decFromPlain(m[1])), rat(100));
  if (/^\d+(?:\.\d+)?$/.test(t)) return rFromDec(decFromPlain(t));
  throw new ToolError(`"${name}" tidak dikenali: "${clip(t)}". Contoh: "11/12", 0.9 atau "90%" / unrecognised; examples: "11/12", 0.9, "90%".`);
}

function ratToPlain(r, places = 10) {
  if (rIsExactAt(r, places)) return decToPlain(rRound(r, places));
  return decToPlain(rRound(r, places)) + '...';
}

export function hitungPpn(args) {
  const { d, interpreted } = readNumber(args.nilai, 'nilai');
  if (d.n < 0n) throw new ToolError('"nilai" tidak boleh negatif / must not be negative.');
  const dari = args.dari === undefined ? 'harga_jual' : String(args.dari);
  if (!['harga_jual', 'dpp_nilai_lain', 'total'].includes(dari)) throw new ToolError('"dari" harus harga_jual, dpp_nilai_lain atau total / must be harga_jual, dpp_nilai_lain or total.');
  const hasRate = !(args.tarif_persen === undefined || args.tarif_persen === null || args.tarif_persen === '');
  const kategori = args.kategori === undefined ? (hasRate ? 'custom' : 'nonmewah') : String(args.kategori);
  let tarif, faktor, label;
  if (kategori === 'custom') {
    if (!hasRate) throw new ToolError('kategori=custom wajib mengisi "tarif_persen" / requires "tarif_persen".');
    const t = readRatio(args.tarif_persen, 'tarif_persen');
    if (rSub(t, rat(100)).p > 0n) throw new ToolError('"tarif_persen" maksimal 100 / at most 100.');
    tarif = rDiv(t, rat(100));
    faktor = readRatio(args.faktor_dpp, 'faktor_dpp') || rat(1);
    if (rSub(faktor, rat(1)).p > 0n) throw new ToolError('"faktor_dpp" maksimal 1 / at most 1.');
    label = `Custom: ${ratToPlain(rMul(tarif, rat(100)), 4)}% x DPP (faktor ${faktor.q === 1n ? faktor.p : `${faktor.p}/${faktor.q}`} x harga)`;
  } else if (PPN_CATEGORIES[kategori]) {
    if (hasRate || (args.faktor_dpp !== undefined && args.faktor_dpp !== null && args.faktor_dpp !== '')) {
      throw new ToolError(`Tarif untuk kategori "${kategori}" sudah ditetapkan aturan. Untuk tarif lain pakai kategori=custom / the rate for this category is fixed by regulation; use kategori=custom for other rates.`);
    }
    ({ tarif, faktor, label } = PPN_CATEGORIES[kategori]);
  } else throw new ToolError('"kategori" harus nonmewah, mewah atau custom / must be nonmewah, mewah or custom.');
  const pembulatan = args.pembulatan === undefined ? 'tidak' : String(args.pembulatan);
  if (!['tidak', 'bawah', 'terdekat', 'atas'].includes(pembulatan)) throw new ToolError('"pembulatan" harus tidak, bawah, terdekat atau atas / must be tidak, bawah, terdekat or atas.');

  const eff = rMul(tarif, faktor);
  const v = rFromDec(d);
  let H, DPP, PPN, T;
  if (dari === 'harga_jual') { H = v; DPP = rMul(H, faktor); PPN = rMul(DPP, tarif); T = rAdd(H, PPN); }
  else if (dari === 'dpp_nilai_lain') { DPP = v; H = rDiv(DPP, faktor); PPN = rMul(DPP, tarif); T = rAdd(H, PPN); }
  else { T = v; H = rDiv(T, rAdd(rat(1), eff)); DPP = rMul(H, faktor); PPN = rSub(T, H); }
  if (pembulatan !== 'tidak') {
    const mode = { bawah: 'floor', terdekat: 'half_up', atas: 'ceil' }[pembulatan];
    PPN = rFromDec(rRound(PPN, 0, mode));
    if (dari === 'total') { H = rSub(T, PPN); DPP = rMul(H, faktor); }
    else T = rAdd(H, PPN);
  }
  const money = r => {
    const two = rRound(r, 2);
    return { nilai: Number(decToPlain(two)), teks: rp(two, 2), tepat: rIsExactAt(r, 2) };
  };
  const out = {
    kategori,
    aturan: label,
    dari,
    tarif_persen: Number(ratToPlain(rMul(tarif, rat(100)), 6).replace('...', '')),
    faktor_dpp: faktor.q === 1n ? String(faktor.p) : `${faktor.p}/${faktor.q}`,
    tarif_efektif_persen: ratToPlain(rMul(eff, rat(100)), 6),
    harga_jual: money(H),
    dpp: money(DPP),
    ppn: money(PPN),
    total: money(T),
    pembulatan,
    penjelasan: '',
    dasar_hukum: kategori === 'custom' ? ['Tarif/faktor diisi pemanggil (custom) / rate and factor supplied by the caller.'] : PPN_SOURCES,
    catatan: [],
  };
  out.penjelasan = `PPN = ${out.tarif_persen}% x DPP ${out.dpp.teks}${faktor.q !== 1n || faktor.p !== 1n ? ` (= ${out.faktor_dpp} x harga jual ${out.harga_jual.teks})` : ''} = ${out.ppn.teks}${pembulatan !== 'tidak' ? ` (dibulatkan ${pembulatan} ke Rupiah penuh)` : ''}; total = ${out.total.teks}; tarif efektif ${out.tarif_efektif_persen}% dari harga jual.`;
  if (interpreted) out.dibaca_sebagai = interpreted;
  if ([out.harga_jual, out.dpp, out.ppn, out.total].some(x => !x.tepat)) out.catatan.push('Sebagian nilai dibulatkan ke 2 desimal (sen) untuk ditampilkan; perhitungan internal tepat / some values are shown rounded to 2 decimals; internal math is exact.');
  if (kategori !== 'custom') out.catatan.push('Berlaku untuk penyerahan sejak 1 Jan 2025. Skema khusus (PPN besaran tertentu, nilai lain selain 11/12, PPN DTP, barang/jasa dibebaskan) tidak dihitung otomatis: pakai kategori=custom. / Valid for deliveries from 1 Jan 2025; special schemes need kategori=custom.');
  if (kategori === 'mewah') out.catatan.push('PPnBM (pajak barang mewah) adalah pajak terpisah dan tidak dihitung di sini; untuk penjualan eceran ke konsumen akhir, tarif efektif 12% berlaku mulai 1 Feb 2025 / PPnBM is separate and not computed; the 12% effective rate for retail sales to end consumers applies from 1 Feb 2025.');
  out.catatan.push('Ini alat bantu hitung, bukan nasihat pajak. Cek aturan terbaru di pajak.go.id / calculation aid only, not tax advice.');
  return out;
}

// ---------- tools ----------

const NUM_INPUT = { type: ['number', 'string'], description: 'A JSON number, or text such as "1250000", "Rp1.250.000,50" or "1,5 jt". Send very large numbers (>= 2^53) as text.' };
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: 'terbilang',
    title: 'Terbilang (angka ke kata)',
    description: 'Mengubah angka menjadi kata-kata Bahasa Indonesia (terbilang) untuk kuitansi/invoice. Converts a number to Indonesian words: up to 999 kuadriliun, '
      + 'decimals with "koma", negatives, optional "rupiah" suffix and "sen", correct seratus/seribu/sebelas rules. Example: 1500 -> "seribu lima ratus".',
    inputSchema: {
      type: 'object',
      properties: {
        angka: NUM_INPUT,
        rupiah: { type: 'boolean', default: false, description: 'Append "rupiah".' },
        sen: { type: 'boolean', default: false, description: 'With rupiah=true: read up to 2 decimals as sen ("... rupiah lima puluh sen") instead of "koma".' },
        huruf: { type: 'string', enum: ['kecil', 'awal', 'judul', 'besar'], default: 'kecil', description: 'Letter case: kecil (lower), awal (first letter), judul (Title Case), besar (UPPER).' },
        kata_negatif: { type: 'string', enum: ['minus', 'negatif'], default: 'minus', description: 'Word used for negative numbers.' },
      },
      required: ['angka'],
    },
    annotations: { title: 'Terbilang', ...RO },
  },
  {
    name: 'format_rupiah',
    title: 'Format Rupiah',
    description: 'Memformat angka sebagai Rupiah gaya Indonesia. Formats a number as Rupiah: "Rp1.234.567,89" (dot thousands, comma decimals), with or without "Rp", '
      + 'fixed decimals, ",-" suffix, or compact like "Rp1,2 jt" / "Rp1,2 juta".',
    inputSchema: {
      type: 'object',
      properties: {
        angka: NUM_INPUT,
        desimal: { type: ['integer', 'string'], description: 'Decimals 0-4, or "auto" (default: 0 for whole numbers, else 2). Rounds half up.' },
        simbol: { type: 'boolean', default: true, description: 'Prefix "Rp".' },
        spasi: { type: 'boolean', default: false, description: 'Space after Rp ("Rp 1.000"). Indonesian spelling rules (EYD) write it without a space.' },
        akhiran_strip: { type: 'boolean', default: false, description: 'Add ",-" (e.g. "Rp1.000,-"); only with 0 decimals.' },
        ringkas: { type: 'boolean', default: false, description: 'Compact: rb / jt / M / T (e.g. "Rp1,2 jt").' },
        ringkas_desimal: { type: 'integer', minimum: 0, maximum: 3, default: 1, description: 'Max decimals in compact mode (trailing zeros dropped).' },
        ringkas_panjang: { type: 'boolean', default: false, description: 'Compact with full words: ribu / juta / miliar / triliun.' },
      },
      required: ['angka'],
    },
    annotations: { title: 'Format Rupiah', ...RO },
  },
  {
    name: 'parse_rupiah',
    title: 'Baca nominal Rupiah dari teks / Parse Rupiah',
    description: 'Membaca nominal dari teks berantakan. Extracts a number from messy text: "Rp 1.250.000,-", "IDR 50k", "1,5 jt", "2.5M", "(Rp1.000)", '
      + '"Total: Rp1.234.567,89" or words like "dua juta lima ratus ribu rupiah". Indonesian conventions first ("." thousands, "," decimal); ambiguities are reported.',
    inputSchema: {
      type: 'object',
      properties: { teks: { type: 'string', description: 'Text that contains an amount.' } },
      required: ['teks'],
    },
    annotations: { title: 'Parse Rupiah', ...RO },
  },
  {
    name: 'hitung_ppn',
    title: 'Hitung PPN / Indonesian VAT',
    description: 'Menghitung PPN Indonesia (aturan 2025+). Computes Indonesian VAT (PPN) from the price before tax, from DPP nilai lain, or backwards from a total that includes PPN. '
      + 'Default kategori nonmewah = 12% x DPP nilai lain 11/12 (effective 11%, PMK 131/2024 Pasal 3); mewah = 12% x price (Pasal 2); custom = your own rate/factor. '
      + 'Returns harga jual, DPP, PPN, total, the rule used and its source. Calculation aid, not tax advice.',
    inputSchema: {
      type: 'object',
      properties: {
        nilai: NUM_INPUT,
        dari: { type: 'string', enum: ['harga_jual', 'dpp_nilai_lain', 'total'], default: 'harga_jual', description: 'What "nilai" is: harga_jual (price/penggantian before PPN, default), dpp_nilai_lain (already the DPP), total (price including PPN).' },
        kategori: { type: 'string', enum: ['nonmewah', 'mewah', 'custom'], default: 'nonmewah', description: 'nonmewah (default, 12% x 11/12), mewah (luxury goods, 12% x price) or custom (needs tarif_persen).' },
        tarif_persen: { type: ['number', 'string'], description: 'Only for kategori=custom: rate in percent, e.g. 11 or "1,1".' },
        faktor_dpp: { type: ['number', 'string'], description: 'Only for kategori=custom: DPP factor, e.g. "11/12", 0.9 or "90%" (default 1).' },
        pembulatan: { type: 'string', enum: ['tidak', 'bawah', 'terdekat', 'atas'], default: 'tidak', description: 'Round PPN to whole Rupiah: tidak (no, show sen), bawah (down), terdekat (nearest), atas (up).' },
      },
      required: ['nilai'],
    },
    annotations: { title: 'Hitung PPN', ...RO },
  },
];

async function callTool(name, args) {
  if (name === 'terbilang') return json(terbilang(args));
  if (name === 'format_rupiah') return json(formatRupiah(args));
  if (name === 'parse_rupiah') return json(parseRupiah(args));
  if (name === 'hitung_ppn') return json(hitungPpn(args));
  throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
}

function json(obj) {
  for (const k of Object.keys(obj)) if (obj[k] === null || obj[k] === undefined) delete obj[k];
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], structuredContent: obj };
}

function clip(s) { return String(s).replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 60); }

// ---------- JSON-RPC over stdio ----------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  if (typeof method !== 'string') {
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid request' } });
    return;
  }
  if (!isRequest) return;
  try {
    let result;
    switch (method) {
      case 'initialize': {
        const asked = params && params.protocolVersion;
        result = {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'mcp-rupiah', title: 'Rupiah tools', version: VERSION },
          instructions: 'Rupiah and Indonesian number tools: terbilang (number to Indonesian words), format_rupiah, parse_rupiah (messy text to number) '
            + 'and hitung_ppn (Indonesian VAT under the 2025+ rules). Offline and exact (no floating-point drift).',
        };
        break;
      }
      case 'ping': result = {}; break;
      case 'tools/list': result = { tools: TOOLS }; break;
      case 'resources/list': result = { resources: [] }; break;
      case 'resources/templates/list': result = { resourceTemplates: [] }; break;
      case 'prompts/list': result = { prompts: [] }; break;
      case 'tools/call': {
        const name = params && params.name;
        if (!TOOLS.some(t => t.name === name)) {
          send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${clip(String(name))}` } });
          return;
        }
        try {
          result = await callTool(name, (params && typeof params.arguments === 'object' && params.arguments) || {});
        } catch (e) {
          if (!(e instanceof ToolError)) log('tool failed:', (e && e.stack) || e);
          const t = e instanceof ToolError ? e.message : 'Terjadi kesalahan / Unexpected error: ' + (e && e.message);
          result = { content: [{ type: 'text', text: t }], isError: true };
        }
        break;
      }
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${clip(method)}` } });
        return;
    }
    send({ jsonrpc: '2.0', id, result });
  } catch (e) {
    log('request failed:', (e && e.stack) || e);
    send({ jsonrpc: '2.0', id, error: { code: e.rpcCode || -32603, message: e.message || 'Internal error' } });
  }
}

function main() {
  log(`v${VERSION} ready (offline)`);
  const pending = new Set();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', line => {
    if (!line.trim()) return;
    if (line.length > 1024 * 1024) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
      return;
    }
    let msg;
    try { msg = JSON.parse(line); } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const msgs = Array.isArray(msg) ? msg : [msg];
    for (const m of msgs) {
      const p = handle(m && typeof m === 'object' ? m : {}).catch(e => log('fatal handler error:', (e && e.stack) || e));
      pending.add(p);
      p.finally(() => pending.delete(p));
    }
  });
  rl.on('close', async () => {
    await Promise.allSettled([...pending]);
    process.exit(0);
  });
}

const isMain = (() => {
  try { return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) main();
