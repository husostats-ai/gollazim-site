# Avrupa kupası rozetleri: logo-yeni/ altındaki tam logolardan yalnızca üstteki amblemi kırpar,
# açık renkli yuvarlak bir rozetin ortasına yerleştirir ve src/components/emblems/*.png olarak yazar.
# Kullanım: python3 -I scripts/turnuva-amblem.py   (gereken: Pillow, WebP desteğiyle)
#
# Kırpma: logonun saydam olmayan satırları yukarıdan taranır; ilk dolu satır bloğu amblemdir
# (altındaki boşluktan sonra "UEFA" yayı ve yazı başlar). Ölçek: amblemin merkezine en uzak
# görünür pikseli rozetin iç çemberine oturur; böylece top ile kupa+halka rozeti benzer oranda doldurur.
# Rozetler üye sitesinin JS'ine data: adresi olarak gömülür; base64 metni üye çıktısı denetiminin
# yasak terimlerini içermemeli (scripts/lib/uye-cikti-denetim.mjs). İçerirse sıkıştırma ayarı değiştirilir.
from __future__ import annotations

import base64
import io
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SOURCES = {
    'ucl': 'logo-yeni/5842fe06a6515b1e0ad75b3b.png',
    'uel': 'logo-yeni/UEFA_Europa_League_logo_(2024_version).svg.webp',
    'uecl': 'logo-yeni/Konferans_Ligi_logosu.svg.webp',
}
OUT = Path('src/components/emblems')
SIZE = 64  # piksel; kartta 18 px çapında gösterilir (~3.5x yoğunluk)
SCALE = 8  # rozet bu katı boyutta çizilip küçültülür (kenar yumuşatma)
BADGE = (238, 242, 246, 255)  # açık gri-beyaz zemin
FILL = 0.40  # amblemin kapladığı yarıçap / rozet çapı (0.5 = kenara kadar)
ALPHA_MIN = 32
FORBIDDEN = ['oran', 'piyasa', 'kaynak', 'ortalama', 'bağlantı', 'footystats', 'csv', 'odds']


def emblem_box(im: Image.Image) -> tuple[int, int, int, int]:
    alpha = im.getchannel('A').point(lambda a: 255 if a > ALPHA_MIN else 0)
    w, h = im.size
    top = bottom = None
    for y in range(h):
        filled = alpha.crop((0, y, w, y + 1)).getbbox() is not None
        if filled and top is None:
            top = y
        if not filled and top is not None:
            bottom = y
            break
    box = alpha.crop((0, top, w, bottom)).getbbox()
    return box[0], top + box[1], box[2], top + box[3]


def badge(im: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    emblem = im.crop(box)
    alpha = emblem.getchannel('A')
    cx, cy = emblem.width / 2, emblem.height / 2
    radius = max(((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5 for y in range(emblem.height) for x in range(emblem.width) if alpha.getpixel((x, y)) > ALPHA_MIN)
    big = SIZE * SCALE
    factor = FILL * big / radius
    emblem = emblem.resize((round(emblem.width * factor), round(emblem.height * factor)), Image.LANCZOS)
    canvas = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).ellipse((0, 0, big - 1, big - 1), fill=BADGE)
    canvas.alpha_composite(emblem, (round(big / 2 - emblem.width / 2), round(big / 2 - emblem.height / 2)))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def encode(img: Image.Image) -> bytes:
    # Base64 metninde yasak terim çıkmayan ilk sıkıştırma ayarı
    for level in range(9, -1, -1):
        buffer = io.BytesIO()
        img.save(buffer, 'PNG', optimize=False, compress_level=level)
        data = buffer.getvalue()
        text = base64.b64encode(data).decode().lower()
        if not any(word in text for word in FORBIDDEN) and not re.search(r'(^|[^a-z0-9_])xg([^a-z0-9_]|$)', text):
            return data
    sys.exit('yasak terim içermeyen kodlama bulunamadı')


OUT.mkdir(parents=True, exist_ok=True)
for name, source in SOURCES.items():
    im = Image.open(source).convert('RGBA')
    box = emblem_box(im)
    data = encode(badge(im, box))
    (OUT / f'{name}.png').write_bytes(data)
    print(f'{name}: {source} {im.size} -> amblem {box} -> {OUT / name}.png {len(data)} bayt')
