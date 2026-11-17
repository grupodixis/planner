#!/usr/bin/env python3
"""Genera catalogo-base.json: catálogo inicial de materiales y herramientas de HAM.

Medidas comerciales habituales en España (acero S235/S275, galvanizado, inox 304/316L,
aluminio), más lo que aparece en los escandallos de Notion (Titan, Dynabolt, Isoparete…).
Para regenerar:  python3 app/src/catalogo/generar.py
Cada entrada: {tipo, familia, nombre, unidad, detalle}. El nombre es único por tipo.
"""
import json, os

items = []
vistos = set()

def num(x):
    s = f"{x:g}"
    return s.replace('.', ',')

def add(tipo, familia, nombre, unidad='ud', detalle=None):
    k = (tipo, nombre.lower())
    if k in vistos:
        return
    vistos.add(k)
    items.append({'tipo': tipo, 'familia': familia, 'nombre': nombre, 'unidad': unidad, 'detalle': detalle})

M = lambda familia, nombre, unidad='ud', detalle=None: add('material', familia, nombre, unidad, detalle)
H = lambda familia, nombre, unidad='ud', detalle=None: add('herramienta', familia, nombre, unidad, detalle)
B6, B12 = 'barra 6 m', 'barra 12 m'

# ---------------------------------------------------------------- tubos de acero
CUAD = {15: [1.5], 20: [1.5, 2], 25: [1.5, 2, 3], 30: [1.5, 2, 3], 35: [1.5, 2, 3], 40: [1.5, 2, 3, 4],
        45: [2, 3], 50: [1.5, 2, 3, 4, 5], 60: [2, 3, 4, 5], 70: [2, 3, 4, 5], 80: [2, 3, 4, 5, 6],
        90: [3, 4, 5], 100: [3, 4, 5, 6, 8], 120: [4, 5, 6, 8], 140: [4, 5, 6, 8], 150: [5, 6, 8, 10],
        160: [5, 6, 8, 10], 180: [6, 8, 10], 200: [6, 8, 10], 250: [8, 10, 12], 300: [8, 10, 12]}
RECT = {(20, 10): [1.5], (25, 15): [1.5], (30, 10): [1.5], (30, 15): [1.5, 2], (30, 20): [1.5, 2],
        (40, 10): [1.5], (40, 15): [1.5], (40, 20): [1.5, 2, 3], (40, 30): [2, 3], (50, 10): [1.5, 2],
        (50, 20): [1.5, 2, 3], (50, 25): [1.5, 2, 3], (50, 30): [2, 3], (50, 35): [2], (50, 40): [2, 3],
        (60, 20): [1.5, 2, 3], (60, 30): [2, 3, 4], (60, 40): [2, 3, 4], (70, 30): [2, 3], (70, 40): [2, 3, 4],
        (70, 50): [3, 4], (80, 20): [2], (80, 40): [2, 3, 4, 5], (80, 60): [3, 4, 5], (90, 50): [3, 4],
        (100, 20): [2], (100, 40): [2, 3, 4], (100, 50): [2, 3, 4, 5, 6], (100, 60): [3, 4, 5],
        (100, 80): [4, 5, 6], (120, 40): [3, 4], (120, 60): [3, 4, 5, 6], (120, 80): [4, 5, 6],
        (140, 60): [4, 5], (140, 80): [4, 5, 6], (150, 50): [4, 5], (150, 100): [4, 5, 6, 8],
        (160, 80): [4, 5, 6, 8], (180, 100): [5, 6, 8], (200, 100): [5, 6, 8, 10], (200, 120): [6, 8, 10],
        (250, 150): [6, 8, 10], (300, 100): [8, 10], (300, 200): [8, 10, 12]}
RED = {16: [1.5], 20: [1.5, 2], 21.3: [2, 2.6], 25: [1.5, 2], 26.9: [2, 2.6], 30: [1.5, 2], 32: [1.5, 2],
       33.7: [2, 2.6, 3.2], 35: [1.5, 2], 40: [1.5, 2], 42.4: [2, 2.6, 3.2], 48.3: [2, 2.6, 3.2, 4],
       50: [2, 3], 60.3: [2, 2.9, 3.6, 4], 76.1: [2.9, 3.2, 4, 5], 88.9: [3.2, 4, 5], 101.6: [3.6, 4, 5],
       114.3: [3.6, 4, 5, 6], 139.7: [4, 5, 6], 168.3: [4, 5, 6, 8], 193.7: [5, 6, 8], 219.1: [6, 8, 10],
       273: [6, 8, 10]}

for lado, es in CUAD.items():
    for e in es:
        M('Tubos acero', f'Tubo cuadrado {lado}×{lado}×{num(e)} S235', 'barra', B6 if lado < 150 else B12)
        if lado <= 120 and e <= 3:
            M('Tubos acero', f'Tubo cuadrado {lado}×{lado}×{num(e)} galvanizado', 'barra', B6)
for (a, b), es in RECT.items():
    for e in es:
        M('Tubos acero', f'Tubo rectangular {a}×{b}×{num(e)} S235', 'barra', B6 if a < 150 else B12)
        if a <= 120 and e <= 3:
            M('Tubos acero', f'Tubo rectangular {a}×{b}×{num(e)} galvanizado', 'barra', B6)
for d, es in RED.items():
    for e in es:
        M('Tubos acero', f'Tubo redondo Ø{num(d)}×{num(e)} S235', 'barra', B6)
        if d <= 76.1 and e <= 3.2:
            M('Tubos acero', f'Tubo redondo Ø{num(d)}×{num(e)} galvanizado', 'barra', B6)

# ---------------------------------------------------------------- tubos inox
for lado, es in {15: [1.5], 20: [1.5, 2], 25: [1.5, 2], 30: [1.5, 2], 40: [1.5, 2, 3], 50: [1.5, 2, 3],
                 60: [2, 3], 80: [2, 3], 100: [2, 3, 4]}.items():
    for e in es:
        for mat in ['INOX 304', 'INOX 316L']:
            M('Tubos inox', f'Tubo cuadrado {lado}×{lado}×{num(e)} {mat} satinado', 'barra', B6)
for (a, b), es in {(20, 10): [1.5], (30, 15): [1.5], (40, 10): [1.5, 2], (40, 20): [1.5, 2], (50, 10): [1.5, 2],
                   (50, 20): [1.5, 2], (50, 25): [1.5, 2], (50, 30): [2], (60, 20): [2], (60, 30): [2, 3],
                   (60, 40): [2, 3], (80, 20): [2], (80, 40): [2, 3], (100, 40): [2, 3], (100, 50): [2, 3]}.items():
    for e in es:
        for mat in ['INOX 304', 'INOX 316L']:
            M('Tubos inox', f'Tubo rectangular {a}×{b}×{num(e)} {mat} satinado', 'barra', B6)
