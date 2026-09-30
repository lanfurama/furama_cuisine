#!/usr/bin/env python3
"""Pull DesignSync get_file results out of this session's records and write them
into public/. Sources the transcript's toolUseResult objects (which hold the full
payload for both inline and persisted tool outputs). Idempotent."""
import json, base64, os, sys, glob

SESSION = "/Users/bcmac/.claude/projects/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/3ba362d6-4082-4a09-a99e-bb7fdc0090e6"
OUT = "/Users/bcmac/Desktop/projects/Outside Projects/furama_cuisine/public"

def collect():
    found = {}
    for f in glob.glob(os.path.join(SESSION, "tool-results", "*.txt")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if d.get("method") == "get_file" and "content" in d:
            found[d["path"]] = d
    jl = SESSION + ".jsonl"
    if os.path.exists(jl):
        for line in open(jl, errors="replace"):
            if '"get_file"' not in line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            r = rec.get("toolUseResult")
            if isinstance(r, dict) and r.get("method") == "get_file" and "content" in r:
                found[r["path"]] = r
    return found

# The DesignSync read caps a file at 256 KiB of base64 (~192 KiB of image), so a
# handful of the largest photos cannot be transferred whole. For those we fall
# back to the design's own smaller variant of the same shot.
FALLBACKS = {
    'assets/chef.jpg': 'assets/figma/chef.jpg',
    'assets/taya-hero.jpg': 'assets/figma/taya-hero.jpg',
    'assets/hero-taya.jpg': 'assets/figma/taya-hero.jpg',
    'assets/hero-indochine.jpg': 'assets/figma/r-cafe-indochine.jpg',
    'assets/r-danaksara.jpg': 'assets/figma/r-danaksara.jpg',
    'assets/r-hai-van-lounge.jpg': 'assets/figma/r-hai-van-lounge.jpg',
    'assets/cuisine-international.jpg': 'assets/figma/cuisine-international.jpg',
    'assets/cuisine-cafe-lounge.jpg': 'assets/figma/cuisine-cafe-lounge.jpg',
}


def decode(d):
    return base64.b64decode(d["content"]) if d.get("isBase64") else d["content"].encode()


def usable(d):
    raw = decode(d)
    return (not d.get("truncated")) and raw[:2] == b"\xff\xd8" and raw[-2:] == b"\xff\xd9"


def main():
    found = collect()

    # Substitute a usable variant for anything the cap truncated.
    for target, source in FALLBACKS.items():
        have = found.get(target)
        if have and usable(have):
            continue
        alt = found.get(source)
        if alt and usable(alt):
            found[target] = alt
            print(f"  ~ {target} <- {source} (original exceeds the 192 KiB transfer cap)")
    wrote = skipped = 0
    bad = []
    for path, d in sorted(found.items()):
        # assets/figma/* and assets/src/* are the design's alternate renditions;
        # only the canonical assets/*.jpg names are referenced by the app.
        if not path.startswith("assets/") or path.count("/") > 1:
            continue
        raw = decode(d)
        if not usable(d):
            bad.append((path, len(raw)))
            continue
        dest = os.path.join(OUT, path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest) and os.path.getsize(dest) == len(raw):
            skipped += 1
            continue
        open(dest, "wb").write(raw)
        wrote += 1
    print(f"wrote={wrote} unchanged={skipped} oversize/truncated={len(bad)}")
    for p, n in bad:
        print(f"  !! {p} (cap-truncated at {n} bytes)")

main()
