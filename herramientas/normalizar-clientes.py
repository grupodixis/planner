import openpyxl, re, json, sys, unicodedata, collections
src, out_json, out_xlsx = sys.argv[1:4]
ws = openpyxl.load_workbook(src, data_only=True).active
rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r[2]]

SUF = [  # (regex al final, forma)
 (r's\.?\s*a\.?\s*,?\s*s\.?\s*m\.?\s*e\.?', 'S.A., S.M.E.'),
 (r'sociedad\s+limitada\s+unipersonal|s\.?\s*l\.?\s*u\.?', 'S.L.U.'),
 (r'sociedad\s+limitada|s\.?\s*l\.?', 'S.L.'),
 (r'sociedad\s+an[oó]nima|s\.?\s*a\.?', 'S.A.'),
 (r's\.?\s*coop\.?', 'S. Coop.'),
 (r'c\.?\s*b\.?', 'C.B.'),
 (r's\.?\s*c\.?\s*p\.?', 'S.C.P.'),
 (r's\.?\s*c\.?', 'S.C.'),
]
MIN = {'de','del','la','las','los','y','i','e','en','con','por','para','a','al','d\'','da','do','van','von','di'}
SIGLAS = {'UTE','SAT','AENA','CLH','IB','UIB','BBVA','DGT','ONCE','CB','MP','RPG','TV','II','III','IV','PB','R&P','LTD','GMBH','SAS','SARL','BV','AG','USA','UK'}
def cap_palabra(w, i, orig_mixta):
    if not w: return w
    if orig_mixta and not (w.isupper() or w.islower()): return w           # «MPolo», «iPhone»: se respeta
    lw0 = w.lower()
    if i > 0 and lw0 in MIN: return lw0
    u = w.upper().strip('.,')
    if u in SIGLAS or (len(u) <= 3 and not re.search(r'[AEIOUÁÉÍÓÚ]', u) and u.isalpha()): return w.upper()
    lw = w.lower()
    if i > 0 and lw in MIN: return lw
    if lw.startswith("d'") and len(lw) > 2: return ("d'" if i else "D'") + lw[2:3].upper() + lw[3:]
    if lw.startswith("l'") and len(lw) > 2: return ("l'" if i else "L'") + lw[2:3].upper() + lw[3:]
    # guiones: Lluís-Maria
    return '-'.join(p[:1].upper() + p[1:] for p in lw.split('-'))
def capital(s):
    s = re.sub(r'\s+', ' ', str(s)).strip()
    mixta = not (s.isupper() or s.islower())
    return ' '.join(cap_palabra(w, i, mixta) for i, w in enumerate(s.split(' ')))
def sufijo(s):
    for rx, forma in SUF:
        m = re.search(r'[,\s]+(' + rx + r')\s*$', s, re.I)
        if m: return s[:m.start()].strip(' ,'), forma
    return s.strip(' ,'), None
def es_persona_nif(n): return bool(n and (re.match(r'^\d{8}[A-Z]$', n) or re.match(r'^[XYZ]\d{7}[A-Z]$', n)))
def nombre_ok(s, nif):
    s = re.sub(r'\s+', ' ', str(s)).strip()
    baja = bool(re.search(r'\(desactivad[ao]\)', s, re.I)); s = re.sub(r'\s*\(desactivad[ao]\)', '', s, flags=re.I)
    base, suf = sufijo(s)
    base = capital(base)
    # «Apellidos, Nombre» → «Nombre Apellidos» en personas
    if not suf and ',' in base and not re.match(r'(?i)comunidad|ajuntament|consell|ayuntamiento', base):
        a, b = [x.strip() for x in base.split(',', 1)]
        if b and len(b.split()) <= 3 and (es_persona_nif(nif) or len(a.split()) <= 3): base = f'{b} {a}'
    return (f'{base}, {suf}' if suf else base), baja, suf
PREF = ['351','353','352','33','39','44','49','41','31','32','47','45','46','43','48','1']
def tel_uno(t):
    d = re.sub(r'\D', '', str(t))
    if not d: return None
    if d.startswith('00'): d = d[2:]
    if len(d) == 11 and d.startswith('34'): d = d[2:]
    if len(d) == 9 and d[0] in '6789': return f'{d[:3]} {d[3:5]} {d[5:7]} {d[7:]}'
    if len(d) > 9:
        for p in PREF:
            if d.startswith(p):
                r = d[len(p):]; return f'+{p} ' + ' '.join(x for x in (r[:3], r[3:6], r[6:]) if x)
    return d
def tels(*vals):
    res = []
    for v in vals:
        if v is None: continue
        for parte in re.split(r'\s+-\s+|/|;', str(v)):
            t = tel_uno(parte)
            if t and t not in res: res.append(t)
    return res
def movil(t): return t.replace(' ', '')[:1] in '67' and not t.startswith('+')
def correos(v):
    if not v: return []
    return [e.lower() for e in re.findall(r'[\w.+\'-]+@[\w-]+(?:\.[\w-]+)+', str(v))]
def nif_ok(n):
    if not n: return None
    n = re.sub(r'[\s.\-]', '', str(n)).upper()
    return n if len(n) >= 8 and n not in ('X',) and not n.startswith('999999') else None
