// End-to-end walkthrough in a real browser. Start the app first (pnpm build && pnpm start),
// then: pnpm e2e [baseUrl]. Screenshots go to .e2e/.
// Uses your installed Chrome; set CHROME_PATH if it isn't in the default place.
// Against a server in demo mode it costs nothing. With a key in .env, start the server with
// DOCENDO_DEMO=1, or every message goes to OpenRouter (~60 model calls per run).
// It sends ~20 messages quickly: start the server with SESSION_TURNS_PER_MIN=200 for the run.

import puppeteer from "puppeteer-core";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = join(process.cwd(), ".e2e");
mkdirSync(OUT, { recursive: true });
const TOPIC = join(process.cwd(), "topics/bandits");
const bundle = JSON.parse(readFileSync(join(TOPIC, "bundle.json"), "utf8"));
const answers = JSON.parse(readFileSync(join(TOPIC, "exercises.json"), "utf8")).items.map((q) => q.answer);
const CHROME =
  process.env.CHROME_PATH ??
  { darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", win32: "C:/Program Files/Google/Chrome/Application/chrome.exe" }[process.platform] ??
  "/usr/bin/google-chrome";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run", "--disable-gpu"] });
const errors = [];
const checks = [];
const check = (ok, what) => checks.push(`${ok ? "✓" : "✗"} ${what}`);

async function newPage(width = 1366, height = 900, context = null) {
  const page = await (context ?? browser).newPage();
  await page.setViewport({ width, height });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("favicon") && errors.push("console: " + m.text()));
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("docendo:session:v1") || "null"));
const shot = (page, name, fullPage = false) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage });

async function start(page, welcomeShot = null) {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForSelector("button[type=submit]");
  if (welcomeShot) await shot(page, welcomeShot);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => location.pathname === "/watch");
  await page.waitForSelector(".frame iframe");
}

// ---------- 1. full run: watch, teach until Kai is ready, exercises ----------
const page = await newPage();
await start(page, "00-welcome");
const imagesLoaded = (p) => p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 }).catch(() => {});
await imagesLoaded(page);
await wait(2500); // let the YouTube player paint
await shot(page, "01-watch");
for (let i = 0; i < bundle.videos.length; i++) {
  await page.click(".aside .btn.primary");
  await wait(300);
}
await page.waitForFunction(() => location.pathname === "/teach");
await page.waitForSelector(".bubble");
check(!!(await page.$(".skip")), "“I've taught all I can” is there from the first message");
await shot(page, "02-teach-start");

let turns = 0;
let sawMind = false;
const moods = new Set();
while (turns < 32) {
  if (await page.$(".ready")) break;
  const s = await saved(page);
  const node = bundle.nodes.find((n) => n.id === s?.chat?.state?.focus) ?? bundle.nodes[0];
  // vary quality: every 4th answer is vague, so Kai gets confused sometimes
  const facts = node.facts.filter((f) => f.teachable).map((f) => f.text);
  // and every 4th (offset 1) explains just one fact, the case where Kai only partly gets it
  const msg = turns % 4 === 3 || !facts.length ? "Hmm, I'm not sure how to explain that one." : turns % 4 === 1 ? facts[0] : facts.join(" ");
  await page.focus("#msg");
  await page.keyboard.type(msg.slice(0, 1100));
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => {
    const s = JSON.parse(localStorage.getItem("docendo:session:v1") || "null");
    // wait for the saved state too: it lands after the reply, and the next message depends on Kai's focus
    return s && s.chat.turns.filter((t) => t.role === "kai").length > n && s.chat.state?.turn === n;
  }, { timeout: 30000 }, turns + 1);
  turns++;
  (await saved(page)).chat.turns.forEach((t) => t.mood && moods.add(t.mood));
  if (turns === 4) {
    await imagesLoaded(page);
    await shot(page, "03-teach-faces");
  }
  if (turns === 6 && !sawMind) {
    await page.click(".seg button:nth-child(2)");
    await page.waitForSelector(".mind svg");
    await page.click(".m-node:nth-of-type(3)").catch(() => {});
    await wait(300);
    await shot(page, "04-mind-midway", true);
    await page.click(".seg button:nth-child(1)");
    await page.waitForSelector("#msg");
    sawMind = true;
  }
  if (turns === 2 && (await page.$(".help:not([disabled])"))) {
    await page.click(".help");
    await page.waitForSelector(".modal iframe");
    await wait(800);
    await shot(page, "05-help");
    await page.click(".modal header .iconbtn");
    await page.waitForSelector(".scrim", { hidden: true });
  }
}
const s = await saved(page);
check(s.chat.done, `Kai felt ready after ${turns} messages (limit 30)`);
check(turns <= 30, "no more than 30 learner messages");
check(["great", "okay", "confused"].every((m) => moods.has(m)), `Kai showed all three reactions (${[...moods].join(", ")})`);
await shot(page, "06-teach-done");

