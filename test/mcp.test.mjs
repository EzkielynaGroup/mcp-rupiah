// Tests for mcp-rupiah: unit tests on the exported functions plus end-to-end tests over MCP stdio. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { terbilang, intToWords, formatRupiah, parseRupiah, wordsToDec, hitungPpn } from '../mcp-rupiah.mjs';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp-rupiah.mjs');
const tb = (angka, opt = {}) => terbilang({ angka, ...opt }).terbilang;
const fr = (angka, opt = {}) => formatRupiah({ angka, ...opt }).teks;
const pr = teks => parseRupiah({ teks });

// ---------- terbilang ----------
test('terbilang: boundaries and the se- rules', () => {
  const cases = [
    [0, 'nol'], [1, 'satu'], [2, 'dua'], [9, 'sembilan'], [10, 'sepuluh'], [11, 'sebelas'], [12, 'dua belas'], [19, 'sembilan belas'],
    [20, 'dua puluh'], [21, 'dua puluh satu'], [99, 'sembilan puluh sembilan'], [100, 'seratus'], [101, 'seratus satu'],
    [110, 'seratus sepuluh'], [111, 'seratus sebelas'], [119, 'seratus sembilan belas'], [200, 'dua ratus'], [999, 'sembilan ratus sembilan puluh sembilan'],
    [1000, 'seribu'], [1001, 'seribu satu'], [1011, 'seribu sebelas'], [1100, 'seribu seratus'], [1111, 'seribu seratus sebelas'],
    [2000, 'dua ribu'], [10000, 'sepuluh ribu'], [11000, 'sebelas ribu'], [12000, 'dua belas ribu'], [100000, 'seratus ribu'],
    [101000, 'seratus satu ribu'], [111111, 'seratus sebelas ribu seratus sebelas'], [999999, 'sembilan ratus sembilan puluh sembilan ribu sembilan ratus sembilan puluh sembilan'],
    [1000000, 'satu juta'], [1001000, 'satu juta seribu'], [1000001, 'satu juta satu'], [2500000, 'dua juta lima ratus ribu'],
    [1000000000, 'satu miliar'], [1000000000000, 'satu triliun'], [1e15, 'satu kuadriliun'],
    [1234567, 'satu juta dua ratus tiga puluh empat ribu lima ratus enam puluh tujuh'],
    [1000001000, 'satu miliar seribu'], [1000000000001, 'satu triliun satu'],
  ];
  for (const [n, w] of cases) assert.equal(tb(n), w, String(n));
  // 1000 inside bigger groups is "satu ribu"-free: only the thousands group of exactly 1 becomes "seribu"
  assert.equal(tb(1000000), 'satu juta');
  assert.equal(tb(201000), 'dua ratus satu ribu');
  assert.equal(tb(21000), 'dua puluh satu ribu');
});

test('terbilang: the largest values and big numbers as text', () => {
  const max = '999999999999999999';
  assert.equal(tb(max), 'sembilan ratus sembilan puluh sembilan kuadriliun sembilan ratus sembilan puluh sembilan triliun sembilan ratus sembilan puluh sembilan miliar sembilan ratus sembilan puluh sembilan juta sembilan ratus sembilan puluh sembilan ribu sembilan ratus sembilan puluh sembilan');
  assert.equal(tb('1000000000000000'), 'satu kuadriliun');
  assert.equal(tb('1000000000001000'), 'satu kuadriliun seribu');
  assert.equal(tb(Number.MAX_SAFE_INTEGER), intToWords(9007199254740991n));
  assert.throws(() => tb('1000000000000000000'), /kuadriliun/);
  assert.throws(() => tb('1e18'), /kuadriliun/);
  assert.throws(() => tb(9007199254740992), /2\^53/);
  assert.equal(tb('1.5e3'), 'seribu lima ratus');
});

