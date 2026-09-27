"""Convert the IOC World Bird List 'Names File Plus' xlsx to seed/ioc_species.csv.

Usage: python3 seed/ioc_to_csv.py IOC_Names_File_Plus-15.2.xlsx 15.2
Source: https://www.worldbirdnames.org/ (CC BY 3.0). Stdlib only.
"""
import csv, re, sys, zipfile, xml.etree.ElementTree as ET

M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

def rows(path):
    z = zipfile.ZipFile(path)
    ss = [''.join(t.text or '' for t in si.iter(M + 't'))
          for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(M + 'si')]
    for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).iter(M + 'row'):
        out = {}
        for c in row.findall(M + 'c'):
            v = c.find(M + 'v')
            val = '' if v is None else (ss[int(v.text)] if c.get('t') == 's' else v.text)
            out[re.match(r'[A-Z]+', c.get('r')).group()] = val.strip()
        yield out

def main(path, version):
    order = family_sci = family_en = genus = ''
    seq = 0
    with open('seed/ioc_species.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['seq', 'scientific_name', 'english_name', 'order_name', 'family_sci', 'family_en',
                    'genus', 'authority', 'breeding_range', 'nonbreeding_range', 'extinct', 'taxonomy_version'])
        for r in rows(path):
            rank, sci = r.get('E', ''), r.get('H', '')
            if rank == 'ORDER':
                order = sci.removeprefix('ORDER ').title()
            elif rank == 'Family':
                family_sci, family_en = sci.removeprefix('Family '), r.get('G', '')
            elif rank == 'Genus':
                genus = sci
            elif rank == 'Species':
                seq += 1
                w.writerow([seq, sci, r.get('G', ''), order, family_sci, family_en, genus, r.get('I', ''),
                            r.get('J', ''), r.get('K', ''), 'true' if r.get('F') else 'false', version])
    print(f'{seq} species written')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
