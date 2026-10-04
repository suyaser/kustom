"""Contrast tables for C, V1, V2 (Night). Run: python3 table.py [cand]"""
import sys
from ok import *

TEAM = dict(blue='#2E9BFF', red='#FF6B35', accent='#FFCF66', ink='#10141B')

C = dict(bg='#1A1F29', card='#262D3A', raised='#313948', border='#566173', strong='#7A8597', fg='#F4F6FA', muted='#CBD2DD')
V1 = dict(bg='#05070C', card='#0C121A', raised='#141B28', border='#2A3344', strong='#5D6A80', fg='#F4F7FC', muted='#8B98AD', lamps=1)
V2 = dict(bg='#0B1321', card='#162033', raised='#222D41',
          border='#49576E', strong='#728096', fg='#F4F6FA', muted='#CAD3E1', lamps=1)


def rows(t):
    t = {**TEAM, **t}
    wash = mix(t['accent'], t['card'], 0.09)
    btint = mix(t['blue'], t['card'], 0.12)
    rtint = mix(t['red'], t['card'], 0.12)
    out = [
        ('card vs page', cr(t['card'], t['bg']), 'separation (border carries it)'),
        ('raised vs card', cr(t['raised'], t['card']), ''),
        ('border vs card', cr(t['border'], t['card']), 'decorative hairline'),
        ('border vs page', cr(t['border'], t['bg']), 'decorative hairline'),
        ('border-strong vs card', cr(t['strong'], t['card']), '>= 3 (states, inputs)'),
        ('foreground on page', cr(t['fg'], t['bg']), '>= 4.5'),
        ('foreground on card', cr(t['fg'], t['card']), '>= 4.5'),
        ('foreground on raised', cr(t['fg'], t['raised']), '>= 4.5'),
        ('muted on page', cr(t['muted'], t['bg']), '>= 4.5 (C rule 7)'),
        ('muted on card', cr(t['muted'], t['card']), '>= 4.5 (C rule 7)'),
        ('muted on raised', cr(t['muted'], t['raised']), '>= 4.5 (C rule 7)'),
        (f'muted on you-wash {wash}', cr(t['muted'], wash), '>= 4.5 (C rule 7)'),
        ('amber text on card', cr(t['accent'], t['card']), '>= 4.5'),
        ('amber text on raised', cr(t['accent'], t['raised']), '>= 4.5'),
        ('blue text on page', cr(t['blue'], t['bg']), '>= 4.5'),
        ('blue text on card', cr(t['blue'], t['card']), '>= 4.5'),
        ('blue on raised (text banned)', cr(t['blue'], t['raised']), '>= 3 non-text'),
        ('red text on page', cr(t['red'], t['bg']), '>= 4.5'),
        ('red text on card', cr(t['red'], t['card']), '>= 4.5'),
        ('red on raised (text banned)', cr(t['red'], t['raised']), '>= 3 non-text'),
        (f'foreground on blue tint {btint}', cr(t['fg'], btint), '>= 4.5'),
        (f'foreground on red tint {rtint}', cr(t['fg'], rtint), '>= 4.5'),
        ('blue tint vs card', cr(btint, t['card']), ''),
        ('red tint vs card', cr(rtint, t['card']), ''),
        ('ink on blue fill / red fill', min(cr(t['ink'], t['blue']), cr(t['ink'], t['red'])), 'unchanged'),
    ]
    if t.get('lamps'):
        # Worst case: page under the blue lamp's peak (16%) and under the amber lamp's peak (12%).
        cool = mix('#2E9BFF', t['bg'], 0.16)
        warm = mix('#FFCF66', t['bg'], 0.12)
        for nm, g in (('blue lamp peak', cool), ('amber lamp peak', warm)):
            out += [(f'muted on {nm} {g}', cr(t['muted'], g), '>= 4.5'),
                    (f'border vs {nm}', cr(t['border'], g), 'decorative'),
                    (f'blue text on {nm}', cr(t['blue'], g), '>= 4.5'),
                    (f'red text on {nm}', cr(t['red'], g), '>= 4.5'),
                    (f'amber text on {nm}', cr(t['accent'], g), '>= 4.5')]
    else:
        g = mix('#FFCF66', t['bg'], 0.07)
        out += [(f'muted on glow peak {g}', cr(t['muted'], g), '>= 4.5'),
                (f'blue text on glow peak', cr(t['blue'], g), '>= 4.5'),
                (f'red text on glow peak', cr(t['red'], g), '>= 4.5')]
    return out


def show(name, t):
    print(f'== {name}: ' + ' '.join(f'{k}={v}' for k, v in t.items()))
    for k, v in t.items():
        if k == 'lamps': continue
        print(f'   {k:7s} {v} oklch{oklch(v)}')
    for label, v, tgt in rows(t):
        print(f'  {label:42s} {v:6.2f}  {tgt}')


if __name__ == '__main__':
    for n, t in (('C', C), ('V1', V1), ('V2', V2)):
        show(n, t)
    b, r = TEAM['blue'], TEAM['red']
    print('team luminance ratio', round(max(L(b), L(r)) / min(L(b), L(r)), 2),
          'dE normal/protan/deutan/tritan', [round(dE(b, r, k), 1) for k in (None, 'protan', 'deutan', 'tritan')])