test('terbilang: decimals, negatives, rupiah, sen and letter case', () => {
  assert.equal(tb(1.5), 'satu koma lima');
  assert.equal(tb(0.25), 'nol koma dua lima');
  assert.equal(tb(0.05), 'nol koma nol lima');
  assert.equal(tb('1,50'), 'satu koma lima', 'trailing zeros dropped');
  assert.equal(tb(1e-7), 'nol koma nol nol nol nol nol nol satu');
  assert.equal(tb(-5), 'minus lima');
  assert.equal(tb(-0.5), 'minus nol koma lima');
  assert.equal(tb(-1000, { kata_negatif: 'negatif' }), 'negatif seribu');
  assert.equal(tb(-0), 'nol');
  assert.equal(tb(1500000, { rupiah: true }), 'satu juta lima ratus ribu rupiah');
  assert.equal(tb(1500.5, { rupiah: true }), 'seribu lima ratus koma lima rupiah');
  assert.equal(tb(1500.5, { rupiah: true, sen: true }), 'seribu lima ratus rupiah lima puluh sen');
  assert.equal(tb(1500.05, { rupiah: true, sen: true }), 'seribu lima ratus rupiah lima sen');
  assert.equal(tb(0.75, { rupiah: true, sen: true }), 'tujuh puluh lima sen');
  assert.equal(tb(0, { rupiah: true, sen: true }), 'nol rupiah');
  assert.equal(tb(11.11, { rupiah: true, sen: true }), 'sebelas rupiah sebelas sen');
  assert.throws(() => tb(1.555, { rupiah: true, sen: true }), /2 angka desimal/);
  assert.throws(() => tb(1, { sen: true }), /rupiah=true/);
  assert.equal(tb(150000, { rupiah: true, huruf: 'judul' }), 'Seratus Lima Puluh Ribu Rupiah');
  assert.equal(tb(150000, { huruf: 'awal' }), 'Seratus lima puluh ribu');
  assert.equal(tb(12, { huruf: 'besar' }), 'DUA BELAS');
  assert.throws(() => tb(1, { huruf: 'x' }), /huruf/);
  assert.throws(() => tb(1, { kata_negatif: 'kurang' }), /kata_negatif/);
});

test('terbilang: text input uses Indonesian separators and reports how it was read', () => {
  const r = terbilang({ angka: 'Rp 1.250.000,-' });
  assert.equal(r.terbilang, 'satu juta dua ratus lima puluh ribu');
  assert.match(r.dibaca_sebagai, /1250000/);
  assert.equal(tb('1.500'), 'seribu lima ratus');
  assert.equal(tb('1.5'), 'satu koma lima');
  assert.equal(tb('2,5 jt'), 'dua juta lima ratus ribu');
  assert.equal(tb(' 42 '), 'empat puluh dua');
  assert.equal(terbilang({ angka: 42 }).dibaca_sebagai, null);
});

test('terbilang: invalid input', () => {
  for (const bad of [undefined, null, '', 'abc', {}, [], true, NaN, Infinity, -Infinity, '1 dan 2', 'Rp1.2.3']) {
    assert.throws(() => terbilang({ angka: bad }), Error, String(bad));
  }
  assert.throws(() => tb('0.' + '1'.repeat(21)), /desimal/);
});

// ---------- terbilang <-> words parser round trip ----------
test('round trip: terbilang output parses back to the same number', () => {
  const values = [0, 1, 10, 11, 100, 101, 111, 1000, 1001, 1100, 10000, 11000, 100000, 101000, 1000000, 1001000, 12345678, 1e9, 1e12, 1e15,
    999999, 1000001000, 7060504030201];
  let seed = 7;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed; };
  for (let i = 0; i < 300; i++) values.push(rnd() * rnd() % 1e15);
  for (const v of values) {
    const w = tb(v);
    assert.equal(parseRupiah({ teks: w }).teks, String(v), `${v} -> ${w}`);
  }
  // big values beyond 2^53 as text
  for (const s of ['999999999999999999', '123456789012345678', '100000000000000001']) assert.equal(wordsToDec(tb(s)).n.toString(), s);
  // decimals, negatives and sen
  assert.equal(pr(tb(-1234.56)).teks, '-1234.56');
  assert.equal(pr(tb(1500.5, { rupiah: true, sen: true })).teks, '1500.5');
  assert.equal(pr(tb(0.75, { rupiah: true, sen: true })).teks, '0.75');
});

