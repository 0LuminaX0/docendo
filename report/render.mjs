// Render a report (default m4) to PDF with the page footer.
// Run from the repository root: node report/render.mjs [m3|m4|m4-info]  (uses the installed Chrome)
import puppeteer from "puppeteer-core";
import { join } from "node:path";

const chrome = process.env.CHROME_PATH ?? { darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", win32: "C:/Program Files/Google/Chrome/Application/chrome.exe" }[process.platform] ?? "/usr/bin/google-chrome";
const name = process.argv[2] ?? "m4";
const titles = { m3: "M3 project description", m4: "M4 research plan", "m4-info": "Participant information" };
const b = await puppeteer.launch({ executablePath: chrome, headless: true });
const p = await b.newPage();
await p.goto("file://" + join(process.cwd(), `report/${name}-report.html`), { waitUntil: "networkidle0" });
await p.evaluateHandle("document.fonts.ready");
const footer = `<div style="width:100%;padding:0 20mm;font:500 7.5pt -apple-system,Helvetica,Arial,sans-serif;color:#7a818d;display:flex;justify-content:space-between;">
  <span>Docendo: ${titles[name] ?? name}, Negrub, Gustke and Cruz</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
await p.pdf({ path: `report/${name}-report.pdf`, format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer, margin: { top: "18mm", bottom: "20mm", left: "20mm", right: "20mm" } });
await b.close();
console.log(`wrote report/${name}-report.pdf`);
