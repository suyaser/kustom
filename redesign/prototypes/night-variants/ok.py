import math
from cbase import lin, rgb, L, cr, mix, dE


def oklab_hex(h):
    r, g, b = [lin(x) for x in rgb(h)]
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = [math.copysign(abs(x) ** (1 / 3), x) for x in (l, m, s)]
    Lk = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return Lk, a, bb


def oklch(h):
    Lk, a, b = oklab_hex(h)
    return (round(Lk, 3), round(math.hypot(a, b), 3), round(math.degrees(math.atan2(b, a)) % 360, 1))


def enc(c):
    c = max(0, min(1, c))
    return round(255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055))


def hexlch(Lk, C, H):
    a = C * math.cos(math.radians(H))
    b = C * math.sin(math.radians(H))
    l = (Lk + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (Lk - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (Lk - 0.0894841775 * a - 1.2914855480 * b) ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return '#' + ''.join(f'{enc(x):02x}' for x in (r, g, bl))
