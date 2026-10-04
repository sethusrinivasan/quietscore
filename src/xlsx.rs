// Minimal OOXML exporter: stored ZIP entries, typed scores, literal text cells.
// No formulas, remote dependencies, or customer data leave this process.
fn xml(s: &str) -> String {
    escape(
        &s.chars()
            .filter(|c| *c == '\n' || *c == '\t' || *c == '\r' || *c >= ' ')
            .collect::<String>(),
    )
}
fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xffffffffu32;
    for b in data {
        c ^= *b as u32;
        for _ in 0..8 {
            c = (c >> 1) ^ if c & 1 != 0 { 0xedb88320 } else { 0 }
        }
    }
    !c
}
fn word(out: &mut Vec<u8>, v: u16) {
    out.extend_from_slice(&v.to_le_bytes())
}
fn dword(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes())
}
// Store entries without compression: this keeps the WASM exporter dependency-free.
// ZIP signatures below identify local headers, the central directory, and its end.
fn zip(files: Vec<(&str, String)>) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    let count = files.len() as u16;
    for (name, body) in files {
        let data = body.as_bytes();
        let offset = out.len() as u32;
        let crc = crc32(data);
        dword(&mut out, 0x04034b50);
        for v in [20, 0, 0, 0, 33] {
            word(&mut out, v)
        }
        dword(&mut out, crc);
        dword(&mut out, data.len() as u32);
        dword(&mut out, data.len() as u32);
        word(&mut out, name.len() as u16);
        word(&mut out, 0);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);
        dword(&mut central, 0x02014b50);
        for v in [20, 20, 0, 0, 0, 33] {
            word(&mut central, v)
        }
        dword(&mut central, crc);
        dword(&mut central, data.len() as u32);
        dword(&mut central, data.len() as u32);
        for v in [name.len() as u16, 0, 0, 0, 0] {
            word(&mut central, v)
        }
        dword(&mut central, 0);
        dword(&mut central, offset);
        central.extend_from_slice(name.as_bytes());
    }
    let start = out.len() as u32;
    let size = central.len() as u32;
    out.extend(central);
    dword(&mut out, 0x06054b50);
    word(&mut out, 0);
    word(&mut out, 0);
    word(&mut out, count);
    word(&mut out, count);
    dword(&mut out, size);
    dword(&mut out, start);
    word(&mut out, 0);
    out
}
fn export_xlsx(input: &str) -> Vec<u8> {
    let rows: Vec<Vec<&str>> = input
        .split('\u{1e}')
        .map(|r| r.split('\u{1f}').collect())
        .collect();
    let header = rows
        .iter()
        .position(|r| r.first() == Some(&"Group"))
        .unwrap_or(0)
        + 1;
    let mut sheet = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="{header}" topLeftCell="A{}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="25" customWidth="1"/><col min="2" max="2" width="45" customWidth="1"/><col min="3" max="3" width="22" customWidth="1"/><col min="4" max="5" width="15" customWidth="1"/><col min="6" max="9" width="60" customWidth="1"/></cols><sheetData>"#,
        header + 1
    );
    for (i, row) in rows.iter().enumerate() {
        let height = row
            .iter()
            .enumerate()
            .map(|(col, s)| {
                let width = if col == 0 {
                    25
                } else if col == 1 {
                    45
                } else if col >= 5 {
                    60
                } else {
                    15
                };
                s.split('\n')
                    .map(|line| (line.chars().count() / width + 1) * 15)
                    .sum::<usize>()
                    + 12
            })
            .max()
            .unwrap_or(24)
            .min(409);
        sheet.push_str(&format!(
            "<row r=\"{}\" ht=\"{height}\" customHeight=\"1\">",
            i + 1
        ));
        for (j, value) in row.iter().take(9).enumerate() {
            let cell = format!("{}{}", (b'A' + j as u8) as char, i + 1);
            let style = if i == 0 || i + 1 == header { 1 } else { 0 };
            if i == 3 && j == 1 && value.starts_with("n:") {
                if let Ok(n) = value[2..].parse::<f64>() {
                    if n.is_finite() {
                        sheet.push_str(&format!("<c r=\"{cell}\" s=\"2\"><v>{n}</v></c>"));
                        continue;
                    }
                }
            }
            sheet.push_str(&format!(r#"<c r="{cell}" t="inlineStr" s="{style}"><is><t xml:space="preserve">{}</t></is></c>"#,xml(value)));
        }
        sheet.push_str("</row>");
    }
    sheet.push_str(&format!(r#"</sheetData><autoFilter ref="A{header}:I{}"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>"#,rows.len()));
    zip(vec![
 ("[Content_Types].xml",r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>"#.into()),
 ("_rels/.rels",r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.into()),
 ("xl/workbook.xml",r#"<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Assessment" sheetId="1" r:id="rId1"/></sheets></workbook>"#.into()),
 ("xl/_rels/workbook.xml.rels",r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#.into()),
 ("xl/styles.xml",r#"<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3947B4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#.into()),("xl/worksheets/sheet1.xml",sheet)])
}