for d, es in {10: [1], 12: [1, 1.5], 16: [1.5], 20: [1.5], 25: [1.5], 30: [1.5], 32: [1.5], 33.7: [2],
              38: [1.5], 40: [1.5, 2], 42.4: [1.5, 2], 48.3: [1.5, 2], 50.8: [1.5, 2], 60.3: [2],
              76.1: [2], 88.9: [2, 3], 101.6: [2], 114.3: [2, 3]}.items():
    for e in es:
        for mat, acab in [('INOX 304', 'satinado'), ('INOX 304', 'pulido brillo'), ('INOX 316L', 'satinado'), ('INOX 316L', 'pulido brillo')]:
            M('Tubos inox', f'Tubo redondo Ø{num(d)}×{num(e)} {mat} {acab}', 'barra', B6)

# ---------------------------------------------------------------- perfiles laminados
for t, ms in {'IPE': [80, 100, 120, 140, 160, 180, 200, 220, 240, 270, 300, 330, 360, 400, 450, 500],
              'IPN': [80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 300],
              'UPN': [50, 65, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 300],
              'HEA': [100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 400],
              'HEB': [100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 400],
              'HEM': [100, 120, 140, 160, 200]}.items():
    for m in ms:
        M('Perfiles laminados', f'{t} {m} S275', 'barra', B12)
for lado, es in {20: [3], 25: [3, 4], 30: [3, 4], 35: [3.5, 4], 40: [4, 5], 45: [4.5, 5], 50: [5, 6],
                 60: [6, 8], 70: [7], 80: [8], 90: [9], 100: [10, 12], 120: [12], 150: [15]}.items():
    for e in es:
        M('Perfiles laminados', f'Angular L {lado}×{lado}×{num(e)} S235', 'barra', B6)
        if lado <= 60:
            M('Perfiles laminados', f'Angular L {lado}×{lado}×{num(e)} galvanizado', 'barra', B6)
            M('Perfiles inox', f'Angular L {lado}×{lado}×{num(e)} INOX 304', 'barra', B6)
for (a, b, e) in [(40, 20, 4), (50, 30, 5), (60, 40, 5), (60, 40, 6), (80, 40, 6), (80, 60, 7), (100, 50, 6),
                  (100, 50, 8), (100, 65, 7), (100, 75, 8), (120, 80, 8), (150, 90, 10)]:
    M('Perfiles laminados', f'Angular L desigual {a}×{b}×{e} S235', 'barra', B6)
for (a, e) in [(20, 3), (25, 3.5), (30, 4), (35, 4.5), (40, 5), (45, 5.5), (50, 6), (60, 7), (70, 8), (80, 9)]:
    M('Perfiles laminados', f'Perfil T {a}×{a}×{num(e)} S235', 'barra', B6)
for (a, b, e) in [(20, 20, 2), (30, 15, 2), (30, 30, 3), (40, 20, 2), (40, 40, 3), (50, 25, 3), (60, 30, 3),
                  (80, 40, 3), (100, 50, 3), (120, 60, 4)]:
    M('Perfiles laminados', f'Perfil U plegado {a}×{b}×{e} S235', 'barra', B6)
    M('Perfiles laminados', f'Perfil U plegado {a}×{b}×{e} galvanizado', 'barra', B6)

# pletinas (llantas)
PLET = {15: [3, 4, 5], 20: [3, 4, 5, 6, 8, 10], 25: [3, 4, 5, 6, 8, 10], 30: [3, 4, 5, 6, 8, 10, 12, 15],
        35: [4, 5, 6, 8, 10], 40: [3, 4, 5, 6, 8, 10, 12, 15, 20], 45: [5, 6, 8, 10], 50: [3, 4, 5, 6, 8, 10, 12, 15, 20, 25],
        60: [4, 5, 6, 8, 10, 12, 15, 20], 70: [5, 6, 8, 10, 12, 15], 80: [5, 6, 8, 10, 12, 15, 20], 90: [8, 10, 12],
        100: [5, 6, 8, 10, 12, 15, 20], 120: [5, 6, 8, 10, 12, 15, 20], 150: [6, 8, 10, 12, 15, 20], 180: [8, 10, 12, 15],
        200: [8, 10, 12, 15, 20], 250: [10, 12, 15, 20], 300: [10, 15, 20]}
for a, es in PLET.items():
    for e in es:
        M('Pletinas y macizos', f'Pletina {a}×{e} S275', 'barra', B6)
        if a <= 100 and e <= 10:
            M('Pletinas y macizos', f'Pletina {a}×{e} galvanizada', 'barra', B6)
        if a <= 100 and e <= 10 or (a in (150, 250) and e == 10):
            M('Pletinas y macizos', f'Pletina {a}×{e} INOX 304', 'barra', B6)
        if a <= 60 and e <= 10:
            M('Pletinas y macizos', f'Pletina {a}×{e} INOX 316L', 'barra', B6)
for d in [5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 30, 35, 40, 45, 50, 60]:
    M('Pletinas y macizos', f'Redondo macizo liso Ø{d} S235', 'barra', B6)
    if d <= 30:
        M('Pletinas y macizos', f'Redondo macizo liso Ø{d} INOX 304', 'barra', B6)
    if d <= 20:
        M('Pletinas y macizos', f'Redondo macizo liso Ø{d} INOX 316L', 'barra', B6)
for d in [6, 8, 10, 12, 16, 20, 25]:
    M('Pletinas y macizos', f'Redondo corrugado (macizo construcción) Ø{d} B500S', 'barra', B6)
for a in [8, 10, 12, 14, 16, 20, 25, 30, 40]:
    M('Pletinas y macizos', f'Cuadrado macizo {a}×{a} S235', 'barra', B6)
    if a <= 20:
        M('Pletinas y macizos', f'Cuadrado macizo {a}×{a} INOX 304', 'barra', B6)
for a in [10, 12, 14, 16, 20]:
    M('Pletinas y macizos', f'Cuadrado macizo forja (retorcido) {a}×{a}', 'barra', B6)

# correas conformadas
for h in [80, 100, 120, 140, 160, 180, 200, 225, 250, 275, 300]:
    for e in [1.5, 2, 2.5, 3]:
        if h >= 200 and e < 2:
            continue
        M('Correas', f'Correa C {h}×{num(e)} galvanizada', 'barra', 'a medida')
        M('Correas', f'Correa Z {h}×{num(e)} galvanizada', 'barra', 'a medida')
for h in [30, 40, 50, 60]:
    M('Correas', f'Perfil omega {h} galvanizado', 'barra', B6)

# ---------------------------------------------------------------- chapas
FMT = ['1000×2000', '1250×2500', '1500×3000']
for e in [0.8, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30]:
    for f in (FMT if e <= 3 else FMT[1:]):
        M('Chapas', f'Chapa lisa negra {num(e)} mm {f}', 'chapa')
