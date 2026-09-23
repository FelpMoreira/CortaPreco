"""Gera as variantes da logo a partir de logo-original.jpeg (fundo branco, 1:1).

Recorta o espaço vazio, remove o fundo (alpha a partir da distância do branco) e
cria versões para fundo claro e escuro. Rodar: python3 assets/brand/build.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'assets/brand/logo-original.jpeg'
OUT = ROOT / 'apps/web/public/brand'
APP = ROOT / 'apps/web/app'

DARK = (11, 34, 25)      # verde quase preto da logo
GREEN = (34, 160, 110)   # esmeralda da logo
ON_DARK = {'dark': (236, 245, 240), 'green': (46, 196, 132)}
ON_LIGHT = {'dark': DARK, 'green': GREEN}
ICON_MAX_X = 452         # faixa vazia entre o ícone e o texto


def lum(c):
    r, g, b = c
    return 0.299 * r + 0.587 * g + 0.114 * b


def recolor(img, palette):
    """Cada pixel vira uma das duas cores da marca com alpha proporcional à tinta."""
    src = img.load()
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    dst = out.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b = src[x, y]
            is_green = (g - r) > 28 and g > 70
            fg = GREEN if is_green else DARK
            a = (255 - lum((r, g, b))) / (255 - lum(fg))
            a = max(0.0, min(1.0, a))
            if a < 0.04:
                continue
            color = palette['green' if is_green else 'dark']
            dst[x, y] = (*color, round(a * 255))
    return out


def trim(img, pad=8):
    box = img.getbbox()
    img = img.crop(box)
    canvas = Image.new('RGBA', (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(img, (pad, pad))
    return canvas


def square_icon(icon, size, bg, radius_ratio=0.22, inset=0.16):
    tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255)
    tile.paste(Image.new('RGBA', (size, size), (*bg, 255)), (0, 0), mask)
    inner = int(size * (1 - inset * 2))
    ic = icon.copy()
    ic.thumbnail((inner, inner), Image.LANCZOS)
    tile.alpha_composite(ic, ((size - ic.width) // 2, (size - ic.height) // 2))
    return tile


def main():
    src = Image.open(SRC).convert('RGB')
    OUT.mkdir(parents=True, exist_ok=True)

    for name, pal in (('logo-on-dark', ON_DARK), ('logo-on-light', ON_LIGHT)):
        trim(recolor(src, pal)).save(OUT / f'{name}.png', optimize=True)

    icon_src = src.crop((0, 0, ICON_MAX_X, src.height))
    icon_dark = trim(recolor(icon_src, ON_DARK), pad=0)
    icon_dark.save(OUT / 'icon-on-dark.png', optimize=True)

    # favicon / ícone do app: ícone claro sobre quadrado verde-escuro da marca
    square_icon(icon_dark, 512, DARK).save(APP / 'icon.png', optimize=True)
    apple = square_icon(icon_dark, 180, DARK, radius_ratio=0)
    apple.convert('RGB').save(APP / 'apple-icon.png', optimize=True)

    # prévia de link (WhatsApp, Telegram, redes): 1200x630, logo sobre o fundo escuro do site
    og = Image.new('RGBA', (1200, 630), (7, 18, 13, 255))
    logo = Image.open(OUT / 'logo-on-dark.png')
    logo.thumbnail((760, 300), Image.LANCZOS)
    og.alpha_composite(logo, ((1200 - logo.width) // 2, (630 - logo.height) // 2))
    og.convert('RGB').save(APP / 'opengraph-image.png', optimize=True)

    for f in sorted(OUT.iterdir()):
        print(f.relative_to(ROOT), Image.open(f).size)


if __name__ == '__main__':
    main()