// ---------- format_rupiah ----------
test('format_rupiah: standard style', () => {
  assert.equal(fr(0), 'Rp0');
  assert.equal(fr(1), 'Rp1');
  assert.equal(fr(10), 'Rp10');
  assert.equal(fr(1000), 'Rp1.000');
  assert.equal(fr(1234567), 'Rp1.234.567');
  assert.equal(fr(1234567.89), 'Rp1.234.567,89');
  assert.equal(fr(1234567.891), 'Rp1.234.567,89');
  assert.equal(fr(0.005), 'Rp0,01', 'half up');
  assert.equal(fr(0.004), 'Rp0,00');
  assert.equal(fr(1e12), 'Rp1.000.000.000.000');
  assert.equal(fr('1000000000000000000000'), 'Rp1.000.000.000.000.000.000.000');
  assert.equal(fr(-1250000), '-Rp1.250.000');
  assert.equal(fr(-0.5), '-Rp0,50');
  assert.equal(fr(1500, { desimal: 2 }), 'Rp1.500,00');
  assert.equal(fr(1500.5, { desimal: 0 }), 'Rp1.501');
  assert.equal(fr(-1500.5, { desimal: 0 }), '-Rp1.501', 'half away from zero');
  assert.equal(fr(2.5, { desimal: 0 }), 'Rp3');
  assert.equal(fr(1.23456, { desimal: 4 }), 'Rp1,2346');
  assert.equal(fr(1500, { desimal: 'auto' }), 'Rp1.500');
  assert.equal(fr(1500, { simbol: false }), '1.500');
  assert.equal(fr(1500, { spasi: true }), 'Rp 1.500');
  assert.equal(fr(1500, { akhiran_strip: true }), 'Rp1.500,-');
  assert.equal(fr('Rp 1.250.000,-'), 'Rp1.250.000');
  assert.throws(() => fr(1500.5, { akhiran_strip: true }), /akhiran_strip/);
  assert.throws(() => fr(1, { desimal: 5 }), /desimal/);
  assert.throws(() => fr(1, { desimal: -1 }), /desimal/);
  assert.throws(() => fr(1, { desimal: 1.5 }), /desimal/);
});

test('format_rupiah: compact', () => {
  const c = (v, o = {}) => fr(v, { ringkas: true, ...o });
  assert.equal(c(0), 'Rp0');
  assert.equal(c(950), 'Rp950');
  assert.equal(c(999.95), 'Rp1.000', 'below 1000 stays a plain number');
  assert.equal(c(1000), 'Rp1 rb');
  assert.equal(c(1500), 'Rp1,5 rb');
  assert.equal(c(15000), 'Rp15 rb');
  assert.equal(c(999949), 'Rp999,9 rb');
  assert.equal(c(999950), 'Rp1 jt', 'promoted to the next unit');
  assert.equal(c(1e6), 'Rp1 jt');
  assert.equal(c(1200000), 'Rp1,2 jt');
  assert.equal(c(1250000), 'Rp1,3 jt');
  assert.equal(c(1250000, { ringkas_desimal: 2 }), 'Rp1,25 jt');
  assert.equal(c(1250000, { ringkas_desimal: 0 }), 'Rp1 jt');
  assert.equal(c(1250000, { ringkas_panjang: true }), 'Rp1,3 juta');
  assert.equal(c(2.5e9), 'Rp2,5 M');
  assert.equal(c(2.5e9, { ringkas_panjang: true }), 'Rp2,5 miliar');
  assert.equal(c(1e12), 'Rp1 T');
  assert.equal(c(1e15), 'Rp1.000 T');
  assert.equal(c(-1250000), '-Rp1,3 jt');
  assert.equal(c(1250000, { simbol: false }), '1,3 jt');
  assert.equal(c(1250000, { spasi: true }), 'Rp 1,3 jt');
  assert.throws(() => c(1, { ringkas_desimal: 4 }), /ringkas_desimal/);
});

// ---------- parse_rupiah ----------
test('parse_rupiah: common Indonesian and English styles', () => {
  const cases = [
    ['Rp 1.250.000,-', 1250000], ['Rp1.250.000,00', 1250000], ['Rp. 75.000', 75000], ['IDR 50.000', 50000], ['50.000 rupiah', 50000],
    ['Rp1.234.567,89', 1234567.89], ['1,234,567.89', 1234567.89], ['1,234,567', 1234567], ['1.234.567', 1234567],
    ['1,5 jt', 1500000], ['1.5jt', 1500000], ['2,5 juta', 2500000], ['IDR 50k', 50000], ['50K', 50000], ['15rb', 15000], ['15 ribu', 15000],
    ['2.5M', 2500000000], ['1 miliar', 1e9], ['1 milyar', 1e9], ['3 T', 3e12], ['1,2 triliun', 1.2e12], ['2 kuadriliun', 2e15], ['4 bn', 4e9],
    ['Rp0', 0], ['0', 0], ['1', 1], ['10', 10], ['007', 7], ['12.50', 12.5], ['1.500', 1500], ['999', 999],
  ];
  for (const [t, v] of cases) assert.equal(pr(t).nilai, v, t);
  assert.equal(pr('Rp1.250.000').rupiah, 'Rp1.250.000');
  assert.equal(pr(1500).nilai, 1500);
});