for e in [0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3]:
    for f in FMT[:2]:
        M('Chapas', f'Chapa galvanizada {num(e)} mm {f}', 'chapa')
for e in ['3/5', '4/6', '5/7', '6/8', '8/10']:
    for f in FMT[1:]:
        M('Chapas', f'Chapa lagrimada {e} mm {f}', 'chapa')
for e in [0.8, 1, 1.5, 2, 3, 4, 5, 6, 8, 10]:
    for f in FMT[:2] if e <= 3 else FMT[1:]:
        M('Chapas', f'Chapa INOX 304 2B {num(e)} mm {f}', 'chapa')
    if e <= 3:
        M('Chapas', f'Chapa INOX 304 satinada {num(e)} mm 1250×2500', 'chapa')
        M('Chapas', f'Chapa INOX 316L 2B {num(e)} mm 1500×3000', 'chapa')
        M('Chapas', f'Chapa INOX 316L satinada {num(e)} mm 1250×2500', 'chapa')
for e in ['1,5/2', '2/3', '3/4,5']:
    M('Chapas', f'Chapa INOX 304 lagrimada {e} mm 1250×2500', 'chapa')
for e in [1, 1.5, 2, 3, 4, 5, 6, 8, 10]:
    M('Chapas', f'Chapa aluminio lisa {num(e)} mm 1500×3000', 'chapa')
for e in ['1,5/2', '2/3', '3/4,5', '4/5,5']:
    M('Chapas', f'Chapa aluminio damero {e} mm 1250×2500', 'chapa')
for e in [1, 1.5, 2, 3]:
    M('Chapas', f'Chapa perforada R5 T8 {num(e)} mm 1000×2000 galvanizada', 'chapa')
    M('Chapas', f'Chapa perforada R5 T8 {num(e)} mm 1000×2000 INOX 304', 'chapa')
for m in ['negra', 'galvanizada']:
    M('Chapas', f'Metal desplegado (deployé) {m} 1000×2000', 'chapa')
for e in [2, 3, 4, 5, 6, 8, 10, 12, 15, 20]:
    M('Chapas', f'Placa de anclaje / chapa cortada a medida {e} mm S275', 'ud', 'indicar medidas en la nota')
for e in [2, 3, 4, 5, 6, 8, 10]:
    M('Chapas', f'Chapa cortada a medida {e} mm INOX 304', 'ud', 'indicar medidas en la nota')
M('Chapas', 'Piezas de corte láser (según plano)', 'ud', 'indicar proveedor y plano')
M('Chapas', 'Chapa plegada a medida (según plano)', 'ud')

# rejillas y mallas
for p in ['30×2', '30×3', '40×3', '30×5']:
    for c in ['30×30', '34×38', '30×10']:
        M('Rejillas y mallas', f'Rejilla electrosoldada (tramex) pletina {p} cuadrícula {c} galvanizada', 'm2')
M('Rejillas y mallas', 'Peldaño de rejilla electrosoldada galvanizado (a medida)', 'ud')
for c, d in [('15×15', 5), ('15×15', 6), ('20×20', 6), ('15×30', 8)]:
    M('Rejillas y mallas', f'Mallazo electrosoldado {c} Ø{d}', 'panel', '2,15×5 m / 2×6 m')
for c in ['50×50', '100×50', '200×50']:
    M('Rejillas y mallas', f'Panel de malla electrosoldada {c} galvanizada (vallado)', 'panel')
M('Rejillas y mallas', 'Malla de simple torsión galvanizada', 'rollo')
M('Rejillas y mallas', 'Malla electrosoldada inox (a medida)', 'm2')
M('Rejillas y mallas', 'Malla anudada / cable inox para barandilla', 'm2')

# aluminio perfiles
for lado, es in {15: [1.5], 20: [1.5, 2], 25: [1.5, 2], 30: [1.5, 2], 40: [2, 3], 50: [2, 3], 60: [2, 3], 80: [3], 100: [3]}.items():
    for e in es:
        M('Aluminio', f'Tubo cuadrado aluminio {lado}×{lado}×{num(e)} bruto', 'barra', B6)
for (a, b, e) in [(40, 20, 2), (50, 20, 2), (50, 30, 2), (60, 30, 2), (60, 40, 2), (80, 40, 2), (100, 50, 3), (150, 70, 3)]:
    M('Aluminio', f'Tubo rectangular aluminio {a}×{b}×{e} bruto', 'barra', B6)
    M('Aluminio', f'Tubo rectangular aluminio {a}×{b}×{e} lacado RAL', 'barra', B6)
for d, e in [(16, 1.5), (20, 2), (25, 2), (30, 2), (40, 2), (50, 2)]:
    M('Aluminio', f'Tubo redondo aluminio Ø{d}×{num(e)} bruto', 'barra', B6)
for (a, e) in [(15, 2), (20, 2), (25, 2), (30, 2), (30, 3), (40, 3), (40, 4), (50, 5)]:
    M('Aluminio', f'Angular aluminio {a}×{a}×{e}', 'barra', B6)
for (a, e) in [(20, 2), (20, 3), (30, 3), (40, 3), (40, 5), (50, 5), (60, 6), (80, 8), (100, 10)]:
    M('Aluminio', f'Pletina aluminio {a}×{e}', 'barra', B6)
M('Aluminio', 'Tubo U con clip aluminio 40×40', 'barra', B6)
M('Aluminio', 'Lama de aluminio para celosía (según modelo)', 'barra')
M('Aluminio', 'Perfilería Cortizo (según serie)', 'barra', 'indicar serie y referencia')

# paneles, cubiertas, cerramientos
for e in [30, 40, 50, 60, 80, 100]:
    M('Paneles y cubiertas', f'Panel sándwich cubierta (Isotap) {e} mm', 'm2', 'longitud a medida')
for e in [40, 50, 60, 80, 100]:
    M('Paneles y cubiertas', f'Panel sándwich fachada (Isoparete) {e} mm', 'm2', 'longitud a medida')
for e in ['0,5', '0,6', '0,7']:
    M('Paneles y cubiertas', f'Chapa grecada {e} mm galvanizada', 'm2')
    M('Paneles y cubiertas', f'Chapa grecada {e} mm prelacada', 'm2')
for r in ['cumbrera', 'canalón', 'remate lateral', 'babero', 'esquinero', 'vierteaguas', 'tapajuntas']:
    M('Paneles y cubiertas', f'Remate de chapa plegada: {r}', 'ud', 'a medida')
M('Paneles y cubiertas', 'Claraboya / lucernario de policarbonato', 'ud')
M('Paneles y cubiertas', 'Placa traslúcida de policarbonato grecada', 'm2')
M('Paneles y cubiertas', 'Tarima composite (Tarimatec) 80×40', 'barra', '3 m')
M('Paneles y cubiertas', 'Cañizo / caña de bambú', 'rollo')
for e in [4, 6, 10, 16]:
    M('Paneles y cubiertas', f'Policarbonato {"compacto" if e <= 6 else "celular"} {e} mm', 'm2')

