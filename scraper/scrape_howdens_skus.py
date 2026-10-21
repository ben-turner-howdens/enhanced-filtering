#!/usr/bin/env python3
"""
Politely scrape howdens.com UK product pages for URL + SKU + product name.

Uses the official product sitemap for discovery, then fetches each product
page sequentially with delay/jitter. Supports resume via a progress file.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

SITEMAP_INDEX = "https://www.howdens.com/sitemap.xml"
PRODUCT_SITEMAP_HINT = "products-product-repository"
USER_AGENT = "HowdensInternalResearchBot/1.0 (+internal research; polite crawl)"
NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
FAMILY_RE = re.compile(r"obj-sku-family-([a-z0-9]+)$", re.I)
# Trailing product code in slug, e.g. ...-mod0011 or ...-wet1356
SLUG_SKU_RE = re.compile(r"(?:^|-)([a-z]{2,}\d+)$", re.I)
# Looks like a real product code (not a numeric family id)
PRODUCT_CODE_RE = re.compile(r"^[A-Z]{2,}\d+$")


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
        }
    )
    return session


def fetch(
    session: requests.Session,
    url: str,
    *,
    timeout: float = 30.0,
    max_retries: int = 4,
) -> requests.Response:
    delay = 2.0
    for attempt in range(max_retries + 1):
        try:
            resp = session.get(url, timeout=timeout)
        except requests.RequestException as exc:
            if attempt >= max_retries:
                raise
            print(f"  network error ({exc}); retry in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
            delay = min(delay * 2, 60)
            continue

        if resp.status_code in (429, 500, 502, 503, 504) and attempt < max_retries:
            retry_after = resp.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else delay
            print(f"  HTTP {resp.status_code}; retry in {wait:.0f}s", file=sys.stderr)
            time.sleep(wait)
            delay = min(delay * 2, 60)
            continue

        resp.raise_for_status()
        return resp

    raise RuntimeError(f"failed to fetch {url}")


def polite_sleep(delay: float, jitter: float) -> None:
    time.sleep(max(0.0, delay + random.uniform(0, jitter)))


def find_product_sitemap_url(session: requests.Session) -> str:
    root = ET.fromstring(fetch(session, SITEMAP_INDEX).content)
    for loc in root.findall("sm:sitemap/sm:loc", NS):
        url = (loc.text or "").strip()
        if PRODUCT_SITEMAP_HINT in url and "/ie-" not in url:
            return url
    raise RuntimeError("UK products-product-repository sitemap not found")


def normalise_category(category: str | None) -> str | None:
    """Turn a category URL or path into a path prefix, e.g. /joinery/mouldings."""
    if not category:
        return None
    raw = category.strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        path = urlparse(raw).path
    else:
        path = raw if raw.startswith("/") else f"/{raw}"
    return path.rstrip("/") or None


def iter_product_urls(
    session: requests.Session,
    sitemap_url: str,
    *,
    category_prefix: str | None = None,
) -> list[str]:
    root = ET.fromstring(fetch(session, sitemap_url).content)
    urls: list[str] = []
    seen: set[str] = set()
    for loc in root.findall("sm:url/sm:loc", NS):
        url = (loc.text or "").strip()
        if not url:
            continue
        path = urlparse(url).path
        if path.startswith("/ie/") or "/ie/" in path:
            continue
        if category_prefix:
            # Match /joinery/mouldings and /joinery/mouldings/...
            if path != category_prefix and not path.startswith(category_prefix + "/"):
                continue
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def clean_title(text: str | None) -> str:
    if not text:
        return ""
    name = " ".join(text.split())
    for suffix in (" | Howdens", " | howdens"):
        if name.endswith(suffix):
            name = name[: -len(suffix)].strip()
    return name


def page_product_name(soup: BeautifulSoup) -> str:
    h1 = soup.find("h1")
    if h1 and h1.get_text(strip=True):
        return clean_title(h1.get_text(" ", strip=True))
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        return clean_title(og["content"])
    if soup.title and soup.title.string:
        return clean_title(soup.title.string)
    return ""


def absolute_url(base: str, href: str | None) -> str:
    if not href:
        return base
    return urljoin(base, href)


def extract_rows(page_url: str, html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "lxml")
    family_name = page_product_name(soup)
    rows: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    items = soup.select(".sku-selector__item[data-sku]")
    for item in items:
        sku = (item.get("data-sku") or "").strip().upper()
        if not sku:
            continue
        link = item.select_one("a.sku-selector__link[href], a[href]")
        href = None
        if link:
            href = link.get("data-pdp-url") or link.get("href")
        url = absolute_url(page_url, href)
        name = clean_title(item.get("data-overlay")) or family_name
        key = (url, sku)
        if key in seen:
            continue
        seen.add(key)
        rows.append({"url": url, "sku": sku, "product_name": name})

    if rows:
        return rows

    # Fallback: single-SKU / no selector pages
    sku = fallback_sku(page_url, soup)
    if sku:
        rows.append({"url": page_url, "sku": sku, "product_name": family_name})
    elif family_name:
        rows.append({"url": page_url, "sku": "", "product_name": family_name})

    return rows


def as_product_code(value: str | None) -> str:
    if not value:
        return ""
    code = value.strip().upper().replace("OBJ_SKU_FAMILY_", "")
    return code if PRODUCT_CODE_RE.fullmatch(code) else ""


def fallback_sku(page_url: str, soup: BeautifulSoup) -> str:
    """Best-effort SKU when there is no .sku-selector list."""
    # Price API link: ...?productCode=MOD0087
    for el in soup.select("[data-product-price-url]"):
        href = el.get("data-product-price-url") or ""
        m = re.search(r"productCode=([A-Za-z0-9]+)", href)
        if m:
            code = as_product_code(m.group(1))
            if code:
                return code

    # Visible "PRODUCT CODE: MOD0011"
    for span in soup.select(".unlogged-sku"):
        sibling = span.find_next_sibling("span")
        if sibling:
            code = as_product_code(sibling.get_text())
            if code:
                return code
        parent_text = span.parent.get_text(" ", strip=True) if span.parent else ""
        m = re.search(r"PRODUCT CODE:\s*([A-Za-z]{2,}\d+)", parent_text, re.I)
        if m:
            code = as_product_code(m.group(1))
            if code:
                return code

    # data-product-id on ratings / widgets
    for el in soup.select("[data-product-id]"):
        code = as_product_code(el.get("data-product-id"))
        if code:
            return code

    # URL slug: ...-obj-sku-family-mod0712 or ...-mod0011 / ...-wet1356
    slug = urlparse(page_url).path.rstrip("/").rsplit("/", 1)[-1]
    m = FAMILY_RE.search(slug)
    if m:
        code = as_product_code(m.group(1))
        if code:
            return code
    m = SLUG_SKU_RE.search(slug)
    if m:
        code = as_product_code(m.group(1))
        if code:
            return code

    # Inline scripts / dataLayer ecommerce id
    for script in soup.find_all("script"):
        text = script.string or script.get_text() or ""
        for pattern in (
            r'"sku"\s*:\s*"(OBJ_SKU_FAMILY_[A-Z0-9]+|[A-Za-z]{2,}\d+)"',
            r"'id'\s*:\s*'([A-Za-z]{2,}\d+)'",
            r'"id"\s*:\s*"([A-Za-z]{2,}\d+)"',
            r"productCode=([A-Za-z]{2,}\d+)",
        ):
            match = re.search(pattern, text, re.I)
            if match:
                code = as_product_code(match.group(1))
                if code:
                    return code

    return ""


def load_progress(path: Path) -> set[str]:
    if not path.exists():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    return set(data.get("completed_urls", []))


def save_progress(path: Path, completed: Iterable[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"completed_urls": sorted(completed)}, indent=2),
        encoding="utf-8",
    )


def open_csv(path: Path, resume: bool):
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not (resume and path.exists() and path.stat().st_size > 0)
    fh = path.open("a" if resume else "w", newline="", encoding="utf-8")
    writer = csv.DictWriter(fh, fieldnames=["url", "sku", "product_name"])
    if write_header:
        writer.writeheader()
        fh.flush()
    return fh, writer


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Scrape Howdens UK product URL / SKU / product name CSV"
    )
    p.add_argument("--out", type=Path, default=Path("output/howdens_uk_skus.csv"))
    p.add_argument("--progress", type=Path, default=Path("output/progress.json"))
    p.add_argument(
        "--delay",
        type=float,
        default=2.5,
        help="Base seconds between page requests",
    )
    p.add_argument(
        "--jitter",
        type=float,
        default=1.0,
        help="Extra random seconds added to delay",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Max product pages to fetch (0 = all)",
    )
    p.add_argument(
        "--resume",
        action="store_true",
        help="Skip URLs already recorded in the progress file",
    )
    p.add_argument(
        "--category",
        default="",
        help=(
            "Only scrape this category path (safe test mode). "
            "Example: /joinery/mouldings or "
            "https://www.howdens.com/joinery/mouldings"
        ),
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    session = make_session()
    category_prefix = normalise_category(args.category or None)

    print("Fetching sitemap index…")
    product_sitemap = find_product_sitemap_url(session)
    print(f"Product sitemap: {product_sitemap}")
    polite_sleep(args.delay, args.jitter)

    print("Downloading product URL list…")
    urls = iter_product_urls(
        session, product_sitemap, category_prefix=category_prefix
    )
    if category_prefix:
        print(f"Category filter: {category_prefix}")
    print(f"Found {len(urls)} UK product family URLs")
    if category_prefix and not urls:
        print(
            f"No sitemap URLs matched {category_prefix}. Check the path and try again.",
            file=sys.stderr,
        )
        return 1

    completed = load_progress(args.progress) if args.resume else set()
    if args.resume:
        print(f"Resuming; {len(completed)} URLs already done")

    fh, writer = open_csv(args.out, resume=args.resume)
    fetched = 0
    try:
        for i, url in enumerate(urls, start=1):
            if args.limit and fetched >= args.limit:
                break
            if url in completed:
                continue

            print(f"[{i}/{len(urls)}] {url}")
            try:
                html = fetch(session, url).text
                for row in extract_rows(url, html):
                    writer.writerow(row)
                fh.flush()
                completed.add(url)
                save_progress(args.progress, completed)
                fetched += 1
            except Exception as exc:  # keep run alive; log and continue
                print(f"  ERROR: {exc}", file=sys.stderr)
            finally:
                polite_sleep(args.delay, args.jitter)
    finally:
        fh.close()

    print(f"Done. Wrote {args.out} ({fetched} pages this run).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