test('parse_rupiah: negatives, ranges and picking the right number', () => {
  assert.equal(pr('-Rp1.000').nilai, -1000);
  assert.equal(pr('Rp-1.000').nilai, -1000);
  assert.equal(pr('Rp -500').nilai, -500);
  assert.equal(pr('(Rp1.000)').nilai, -1000);
  assert.equal(pr('minus 5 rb').nilai, -5000);
  const range = pr('10.000-20.000');
  assert.equal(range.nilai, 10000);
  assert.deepEqual(range.kandidat.map(k => k.nilai), [10000, 20000], 'a range is not a minus sign');
  const total = pr('Total: Rp1.234.567,89 (sudah termasuk PPN 11%)');
  assert.equal(total.nilai, 1234567.89);
  assert.equal(total.kandidat.length, 2);
  assert.equal(pr('PO no 4471 total Rp 15.000').nilai, 15000, 'Rp-marked amount wins');
  assert.equal(pr('harga promo 99rb, normal 150rb').nilai, 99000);
});

test('parse_rupiah: ambiguity notes and words', () => {
  const a = pr('harga 1,500');
  assert.equal(a.nilai, 1.5);
  assert.ok(a.catatan.some(c => c.includes('koma = desimal')));
  const b = pr('1.500 jt');
  assert.equal(b.nilai, 1.5e9);
  assert.ok(b.catatan.length);
  const m = pr('3 m');
  assert.equal(m.nilai, 3e9);
  assert.ok(m.catatan.some(c => c.includes('miliar')));
  assert.ok(pr('1,234,567.89').catatan.some(c => c.includes('Inggris')));
  assert.equal(pr('dua juta lima ratus ribu rupiah').nilai, 2500000);
  assert.equal(pr('Seratus Lima Puluh Ribu Rupiah Saja').nilai, 150000);
  assert.equal(pr('seribu rupiah lima puluh sen').nilai, 1000.5);
  assert.equal(pr('lima puluh sen').nilai, 0.5);
  assert.equal(pr('minus seratus koma lima').nilai, -100.5);
  assert.equal(pr('sejuta').nilai, 1e6);
  assert.equal(pr('nol').nilai, 0);
  assert.equal(pr('dua-puluh-satu').nilai, 21);
  assert.equal(pr('Terbilang: sebelas ribu').nilai, 11000);
});

test('parse_rupiah: invalid input', () => {
  for (const bad of ['', '   ', 'abc', 'Rp', 'Rp 1.2.3', 'satu dua', 'puluh', 'dua ribu tiga ribu', 'seribu juta', 'dua puluh tiga belas', 'koma lima x', 'lima sen rupiah']) {
    assert.throws(() => pr(bad), Error, bad);
  }
  assert.throws(() => parseRupiah({}), /teks/);
  assert.throws(() => parseRupiah({ teks: null }), /teks/);
  assert.throws(() => pr('1'.repeat(2001)), /2000/);
});

// ---------- hitung_ppn ----------
const ppn = a => hitungPpn(a);
test('hitung_ppn: default non-luxury rule is 12% x 11/12 (effective 11%)', () => {
  const r = ppn({ nilai: 1000000 });
  assert.equal(r.kategori, 'nonmewah');
  assert.equal(r.tarif_persen, 12);
  assert.equal(r.faktor_dpp, '11/12');
  assert.equal(r.tarif_efektif_persen, '11');
  assert.equal(r.harga_jual.nilai, 1000000);
  assert.equal(r.dpp.nilai, 916666.67);
  assert.equal(r.dpp.tepat, false);
  assert.equal(r.ppn.nilai, 110000);
  assert.equal(r.ppn.tepat, true);
  assert.equal(r.total.nilai, 1110000);
  assert.equal(r.total.teks, 'Rp1.110.000');
  assert.ok(r.dasar_hukum.some(s => s.includes('PMK 131 Tahun 2024')));
  assert.match(r.penjelasan, /12% x DPP Rp916\.666,67/);
});