# vidrio
for v in ['3+3', '4+4', '5+5', '6+6', '8+8', '10+10']:
    M('Vidrio', f'Vidrio laminado {v} transparente', 'm2', 'a medida')
    if v in ('5+5', '6+6', '8+8'):
        M('Vidrio', f'Vidrio laminado templado {v}', 'm2', 'a medida')
M('Vidrio', 'Vidrio laminado 4+4 mate (butiral translúcido)', 'm2')
for e in [6, 8, 10, 12]:
    M('Vidrio', f'Vidrio templado {e} mm', 'm2', 'a medida')

# ---------------------------------------------------------------- tornillería
LARGOS = {6: [16, 20, 25, 30, 40, 50, 60], 8: [16, 20, 25, 30, 40, 50, 60, 70, 80], 10: [20, 25, 30, 40, 50, 60, 70, 80, 100],
          12: [25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 120], 14: [40, 50, 60, 80, 100], 16: [40, 50, 60, 70, 80, 90, 100, 120, 150],
          20: [50, 60, 70, 80, 90, 100, 120, 150, 160], 24: [60, 70, 80, 100, 120, 150, 200], 27: [80, 100, 120], 30: [80, 100, 120, 150]}
for m, ls in LARGOS.items():
    for l in ls:
        M('Tornillería', f'Tornillo hexagonal DIN 933 M{m}×{l} 8.8 cincado')
        if m <= 16 and l <= 100:
            M('Tornillería', f'Tornillo hexagonal DIN 933 M{m}×{l} INOX A2')
        if m <= 12 and l <= 80:
            M('Tornillería', f'Tornillo hexagonal DIN 933 M{m}×{l} INOX A4')
        if m >= 10:
            M('Tornillería', f'Tornillo hexagonal DIN 933 M{m}×{l} 8.8 galvanizado en caliente')
        if m >= 16:
            M('Tornillería', f'Tornillo estructural HV DIN EN 14399 M{m}×{l} 10.9')
for m in [3, 4, 5, 6, 8, 10, 12, 16]:
    for l in [8, 10, 12, 16, 20, 25, 30, 40, 50, 60]:
        if l < m * 2 or (m <= 4 and l > 30):
            continue
        M('Tornillería', f'Tornillo Allen DIN 912 M{m}×{l} 8.8')
        M('Tornillería', f'Tornillo Allen DIN 912 M{m}×{l} INOX A2')
for m in [4, 5, 6, 8, 10, 12]:
    for l in [10, 16, 20, 25, 30, 40, 50]:
        if l < m * 2:
            continue
        M('Tornillería', f'Tornillo avellanado Allen DIN 7991 M{m}×{l} INOX A2')
        M('Tornillería', f'Tornillo avellanado Allen DIN 7991 M{m}×{l} 10.9 cincado')
for m in [6, 8, 10, 12]:
    for l in [20, 30, 40, 50, 60, 80]:
        M('Tornillería', f'Tornillo de cabeza alomada (carrocero) DIN 603 M{m}×{l} cincado')
        M('Tornillería', f'Tornillo de cabeza alomada (carrocero) DIN 603 M{m}×{l} INOX A2')
for m in [4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 27, 30]:
    for q in ['cincada', 'INOX A2', 'INOX A4', 'galvanizada en caliente']:
        if q == 'INOX A4' and m > 20:
            continue
        M('Tornillería', f'Tuerca hexagonal DIN 934 M{m} {q}')
        if m <= 24:
            M('Tornillería', f'Tuerca autoblocante DIN 985 M{m} {q}') if q != 'galvanizada en caliente' else None
        if m <= 20:
            M('Tornillería', f'Arandela plana DIN 125 M{m} {q}')
    if m <= 20:
        M('Tornillería', f'Tuerca ciega DIN 1587 M{m} INOX A2')
        M('Tornillería', f'Tuerca ciega DIN 1587 M{m} cincada')
        M('Tornillería', f'Tuerca baja (bajo perfil) DIN 439 M{m} galvanizada')
        M('Tornillería', f'Arandela ancha DIN 9021 M{m} cincada')
        M('Tornillería', f'Arandela ancha DIN 9021 M{m} INOX A2')
        M('Tornillería', f'Arandela grower DIN 127 M{m} cincada')
        M('Tornillería', f'Arandela grower DIN 127 M{m} INOX A2')
for m in [6, 8, 10, 12, 14, 16, 20, 24, 30]:
    for q in ['cincada', 'galvanizada en caliente', 'INOX A2', 'INOX A4']:
        M('Tornillería', f'Varilla roscada DIN 975 M{m} {q}', 'barra', '1 m')
    if m >= 12:
        M('Tornillería', f'Varilla roscada DIN 975 M{m} 8.8 cincada', 'barra', '1 m')
for m in [12, 16, 20, 24, 30]:
    for l in [300, 400, 500, 600, 700, 800]:
        M('Tornillería', f'Perno de anclaje en L / J M{m}×{l} galvanizado')
for d, ls in {4.2: [13, 16, 19, 25], 4.8: [16, 19, 25, 32, 38], 5.5: [19, 25, 32, 38, 50], 6.3: [25, 32, 38, 50, 70]}.items():
    for l in ls:
        M('Tornillería', f'Tornillo autotaladrante cabeza hexagonal {num(d)}×{l} cincado')
        M('Tornillería', f'Tornillo autotaladrante cabeza hexagonal {num(d)}×{l} INOX A2')
for l in [40, 60, 80, 100, 120, 140, 160, 180, 200, 220]:
    M('Tornillería', f'Tornillo autotaladrante para panel sándwich 5,5×{l} con arandela EPDM')
for d, ls in {4.2: [13, 19, 25], 4.8: [19, 25, 38], 6.3: [19, 25, 38, 50]}.items():
    for l in ls:
        M('Tornillería', f'Tornillo rosca chapa {num(d)}×{l} con arandela, galvanizado')
        M('Tornillería', f'Tornillo rosca chapa {num(d)}×{l} INOX A2')
for d in [3.2, 4, 4.8, 6.4]:
    for l in [8, 10, 12, 16, 20]:
        M('Tornillería', f'Remache ciego {num(d)}×{l} aluminio')
        M('Tornillería', f'Remache ciego {num(d)}×{l} INOX')
for m in [4, 5, 6, 8, 10, 12]:
    M('Tornillería', f'Tuerca remachable M{m} acero cincado')
    M('Tornillería', f'Tuerca remachable M{m} INOX')
