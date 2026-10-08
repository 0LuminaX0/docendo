// Render report/m3-report.html to report/m3-report.pdf with the page footer.
// Run from the repository root: node report/render.mjs  (uses the installed Chrome)
import puppeteer from "puppeteer-core";
import { join } from "node:path";

const chrome = process.env.CHROME_PATH ?? { darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", win32: "C:/Program Files/Google/Chrome/Application/chrome.exe" }[process.platform] ?? "/usr/bin/google-chrome";
const b = await puppeteer.launch({ executablePath: chrome, headless: true });
const p = await b.newPage();
await p.goto("file://" + join(process.cwd(), "report/m3-report.html"), { waitUntil: "networkidle0" });
await p.evaluateHandle("document.fonts.ready");
const footer = `<div style="width:100%;padding:0 20mm;font:500 7.5pt -apple-system,Helvetica,Arial,sans-serif;color:#7a818d;display:flex;justify-content:space-between;">
  <span>Docendo: M3 project description, Negrub, Gustke and Cruz</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
await p.pdf({ path: "report/m3-report.pdf", format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer, margin: { top: "18mm", bottom: "20mm", left: "20mm", right: "20mm" } });
await b.close();
console.log("wrote report/m3-report.pdf");
