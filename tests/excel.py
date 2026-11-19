import math
from pathlib import Path
import sys
from openpyxl import load_workbook

evidence = Path(sys.argv[1])
for name in ("single", "batch"):
    wb = load_workbook(evidence / f"{name}.xlsx")
    sheet = wb["Расчет"]
    assert len(wb.worksheets) == 3
    assert len(sheet.merged_cells.ranges) == 23
    assert all("#REF!" not in cell.value for tab in wb for row in tab for cell in row
               if cell.data_type in ("f", "e") and isinstance(cell.value, str))
    assert wb.calculation.fullCalcOnLoad
    assert sheet["J24"].value == 90
    assert sheet["O45"].value == "=O8"
    assert sheet["Q45"].value == "=SUM(N45:P45)"
    assert sheet["U45"].value == "=U8"
    assert any("1.22" in cell.value for row in sheet for cell in row if cell.data_type == "f")
    if name == "single":
        assert sheet["E8"].value == 125.125
        assert math.isclose(sheet["I8"].value, 1)
        assert sheet["L8"].value == 172000
        assert sheet["U8"].value == 246801
        assert sheet["Q4"].value == "отсрочка"
    else:
        assert [sheet[f"I{i}"].value for i in (8, 9, 10)] == [1, 1, 2]
        assert [sheet[f"G{i}"].value for i in (8, 9, 10)] == ["2B+PE", "2B", "2B"]
        assert sheet["Q4"].value == "предоплата"
        assert sheet["O8"].value > sheet["O9"].value > 0
        assert sheet["O9"].value == sheet["O10"].value
    print(f"{name}.xlsx: checked cells, 3 sheets, 23 merged ranges, no explicit #REF!")
