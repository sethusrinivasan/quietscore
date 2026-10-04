use std::{cell::RefCell, collections::BTreeMap};
#[rustfmt::skip]
mod tables;
struct OptionDef {
    value: &'static str,
    label: &'static str,
    explanation: &'static str,
}
struct Metric {
    key: &'static str,
    name: &'static str,
    question: &'static str,
    group: usize,
    options: &'static [OptionDef],
}
include!("metrics.rs");
include!("xlsx.rs");
pub const EXAMPLE: &str = "CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N";
#[derive(Clone)]
pub struct Vector {
    values: BTreeMap<String, String>,
}
impl Vector {
    pub fn parse(input: &str) -> Result<Self, String> {
        if input.len() > 8192 {
            return Err("The vector is too long (maximum 8 KB).".into());
        }
        let mut parts = input.trim().split('/');
        if parts.next() != Some("CVSS:4.0") {
            return Err("Start with CVSS:4.0/. Only CVSS version 4.0 is supported.".into());
        }
        let mut values = BTreeMap::new();
        for p in parts {
            let (k, v) = p
                .split_once(':')
                .ok_or_else(|| format!("Invalid segment: {p}. Use METRIC:VALUE."))?;
            let metric = METRICS
                .iter()
                .find(|m| m.key == k)
                .ok_or_else(|| format!("Unknown metric: {k}."))?;
            if values.contains_key(k) {
                return Err(format!("Duplicate metric: {k}. Specify each metric once."));
            }
            if !metric.options.iter().any(|o| o.value == v) {
                return Err(format!(
                    "Invalid value for {k}: {v}. Allowed: {}.",
                    metric
                        .options
                        .iter()
                        .map(|o| o.value)
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
            values.insert(k.into(), v.into());
        }
        let missing = METRICS
            .iter()
            .filter(|m| m.group == 0 && !values.contains_key(m.key))
            .map(|m| m.key)
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(format!(
                "Missing required Base metrics: {}.",
                missing.join(", ")
            ));
        }
        Ok(Self { values })
    }
    fn raw(&self, k: &str) -> &str {
        self.values.get(k).map(String::as_str).unwrap_or("X")
    }
    fn effective(&self, k: &str) -> &str {
        let v = self.raw(k);
        if k == "E" && v == "X" {
            return "A";
        }
        if ["CR", "IR", "AR"].contains(&k) && v == "X" {
            return "H";
        }
        if !k.starts_with('M') {
            let modified = format!("M{k}");
            if let Some(m) = self.values.get(&modified) {
                if m != "X" {
                    return m;
                }
            }
        }
        v
    }
    pub fn canonical(&self) -> String {
        let mut s = "CVSS:4.0".to_string();
        for m in METRICS {
            let v = self.raw(m.key);
            if m.group == 0 || v != "X" {
                s.push_str(&format!("/{}:{}", m.key, v));
            }
        }
        s
    }
    fn nomenclature(&self) -> &str {
        let t = self.raw("E") != "X";
        let e = METRICS
            .iter()
            .any(|m| m.group == 2 && self.raw(m.key) != "X");
        match (t, e) {
            (false, false) => "CVSS-B",
            (true, false) => "CVSS-BT",
            (false, true) => "CVSS-BE",
            (true, true) => "CVSS-BTE",
        }
    }
    // FIRST groups effective metrics into six equivalence classes (EQ1–EQ6).
    // Keep their ordering aligned with the generated lookup tables.
    fn macrovector(&self) -> [u8; 6] {
        let m = |k| self.effective(k);
        let eq1 = if m("AV") == "N" && m("PR") == "N" && m("UI") == "N" {
            0
        } else if m("AV") != "P" && (m("AV") == "N" || m("PR") == "N" || m("UI") == "N") {
            1
        } else {
            2
        };
        let eq2 = if m("AC") == "L" && m("AT") == "N" {
            0
        } else {
            1
        };
        let eq3 = if m("VC") == "H" && m("VI") == "H" {
            0
        } else if ["VC", "VI", "VA"].iter().any(|k| m(k) == "H") {
            1
        } else {
            2
        };
        let eq4 = if m("MSI") == "S" || m("MSA") == "S" {
            0
        } else if ["SC", "SI", "SA"].iter().any(|k| m(k) == "H") {
            1
        } else {
            2
        };
        let eq5 = match m("E") {
            "A" => 0,
            "P" => 1,
            _ => 2,
        };
        let eq6 = if [("CR", "VC"), ("IR", "VI"), ("AR", "VA")]
            .iter()
            .any(|(r, i)| m(r) == "H" && m(i) == "H")
        {
            0
        } else {
            1
        };
        [eq1, eq2, eq3, eq4, eq5, eq6]
    }
    // Interpolate within the macrovector using distances to less severe classes.
    // Preserve operation order: floating-point changes can affect one-decimal rounding.
    pub fn score(&self) -> f64 {
        if ["VC", "VI", "VA", "SC", "SI", "SA"]
            .iter()
            .all(|k| self.effective(k) == "N")
        {
            return 0.0;
        }
        let eq = self.macrovector();
        let value = tables::lookup(eq);
        let mut lower = [f64::NAN; 5];
        for (i, index) in [0, 1, 2, 3, 4].iter().enumerate() {
            let mut next = eq;
            next[*index] += 1;
            lower[i] = tables::lookup(next);
        }
        let mut n = eq;
        match (eq[2], eq[5]) {
            (0, 0) => {
                n[5] += 1;
                let left = tables::lookup(n);
                n = eq;
                n[2] += 1;
                lower[2] = left.max(tables::lookup(n));
            }
            (1, 0) => {
                n[5] += 1;
                lower[2] = tables::lookup(n)
            }
            (0, 1) | (1, 1) => {
                n[2] += 1;
                lower[2] = tables::lookup(n)
            }
            _ => {
                n[2] += 1;
                n[5] += 1;
                lower[2] = tables::lookup(n)
            }
        }
        let groups: [&[&str]; 4] = [
            &["AV", "PR", "UI"],
            &["AC", "AT"],
            &["VC", "VI", "VA", "CR", "IR", "AR"],
            &["SC", "SI", "SA"],
        ];
        let mut distance = [0.0; 5];
        for (g, keys) in groups.iter().enumerate() {
            let maxima = tables::maxes(g + 1, eq[g], eq[5]);
            for v in maxima {
                let parts: BTreeMap<_, _> = v
                    .trim_end_matches('/')
                    .split('/')
                    .filter_map(|p| p.split_once(':'))
                    .collect();
                let ds: Vec<f64> = keys
                    .iter()
                    .map(|k| level(k, self.effective(k)) - level(k, parts[k]))
                    .collect();
                if ds.iter().all(|x| *x >= -1e-9) {
                    distance[g] = ds.iter().sum();
                    break;
                }
            }
        }
        let depths = [
            [1.0, 4.0, 5.0][eq[0] as usize],
            [1.0, 2.0][eq[1] as usize],
            match (eq[2], eq[5]) {
                (0, 0) => 7.0,
                (0, 1) => 6.0,
                (1, _) => 8.0,
                _ => 10.0,
            },
            [6.0, 5.0, 4.0][eq[3] as usize],
            1.0,
        ];
        let mut total = 0.0;
        let mut count = 0;
        for i in 0..5 {
            if lower[i].is_finite() {
                count += 1;
                total += (value - lower[i]) * (distance[i] / (depths[i] * 0.1))
            }
        }
        let mean = if count == 0 {
            0.0
        } else {
            total / count as f64
        };
        ((value - mean).clamp(0.0, 10.0) * 10.0).round() / 10.0
    }
}
fn level(k: &str, v: &str) -> f64 {
    let values = match k {
        "AV" => "NALP",
        "PR" => "NLH",
        "UI" => "NPA",
        "AC" => "LH",
        "AT" => "NP",
        "SC" | "SI" | "SA" => "SHLN",
        "CR" | "IR" | "AR" => "HML",
        _ => "HLN",
    };
    [0.0, 0.1, 0.2, 0.3][values.find(v).unwrap_or(0)]
}
fn severity(score: f64) -> &'static str {
    if score == 0.0 {
        "None"
    } else if score < 4.0 {
        "Low"
    } else if score < 7.0 {
        "Medium"
    } else if score < 9.0 {
        "High"
    } else {
        "Critical"
    }
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
struct App {
    vector: Vector,
    tab: usize,
    error: String,
    notice: String,
    draft: String,
}
impl App {
    fn new() -> Self {
        Self {
            vector: Vector::parse(EXAMPLE).unwrap(),
            tab: 0,
            error: String::new(),
            notice: String::new(),
            draft: String::new(),
        }
    }
    fn action(&mut self, action: u32, input: &str) -> String {
        self.notice.clear();
        match action {
            1 => match Vector::parse(input) {
                Ok(v) => {
                    self.vector = v;
                    self.error.clear();
                    self.draft.clear();
                    self.notice = "Vector applied. Every metric has been validated locally.".into()
                }
                Err(e) => {
                    self.error = e;
                    self.draft = input.into()
                }
            },
            2 => {
                if let Some((k, v)) = input.split_once(':') {
                    let mut values = self.vector.values.clone();
                    values.insert(k.into(), v.into());
                    let candidate = Vector { values };
                    match Vector::parse(&candidate.canonical()) {
                        Ok(v) => {
                            self.vector = v;
                            self.error.clear();
                            self.draft.clear()
                        }
                        Err(e) => self.error = e,
                    }
                }
            }
            3 => self.tab = input.parse::<usize>().unwrap_or(0).min(3),
            4 => {
                self.vector = Vector::parse(
                    "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N",
                )
                .unwrap();
                self.error.clear();
                self.draft.clear();
                self.notice =
                    "Reset to no impact. Assess every Base metric before using the score.".into()
            }
            5 => return self.export_json(),
            6 => return self.export_text(),
            7 => return self.vector.canonical(),
            8 => return self.result_json(),
            9 => {
                return match Vector::parse(input) {
                    Ok(v) => format!("{:.1}", v.score()),
                    Err(e) => format!("ERROR: {e}"),
                }
            }
            _ => {}
        }
        self.render()
    }
    fn result_json(&self) -> String {
        format!(
            "{{\"vector\":\"{}\",\"score\":{:.1},\"severity\":\"{}\",\"nomenclature\":\"{}\"}}",
            self.vector.canonical(),
            self.vector.score(),
            severity(self.vector.score()),
            self.vector.nomenclature()
        )
    }
    fn export_json(&self) -> String {
        format!("{{\n  \"format\": \"quiet-cvss\",\n  \"schemaVersion\": 1,\n  \"cvssVersion\": \"4.0\",\n  \"vector\": \"{}\",\n  \"score\": {:.1},\n  \"severity\": \"{}\",\n  \"nomenclature\": \"{}\"\n}}\n",self.vector.canonical(),self.vector.score(),severity(self.vector.score()),self.vector.nomenclature())
    }
    fn export_text(&self) -> String {
        let mut s = format!(
            "QuietScore — CVSS 4.0 assessment\n{}\nScore: {:.1} / 10 ({})\nScore type: {}\n\n",
            self.vector.canonical(),
            self.vector.score(),
            severity(self.vector.score()),
            self.vector.nomenclature()
        );
        for m in METRICS {
            if m.group == 0 || self.vector.raw(m.key) != "X" {
                let o = m
                    .options
                    .iter()
                    .find(|o| o.value == self.vector.raw(m.key))
                    .unwrap();
                s.push_str(&format!(
                    "{} ({}): {}\n  {}\n",
                    m.name, m.key, o.label, o.explanation
                ));
            }
        }
        s.push_str("\nCVSS describes vulnerability severity, not complete business risk.\nCalculated locally with Rust/WebAssembly. Supplemental metrics do not affect the score.\n");
        s
    }
    fn render(&self) -> String {
        let score = self.vector.score();
        let sev = severity(score);
        let canonical = self.vector.canonical();
        let labels = ["Base", "Threat", "Environment", "Supplemental"];
        let intro=["The vulnerability’s intrinsic characteristics. All 11 metrics are required.","Refine severity with current evidence of exploitation. Optional; Not defined assumes Attacked.","Refine severity for your deployment and security requirements. Optional overrides replace Base values.","Additional context for your assessment. These metrics never change the score."];
        let mut s = format!(
            r#"<header><span class="brand" aria-label="QuietScore"><span class="brand-icon">q</span>quietscore<span class="brand-light">/ cvss</span></span><span class="privacy-pill"><span class="dot"></span> Local calculations · No telemetry</span></header><main><div class="page-heading"><div><p class="eyebrow">VULNERABILITY SEVERITY, CLEARLY</p><h1>A little clarity. A better assessment.</h1><p class="subtitle">CVSS 4.0, explained in plain language. Your assessment stays on your device.</p></div><span class="version-tag">CVSS <b>4.0</b></span></div><section class="vector-card" aria-label="Vector import"><div class="section-top"><label for="vector-input">Start with a vector <span class="muted">or choose metrics below</span></label><button class="text-button" data-action="file">↑ Import file</button></div><form id="vector-form"><textarea id="vector-input" rows="2" spellcheck="false" aria-describedby="vector-status" placeholder="Paste a CVSS:4.0 vector here">{}</textarea><button class="primary" type="submit">Apply vector <span aria-hidden="true">↗</span></button></form><p id="vector-status" class="{}" role="status">{}</p><input hidden type="file" id="file-input" accept=".json,.txt,application/json,text/plain"></section><div class="workspace"><section class="metrics-panel"><div role="tablist" aria-label="Metric groups" class="tabs">"#,
            escape(if self.draft.is_empty() {
                &canonical
            } else {
                &self.draft
            }),
            if self.error.is_empty() {
                "vector-status"
            } else {
                "error"
            },
            if !self.error.is_empty() {
                escape(&self.error)
            } else if !self.notice.is_empty() {
                escape(&self.notice)
            } else {
                "✓ Valid CVSS 4.0 vector · 11 of 11 Base metrics present".into()
            }
        );
        for (i, label) in labels.iter().enumerate() {
            s.push_str(&format!(r#"<button id="tab-{i}" role="tab" aria-selected="{}" aria-controls="metric-content" tabindex="{}" data-tab="{i}" class="tab {}">{label}<span>{}</span></button>"#,i==self.tab,if i==self.tab{0}else{-1},if i==self.tab{"active"}else{""},if i==0{"11"}else{"+"}));
        }
        s.push_str(&format!(r#"</div><div id="metric-content" role="tabpanel" aria-labelledby="tab-{}"><div class="group-heading"><div><p class="eyebrow">{} METRICS</p><h2>{}</h2></div><button class="text-button" data-action="reset">↺ Reset all</button></div><p class="group-intro">{}</p>"#,self.tab,labels[self.tab].to_uppercase(),["Understand the attack","Consider the threat","Make it environment-specific","Add the bigger picture"][self.tab],intro[self.tab]));
        let mut count = 0;
        for m in METRICS.iter().filter(|m| m.group == self.tab) {
            if self.tab == 0 && [0, 5, 8].contains(&count) {
                s.push_str(&format!(
                    "<h3 class=\"subgroup\">{}</h3>",
                    match count {
                        0 => "01 / Exploitability",
                        5 => "02 / Vulnerable system impact",
                        _ => "03 / Subsequent system impact",
                    }
                ));
                if count == 8 {
                    s.push_str("<p class=\"scope-note\">A subsequent system is affected beyond the vulnerable component’s security boundary.</p>")
                }
            }
            let selected = self.vector.raw(m.key);
            let chosen = m.options.iter().find(|o| o.value == selected).unwrap();
            s.push_str(&format!(r#"<fieldset class="metric"><legend>{} <span class="metric-key">{}</span></legend><p class="question">{}</p><div class="options">"#,m.name,m.key,m.question));
            for o in m.options {
                s.push_str(&format!(r#"<label class="option {}"><input type="radio" name="{}" value="{}" {}><span>{}</span><small>{}</small></label>"#,if o.value==selected{"selected"}else{""},m.key,o.value,if o.value==selected{"checked"}else{""},o.label,o.value));
            }
            s.push_str(&format!(r#"</div><p class="explanation"><span aria-hidden="true">↳</span> <b>{}:</b> {}</p><details class="metric-help"><summary>Compare all classifications</summary><dl>"#,chosen.label,chosen.explanation));
            for o in m.options {
                s.push_str(&format!(
                    "<dt>{} ({})</dt><dd>{}</dd>",
                    o.label, o.value, o.explanation
                ));
            }
            s.push_str("</dl></details></fieldset>");
            count += 1;
        }
        let width = score * 10.0;
        s.push_str(&format!(r#"</div></section><aside><section class="score-card {}"><div class="score-top"><span class="eyebrow">{}</span><span class="live-dot"></span></div><div class="score" aria-live="polite">{:.1}<span>/ 10</span></div><div class="severity-label">{} <span>severity</span></div><div class="score-track"><div style="width:{}%"></div></div><div class="scale"><span>0</span><span>10</span></div><p class="score-type">{} <span> · {}</span></p><p class="score-explainer">{}</p><details class="thresholds"><summary>What do severity levels mean?</summary><p>None: 0.0 · Low: 0.1–3.9 · Medium: 4.0–6.9 · High: 7.0–8.9 · Critical: 9.0–10.0.</p><p>These are CVSS severity bands, not the probability of an attack or a complete risk assessment.</p></details><div class="result-vector"><span class="eyebrow">YOUR VECTOR</span><code>{}</code><button class="copy-button" data-action="copy">Copy vector <span>⧉</span></button></div><div class="download-label">Take your assessment with you</div><div class="export-buttons"><button data-action="json">↓ JSON</button><button data-action="text">↓ Plain text</button></div><p class="export-note">JSON and text can be imported back.<br>PDF is a printable report.</p></section><section class="privacy-card"><span class="lock-icon" aria-hidden="true">◇</span><h3>Private by design.</h3><p>Rust + WebAssembly calculates and validates everything in your browser. No analytics, accounts in the calculator, or assessment uploads.</p><details><summary>How privacy works</summary><p>The hosted page still requires network access to load and the host may log requests. Vectors never go into the URL or cookies. Saved drafts use local browser storage only when you choose Save. Drafts are not encrypted; anyone using this browser profile can access them. Imported files stay local.</p><p>For zero host contact, download the offline edition and open it with networking disabled. Browser extensions and your device remain outside this app’s control.</p></details><a href="quietscore-offline.html" download>↓ Download offline edition</a></section></aside></div><footer><span>Less friction. More understanding.</span><span>Scoring based on <a href="https://www.first.org/cvss/v4.0/specification-document" target="_blank" rel="noopener noreferrer">FIRST CVSS 4.0 ↗</a> · <a href="FIRST-LICENSE" target="_blank" rel="noopener">License</a></span></footer></main>"#,sev.to_lowercase(),if self.error.is_empty(){"LIVE SEVERITY"}else{"LAST VALID ASSESSMENT"},score,sev,width,self.vector.nomenclature(),match self.vector.nomenclature(){"CVSS-B"=>"Base score","CVSS-BT"=>"Base + Threat","CVSS-BE"=>"Base + Environment",_=>"Base + Threat + Environment"},match sev{"None"=>"No confidentiality, integrity, or availability impact is specified.","Low"=>"Limited severity under the selected conditions.","Medium"=>"Moderate severity under the selected conditions.","High"=>"Significant severity. Review exposure and local context when prioritizing remediation.",_=>"The highest severity band. Review exposure and local context urgently."},canonical));
        s
    }
}
thread_local! {static APP:RefCell<App>=RefCell::new(App::new());static OUTPUT:RefCell<Vec<u8>>=const {RefCell::new(Vec::new())};}
static mut INPUT: [u8; 262144] = [0; 262144];
#[no_mangle]
pub extern "C" fn input_ptr() -> *mut u8 {
    std::ptr::addr_of_mut!(INPUT).cast()
}
#[no_mangle]
pub extern "C" fn output_ptr() -> *const u8 {
    OUTPUT.with(|o| o.borrow().as_ptr())
}
#[no_mangle]
pub extern "C" fn run(action: u32, len: usize) -> usize {
    if len > 262144 {
        return 0;
    }
    let input = unsafe { std::slice::from_raw_parts(std::ptr::addr_of!(INPUT).cast::<u8>(), len) };
    if action == 13 {
        let result = match std::str::from_utf8(input) {
            Ok(s) => export_xlsx(s),
            Err(_) => return 0,
        };
        return OUTPUT.with(|o| {
            *o.borrow_mut() = result;
            o.borrow().len()
        });
    }
    let result = match std::str::from_utf8(input) {
        Ok(s) if (10..=12).contains(&action) => engine_api(action, s),
        Ok(s) => APP.with(|a| a.borrow_mut().action(action, s)),
        Err(_) => "Invalid UTF-8 input".into(),
    };
    OUTPUT.with(|o| {
        *o.borrow_mut() = result.into_bytes();
        o.borrow().len()
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parser_errors() {
        for s in [
            "CVSS:3.1/AV:N",
            "CVSS:4.0/AV:N",
            &format!("{EXAMPLE}/AV:N"),
            &format!("{EXAMPLE}/ZZ:H"),
            &EXAMPLE.replace("UI:P", "UI:S"),
        ] {
            assert!(Vector::parse(s).is_err(), "{s}")
        }
    }
    #[test]
    fn canonical_roundtrip() {
        let v = Vector::parse(&format!("{EXAMPLE}/E:X/CR:H/MSI:S/U:Red")).unwrap();
        assert_eq!(
            Vector::parse(&v.canonical()).unwrap().canonical(),
            v.canonical()
        );
        assert!(!v.canonical().contains("E:X"))
    }
    #[test]
    fn undefined_values_use_first_defaults() {
        let v = Vector::parse(EXAMPLE).unwrap();
        for (key, value) in [("E", "A"), ("CR", "H"), ("IR", "H"), ("AR", "H")] {
            assert_eq!(v.effective(key), value);
        }
        assert_eq!(v.nomenclature(), "CVSS-B");
    }
    #[test]
    fn modified_metrics_override_base_and_x_inherits() {
        let changed = Vector::parse(&format!("{EXAMPLE}/MAV:L/MAC:H/MUI:A")).unwrap();
        assert_eq!(changed.effective("AV"), "L");
        assert_eq!(changed.effective("AC"), "H");
        assert_eq!(changed.effective("UI"), "A");
        assert_eq!(changed.nomenclature(), "CVSS-BE");
        let inherited = Vector::parse(&format!("{EXAMPLE}/MAV:X")).unwrap();
        assert_eq!(inherited.effective("AV"), "N");
    }
    #[test]
    fn supplemental_values_never_change_score() {
        let base = Vector::parse(EXAMPLE).unwrap();
        let supplemental =
            Vector::parse(&format!("{EXAMPLE}/S:P/AU:Y/R:A/V:C/RE:H/U:Red")).unwrap();
        assert_eq!(base.score(), supplemental.score());
        assert_eq!(supplemental.nomenclature(), "CVSS-B");
    }
    #[test]
    fn oversized_vectors_and_invalid_metric_values_fail() {
        assert!(Vector::parse(&"a".repeat(8193))
            .err()
            .unwrap()
            .contains("too long"));
        for suffix in ["/E:B", "/MSI:Z", "/CR:N", "/U:red"] {
            assert!(Vector::parse(&format!("{EXAMPLE}{suffix}")).is_err());
        }
    }
    #[test]
    fn json_and_xml_escape_customer_text() {
        assert_eq!(json_string("\"\\\n\t"), "\"\\\"\\\\\\n\\t\"");
        assert_eq!(xml("<note>&"), "&lt;note&gt;&amp;");
    }
    #[test]
    fn xlsx_zip_crc_and_numeric_score_are_valid() {
        assert_eq!(crc32(b"123456789"), 0xcbf43926);
        let bytes = export_xlsx("Assessment\x1eTitle\x1fQA\x1eVector\x1fCVSS:4.0\x1eScore\x1fn:7.6\x1eAV\x1f=literal text");
        assert_eq!(&bytes[..4], b"PK\x03\x04");
        let stored = String::from_utf8_lossy(&bytes);
        assert!(stored.contains("<v>7.6</v>"));
        assert!(stored.contains("=literal text"));
        assert!(!stored.contains("<f>"));
    }
    #[test]
    fn boundaries() {
        let zero = EXAMPLE.replace("VC:H/VI:H", "VC:N/VI:N");
        assert_eq!(Vector::parse(&zero).unwrap().score(), 0.0);
        let ten = "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H/MSI:S/MSA:S";
        assert_eq!(Vector::parse(ten).unwrap().score(), 10.0)
    }
}

fn json_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c < '\u{20}' => out.push_str(&format!("\\u{:04x}", c as u32)),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}
fn metric_json(m: &Metric) -> String {
    let options = m
        .options
        .iter()
        .map(|o| {
            format!(
                "{{\"value\":{},\"label\":{},\"explanation\":{}}}",
                json_string(o.value),
                json_string(o.label),
                json_string(o.explanation)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"metric\":{},\"name\":{},\"group\":{},\"question\":{},\"required\":{},\"affectsScore\":{},\"options\":[{}],\"source\":\"https://www.first.org/cvss/v4.0/specification-document\",\"guidance\":\"Plain-language interpretation; consult FIRST for authoritative definitions.\"}}",json_string(m.key),json_string(m.name),json_string(["Base","Threat","Environmental","Supplemental"][m.group]),json_string(m.question),m.group==0,m.group!=3,options)
}
fn engine_api(action: u32, input: &str) -> String {
    if action == 12 {
        return match METRICS.iter().find(|m| m.key == input) {
            Some(m) => metric_json(m),
            None => "{\"valid\":false,\"error\":\"Unknown CVSS 4.0 metric.\"}".into(),
        };
    }
    match Vector::parse(input) {
        Err(e) => format!("{{\"valid\":false,\"error\":{}}}", json_string(&e)),
        Ok(v) => {
            let mut out=format!("{{\"valid\":true,\"cvssVersion\":\"4.0\",\"vector\":{},\"score\":{:.1},\"severity\":{},\"nomenclature\":{},\"source\":\"https://www.first.org/cvss/v4.0/specification-document\"",json_string(&v.canonical()),v.score(),json_string(severity(v.score())),json_string(v.nomenclature()));
            if action == 11 {
                let metrics=METRICS.iter().map(|m|{let raw=v.raw(m.key);let selected=m.options.iter().find(|o|o.value==raw).unwrap();format!("{{\"metric\":{},\"name\":{},\"group\":{},\"value\":{},\"effectiveValue\":{},\"label\":{},\"explanation\":{},\"affectsScore\":{}}}",json_string(m.key),json_string(m.name),json_string(["Base","Threat","Environmental","Supplemental"][m.group]),json_string(raw),json_string(v.effective(m.key)),json_string(selected.label),json_string(selected.explanation),m.group!=3)}).collect::<Vec<_>>().join(",");
                out.push_str(&format!(",\"metrics\":[{metrics}],\"guidance\":\"Plain-language interpretation; consult FIRST for authoritative definitions.\""));
            }
            out.push('}');
            out
        }
    }
}
