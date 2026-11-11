# mcp-rupiah

<!-- ezk:badges -->
[![npm](https://img.shields.io/npm/v/mcp-rupiah?color=c2410c)](https://www.npmjs.com/package/mcp-rupiah) [![CI](https://github.com/EzkielynaGroup/mcp-rupiah/actions/workflows/test.yml/badge.svg)](https://github.com/EzkielynaGroup/mcp-rupiah/actions/workflows/test.yml) [![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.EzkielynaGroup%2Fmcp--rupiah-1f6feb)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.EzkielynaGroup/mcp-rupiah) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
<!-- /ezk:badges -->

An [MCP](https://modelcontextprotocol.io) server with **Rupiah and Indonesian number tools** for your AI assistant: *terbilang* (number to Indonesian words), Rupiah formatting, parsing messy amounts like `Rp 1.250.000,-` or `1,5 jt`, and an Indonesian VAT (**PPN**) calculator that follows the 2025+ rules. Offline, exact decimal math, no API key, no dependencies.

Example: *"Write the terbilang for Rp1.500.250 for this receipt, and how much PPN is in a total of Rp5.550.000?"*

> 🇮🇩 Bahasa Indonesia: lihat [bagian di bawah](#bahasa-indonesia).

- **One file, no dependencies**: Node.js 18+, no `npm install`, no network, no file writes.
- **Exact**: all math uses BigInt decimals and fractions, so `0.1 + 0.2` style float errors never appear. Very large numbers can be sent as text.
- **Honest**: ambiguous input (is `1,500` one and a half or fifteen hundred?) is read the Indonesian way and the answer says how it was read.

## Tools

| Tool | What it does | Example |
|---|---|---|
| `terbilang` | Number → Indonesian words. Up to 999 kuadriliun (< 10^18), decimals with *koma*, negatives (*minus*), optional `rupiah` suffix and *sen*, letter case (`kecil`, `awal`, `judul`, `besar`). Correct *se-* rules: *sepuluh, sebelas, seratus, seribu* (but *satu juta*). | `1500250` → `satu juta lima ratus ribu dua ratus lima puluh` |
| `format_rupiah` | Number → `Rp1.234.567,89` (dot thousands, comma decimals). Options: decimals (0-4 or auto), with/without `Rp`, space after Rp, `,-` suffix, compact `Rp1,2 jt` / `Rp1,2 juta`. Rounds half away from zero. | `1250000` (compact) → `Rp1,3 jt` |
| `parse_rupiah` | Messy text → number. Handles `Rp`, `Rp.`, `IDR`, `rupiah`, `,-`, `,00`, units `rb/ribu/k`, `jt/juta`, `M/miliar/milyar/b/bn`, `T/triliun`, `kuadriliun`, English `1,234,567.89`, accounting `(Rp1.000)`, and words (`dua juta lima ratus ribu rupiah`, `seribu rupiah lima puluh sen`). Picks the first Rp-marked amount and lists the other candidates. | `Total: Rp 1.250.000,- (incl. PPN)` → `1250000` |
| `hitung_ppn` | Indonesian VAT from the price before tax, from *DPP nilai lain*, or backwards from a total that includes PPN. Returns harga jual, DPP, PPN, total, the rule used and its legal source. | `1000000` → PPN `Rp110.000`, total `Rp1.110.000` |

All tools are read-only (`readOnlyHint: true`) and closed-world (`openWorldHint: false`). Numbers can be JSON numbers or text; send values of 2^53 or more as text.

## PPN (VAT) rules used by `hitung_ppn`

Since **1 January 2025** the PPN rate in the law is **12%** (UU 7/2021 *Harmonisasi Peraturan Perpajakan*). The Minister of Finance regulation **PMK 131 Tahun 2024** (issued 31 December 2024, in force 1 January 2025) then splits the calculation:

| `kategori` | Goods/services | Formula | Effective rate |
|---|---|---|---|
| `nonmewah` (default) | All taxable goods and services **except** luxury goods (PMK 131/2024 Article 3) | PPN = 12% × **DPP nilai lain**, where DPP nilai lain = **11/12** × selling price / replacement value / import value | **11%** |
| `mewah` | Luxury goods that are subject to PPnBM (Article 2), such as certain motor vehicles, luxury homes, aircraft and yachts | PPN = 12% × selling price / import value | **12%** |
| `custom` | Anything else (special schemes) | your `tarif_persen` × (`faktor_dpp` × price), `faktor_dpp` default 1 | your choice |

Worked example (`nonmewah`, price Rp1.000.000): DPP nilai lain = 11/12 × 1.000.000 = Rp916.666,67; PPN = 12% × 916.666,67 = **Rp110.000**; total Rp1.110.000.

From a total (`dari: "total"`): price = total ÷ 1.11, so Rp1.110.000 → price Rp1.000.000, PPN Rp110.000.

What the tool does **not** model, on purpose (use `kategori: "custom"` and pass your own rate/factor):

- PPN *besaran tertentu* and other *nilai lain* bases set by separate regulations (consolidated in PMK 11 Tahun 2025), PPN *ditanggung pemerintah* (DTP), exempt goods/services, and PPnBM itself.
- Older periods: before 2025 the rate was 11% (from 1 April 2022) and 10% before that. For luxury goods sold to end consumers the full 12% applies from 1 February 2025; the January 2025 transition is not modelled.
- Invoice rounding rules (e-Faktur) are not modelled: by default values are shown to the sen; `pembulatan` (`bawah`, `terdekat`, `atas`) rounds the PPN to whole Rupiah if you need it.

Sources (checked 11 November 2026):

- PMK 131 Tahun 2024 and the DJP article *"PMK 131/2024: Tarif PPN Sebelas-Dua Belas"*, 6 January 2025, [pajak.go.id](https://pajak.go.id/index.php/id/artikel/pmk-1312024-tarif-ppn-sebelas-dua-belas).
- DJP press release on PMK 11/2025 (DPP nilai lain and PPN besaran tertentu), [pajak.go.id](https://www.pajak.go.id/id/siaran-pers/pemerintah-terbitkan-aturan-dpp-nilai-lain-dan-besaran-tertentu-ppn).
- DDTCNews, 17 August 2025: the Ministry of Finance confirms 12% for luxury goods and 12% × 11/12 for other goods in 2026, [news.ddtc.co.id](https://news.ddtc.co.id/berita/nasional/1812992/tak-berubah-tarif-ppn-12-tetap-berlaku-untuk-barang-mewah-di-2026).
- DDTCNews, 10 September 2026: the Minister of Finance says the general PPN rate stays at 12%, [news.ddtc.co.id](https://news.ddtc.co.id/berita/nasional/1822358/jepang-akan-pangkas-tarif-ppn-purbaya-kita-steady).

If the rules change, `kategori: "custom"` keeps working while the defaults are updated. This is a calculation aid, not tax advice.

## Install

**With npx (recommended):** nothing to install. The configs below run `npx -y mcp-rupiah`.

**From source:**

```bash
git clone https://github.com/EzkielynaGroup/mcp-rupiah.git
cd mcp-rupiah
node --test test/        # optional: offline tests
```

Then use `"command": "node"` with `"args": ["/full/path/to/mcp-rupiah.mjs"]` instead of `npx`.

On Windows, if the app cannot start `npx`, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "mcp-rupiah"]`.

### Claude Desktop

Settings → Developer → Edit Config (`claude_desktop_config.json`), then fully quit and reopen Claude Desktop.

```json
{
  "mcpServers": {
    "rupiah": {
      "command": "npx",
      "args": ["-y", "mcp-rupiah"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add rupiah -- npx -y mcp-rupiah
```

Add `--scope user` to make it available in every project. Check with `claude mcp list`.

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project), same JSON as Claude Desktop.

### OpenCode

`opencode.json` in the project, or `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rupiah": {
      "type": "local",
      "command": ["npx", "-y", "mcp-rupiah"],
      "enabled": true
    }
  }
}
```

## Configuration

No environment variables and no API key. The server never opens a network connection and never writes files.

## Reading rules for text input

- `.` is the thousands separator and `,` the decimal mark (Indonesian style): `1.250.000,50` = 1250000.5.
- If both appear, the last one is the decimal mark, so English `1,234,567.89` also works (the answer notes it).
- A single `,` is always a decimal mark: `1,500` = 1.5 (with a note). A single `.` followed by exactly three digits is a thousands separator: `1.500` = 1500; otherwise it is a decimal point: `1.5` = 1.5.
- `M` means *miliar* (10^9) as in Indonesian; a lowercase `m` is also read as miliar, with a note (write `jt` for million).
- Plain digit strings (`"1234.5"`) and scientific notation (`"1.5e3"`) are read as numbers.

## Limits

- `terbilang` names numbers below 10^18 (up to 999 kuadriliun) with up to 20 decimal digits.
- Text input is limited to 2,000 characters.
- JSON numbers above 2^53 are refused because their precision is already lost; send them as text.

## FAQ

**How do I write terbilang for Rp1.500.000 in Indonesian?**
*Satu juta lima ratus ribu rupiah.* Call `terbilang` with `rupiah: true`; add `huruf: "judul"` for *Satu Juta Lima Ratus Ribu Rupiah* on a receipt (kuitansi).

**Is it "seribu" or "satu ribu", "seratus" or "satu ratus"?**
1,000 is *seribu* and 100 is *seratus*, also inside bigger numbers (*seratus satu ribu*, *satu juta seribu*). From a million up, *satu* is used: *satu juta*, *satu miliar*.

**How is PPN 12% calculated in 2025 and 2026?**
For most goods and services: 12% × DPP nilai lain, where DPP nilai lain = 11/12 of the price, so the PPN is effectively 11% of the price (PMK 131/2024). Only luxury goods subject to PPnBM pay 12% of the full price.

**How do I get the price before PPN from a total that includes PPN?**
For non-luxury goods divide by 1.11 (price = total ÷ 1.11, PPN = total − price). `hitung_ppn` with `dari: "total"` does this exactly.

**How do I format a number as Rupiah, like Rp1.234.567,89?**
Use `format_rupiah`: dots for thousands, comma for decimals, `Rp` with no space (Indonesian spelling rules). `ringkas: true` gives short forms such as `Rp1,2 jt`.

**How do I convert "1,5 jt" or "Rp 1.250.000,-" to a number?**
`parse_rupiah` returns 1500000 and 1250000. It also reads amounts written in words.

## Development

```bash
node --test test/
```

18 test groups (unit tests including a terbilang → words-parser round trip over 300+ numbers, plus end-to-end tests over MCP stdio), offline. Issues and pull requests are welcome.

---

## Bahasa Indonesia

Server MCP berisi **alat Rupiah dan angka Indonesia** untuk asisten AI (Claude Desktop, Claude Code, Cursor, OpenCode): *terbilang*, format Rupiah, membaca nominal dari teks berantakan, dan kalkulator **PPN** sesuai aturan 2025+. Offline, hitungan desimal tepat, tanpa API key, tanpa dependensi.

Contoh: *"Tuliskan terbilang Rp1.500.250 untuk kuitansi, dan berapa PPN dari total Rp5.550.000?"*

**Tools**

| Tool | Fungsi |
|---|---|
| `terbilang` | Angka → kata: sampai 999 kuadriliun, desimal dengan "koma", negatif ("minus"), akhiran "rupiah" dan "sen", pilihan huruf (kecil/awal/judul/besar). Aturan *sepuluh, sebelas, seratus, seribu* benar (tetapi *satu juta*). |
| `format_rupiah` | Angka → `Rp1.234.567,89`; desimal 0-4 atau otomatis, dengan/tanpa `Rp`, akhiran `,-`, ringkas `Rp1,2 jt` / `Rp1,2 juta`. |
| `parse_rupiah` | Teks → angka: `Rp 1.250.000,-`, `1,5 jt`, `IDR 50k`, `2,5 M`, `(Rp1.000)`, gaya Inggris `1,234,567.89`, dan kata-kata (`dua juta lima ratus ribu rupiah`). Ambiguitas dijelaskan di `catatan`. |
| `hitung_ppn` | Hitung PPN dari harga sebelum pajak, dari DPP nilai lain, atau mundur dari total termasuk PPN. Menampilkan harga jual, DPP, PPN, total, aturan, dan dasar hukumnya. |

**Aturan PPN (sejak 1 Januari 2025, PMK 131 Tahun 2024):**

- **Bukan barang mewah** (default `nonmewah`): PPN = 12% × DPP nilai lain, DPP nilai lain = 11/12 × harga jual/penggantian/nilai impor → efektif **11%**. Contoh: harga Rp1.000.000 → DPP Rp916.666,67 → PPN **Rp110.000** → total Rp1.110.000.
- **Barang mewah objek PPnBM** (`mewah`): PPN = 12% × harga jual → efektif **12%** (penjualan eceran ke konsumen akhir mulai 1 Februari 2025). PPnBM tidak dihitung.
- **Skema khusus** (PPN besaran tertentu, nilai lain selain 11/12, PPN DTP, barang/jasa dibebaskan, periode sebelum 2025): pakai `kategori: "custom"` dengan `tarif_persen` dan `faktor_dpp` sendiri.
- Sumber: PMK 131/2024; artikel DJP "PMK 131/2024: Tarif PPN Sebelas-Dua Belas" (6 Jan 2025); siaran pers DJP tentang PMK 11/2025; DDTCNews 17 Agu 2025 dan 10 Sep 2026 (tarif umum tetap 12%). Dicek 11 November 2026. Alat bantu hitung, bukan nasihat pajak.

**Instalasi**: sama seperti contoh di atas. Claude Code: `claude mcp add rupiah -- npx -y mcp-rupiah`. Windows: `"command": "cmd"`, `"args": ["/c", "npx", "-y", "mcp-rupiah"]`. Tidak ada variabel lingkungan atau API key.

**Aturan membaca teks**: titik = ribuan, koma = desimal. `1.500` dibaca 1500, `1,500` dibaca 1,5 (dengan catatan). `M` = miliar. Angka sangat besar (≥ 2^53) kirim sebagai teks.

**Tanya jawab**

- *Terbilang Rp1.500.000?* "Satu juta lima ratus ribu rupiah" (`terbilang` dengan `rupiah: true`, `huruf: "judul"` untuk kuitansi).
- *Seribu atau satu ribu?* 1.000 = *seribu*, 100 = *seratus*; mulai juta memakai *satu*: *satu juta*.
- *Cara hitung PPN 12% tahun 2025/2026?* Umumnya 12% × 11/12 × harga = 11% dari harga; barang mewah 12% dari harga penuh.
- *Cara mencari harga sebelum PPN dari total?* Untuk barang bukan mewah: harga = total ÷ 1,11 (`hitung_ppn` dengan `dari: "total"`).

## License

MIT. See [LICENSE](LICENSE).

---

Made by [Ezkielyna](https://ezkielyna.store/?utm_source=github&utm_medium=readme&utm_campaign=mcp-rupiah), an independent AI API gateway for Indonesian developers (pay with QRIS).

<!-- ezk:toolkit -->
---

### Part of the Ezkielyna developer toolkit

Open-source tools from [Ezkielyna](https://ezkielyna.store/?utm_source=github&utm_medium=readme&utm_campaign=mcp-rupiah), an independent OpenAI- and Anthropic-compatible AI API gateway (pay with QRIS, USDT or Binance Pay; no credit card).

| No API key needed | With an Ezkielyna key |
|---|---|
| [mcp-bmkg](https://github.com/EzkielynaGroup/mcp-bmkg) · [mcp-wilayah-indonesia](https://github.com/EzkielynaGroup/mcp-wilayah-indonesia) · [mcp-hari-libur-indonesia](https://github.com/EzkielynaGroup/mcp-hari-libur-indonesia) · [mcp-rupiah](https://github.com/EzkielynaGroup/mcp-rupiah) · [mcp-qris](https://github.com/EzkielynaGroup/mcp-qris) · [ai-model-status-mcp](https://github.com/EzkielynaGroup/ai-model-status-mcp) | [ezkielyna-mcp](https://github.com/EzkielynaGroup/ezkielyna-mcp) · [ezkielyna-image-mcp](https://github.com/EzkielynaGroup/ezkielyna-image-mcp) · [ezkielyna-audio-mcp](https://github.com/EzkielynaGroup/ezkielyna-audio-mcp) · [n8n-nodes-ezkielyna](https://github.com/EzkielynaGroup/n8n-nodes-ezkielyna) |

More: [all repositories](https://github.com/EzkielynaGroup) · [awesome-mcp-indonesia](https://github.com/EzkielynaGroup/awesome-mcp-indonesia) · [awesome-ai-indonesia](https://github.com/EzkielynaGroup/awesome-ai-indonesia)
<!-- /ezk:toolkit -->
