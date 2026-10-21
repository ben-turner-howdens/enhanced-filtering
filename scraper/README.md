# Howdens UK URL / SKU scraper

Polite Python script that builds a CSV of Howdens UK product URLs, SKUs, and product names.

## How it works

1. Reads the sitemap index at `https://www.howdens.com/sitemap.xml`
2. Loads the UK product list from `products-product-repository1.xml` (~16.5k family URLs)
3. Fetches each product page **one at a time**, with a delay between requests
4. Parses SKUs and names from the HTML (BeautifulSoup)
5. Appends rows to a CSV: `url`, `sku`, `product_name`

The XML is only used for discovery. SKUs and names come from the product pages.

UK only — `/ie/` URLs are skipped.

## Setup

```bash
cd scraper
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

```bash
# Recommended first test — mouldings only (~88 pages, ~3–5 mins)
python scrape_howdens_skus.py \
  --category /joinery/mouldings \
  --out output/mouldings_skus.csv \
  --progress output/progress_mouldings.json

# Same thing with the full category URL
python scrape_howdens_skus.py \
  --category https://www.howdens.com/joinery/mouldings \
  --out output/mouldings_skus.csv

# Tiny smoke test (first 5 mouldings pages)
python scrape_howdens_skus.py --category /joinery/mouldings --limit 5 --out output/sample.csv

# Full UK run (slower with defaults; ~12+ hours) — only when you're happy with category tests
python scrape_howdens_skus.py --out output/howdens_uk_skus.csv

# Resume after stopping
python scrape_howdens_skus.py --out output/howdens_uk_skus.csv --resume
```

### Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--category` | (none) | Limit to one category path, e.g. `/joinery/mouldings` |
| `--delay` | `2.5` | Base seconds between page requests |
| `--jitter` | `1.0` | Extra random seconds added to delay |
| `--limit` | `0` | Cap pages fetched (`0` = all matched) |
| `--resume` | off | Skip URLs already in the progress file |
| `--out` | `output/howdens_uk_skus.csv` | CSV path |
| `--progress` | `output/progress.json` | Resume checkpoint |

## Politeness

- Single-threaded (no parallel requests)
- Default ~2.5–3.5s between page hits (delay + jitter)
- One request at a time (no parallel workers)
- Retries with backoff on 429 / 5xx
- Identifies as `HowdensInternalResearchBot/1.0`
- Honours robots.txt product PDP paths (does not hit search/facet/checkout)

A mouldings-only run (~88 pages) is roughly **4–6 minutes**. A full UK run at these defaults is roughly **12+ hours**. Use `--resume` if you stop mid-way. CSV is flushed after each successful page.

## Output

Example CSV rows:

```csv
url,sku,product_name
https://www.howdens.com/joinery/skirting-boards/...?skuId=MOD0802,MOD0802,Howdens 4.2m x 120mm Torus White Primed MDF Skirting Board
https://www.howdens.com/joinery/skirting-boards/...?skuId=MOD0813,MOD0813,Howdens 4.2m x 152mm Torus White Primed MDF Skirting Board
```

One family page can produce multiple rows (one per variant SKU).

## Out of scope

- Ireland (`/ie/`)
- Category/facet crawling, price/stock APIs, images
- Parallel fetchers
