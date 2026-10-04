#!/usr/bin/env python3
"""Contrast + colour-vision checks for Direction C. Run: python3 contrast.py"""
import math
def lin(c):
    c/=255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def rgb(h): h=h.lstrip('#'); return [int(h[i:i+2],16) for i in (0,2,4)]
def L(h): r,g,b=[lin(x) for x in rgb(h)]; return 0.2126*r+0.7152*g+0.0722*b
def cr(a,b):
    la,lb=sorted([L(a),L(b)],reverse=True); return (la+0.05)/(lb+0.05)
def mix(a,b,t):  # t of a over b, sRGB
    A,B=rgb(a),rgb(b); return '#'+''.join(f'{round(A[i]*t+B[i]*(1-t)):02x}' for i in range(3))
M={'protan':[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],
   'deutan':[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],
   'tritan':[[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]]}
def oklab(l):
    r,g,b=l
    L_=0.4122214708*r+0.5363325363*g+0.0514459929*b
    m=0.2119034982*r+0.6806995451*g+0.1073969566*b
    s=0.0883024619*r+0.2817188376*g+0.6299787005*b
    L_,m,s=[math.copysign(abs(x)**(1/3),x) for x in (L_,m,s)]
    return (0.2104542553*L_+0.7936177850*m-0.0040720468*s,1.9779984951*L_-2.4285922050*m+0.4505937099*s,0.0259040371*L_+0.7827717662*m-0.8086757660*s)
def sim(h,k):
    l=[lin(x) for x in rgb(h)]
    if k is None: return l
    return [max(0,min(1,sum(M[k][i][j]*l[j] for j in range(3)))) for i in range(3)]
def dE(a,b,k=None):
    A,B=oklab(sim(a,k)),oklab(sim(b,k)); return 100*math.dist(A,B)
def hue(h):
    a,b=oklab(sim(h,None))[1:]; return math.degrees(math.atan2(b,a))%360

NIGHT=dict(bg='#1A1F29',card='#262D3A',raised='#313948',border='#566173',strong='#7A8597',fg='#F4F6FA',muted='#C5CDD9',
           blue='#2E9BFF',red='#FF6B35',accent='#FFCF66',ink='#10141B')
DAY=dict(bg='#E9EDF2',card='#FFFFFF',raised='#EEF1F5',border='#A9B3C1',strong='#7D8898',fg='#0E1116',muted='#434C5A',
         blue='#1563CF',red='#B5390B',accent='#7A4F00',ink='#FFFFFF')
A=dict(bg='#0A0C10',card='#12161C',muted='#98A3B3',border='#262E3A',fg='#ECEFF3')
if __name__=='__main__':
    for name,t in (('NIGHT',NIGHT),('DAY',DAY)):
        print(f'== {name}')
        for fg in ('fg','muted','blue','red','accent'):
            print(f'  {fg:7s} {t[fg]} on card {cr(t[fg],t["card"]):5.2f}  on bg {cr(t[fg],t["bg"]):5.2f}  on raised {cr(t[fg],t["raised"]):5.2f}')
        print(f'  card vs bg {cr(t["card"],t["bg"]):.2f}; border vs card {cr(t["border"],t["card"]):.2f}, vs bg {cr(t["border"],t["bg"]):.2f}; strong vs card {cr(t["strong"],t["card"]):.2f}')
        print(f'  ink text on blue {cr(t["ink"],t["blue"]):.2f}, on red {cr(t["ink"],t["red"]):.2f}; blue vs card (non-text) {cr(t["blue"],t["card"]):.2f}')
        stripe=mix(t['ink'] if name=='NIGHT' else '#000000',t['red'],0.2)
        print(f'  red stripe {stripe}: ink on stripe {cr(t["ink"],stripe):.2f}; stripe vs red {cr(stripe,t["red"]):.2f}')
        print(f'  lum ratio blue:red {max(L(t["blue"]),L(t["red"]))/min(L(t["blue"]),L(t["red"])):.2f}')
    print('== A (for comparison)')
    print(f'  card vs bg {cr(A["card"],A["bg"]):.2f}; border vs card {cr(A["border"],A["card"]):.2f}; muted on card {cr(A["muted"],A["card"]):.2f}')
    print('== accent candidates vs red #FF6B35 (3.4 limits: lum>=1.8, deutan/protan/tritan dE>=15, hue not within 25 of 39/251)')
    for acc in ('#FFB224','#FFC857','#FFCC5C','#FFCF66','#FFD24D'):
        print(f'  {acc}: lum {L(acc)/L("#FF6B35"):.2f}  deutan {dE(acc,"#FF6B35","deutan"):.1f}  protan {dE(acc,"#FF6B35","protan"):.1f}  tritan {dE(acc,"#FF6B35","tritan"):.1f}  hue {hue(acc):.0f}  on card {cr(acc,NIGHT["card"]):.2f}  ink on it {cr(NIGHT["ink"],acc):.2f}')
    print(f'  team dE normal {dE(NIGHT["blue"],NIGHT["red"]):.1f} protan {dE(NIGHT["blue"],NIGHT["red"],"protan"):.1f} deutan {dE(NIGHT["blue"],NIGHT["red"],"deutan"):.1f}')