for d, l in [(6, 40), (8, 50), (8, 80), (10, 60), (10, 100), (12, 80), (12, 120)]:
    M('Tornillería', f'Taco de nylon Ø{d} + tirafondo {l} mm')
for d, l in [(8, 75), (8, 100), (10, 80), (10, 90), (10, 120), (12, 100), (12, 120), (12, 150), (16, 125), (16, 150), (20, 170)]:
    M('Anclajes', f'Anclaje mecánico perno de expansión M{d}×{l} cincado')
    M('Anclajes', f'Anclaje mecánico perno de expansión M{d}×{l} INOX A4')
for m in [8, 10, 12, 16]:
    M('Anclajes', f'Dynabolt (anclaje camisa) M{m} galvanizado')
    M('Anclajes', f'Dynabolt (anclaje camisa) M{m} INOX')
for v in ['300 ml', '410 ml']:
    M('Anclajes', f'Resina química de anclaje (cartucho {v})', 'ud')
M('Anclajes', 'Resina química epoxi para anclajes estructurales', 'ud')
M('Anclajes', 'Cánula mezcladora para resina', 'ud')
for d in [12, 16, 20]:
    M('Anclajes', f'Tamiz plástico para resina Ø{d}', 'ud')
M('Anclajes', 'Mortero de nivelación sin retracción (grout) saco 25 kg', 'saco')
for m in [6, 8, 10, 12, 16, 20]:
    M('Elevación y amarre', f'Cáncamo macho DIN 580 M{m}')
    M('Elevación y amarre', f'Cáncamo hembra DIN 582 M{m}')
    M('Elevación y amarre', f'Cáncamo M{m} INOX')
for d in [4, 5, 6, 8, 10, 12]:
    M('Elevación y amarre', f'Grillete recto Ø{d} galvanizado')
    M('Elevación y amarre', f'Grillete lira Ø{d} INOX')
    M('Elevación y amarre', f'Sujetacables (perrillo) Ø{d}')
    M('Elevación y amarre', f'Cable de acero Ø{d} galvanizado', 'm')
    M('Elevación y amarre', f'Cable de acero Ø{d} INOX 316', 'm')
    M('Elevación y amarre', f'Tensor ojo-ojo M{d + 2} galvanizado')
    M('Elevación y amarre', f'Tensor horquilla M{d + 2} INOX')
    M('Elevación y amarre', f'Cadena de eslabón corto Ø{d} galvanizada', 'm')
    M('Elevación y amarre', f'Cadena Ø{d} INOX', 'm')
    M('Elevación y amarre', f'Guardacabos Ø{d}')
    M('Elevación y amarre', f'Terminal prensado para cable Ø{d} INOX')
M('Elevación y amarre', 'Alambre galvanizado', 'kg')
M('Elevación y amarre', 'Alambre INOX', 'kg')

# ---------------------------------------------------------------- herrajes y accesorios
for d in [12, 14, 16, 18, 20, 22, 25, 30, 35, 40]:
    M('Herrajes', f'Pernio / bisagra para soldar Ø{d}')
for d in [16, 20, 25, 30]:
    M('Herrajes', f'Pernio para soldar Ø{d} INOX')
for m in [16, 20, 24]:
    M('Herrajes', f'Bisagra regulable para soldar M{m}')
M('Herrajes', 'Bisagra de pala con cojinete de bolas para puerta pesada')
M('Herrajes', 'Bisagra para tubo atornillable (barandilla de cristal)')
for t in [30, 40, 50, 60]:
    M('Herrajes', f'Cerradura de embutir para perfil de {t} mm')
M('Herrajes', 'Cerradura de sobreponer para puerta metálica')
M('Herrajes', 'Cerradura eléctrica (abrepuertas)')
M('Herrajes', 'Bombín (cilindro) de seguridad')
M('Herrajes', 'Juego de manillas con placa')
M('Herrajes', 'Juego de manillas INOX')
M('Herrajes', 'Pasador / cerrojo de suelo para soldar')
M('Herrajes', 'Pasador de cuello para candado')
M('Herrajes', 'Cerrojo de portón con alojamiento para candado')
M('Herrajes', 'Candado de alta seguridad')
M('Herrajes', 'Cierrapuertas hidráulico')
M('Herrajes', 'Muelle de cierre para cancela')
M('Herrajes', 'Tope de portón (fin de carrera)')
M('Herrajes', 'Tope retenedor de puerta')
for d in [60, 80, 100, 120, 150, 200]:
    M('Herrajes', f'Rueda para portón corredero Ø{d} garganta en V')
    M('Herrajes', f'Rueda para portón corredero Ø{d} garganta en U')
    M('Herrajes', f'Rueda / rodillo Ø{d} INOX')
for d in [16, 20, 25]:
    M('Herrajes', f'Carril / guía de suelo para portón corredero Ø{d} (macizo/angular)', 'barra', B6)
M('Herrajes', 'Guía superior con rodillos para portón corredero')
M('Herrajes', 'Carro / carretón para portón autoportante')
M('Herrajes', 'Perfil para portón autoportante', 'barra', B6)
M('Herrajes', 'Recibidor / receptor final de portón autoportante')
M('Herrajes', 'Cremallera de nylon para motor de portón', 'm')
M('Herrajes', 'Cremallera de acero galvanizado para motor de portón', 'm')
for k in [400, 600, 1000, 1500, 2000]:
    M('Automatismos', f'Motor para portón corredero hasta {k} kg')
M('Automatismos', 'Motor batiente para puerta de 2 hojas (kit)')
M('Automatismos', 'Fotocélulas de seguridad (par)')
M('Automatismos', 'Emisor / mando a distancia')
M('Automatismos', 'Lámpara destellante')
M('Automatismos', 'Cuadro de maniobra')
M('Automatismos', 'Banda de seguridad')
M('Automatismos', 'Selector de llave / teclado')
for lado in [15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 120]:
    M('Tapones y embellecedores', f'Tapón plástico para tubo cuadrado {lado}×{lado}')
for (a, b) in [(30, 15), (40, 20), (50, 20), (50, 30), (60, 30), (60, 40), (80, 40), (100, 40), (100, 50), (120, 60)]:
    M('Tapones y embellecedores', f'Tapón plástico para tubo rectangular {a}×{b}')
for d in [16, 20, 25, 30, 32, 35, 40, 42, 48, 50, 60]:
    M('Tapones y embellecedores', f'Tapón plástico para tubo redondo Ø{d}')
for d in [25, 33.7, 42.4, 48.3, 50.8]:
    M('Tapones y embellecedores', f'Tapa / tapón INOX para tubo Ø{num(d)}')
    M('Tapones y embellecedores', f'Curva / codo 90° INOX para tubo Ø{num(d)}')
    M('Tapones y embellecedores', f'Soporte de pasamanos a pared INOX para tubo Ø{num(d)}')
    M('Tapones y embellecedores', f'Embellecedor / roseta INOX para tubo Ø{num(d)}')
    M('Tapones y embellecedores', f'Unión / codo articulado INOX para tubo Ø{num(d)}')