test('hitung_ppn: from total, from DPP nilai lain, luxury and custom', () => {
  const t = ppn({ nilai: 1110000, dari: 'total' });
  assert.equal(t.harga_jual.nilai, 1000000);
  assert.equal(t.ppn.nilai, 110000);
  const d = ppn({ nilai: 11000000, dari: 'dpp_nilai_lain' });
  assert.equal(d.harga_jual.nilai, 12000000);
  assert.equal(d.ppn.nilai, 1320000);
  assert.equal(d.total.nilai, 13320000);
  const m = ppn({ nilai: 1000000, kategori: 'mewah' });
  assert.equal(m.tarif_efektif_persen, '12');
  assert.equal(m.ppn.nilai, 120000);
  assert.ok(m.catatan.some(c => c.includes('PPnBM')));
  const mt = ppn({ nilai: 1120000, kategori: 'mewah', dari: 'total' });
  assert.equal(mt.harga_jual.nilai, 1000000);
  const c = ppn({ nilai: 1000000, tarif_persen: 11 });
  assert.equal(c.kategori, 'custom');
  assert.equal(c.ppn.nilai, 110000);
  const c2 = ppn({ nilai: 1000000, kategori: 'custom', tarif_persen: '12', faktor_dpp: '11/12' });
  assert.equal(c2.ppn.nilai, 110000);
  const c3 = ppn({ nilai: 1000000, kategori: 'custom', tarif_persen: '1,1' });
  assert.equal(c3.ppn.nilai, 11000);
  const c4 = ppn({ nilai: 1000000, kategori: 'custom', tarif_persen: 12, faktor_dpp: '10%' });
  assert.equal(c4.ppn.nilai, 12000);
  const c5 = ppn({ nilai: 1000000, kategori: 'custom', tarif_persen: 12, faktor_dpp: 0.5 });
  assert.equal(c5.ppn.nilai, 60000);
});

test('hitung_ppn: boundaries, odd amounts and rounding modes', () => {
  assert.equal(ppn({ nilai: 0 }).ppn.nilai, 0);
  assert.equal(ppn({ nilai: 1 }).ppn.nilai, 0.11);
  assert.equal(ppn({ nilai: 10 }).ppn.nilai, 1.1);
  assert.equal(ppn({ nilai: 100 }).ppn.nilai, 11);
  assert.equal(ppn({ nilai: 1e12 }).ppn.nilai, 110000000000);
  assert.equal(ppn({ nilai: '1000000000000000' }).ppn.teks, 'Rp110.000.000.000.000');
  const odd = ppn({ nilai: 123457 });
  assert.equal(odd.ppn.nilai, 13580.27);
  assert.equal(ppn({ nilai: 123457, pembulatan: 'bawah' }).ppn.nilai, 13580);
  assert.equal(ppn({ nilai: 123457, pembulatan: 'atas' }).ppn.nilai, 13581);
  assert.equal(ppn({ nilai: 123457, pembulatan: 'terdekat' }).ppn.nilai, 13580);
  assert.equal(ppn({ nilai: 123457, pembulatan: 'bawah' }).total.nilai, 137037);
  // from total with rounding: parts still add up exactly to the total
  for (const total of [1, 99, 111, 123457, 999999, 1110001]) {
    for (const p of ['bawah', 'terdekat', 'atas']) {
      const r = ppn({ nilai: total, dari: 'total', pembulatan: p });
      assert.equal(r.harga_jual.nilai + r.ppn.nilai, total, `${total} ${p}`);
      assert.ok(Number.isInteger(r.ppn.nilai));
    }
  }
  // exact rational math: 11% of 0.01 shown as 0.00 but flagged as rounded
  const tiny = ppn({ nilai: 0.01 });
  assert.equal(tiny.ppn.nilai, 0);
  assert.equal(tiny.ppn.tepat, false);
  assert.ok(tiny.catatan.some(c => c.includes('2 desimal')));
  assert.equal(ppn({ nilai: 'Rp 1.000.000,-' }).ppn.nilai, 110000);
});

