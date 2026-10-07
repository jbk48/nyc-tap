#!/usr/bin/env python3
"""Generate g/<id>/index.html for every games/<id>.json and check the game files.

Usage:
  python3 tools/build.py            # validate games, warn on duplicates, write pages
  python3 tools/build.py --new-id   # print a fresh random game id
"""
import hashlib
import json
import math
import re
import secrets
import shutil
import string
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAMES = ROOT / "games"
PAGES = ROOT / "g"
ALPHABET = string.ascii_lowercase + string.digits
DUPLICATE_RADIUS_M = 150  # two pins this close are probably the same landmark
REGIONS = {
    "nyc": "data/nyc-boundary.json",
    "westchester": "data/westchester-boundary.json",
    "usa": "data/usa-boundary.json",
}


def load_region(key):
    geom = json.loads((ROOT / REGIONS[key]).read_text())["geometry"]
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def in_ring(lng, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        (xi, yi), (xj, yj) = ring[i], ring[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_region(polys, lat, lng, slack=0.0002):
    # Allow ~20 m of slack so points sitting exactly on the border (e.g. a route's end) pass.
    tries = [(lat, lng)] + [(lat + a, lng + b) for a in (-slack, slack) for b in (-slack, slack)]
    return any(
        in_ring(x, y, p[0]) and not any(in_ring(x, y, h) for h in p[1:]) for y, x in tries for p in polys
    )


def new_id(n=6):
    return "".join(secrets.choice(ALPHABET) for _ in range(n))


def haversine(a, b):
    r = 6371008.8
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lng"] - a["lng"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def norm(name):
    return " ".join(name.lower().replace("the ", " ").split())


def main():
    if "--new-id" in sys.argv:
        print(new_id())
        return

    template = (ROOT / "game.html").read_text()
    page = template.replace("<!--BASE-->", '<base href="../../">')
    # Stamp local css/js links with a content hash so phones never mix old and new files after an update.
    page = re.sub(
        r'((?:src|href)="((?:js|css)/[^"?]+))"',
        lambda m: f'{m.group(1)}?v={hashlib.sha1((ROOT / m.group(2)).read_bytes()).hexdigest()[:8]}"',
        page,
    )

    errors, warnings, seen = [], [], []
    regions = {key: load_region(key) for key in REGIONS}
    files = sorted(GAMES.glob("*.json"))
    for f in files:
        game = json.loads(f.read_text())
        gid = game.get("id")
        if gid != f.stem:
            errors.append(f"{f.name}: id '{gid}' does not match file name")
        if not game.get("title"):
            warnings.append(f"{f.name}: no title (convention: the date it's sent, e.g. \"Oct 2\")")
        region = game.get("region", "nyc")
        if region not in REGIONS:
            errors.append(f"{f.name}: unknown region '{region}' (use one of: {', '.join(REGIONS)})")
            continue
        locs = game.get("locations", [])
        if len(locs) != 5:
            errors.append(f"{f.name}: has {len(locs)} locations, needs 5")
        for loc in locs:
            # A location is a point (lat/lng) or a route (lines: [[[lat, lng], ...], ...]).
            pts = [p for line in loc["lines"] for p in line] if "lines" in loc else [(loc["lat"], loc["lng"])]
            if not pts:
                errors.append(f"{f.name}: '{loc['name']}' has no coordinates")
            for lat, lng in pts:
                if not in_region(regions[region], lat, lng):
                    errors.append(f"{f.name}: '{loc['name']}' is outside {region} ({lat}, {lng})")
                    break
            seen.append((f.stem, loc))

    for i, (g1, a) in enumerate(seen):
        for g2, b in seen[i + 1:]:
            if norm(a["name"]) == norm(b["name"]):
                warnings.append(f"same name: '{a['name']}' in {g1} and {g2}")
            elif "lines" not in a and "lines" not in b and haversine(a, b) < DUPLICATE_RADIUS_M:
                warnings.append(f"within {DUPLICATE_RADIUS_M} m: '{a['name']}' ({g1}) and '{b['name']}' ({g2})")

    if errors:
        print("Errors:\n  " + "\n  ".join(errors))
        sys.exit(1)

    # Rebuild g/ so deleted games disappear.
    if PAGES.exists():
        shutil.rmtree(PAGES)
    for f in files:
        out = PAGES / f.stem / "index.html"
        out.parent.mkdir(parents=True)
        out.write_text(page)

    print(f"Built {len(files)} game page(s): " + ", ".join(f"g/{f.stem}/" for f in files))
    if warnings:
        print("Warnings:\n  " + "\n  ".join(warnings))


if __name__ == "__main__":
    main()