for d in [10, 12]:
    M('Tapones y embellecedores', f'Pasador / soporte de varilla Ø{d} INOX para barandilla')
M('Tapones y embellecedores', 'Pinza de vidrio INOX para barandilla')
M('Tapones y embellecedores', 'Perfil de suelo para barandilla de vidrio (perfil U de aluminio)', 'barra')
M('Tapones y embellecedores', 'Embellecedor INOX para pletina 50×10')
M('Tapones y embellecedores', 'Contera / pie regulable M10')
M('Tapones y embellecedores', 'Pie nivelador M12 / M16')
M('Tapones y embellecedores', 'Pieza de forja decorativa (lanza, roseta, voluta)', 'ud', 'indicar referencia')
M('Tapones y embellecedores', 'Pasamanos de madera (moldura)', 'barra')

# ---------------------------------------------------------------- soldadura y gases
for d in [0.6, 0.8, 1.0, 1.2]:
    M('Soldadura', f'Hilo de soldadura SG2 (ER70S-6) Ø{num(d)} bobina 15 kg', 'bobina')
    if d <= 1.0:
        M('Soldadura', f'Hilo de soldadura SG2 (ER70S-6) Ø{num(d)} bobina 5 kg', 'bobina')
for d in [0.8, 1.0, 1.2]:
    M('Soldadura', f'Hilo de soldadura INOX 308LSi Ø{num(d)}', 'bobina')
    M('Soldadura', f'Hilo de soldadura INOX 316LSi Ø{num(d)}', 'bobina')
    M('Soldadura', f'Hilo de soldadura aluminio 5356 Ø{num(d)}', 'bobina')
    M('Soldadura', f'Hilo tubular E71T-1 Ø{num(d)}', 'bobina')
for d in [2.0, 2.5, 3.2, 4.0]:
    M('Soldadura', f'Electrodo rutilo E6013 Ø{num(d)}', 'caja')
    M('Soldadura', f'Electrodo básico E7018 Ø{num(d)}', 'caja')
    if d <= 3.2:
        M('Soldadura', f'Electrodo INOX 308L Ø{num(d)}', 'caja')
        M('Soldadura', f'Electrodo INOX 316L Ø{num(d)}', 'caja')
        M('Soldadura', f'Electrodo para fundición Ø{num(d)}', 'caja')
for d in [1.6, 2.0, 2.4, 3.2]:
    M('Soldadura', f'Varilla TIG acero ER70S-6 Ø{num(d)}', 'kg')
    M('Soldadura', f'Varilla TIG INOX 316L Ø{num(d)}', 'kg')
    M('Soldadura', f'Varilla TIG aluminio 5356 Ø{num(d)}', 'kg')
    M('Soldadura', f'Electrodo de tungsteno Ø{num(d)}', 'caja')
for d in [0.8, 1.0, 1.2]:
    M('Soldadura', f'Tubo / punta de contacto MIG Ø{num(d)}', 'ud')
M('Soldadura', 'Tobera MIG', 'ud')
M('Soldadura', 'Difusor de gas MIG', 'ud')
M('Soldadura', 'Spray antiproyecciones', 'ud')
M('Soldadura', 'Pasta decapante para inox', 'ud')
M('Soldadura', 'Líquido pasivador para inox', 'l')
M('Soldadura', 'Cristal de careta (protector) ', 'ud')
for g in ['Argón', 'Mezcla argón + 18 % CO2', 'Mezcla argón + 2 % CO2 (inox)', 'CO2', 'Oxígeno', 'Acetileno', 'Propano']:
    M('Gases', f'Botella de {g}', 'botella')

# ---------------------------------------------------------------- abrasivos, corte y taladro (consumibles)
for d in [115, 125, 180, 230]:
    for t in ['acero', 'inox']:
        M('Abrasivos y corte', f'Disco de corte {t} {d} mm', 'ud')
    M('Abrasivos y corte', f'Disco de desbaste {d} mm', 'ud')
    if d <= 180:
        for g in [40, 60, 80, 120]:
            M('Abrasivos y corte', f'Disco de láminas (flap) {d} mm grano {g}', 'ud')
        M('Abrasivos y corte', f'Disco de fibra {d} mm', 'ud')
        M('Abrasivos y corte', f'Disco de esponja / Scotch-Brite {d} mm', 'ud')
        M('Abrasivos y corte', f'Cepillo de alambre de copa para radial {d} mm', 'ud')
        M('Abrasivos y corte', f'Disco diamante {d} mm', 'ud')
for d in [300, 350, 400]:
    M('Abrasivos y corte', f'Disco de corte para tronzadora {d} mm', 'ud')
    M('Abrasivos y corte', f'Disco de sierra circular para metal (TCT) {d} mm', 'ud')
for dt in ['4/6', '5/8', '6/10', '8/12', '10/14']:
    M('Abrasivos y corte', f'Hoja de sierra de cinta bimetal dientes {dt} (medida de la máquina)', 'ud')
M('Abrasivos y corte', 'Lija en rollo (grano 80/120/180)', 'rollo')
M('Abrasivos y corte', 'Lima / escofina', 'ud')
for d in [2, 2.5, 3, 3.2, 3.5, 4, 4.2, 4.5, 5, 5.5, 6, 6.5, 7, 8, 8.5, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20]:
    M('Brocas y fresas', f'Broca HSS-Co (cobalto) Ø{num(d)}', 'ud')
for d in [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 25]:
    M('Brocas y fresas', f'Broca SDS-plus hormigón Ø{d}', 'ud')
for d in [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 33, 36, 40, 50]:
    M('Brocas y fresas', f'Fresa anular (taladro magnético) Ø{d}×30', 'ud')
    if d <= 36:
        M('Brocas y fresas', f'Fresa anular (taladro magnético) Ø{d}×50', 'ud')
for d in [16, 20, 22, 25, 30, 35, 40, 51, 60, 68, 76, 100]:
    M('Brocas y fresas', f'Corona bimetal Ø{d}', 'ud')
M('Brocas y fresas', 'Broca escalonada 4–20', 'ud')
M('Brocas y fresas', 'Broca escalonada 6–36', 'ud')
M('Brocas y fresas', 'Avellanador HSS 90°', 'ud')
for m in [4, 5, 6, 8, 10, 12, 14, 16, 20, 24]:
    M('Brocas y fresas', f'Macho de roscar M{m} (juego)', 'juego')
    M('Brocas y fresas', f'Terraja M{m}', 'ud')
M('Brocas y fresas', 'Puntas de atornillador (estuche)', 'juego')
M('Brocas y fresas', 'Vasos de impacto (juego)', 'juego')