test('hitung_ppn: invalid input', () => {
  const bad = [
    [{}, /nilai/], [{ nilai: -1 }, /negatif/], [{ nilai: 'abc' }, /nominal/], [{ nilai: 1, dari: 'dpp' }, /dari/],
    [{ nilai: 1, kategori: 'umum' }, /kategori/], [{ nilai: 1, kategori: 'custom' }, /tarif_persen/],
    [{ nilai: 1, kategori: 'nonmewah', tarif_persen: 11 }, /custom/], [{ nilai: 1, kategori: 'mewah', faktor_dpp: '1' }, /custom/],
    [{ nilai: 1, tarif_persen: 101 }, /100/], [{ nilai: 1, tarif_persen: -1 }, /tarif_persen/], [{ nilai: 1, tarif_persen: 'sebelas' }, /tarif_persen/],
    [{ nilai: 1, tarif_persen: 12, faktor_dpp: '12/11' }, /faktor_dpp/], [{ nilai: 1, tarif_persen: 12, faktor_dpp: '1/0' }, /0/],
    [{ nilai: 1, tarif_persen: 12, faktor_dpp: 0 }, /faktor_dpp/], [{ nilai: 1, pembulatan: 'ke atas' }, /pembulatan/],
  ];
  for (const [a, re] of bad) assert.throws(() => ppn(a), re, JSON.stringify(a));
});

// ---------- MCP over stdio ----------
function startMcp() {
  const child = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let stderr = '';
  let nextId = 1;
  const waiting = new Map();
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  child.stderr.on('data', d => { stderr += d; });
  const request = (method, params, raw) => new Promise((resolve, reject) => {
    const id = raw ? null : nextId++;
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10000);
    waiting.set(id, m => { clearTimeout(t); resolve(m); });
    child.stdin.write((raw || JSON.stringify({ jsonrpc: '2.0', id, method, params })) + '\n');
  });
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  const stop = () => new Promise(r => { if (child.exitCode !== null) return r(); child.on('exit', r); child.stdin.end(); });
  const kill = () => { if (child.exitCode === null) child.kill(); };
  return { request, call, stop, kill, stderr: () => stderr };
}
const textOf = r => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');

test('mcp: handshake, tools/list, errors', async t => {
  const mcp = startMcp();
  t.after(mcp.kill);
  const init = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.equal(init.result.serverInfo.name, 'mcp-rupiah');
  assert.equal((await mcp.request('initialize', { protocolVersion: 'x' })).result.protocolVersion, '2025-06-18');
  assert.deepEqual((await mcp.request('ping')).result, {});
  const tools = (await mcp.request('tools/list')).result.tools;
  assert.deepEqual(tools.map(x => x.name).sort(), ['format_rupiah', 'hitung_ppn', 'parse_rupiah', 'terbilang']);
  for (const x of tools) {
    assert.equal(x.inputSchema.type, 'object');
    assert.equal(x.annotations.readOnlyHint, true);
    assert.equal(x.annotations.openWorldHint, false);
  }
  assert.equal((await mcp.request('nope')).error.code, -32601);
  assert.equal((await mcp.request('tools/call', { name: 'x' })).error.code, -32602);
  assert.equal((await mcp.request(null, null, '[1,')).error.code, -32700);
  await mcp.stop();
  assert.match(mcp.stderr(), /ready/);
});

test('mcp: every tool end to end', async t => {
  const mcp = startMcp();
  t.after(mcp.kill);
  await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  const a = await mcp.call('terbilang', { angka: 1500000, rupiah: true, huruf: 'judul' });
  assert.equal(a.structuredContent.terbilang, 'Satu Juta Lima Ratus Ribu Rupiah');
  assert.ok(!('dibaca_sebagai' in a.structuredContent));
  const b = await mcp.call('format_rupiah', { angka: 1234567.89 });
  assert.equal(JSON.parse(textOf(b)).teks, 'Rp1.234.567,89');
  const c = await mcp.call('parse_rupiah', { teks: 'Rp 1.250.000,-' });
  assert.equal(c.structuredContent.nilai, 1250000);
  const d = await mcp.call('hitung_ppn', { nilai: 1000000 });
  assert.equal(d.structuredContent.ppn.nilai, 110000);
  for (const [tool, args, re] of [
    ['terbilang', {}, /angka/], ['terbilang', { angka: '1e30' }, /jangkauan|kuadriliun/], ['format_rupiah', { angka: 'x' }, /nominal/],
    ['parse_rupiah', { teks: '' }, /teks/], ['hitung_ppn', { nilai: -5 }, /negatif/],
  ]) {
    const r = await mcp.call(tool, args);
    assert.equal(r.isError, true, tool);
    assert.match(textOf(r), re);
    assert.ok(!/node:internal|\bat \w+ \(/.test(textOf(r)), 'no stack trace');
  }
  await mcp.stop();
});
