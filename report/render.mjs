// Render a report (default m4) to PDF with the page footer.
// Run from the repository root: node report/render.mjs [m3|m4|m4-info|m4-info2]  (uses the installed Chrome)
// node report/render.mjs m4-info --web: the copy the welcome page's consent links to (public/), without the access code
import puppeteer from "puppeteer-core";
import { join } from "node:path";

const chrome = process.env.CHROME_PATH ?? { darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", win32: "C:/Program Files/Google/Chrome/Application/chrome.exe" }[process.platform] ?? "/usr/bin/google-chrome";
const args = process.argv.slice(2);
const web = args.includes("--web");
const name = args.find((a) => !a.startsWith("--")) ?? "m4";
const titles = { m3: "M3 project description", m4: "M4 research plan", "m4-info": "Participant information", "m4-info2": "Take part in our study", "form-b": "Post-test form B, 6 November 2026" };
// the website's copies (the file name is what a participant's download is called; topics/<slug>/copy.json's infoSheet links it)
const webFiles = { "m4-info": "public/docendo-participant-information.pdf" };
if (web && !webFiles[name]) throw new Error(`${name} has no copy for the website (webFiles in report/render.mjs)`);
const out = web ? webFiles[name] : `report/Group_G_Team_Docendo_${name}-report.pdf`;
const b = await puppeteer.launch({ executablePath: chrome, headless: true });
const p = await b.newPage();
await p.goto("file://" + join(process.cwd(), `report/${name}-report.html`), { waitUntil: "networkidle0" });
if (web) await p.evaluate(() => document.documentElement.classList.add("web"));
await p.evaluateHandle("document.fonts.ready");
const footer = `<div style="width:100%;padding:0 20mm;font:500 7.5pt -apple-system,Helvetica,Arial,sans-serif;color:#7a818d;display:flex;justify-content:space-between;">
  <span>Docendo: ${titles[name] ?? name}${name.startsWith("m4-info") ? "" : ", Negrub, Gustke and Cruz"}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
await p.pdf({ path: out, format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer, margin: { top: "18mm", bottom: "20mm", left: "20mm", right: "20mm" } });
await b.close();
console.log(`wrote ${out}`);
