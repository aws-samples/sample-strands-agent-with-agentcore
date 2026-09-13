import io
import subprocess
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from openpyxl import Workbook

from builtin_tools.lib.excel_recalc import _scan_errors, recalc_spreadsheet


def workbook_bytes(cached=False, empty_string=False):
    book = Workbook()
    book.active['A1'] = 10
    book.active['B1'] = '=""' if empty_string else '=A1*2'
    output = io.BytesIO()
    book.save(output)
    if not cached:
        return output.getvalue()
    result = io.BytesIO()
    with zipfile.ZipFile(output) as source, zipfile.ZipFile(result, 'w') as target:
        for name in source.namelist():
            data = source.read(name)
            if name == 'xl/worksheets/sheet1.xml':
                data = data.replace(b'<v></v>', b'<v>20</v>').replace(b'<v/>', b'<v>20</v>').replace(b'<v />', b'<v>20</v>')
                if empty_string:
                    data = data.replace(b'<c r="B1">', b'<c r="B1" t="str">').replace(b'<v>20</v>', b'<v></v>')
            target.writestr(name, data)
    return result.getvalue()


@pytest.mark.parametrize('cached,empty_string,status', [(False, False, 'incomplete'), (True, False, 'success'), (True, True, 'success')])
def test_recalculation_requires_cached_formula_values(tmp_path, cached, empty_string, status):
    path = tmp_path / 'book.xlsx'
    path.write_bytes(workbook_bytes(cached, empty_string))
    report = _scan_errors(str(path))
    assert report['total_formulas'] == 1
    assert report['status'] == status


def test_converts_in_isolated_profile_and_returns_verified_bytes(monkeypatch):
    original = workbook_bytes()
    recalculated = workbook_bytes(cached=True)
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        assert any(arg.startswith('-env:UserInstallation=file:') for arg in command)
        assert Path(command[-1]).read_bytes() == original
        output = Path(command[command.index('--outdir') + 1]) / Path(command[-1]).name
        output.write_bytes(recalculated)
        return SimpleNamespace(returncode=0, stderr='')
    monkeypatch.setattr(subprocess, 'run', run)
    for _ in range(2):
        data, report = recalc_spreadsheet(original, 'book.xlsx')
        assert data == recalculated
        assert report['status'] == 'success'
    assert calls[0][1] != calls[1][1]


@pytest.mark.parametrize('failure', ['timeout', 'missing_output', 'unchanged_output', 'nonzero'])
def test_never_reports_failed_conversion_as_recalculated(monkeypatch, failure):
    original = workbook_bytes()
    def run(command, **kwargs):
        if failure == 'timeout':
            raise subprocess.TimeoutExpired(command, kwargs['timeout'])
        if failure == 'unchanged_output':
            (Path(command[command.index('--outdir') + 1]) / Path(command[-1]).name).write_bytes(original)
        return SimpleNamespace(returncode=124 if failure == 'nonzero' else 0, stderr='conversion failed')
    monkeypatch.setattr(subprocess, 'run', run)
    data, report = recalc_spreadsheet(original, 'book.xlsx')
    assert data == original
    assert report['status'] in {'skipped', 'incomplete'}
