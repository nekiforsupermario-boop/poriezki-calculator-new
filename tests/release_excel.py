from pathlib import Path
import math
import sys
from openpyxl import load_workbook

root = Path(sys.argv[1])
for name, count, rate in [
    ('single', 1, 90), ('batch', 3, 90), ('card', 1, 90), ('mixed-strip', 2, 90),
    ('single-zero-cny', 1, 12), ('single-auto-cny', 1, 12),
]:
    file = root / f'{name}.xlsx'
    wb = load_workbook(file)
    s = wb['Расчет']
    assert len(wb.sheetnames) == 3 and len(s.merged_cells.ranges) == 23
    assert s['J24'].value == rate and s['F28'].value == .12 and s['F65'].value == '=F28'
    assert all('#REF!' not in str(cell.value) for tab in wb for row in tab for cell in row if cell.data_type in ('f','e'))
    for i in range(count):
        a, b = 8 + i, 45 + i
        assert s[f'Q{a}'].value == f'=SUM(N{a}:P{a})'
        assert s[f'Q{b}'].value == f'=SUM(N{b}:P{b})'
        assert s[f'J{a}'].value == '=$J$24'
        assert s[f'O{b}'].value == f'=O{a}' and s[f'P{b}'].value == f'=P{a}'
        assert s[f'U{b}'].value == f'=U{a}'
        assert s[f'V{a}'].value == f'=U{a}/1.22'
        assert s[f'N{b}'].value == 2800
    for start in (8, 45):
        for row in range(start + count, start + 14):
            assert all(s[f'{column}{row}'].value is None for column in ('B','I','O','Q','S','U','Y','Z'))
    if name == 'single':
        assert s['U8'].value == 246801 and s['L8'].value == 172000
        assert s['Q4'].value == 'отсрочка' and s['B33'].value == 30
    elif name == 'batch':
        assert [s[f'I{i}'].value for i in (8,9,10)] == [1,1,2]
    elif name == 'mixed-strip':
        assert {s['E8'].value,s['E9'].value} == {150,310}
        assert math.isclose(s['I8'].value+s['I9'].value,3)
    elif name == 'card':
        assert s['E8'].value == 300 and s['F8'].value == 500
    else:
        assert s['K45'].value == 1500
        assert s['L45'].value == '=K45*J45'
        assert s['U8'].value == 0 if name.endswith('zero-cny') else s['U8'].value > 0
    print(f'{file.name}: {count} active rows, inactive rows cleared, reference formula mapping and input values verified')
print('Independent sample for CNY: 1500 × 12 = 18000; 30-day finance at 12% = 177.5342465753 before rounding.')