# ---------------------------------------------------------------- pinturas
for p, u in [('Imprimación antioxidante sintética gris', 'l'), ('Imprimación antioxidante sintética roja', 'l'),
             ('Imprimación Titan 220 antioxidante', 'l'), ('Imprimación multiadherente Titan 200', 'l'),
             ('Imprimación epoxi rica en zinc', 'l'), ('Imprimación epoxi fosfato de zinc', 'l'),
             ('Imprimación para galvanizado (wash primer)', 'l'), ('Imprimación epoxi para inox / aluminio', 'l'),
             ('Esmalte sintético Titan 550 (indicar RAL)', 'l'), ('Esmalte sintético Titan 550 RAL 9016 blanco satinado', 'l'),
             ('Esmalte sintético negro satinado', 'l'), ('Esmalte sintético RAL 7016 gris antracita', 'l'),
             ('Esmalte forja Oxirón (indicar color)', 'l'), ('Esmalte forja Oxirón negro', 'l'), ('Esmalte forja Oxirón marrón 214', 'l'),
             ('Esmalte poliuretano 2C (indicar RAL)', 'l'), ('Esmalte alquídico (indicar RAL)', 'l'),
             ('Pintura epoxi 2C (indicar RAL)', 'l'), ('Pintura intumescente (protección al fuego)', 'kg'),
             ('Pintura para suelo / señalización', 'l'), ('Galvanizado en frío (spray)', 'ud'), ('Galvanizado en frío (bote)', 'l'),
             ('Pintura en spray (indicar RAL)', 'ud'), ('Spray marcador (topográfico)', 'ud'),
             ('Disolvente universal', 'l'), ('Disolvente nitrocelulósico', 'l'), ('Disolvente para poliuretano', 'l'),
             ('Disolvente epoxi', 'l'), ('Desengrasante', 'l'), ('Masilla de poliéster', 'ud'), ('Masilla para metal', 'ud'),
             ('Cinta de carrocero (enmascarar)', 'rollo'), ('Plástico de protección / cubrición', 'rollo'),
             ('Rodillo de pintura (recambio)', 'ud'), ('Brocha / paletina', 'ud'), ('Filtro de cabina de pintura', 'ud'),
             ('Termolacado / lacado en horno (servicio externo)', 'm2'), ('Galvanizado en caliente (servicio externo)', 'kg'),
             ('Granallado (servicio externo)', 'm2')]:
    M('Pinturas', p, u)

# sellado y adhesivos
for p, u in [('Silicona neutra transparente', 'ud'), ('Silicona neutra blanca', 'ud'), ('Silicona neutra negra', 'ud'),
             ('Silicona neutra gris', 'ud'), ('Silicona alta temperatura', 'ud'), ('Sellador de poliuretano (Sikaflex 11FC)', 'ud'),
             ('Adhesivo-sellador MS polímero', 'ud'), ('Adhesivo de montaje', 'ud'), ('Adhesivo epoxi bicomponente', 'ud'),
             ('Adhesivo instantáneo (cianoacrilato)', 'ud'), ('Espuma de poliuretano', 'ud'), ('Cinta butílica', 'rollo'),
             ('Banda / burlete EPDM', 'm'), ('Cinta de doble cara (alta resistencia)', 'rollo'), ('Cinta americana', 'rollo'),
             ('Fijador de roscas (Loctite)', 'ud'), ('Junta de neopreno', 'm'), ('Teflón', 'rollo')]:
    M('Sellado y adhesivos', p, u)

# obra
for p, u in [('Cemento saco 25 kg', 'saco'), ('Mortero saco 25 kg', 'saco'), ('Mortero rápido', 'saco'),
             ('Hormigón seco en saco', 'saco'), ('Hormigón (camión)', 'm3'), ('Arena', 'saco'), ('Grava', 'saco'),
             ('Ladrillo / bloque', 'ud'), ('Escayola', 'saco')]:
    M('Obra', p, u)

# maderas
for e in [10, 15, 18, 21, 25, 30]:
    M('Maderas y tableros', f'Tablero contrachapado {e} mm', 'tablero')
    M('Maderas y tableros', f'Tablero fenólico {e} mm', 'tablero')
for e in [10, 16, 19]:
    M('Maderas y tableros', f'Tablero DM {e} mm', 'tablero')
    M('Maderas y tableros', f'Tablero OSB {e} mm', 'tablero')
for p in ['Tablón de pino', 'Listón de madera', 'Calzos / tacos de madera', 'Palé']:
    M('Maderas y tableros', p, 'ud')

# eléctrico
for p, u in [('Manguera eléctrica 3×1,5', 'm'), ('Manguera eléctrica 3×2,5', 'm'), ('Manguera eléctrica 5×2,5', 'm'),
             ('Manguera eléctrica 5×6', 'm'), ('Tubo corrugado Ø20', 'm'), ('Tubo corrugado Ø25', 'm'),
             ('Caja estanca de registro', 'ud'), ('Regleta de conexión', 'ud'), ('Clavija / base industrial 16 A', 'ud'),
             ('Clavija / base industrial 32 A', 'ud'), ('Bridas (paquete)', 'ud'), ('Proyector LED', 'ud'),
             ('Interruptor diferencial', 'ud'), ('Magnetotérmico', 'ud')]:
    M('Eléctrico', p, u)

# consumibles de taller y EPI (gastables)
for p, u in [('Guantes de soldador', 'par'), ('Guantes de trabajo', 'par'), ('Guantes anticorte', 'par'),
             ('Gafas de protección', 'ud'), ('Tapones auditivos', 'caja'), ('Mascarilla FFP2', 'ud'), ('Mascarilla FFP3', 'ud'),
             ('Filtros de mascarilla (pintura)', 'par'), ('Buzo desechable', 'ud'), ('Trapos / papel industrial', 'rollo'),
             ('Taladrina / aceite de corte', 'l'), ('Aceite lubricante (WD-40)', 'ud'), ('Grasa', 'ud'),
             ('Jaboncillo / tiza de marcar', 'caja'), ('Rotulador de marcar metal', 'ud'), ('Bolsas de basura', 'rollo'),
             ('Film / plástico de embalar', 'rollo'), ('Cantoneras de protección (transporte)', 'ud'), ('Fleje / precinto', 'rollo'),
             ('Cinta de balizamiento', 'rollo'), ('Señal / cartel de obra', 'ud'), ('Agua / bidón', 'ud'), ('Gasoil', 'l'), ('Gasolina', 'l')]:
    M('Consumibles de taller y EPI', p, u)

