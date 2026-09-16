#!/usr/bin/env python3
"""Сборка шрифта эмодзи «Twemoji Gandola» (стиль «Б» десктопа).

Один цветной COLRv1-шрифт из SVG-набора Twemoji — смайлики в приложении
одинаковые на любом компе (системный шрифт Windows у всех разный). Результат:
src/renderer/assets/fonts/TwemojiGandola.ttf (~1,4 МБ, ~3700 глифов),
подключается в styles/global.css. Пересобирать нужно только при обновлении
набора эмодзи (новая версия @twemoji/svg).

Шаги (Linux, Python 3.11+, Node):
  python3 -m venv /tmp/fontenv && . /tmp/fontenv/bin/activate
  pip install nanoemoji fonttools
  python client/scripts/build-twemoji-font.py --work /tmp/twbuild
Скрипт сам: качает @twemoji/svg через `npm pack`, переименовывает файлы в
формат nanoemoji (emoji_u1f469_200d_1f4bb.svg), собирает COLRv1 и ДОБАВЛЯЕТ
cmap format 14 (вариационные последовательности с FE0F): без неё Chromium
считает, что шрифт не умеет «❤️», разрывает ZWJ-цепочки на части и уводит
их в системный шрифт — HarfBuzz сам по себе лигатуры собирал, Blink нет.
"""
from __future__ import annotations

import argparse
import glob
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "src" / "renderer" / "assets" / "fonts" / "TwemojiGandola.ttf"
FAMILY = "Twemoji Gandola"


def run(cmd: list[str], **kw) -> None:
    print("+", " ".join(cmd[:6]), "…" if len(cmd) > 6 else "")
    subprocess.run(cmd, check=True, **kw)


def fetch_svgs(work: Path, version: str) -> Path:
    pkg_dir = work / "pkg"
    if not (pkg_dir / "package").exists():
        pkg_dir.mkdir(parents=True, exist_ok=True)
        run(["npm", "pack", f"@twemoji/svg@{version}"], cwd=pkg_dir)
        tgz = next(pkg_dir.glob("*.tgz"))
        with tarfile.open(tgz) as t:
            t.extractall(pkg_dir)
    src = work / "svg"
    if src.exists():
        shutil.rmtree(src)
    src.mkdir()
    n = 0
    for f in (pkg_dir / "package").glob("*.svg"):
        # "1f469-200d-1f4bb.svg" → "emoji_u1f469_200d_1f4bb.svg" (имена, которые понимает nanoemoji)
        shutil.copy(f, src / f"emoji_u{f.stem.replace('-', '_')}.svg")
        n += 1
    print(f"svg: {n} файлов")
    return src


def build_font(work: Path, src: Path) -> Path:
    out = work / "TwemojiGandola.ttf"
    files = sorted(glob.glob(str(src / "emoji_u*.svg")))
    run([
        "nanoemoji", "--color_format", "glyf_colr_1", "--family", FAMILY,
        "--output_file", str(out), "--build_dir", str(work / "build"), *files,
    ])
    return out


def add_vs_cmap(path: Path) -> None:
    """cmap format 14: (cp, U+FE0F) → глиф cp для всех эмодзи в шрифте.

    Плюс лигатуры БЕЗ FE0F: когда селектор разрешается через cmap14,
    HarfBuzz прячет его из потока и правило `1f3f3 fe0f 200d 1f308` уже не
    совпадает — 🏳️‍🌈 рассыпался бы на флаг и радугу. Noto делает так же:
    в GSUB последовательности без FE0F."""
    from fontTools.ttLib import TTFont
    from fontTools.ttLib.tables import otTables as ot
    from fontTools.ttLib.tables._c_m_a_p import cmap_format_14

    font = TTFont(str(path))
    cmap = font["cmap"]
    best = cmap.getBestCmap()
    vs_glyph = best.get(0xFE0F)
    if not any(t.format == 14 for t in cmap.tables):
        components = {0x200D, 0xFE0F, 0x20E3} | set(range(0x1F3FB, 0x1F400)) | set(range(0xE0020, 0xE0080))
        # Цифры/#/* — только компоненты кейкапов (в шрифте у них пустые глифы)
        components |= set(range(0x30, 0x3A)) | {0x23, 0x2A}
        entries = [(cp, None) for cp in sorted(best) if cp not in components]
        sub = cmap_format_14(14)
        sub.platformID, sub.platEncID, sub.language = 0, 5, 0
        sub.cmap = {}
        sub.uvsDict = {0xFE0F: entries}
        cmap.tables.append(sub)
        print(f"cmap14: {len(entries)} вариационных последовательностей с FE0F")
    else:
        print("cmap14 уже есть")

    added = 0
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for st in lookup.SubTable:
            if getattr(st, "ExtSubTable", None) is not None:
                st = st.ExtSubTable
            if not hasattr(st, "ligatures"):
                continue
            for first, ligs in st.ligatures.items():
                have = {tuple(l.Component) for l in ligs}
                for l in list(ligs):
                    if vs_glyph in l.Component:
                        comp = [g for g in l.Component if g != vs_glyph]
                        if tuple(comp) in have or not comp:
                            continue
                        nl = ot.Ligature()
                        nl.Component = comp
                        nl.CompCount = len(comp) + 1
                        nl.LigGlyph = l.LigGlyph
                        ligs.append(nl)
                        have.add(tuple(comp))
                        added += 1
                ligs.sort(key=lambda l: -l.CompCount)  # длинные раньше коротких
    font.save(str(path))
    print(f"лигатур без FE0F добавлено: {added}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/twemoji-build")
    ap.add_argument("--twemoji-version", default="15.0.0")
    ap.add_argument("--skip-build", action="store_true", help="только добавить cmap14 к готовому work/TwemojiGandola.ttf")
    args = ap.parse_args()
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    if args.skip_build:
        built = work / "TwemojiGandola.ttf"
    else:
        built = build_font(work, fetch_svgs(work, args.twemoji_version))
    add_vs_cmap(built)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(built, OUT)
    print(f"→ {OUT} ({os.path.getsize(OUT) // 1024} КБ)")


if __name__ == "__main__":
    sys.exit(main())
