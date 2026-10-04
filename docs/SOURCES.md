# Sources and sample provenance

## Scoring authority

QuietScore uses FIRST’s [CVSS 4.0 Specification](https://www.first.org/cvss/v4.0/specification-document), [User Guide](https://www.first.org/cvss/v4.0/user-guide), [Implementation Guide](https://www.first.org/cvss/v4.0/implementation-guide), [Examples](https://www.first.org/cvss/v4.0/examples), and [FAQ](https://www.first.org/cvss/v4.0/faq). Plain-language UI explanations are paraphrases; the specification takes precedence. Supplemental metrics do not modify scores.

The [official calculator reference](https://github.com/FIRSTdotorg/cvss-v4-calculator/tree/c5b0d409ae9f57c44264c6ce5f27d89298e1d32a) is pinned to `c5b0d409ae9f57c44264c6ce5f27d89298e1d32a`. `reference/provenance.json` records SHA-256 hashes; source checks verify those hashes and all 32 metric classifications. Reference files are not silently updated from an upstream branch. Scoring/definitions were checked 3 October 2026; sample context was checked 4 October 2026.

CVSS is maintained by FIRST.Org, Inc. FIRST.ORG, Inc., Red Hat, and contributors retain their copyright and BSD-2-Clause conditions in [FIRST-LICENSE](../FIRST-LICENSE), hosted output, and the offline edition. QuietScore is independent; endorsement/certification is not implied.

## Published samples

- **CVE-2026-88771 — NetScaler remote command execution**. 9.5; NetScaler CNA; published 2026-09-27. [NetScaler CNA score / CVE Program](https://www.cve.org/CVERecord?id=CVE-2026-88771) · [Maintainer advisory / fix](https://support.citrix.com/support-home/kbsearch/article?articleNumber=CTX697096).
- **CVE-2026-88775 — NetScaler memory overflow**. 8.8; NetScaler CNA; published 2026-09-27. [NetScaler CNA score / CVE Program](https://www.cve.org/CVERecord?id=CVE-2026-88775) · [Maintainer advisory / fix](https://support.citrix.com/support-home/kbsearch/article?articleNumber=CTX697096&articleTitle=Citrix_NetScaler_ADC_and_Citrix_NetScaler_Gateway_Security_Bulletin_for_CVE_2026_88771_CVE_2026_88772_CVE_2026_88773_CVE_2026_88774_CVE_2026_88775_CVE_2026_88776_CVE_2026_88777_and_CVE_2026_88778).
- **CVE-2026-56705 — Adminer database connection injection**. 9.3; VulnCheck CNA; published 2026-08-25. [VulnCheck CNA score / CVE Program](https://www.cve.org/CVERecord?id=CVE-2026-56705) · [Maintainer advisory / fix](https://github.com/vrana/adminer/security/advisories/GHSA-r4x9-5m63-3vxw).
- **CVE-2026-18751 — Citrix Workspace for Mac file-path control**. 5.2; Citrix CNA; published 2026-08-18. [Citrix CNA score / CVE Program](https://www.cve.org/CVERecord?id=CVE-2026-18751) · [Maintainer advisory / fix](https://support.citrix.com/external/article/CTX696911).
- **CVE-2026-42903 — Windows Kerberos denial of service**. 7.1; FIRST worked example; published 2026-06-09. [FIRST worked example](https://www.first.org/cvss/v4.0/examples) · [CVE Program record](https://www.cve.org/CVERecord?id=CVE-2026-42903) · [Maintainer advisory / fix](https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-42903).
- **CVE-2026-48172 — LiteSpeed cPanel privilege escalation**. 10; mitre CNA; published 2026-05-21. [mitre CNA score / CVE Program](https://www.cve.org/CVERecord?id=CVE-2026-48172) · [Maintainer advisory / fix](https://blog.litespeedtech.com/2026/05/21/security-update-for-litespeed-cpanel-plugin/).
- **CVE-2026-31431 — Linux kernel CopyFail**. 8.5; FIRST worked example; published 2026-04-22. [FIRST worked example](https://www.first.org/cvss/v4.0/examples) · [CVE Program record](https://www.cve.org/CVERecord?id=CVE-2026-31431) · [Maintainer advisory / fix](https://git.kernel.org/stable/c/893d22e0135fa394db81df88697fba6032747667).
- **CVE-2026-39987 — marimo notebook authentication bypass**. 9.3; GitHub_M CNA; published 2026-04-09. [GitHub_M CNA score / CVE Program](https://www.cve.org/CVERecord?id=CVE-2026-39987) · [Maintainer advisory / fix](https://github.com/marimo-team/marimo/security/advisories/GHSA-2679-6mx9-h9xc).
- **CVE-2026-1731 — BeyondTrust remote code execution**. 9.9; BT CNA; published 2026-02-06. [BT CNA score / CVE Program](https://www.cve.org/CVERecord?id=CVE-2026-1731) · [Maintainer advisory / fix](https://www.beyondtrust.com/trust-center/security-advisories/bt26-02).
- **CVE-2021-44228 — Log4Shell · Apache Log4j**. 9.3; FIRST worked example; published 2021-12-10. [FIRST worked example](https://www.first.org/cvss/v4.0/examples) · [Apache Log4j security advisory](https://logging.apache.org/log4j/2.x/security.html#CVE-2021-44228) · [NVD record / original disclosure](https://nvd.nist.gov/vuln/detail/CVE-2021-44228).

Log4Shell is FIRST’s historical CVSS 4.0 Base + Threat worked example, not a 2026 disclosure or an original Apache CVSS 4.0 score. Conditional mitigation variants apply only when the documented mitigation is present. This library is an attributed snapshot rather than a prevalence ranking.

## Evidence boundaries

`samples.json` contains 32 metric contexts per sample, with linked sources. Source-supported facts, interpretations, defaults, discrepancies, and missing evidence are labelled separately. Optional metrics remain Not defined unless supplied by the published vector. Viewing locks the reference; cloning preserves attribution for independent work.

Known discrepancies: CopyFail’s table/vector score is 8.5 despite a nearby 10.0 heading; LiteSpeed describes a cPanel-account prerequisite but publishes PR:N; NetScaler’s AT:P execution condition is unexplained; Adminer/marimo prerequisites coexist with AT:N; Workspace’s UI:A lacks a precise victim-action description. These are disclosed without replacing the published vectors. Microsoft’s advisory and the kernel patch did not render in the research browser; official CVE records and FIRST examples supplied accessible evidence.

To update: verify publication dates, scorer/vector/context, source accessibility and licensing; preserve attribution; rerun source/parity/sample checks. Do not fill evidence gaps with invented facts.