def tipo_de(nif, nombre, suf):
    if suf: return 'empresa'
    if nif:
        c = nif[0]
        if c == 'H': return 'comunidad'
        if c in 'PQS': return 'administracion'
        if es_persona_nif(nif): return 'particular'
        if c in 'ABCDEFGJNRUVW': return 'empresa'
    if re.match(r'(?i)comunidad|cdad', nombre): return 'comunidad'
    if re.search(r'(?i)ajuntament|ayuntamiento|consell|govern|ministerio|centro penitenciario|aena|ibisec', nombre): return 'administracion'
    if suf: return 'empresa'
    if re.search(r'(?i)internacional|international|group|grup|grupo|construcc|reformas|servicios|serveis|menorca|club|asociaci|associaci|hotel|restaurant|taller|fontaner|instalac|ingenier|arquitect|estudio|obras|proyectos|inmobiliaria|promoc|rent|motor|náutic|nautic|marina|fundaci|parroquia|colegio|escola|ies |ceip', nombre): return 'empresa'
    if len(nombre.split()) == 1: return 'empresa'
    return 'particular' if len(nombre.split()) <= 4 else 'empresa'
def contacto_ok(s):
    if not s: return None
    s = re.sub(r'(?i)^(sr|sra|srta|d|dña|don|doña)\.?\s+', '', str(s).strip())
    return capital(s) or None

clientes = []
for r in rows:
    _, cod, nfis, ncom, tel, fax, mov, mail, pers, nif, agente, tipo_cli = r[:12]
    if cod == 0: continue  # «Clientes contado»: genérico del programa de facturación
    nif = nif_ok(nif)
    nombre, baja, suf = nombre_ok(nfis, nif)
    comercial = nombre_ok(ncom, nif)[0] if ncom else None
    def clave(x): return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFD', sufijo(x or '')[0].lower()).encode('ascii', 'ignore').decode())
    if comercial and clave(comercial) == clave(nombre): comercial = None
    ts = tels(tel, mov)
    fijo = next((t for t in ts if not movil(t)), None)
    mov1 = next((t for t in ts if movil(t)), None)
    telefono = fijo or mov1
    mov_c = mov1 if fijo else None
    otros = [t for t in ts if t not in (telefono, mov_c)]
    fx = tels(fax)
    ems = correos(mail)
    notas = []
    if otros: notas.append('Otros teléfonos: ' + ' · '.join(otros))
    if fx: notas.append('Fax: ' + ' · '.join(fx))
    if len(ems) > 1: notas.append('Otros correos: ' + ' · '.join(ems[1:]))
    if tipo_cli and str(tipo_cli).strip().upper().startswith('WE'): notas.append('Cliente web')
    pc = contacto_ok(pers)
    contactos = []
    if pc and (pc.lower() not in nombre.lower()):
        contactos.append({'nombre': pc, 'telefono': mov1 or telefono, 'email': ems[0] if ems else None})
    clientes.append({'codigo_ext': str(cod), 'nombre': nombre, 'nombre_comercial': comercial, 'cif': nif, 'tipo': tipo_de(nif, nombre, suf),
        'telefono': telefono, 'movil': mov_c, 'email': ems[0] if ems else None, 'notas': '\n'.join(notas) or None,
        'activo': not baja, 'contactos': contactos})

# duplicados en la hoja: mismo NIF → se juntan (se queda el de código más alto, con lo que falte del otro)
porNif = {}; finales = []
for c in clientes:
    if c['cif'] and c['cif'] in porNif:
        a = porNif[c['cif']]
        for k, v in c.items():
            if k == 'contactos': a['contactos'] += [x for x in v if x['nombre'] not in [y['nombre'] for y in a['contactos']]]
            elif v and not a.get(k): a[k] = v
        a['notas'] = '\n'.join(filter(None, [a.get('notas'), f"También código {c['codigo_ext']} en el programa de facturación"]))
        continue
    if c['cif']: porNif[c['cif']] = c
    finales.append(c)
json.dump(finales, open(out_json, 'w'), ensure_ascii=False, indent=1)
# hoja para revisar
wb = openpyxl.Workbook(); h = wb.active; h.title = 'Clientes'
cab = ['Código', 'Nombre fiscal', 'Nombre comercial', 'NIF / CIF', 'Tipo', 'Teléfono', 'Móvil', 'Correo', 'Persona de contacto', 'Tel. contacto', 'Notas', 'Activo']
h.append(cab)
for c in finales:
    k = c['contactos'][0] if c['contactos'] else {}
    h.append([int(c['codigo_ext']), c['nombre'], c['nombre_comercial'], c['cif'], c['tipo'], c['telefono'], c['movil'], c['email'], k.get('nombre'), k.get('telefono'), c['notas'], 'sí' if c['activo'] else 'no'])
from openpyxl.styles import Font, PatternFill
for cell in h[1]: cell.font = Font(bold=True, color='FFFFFF'); cell.fill = PatternFill('solid', fgColor='10776C')
for col, w in zip('ABCDEFGHIJKL', [8, 42, 30, 13, 14, 15, 15, 32, 24, 15, 40, 7]): h.column_dimensions[col].width = w
h.freeze_panes = 'B2'; h.auto_filter.ref = h.dimensions
wb.save(out_xlsx)
print(len(rows), '→', len(finales), collections.Counter(c['tipo'] for c in finales), 'contactos', sum(len(c['contactos']) for c in finales), 'de baja', sum(not c['activo'] for c in finales))
