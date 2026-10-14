import puppeteer from "puppeteer-core";
const B = "http://localhost:3194", OUT = "/private/tmp/claude-502/-Users-andrii-Documents-Projects-Projects-Docendo/cfb3527a-30b0-40f4-b0dd-a11942b75e53/scratchpad/";
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage();
const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.setViewport({ width: 1440, height: 1000 });
await p.goto(B + "/", { waitUntil: "load" });
await p.click("button[type=submit]");
await p.waitForFunction(() => location.pathname === "/pretest");
await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("docendo:session:v1"));
  s.step = "practice";
  s.chat.state = { v: 1, turn: 3, focus: "n07", notebook: [
    { fact: "n01.f1", verdict: "correct", words: "you choose between restaurants every night and don't know which is best", turn: 1 },
    { fact: "n05.f1", verdict: "correct", words: "greedy always picks the best average so far", turn: 2 },
    { fact: "n07.f1", verdict: "correct", words: "epsilon greedy usually takes the best one but sometimes explores at random", turn: 3 } ],
    misconceptions: [{ node: "n07", words: "when it explores it goes to the restaurant it has visited the least", turn: 3 }],
    memo: {}, contradicted: [], usedTerms: [], last: null, done: false };
  s.practice = { startedAt: Date.now(), items: {}, current: 1, view: "recursive" };
  localStorage.setItem("docendo:session:v1", JSON.stringify(s));
});
await p.goto(B + "/practice", { waitUntil: "load" });
await p.waitForSelector(".kattempt .light", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: OUT + "v2-rf-1.png", fullPage: true });
// the correction field does sums too
await p.focus(".ks-fix textarea");
await p.keyboard.type("It picks any of the three at random, so A has 1/3 + 0 =");
await new Promise((r) => setTimeout(r, 300));
console.log("correction field:", await p.$eval(".ks-fix textarea", (e) => e.value));
await p.$eval(".ks-fix .btn.primary", (e) => e.click());
await p.waitForFunction(() => document.querySelectorAll(".kattempt").length === 2, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1800));
await p.screenshot({ path: OUT + "v2-rf-2.png", fullPage: true });
// direct view: the working field with keys
await p.$eval(".seg button:nth-child(1)", (e) => e.click());
await p.waitForSelector(".scratch textarea");
await p.focus(".scratch textarea");
await p.keyboard.type("Explore day: random among all 3.\nA: 6.1 + 0.5 =");
await p.$eval(".scratch-toggle", (e) => e.click());
await p.keyboard.type("\n0.8 * 1000 + 200 / 3");
await new Promise((r) => setTimeout(r, 300));
console.log("working field:", JSON.stringify(await p.$eval(".scratch textarea", (e) => e.value)), "| hint:", await p.$eval(".scratch-hint", (e) => e.textContent));
await p.screenshot({ path: OUT + "v2-direct.png", fullPage: true });
console.log("errors:", errors.length ? errors : "none");
await b.close();