# ================================================================= HERRAMIENTAS
HERR = {
    'Corte': ['Sierra de cinta', 'Sierra de cinta portátil', 'Tronzadora de disco', 'Ingletadora / sierra circular para metal',
              'Radial pequeña 115/125', 'Radial grande 230', 'Radial a batería', 'Cizalla de palanca', 'Cizalla eléctrica (chapa)',
              'Equipo de corte por plasma', 'Equipo de oxicorte', 'Sierra sable', 'Sierra de calar', 'Tijera de chapa',
              'Cortapernos', 'Sierra de mano / arco de sierra'],
    'Taladro y roscado': ['Taladro de columna', 'Taladro magnético', 'Taladro percutor', 'Taladro atornillador a batería',
                          'Martillo perforador SDS', 'Martillo demoledor', 'Llave de impacto a batería', 'Atornillador de impacto',
                          'Roscadora / juego de machos y terrajas', 'Remachadora manual', 'Remachadora de tuercas',
                          'Remachadora a batería', 'Avellanador / desbarbador'],
    'Soldadura': ['Soldadora MIG/MAG (taller)', 'Soldadora MIG/MAG portátil', 'Soldadora MIG amarilla', 'Soldadora TIG',
                  'Soldadora de electrodo (inverter)', 'Equipo de soldadura de aluminio', 'Pistola MIG de recambio',
                  'Pinza de masa', 'Careta de soldar', 'Manta ignífuga', 'Biombo / cortina de soldadura',
                  'Manorreductor de gas', 'Carro portabotellas', 'Aspirador de humos', 'Equipo de limpieza electrolítica de inox'],
    'Desbaste y acabado': ['Lijadora de banda', 'Lijadora orbital', 'Pulidora / satinadora de inox', 'Amoladora recta',
                           'Esmeriladora de banco', 'Cepillo de alambre manual', 'Limas (juego)'],
    'Medición y trazado': ['Flexómetro 5 m', 'Flexómetro 8 m', 'Cinta métrica 30 m', 'Metro láser', 'Nivel de burbuja 60 cm',
                           'Nivel de burbuja 2 m', 'Nivel láser / láser de líneas', 'Nivel láser rotativo con trípode',
                           'Escuadra de taller', 'Escuadra magnética (soldadura)', 'Calibre (pie de rey)', 'Goniómetro / transportador',
                           'Plomada', 'Tiralíneas', 'Granete y punta de trazar', 'Compás de puntas', 'Galgas de espesores',
                           'Medidor de espesor de pintura', 'Cámara / móvil para fotos de obra'],
    'Sujeción y montaje': ['Sargentos (juego)', 'Mordazas / gatos de presión (juego)', 'Tornillo de banco', 'Mesa de soldadura con utillaje',
                           'Potro / borriquetas', 'Imanes de soldadura', 'Llaves fijas combinadas (juego)', 'Llave inglesa',
                           'Llave dinamométrica', 'Carraca y vasos (juego)', 'Llaves Allen (juego)', 'Destornilladores (juego)',
                           'Alicates (juego)', 'Martillo', 'Maza', 'Mazo de goma', 'Palanca / pata de cabra', 'Botador',
                           'Llave de pilotes (nueva)', 'Llave de pilotes (fabricada)', 'Pistola de silicona', 'Pistola de resina química',
                           'Bomba / cepillo de limpieza de taladros (anclajes)', 'Ventosa para vidrio', 'Caja de herramientas de montaje'],
    'Elevación y transporte': ['Grúa (servicio externo)', 'Camión grúa', 'Plataforma elevadora de tijera', 'Plataforma elevadora articulada (PEMP)',
                               'Manipulador telescópico', 'Carretilla elevadora', 'Transpaleta', 'Polipasto eléctrico', 'Polipasto manual de cadena',
                               'Tráctel / tirfor', 'Eslingas de poliéster (juego)', 'Eslinga de cadena', 'Grilletes de elevación (juego)',
                               'Garras de elevación de chapa', 'Pórtico / cabria', 'Carro portaperfiles', 'Gato hidráulico', 'Puntales',
                               'Patines de carga'],
    'Acceso y seguridad': ['Andamio', 'Escalera de tijera', 'Escalera extensible', 'Arnés anticaídas', 'Línea de vida provisional',
                           'Casco', 'Extintor', 'Vallas / balizamiento de obra', 'Conos', 'Botiquín', 'Redes de seguridad'],
    'Pintura': ['Compresor', 'Pistola aerográfica', 'Equipo airless', 'Pistola de sopleteado', 'Manguera de aire',
                'Cabina de pintura', 'Rodillos y bandeja', 'Brochas (juego)'],
    'Energía y obra': ['Generador eléctrico', 'Alargadera / prolongador', 'Cuadro eléctrico de obra', 'Focos de trabajo',
                       'Hormigonera', 'Carretilla de obra', 'Pala y pico', 'Hidrolimpiadora', 'Aspirador'],
    'Vehículos': ['Furgoneta', 'Furgoneta grande', 'Camión', 'Remolque', 'Coche'],
}
# Lo que NO es herramienta de mano y por tanto no va en la lista de herramientas de la tarea:
#  · máquinas fijas → son (o están en) un Área de trabajo (sierra de cinta, plegadora, cizalla, columna…)
#  · equipos de los que hay pocos → son Recursos (máquina) y se controla que no se crucen (taladro magnético,
#    soldadoras, llaves de impacto, remachadoras de tuercas, generador, compresor…)
#  · vehículos, grúas, plataformas, carretillas → Recursos o subcontrata
NO_DE_MANO = {
    'Sierra de cinta', 'Tronzadora de disco', 'Ingletadora / sierra circular para metal', 'Equipo de corte por plasma', 'Equipo de oxicorte',
    'Taladro de columna', 'Taladro magnético', 'Martillo demoledor', 'Llave de impacto a batería', 'Remachadora de tuercas', 'Remachadora a batería',
    'Soldadora MIG/MAG (taller)', 'Soldadora MIG/MAG portátil', 'Soldadora MIG amarilla', 'Soldadora TIG', 'Soldadora de electrodo (inverter)',
    'Equipo de soldadura de aluminio', 'Esmeriladora de banco', 'Mesa de soldadura con utillaje',
    'Grúa (servicio externo)', 'Camión grúa', 'Plataforma elevadora de tijera', 'Plataforma elevadora articulada (PEMP)', 'Manipulador telescópico',
    'Carretilla elevadora', 'Polipasto eléctrico', 'Pórtico / cabria', 'Andamio',
    'Compresor', 'Equipo airless', 'Cabina de pintura', 'Generador eléctrico', 'Hormigonera',
}
HERR.pop('Vehículos')
for fam, hs in HERR.items():
    for h in hs:
        if h not in NO_DE_MANO:
            H(fam, h)

out = os.path.join(os.path.dirname(__file__), 'catalogo-base.json')
json.dump(items, open(out, 'w'), ensure_ascii=False, indent=0)
from collections import Counter
c = Counter((i['tipo'], i['familia']) for i in items)
print(len(items), 'entradas')
for (t, f), n in sorted(c.items()):
    print(f'{t:12} {f:32} {n}')