// standalone Kai's mind
const mindPage = await newPage(1440, 1000);
await mindPage.goto(BASE + "/mind", { waitUntil: "load" });
await mindPage.waitForSelector(".mind svg");
check((await mindPage.$$(".m-node")).length === bundle.nodes.length, "Kai's mind draws every idea");
await shot(mindPage, "07-mind-final", true);
await mindPage.close();

await page.click(".ready .btn.primary");
await page.waitForFunction(() => location.pathname === "/exercises");
await page.waitForSelector(".q");
const choose = answers.map((a, i) => (i === 3 || i === 7 ? (a + 1) % 4 : a));
const cards = await page.$$(".q");
for (let i = 0; i < choose.length; i++) await cards[i].$eval(`.opt:nth-child(${choose[i] + 1}) input`, (el) => el.click());
await shot(page, "08a-exercises");
await page.click(".submitbar .btn.primary");
await page.waitForFunction(() => location.pathname === "/results");
await page.waitForSelector(".big");
const score = (await page.$eval(".big", (e) => e.textContent)).replace(/\s+/g, "");
check(score === "8/10", `graded on the server: ${score} (2 wrong on purpose)`);
await shot(page, "08-results", true);

// ---------- 2. skip straight to the exercises ----------
const skip = await newPage(1366, 900, await browser.createBrowserContext()); // fresh storage
await start(skip);
for (let i = 0; i < bundle.videos.length; i++) await skip.click(".aside .btn.primary");
await skip.waitForFunction(() => location.pathname === "/teach");
await skip.waitForSelector(".skip");
await skip.click(".skip");
await skip.waitForSelector(".composer-foot .btn.small");
await shot(skip, "09-skip-confirm");
await skip.click(".composer-foot .row .btn.small");
// stopping ends the chat in place; the learner moves on with a click
await skip.waitForSelector(".ready .btn.primary");
await wait(1200);
const stayed = await skip.evaluate(() => location.pathname === "/teach");
await shot(skip, "09b-skip-finished");
await skip.click(".ready .btn.primary");
await skip.waitForFunction(() => location.pathname === "/exercises");
check(stayed, "stopping from the first message waits for a click, then reaches the exercises");

// ---------- 3. phone width ----------
const phone = await newPage(390, 844);
await phone.goto(BASE + "/", { waitUntil: "load" });
await phone.evaluate((v) => localStorage.setItem("docendo:session:v1", v), JSON.stringify(s));
for (const path of ["/teach", "/mind", "/results"]) {
  await phone.goto(BASE + path, { waitUntil: "load" });
  await wait(700);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 0, `no sideways scroll at 390px on ${path}`);
  if (path === "/teach") {
    // the one-row header: the left group (brand, toggle) must end before the right group (meter) starts
    const gap = await phone.evaluate(() => {
      const kids = (sel) => [...document.querySelectorAll(`${sel} > *`)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      const left = Math.max(...kids(".top-start").map((r) => r.right));
      const right = Math.min(...kids(".top-right").map((r) => r.left));
      return right - left;
    });
    check(gap >= 4, `header items don't overlap at 390px (${Math.round(gap)}px apart)`);
  }
  await shot(phone, `10-phone${path.replace("/", "-")}`);
}
const phoneHome = await newPage(390, 844, await browser.createBrowserContext());
await phoneHome.goto(BASE + "/", { waitUntil: "load" });
await phoneHome.waitForSelector("button[type=submit]");
await shot(phoneHome, "10-phone-welcome", true);

await browser.close();
console.log(checks.join("\n"));
console.log(errors.length ? "PAGE ERRORS:\n" + errors.join("\n") : "no page errors");
process.exit(checks.some((c) => c.startsWith("✗")) || errors.length ? 1 : 0);
