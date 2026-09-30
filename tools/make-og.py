#!/usr/bin/env python3
"""生成社交分享卡 1200x630（og.png）与 apple-touch-icon.png
用法: python3 tools/make-og.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')
W, H = 1200, 630

FONT_CANDIDATES = [
    '/usr/share/fonts/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
]
FONT_BOLD_CANDIDATES = [
    '/usr/share/fonts/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc',
]


def pick(cands, size, fallback=None):
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def build_og():
    img = Image.new('RGB', (W, H), (8, 10, 20))
    d = ImageDraw.Draw(img, 'RGBA')

    # 夜空渐变底
    top, bot = (13, 16, 32), (8, 10, 20)
    for y in range(H):
        d.line([(0, y), (W, y)], fill=lerp(top, bot, y / H))

    # 光晕
    for (cx, cy, r, col) in [
        (600, -80, 560, (125, 212, 225, 34)),
        (1040, 420, 460, (157, 140, 224, 30)),
        (120, 560, 420, (217, 184, 119, 20)),
    ]:
        for i in range(46, 0, -1):
            t = i / 46
            rr = int(r * t)
            a = int(col[3] * (1 - t) ** 1.7)
            if a <= 0:
                continue
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col[:3] + (a,))

    # 月亮：用遮罩法切出月牙，避免"缺口"露出与背景不符的纯黑椭圆
    mx, my, mr = 1010, 118, 62
    glow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow, 'RGBA')
    for i in range(26, 0, -1):
        t = i / 26
        rr = int(mr * t * 2.4)
        a = int(46 * (1 - t) ** 2)
        if a <= 0:
            continue
        gd.ellipse([mx - rr, my - rr, mx + rr, my + rr], fill=(244, 224, 176, a))
    img.paste(Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB'), (0, 0))

    disc = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(disc).ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=(246, 232, 196, 255))
    cut = Image.new('L', img.size, 0)
    ImageDraw.Draw(cut).ellipse([mx - mr + 34, my - mr - 14, mx + mr + 68, my + mr - 38], fill=255)
    disc.putalpha(Image.composite(Image.new('L', img.size, 0), disc.getchannel('A'), cut))
    img.paste(Image.alpha_composite(img.convert('RGBA'), disc).convert('RGB'), (0, 0))

    # 星点（固定种子，保证可复现）
    import random
    rnd = random.Random(20260929)
    for _ in range(120):
        x = rnd.randint(0, W)
        y = rnd.randint(0, int(H * 0.82))
        a = rnd.randint(40, 190)
        r = rnd.choice([1, 1, 1, 2])
        d.ellipse([x, y, x + r, y + r], fill=(207, 216, 255, a))

    # 左侧品牌竖条
    for i in range(8):
        d.rectangle([0, i * (H / 8), 8, (i + 1) * (H / 8)],
                    fill=lerp((125, 212, 193), (157, 140, 224), i / 7))

    f_title = pick(FONT_BOLD_CANDIDATES, 108)
    f_sub = pick(FONT_CANDIDATES, 40)
    f_tag = pick(FONT_CANDIDATES, 30)
    f_small = pick(FONT_CANDIDATES, 26)

    x0 = 96
    # 主标题
    d.text((x0 + 3, 176 + 4), '周公解梦', font=f_title, fill=(0, 0, 0, 160))
    d.text((x0, 176), '周公解梦', font=f_title, fill=(244, 224, 176))

    # 副标题
    d.text((x0, 316), '说了你梦到什么，逐象拆解吉凶', font=f_sub, fill=(228, 232, 242))

    # 分隔线
    d.rectangle([x0, 386, x0 + 520, 389], fill=(217, 184, 119, 150))

    # 四个能力标签
    tags = ['传统断语', '心理象征', '情境分述', '吉凶定级']
    tx = x0
    f_chip = pick(FONT_CANDIDATES, 27)
    for i, t in enumerate(tags):
        wpx = d.textlength(t, font=f_chip)
        bw = int(wpx) + 34
        d.rounded_rectangle([tx, 420, tx + bw, 470], radius=25,
                            fill=(125, 212, 193, 26), outline=(47, 143, 124, 150), width=1)
        d.text((tx + 17, 432), t, font=f_chip, fill=(184, 240, 228))
        tx += bw + 13

    # 底部：左一行示例、右一行说明，各自按可用宽度截断，绝不重叠
    d.text((x0, 522), '蛇 · 掉牙 · 洪水 · 被追 · 考试 · 飞翔 · 结婚 …', font=f_small,
           fill=(154, 160, 189))
    right = '纯前端本地计算 · 无后端'
    rw = d.textlength(right, font=f_small)
    d.text((W - 96 - rw, 522), right, font=f_small, fill=(125, 132, 164))

    # 右下角装饰：解梦书页
    bx, by = 828, 300
    for i, (off, alpha) in enumerate([(8, 46), (4, 70), (0, 255)]):
        d.rounded_rectangle([bx + off, by - off, bx + 300 + off, by + 220 - off],
                            radius=14, fill=(17, 21, 39, alpha),
                            outline=(36, 43, 71, 200), width=1)
    d.rounded_rectangle([bx, by, bx + 300, by + 220], radius=14,
                        fill=(23, 28, 50), outline=(51, 60, 96), width=1)
    for i in range(6):
        yy = by + 34 + i * 28
        ww = [232, 196, 246, 158, 214, 132][i]
        d.rounded_rectangle([bx + 28, yy, bx + 28 + ww, yy + 7], radius=4,
                            fill=(125, 212, 193, 62 + i * 12))
    d.rounded_rectangle([bx + 28, by + 34 + 9, bx + 28 + 232, by + 34 + 9],
                        radius=0, fill=(217, 184, 119, 120))

    img.save(os.path.join(OUT, 'og.png'), 'PNG', optimize=True)
    print('og.png', img.size, os.path.getsize(os.path.join(OUT, 'og.png')), 'bytes')


def build_icon():
    S = 512
    img = Image.new('RGB', (S, S), (8, 10, 20))
    d = ImageDraw.Draw(img, 'RGBA')
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp((14, 17, 34), (8, 10, 20), y / S))
    for i in range(40, 0, -1):
        t = i / 40
        rr = int(S * 0.62 * t)
        a = int(46 * (1 - t) ** 1.8)
        d.ellipse([S / 2 - rr, S / 2 - rr, S / 2 + rr, S / 2 + rr], fill=(125, 212, 225, a))
    # 月亮
    mr = 150
    d.ellipse([S / 2 - mr, S / 2 - mr, S / 2 + mr, S / 2 + mr], fill=(246, 232, 196))
    d.ellipse([S / 2 - mr + 74, S / 2 - mr - 30, S / 2 + mr + 150, S / 2 + mr - 84], fill=(10, 12, 24))
    import random
    rnd = random.Random(7)
    for _ in range(70):
        x = rnd.randint(0, S)
        y = rnd.randint(0, S)
        a = rnd.randint(40, 170)
        r = rnd.choice([2, 3, 4])
        d.ellipse([x, y, x + r, y + r], fill=(207, 216, 255, a))
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=0, outline=(217, 184, 119, 60), width=3)
    img.save(os.path.join(OUT, 'apple-touch-icon.png'), 'PNG', optimize=True)
    print('apple-touch-icon.png', img.size, os.path.getsize(os.path.join(OUT, 'apple-touch-icon.png')), 'bytes')


if __name__ == '__main__':
    build_og()
    build_icon()
