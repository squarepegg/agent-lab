import { newPage, open, ready, idle, done } from "./harness.mjs";
const p = await newPage({ width: 1440, height: 900 }); p.on("pageerror", (e) => console.log("pageerror:", e.message)); p.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 200)));
await open(p, "#m=guard"); await ready(p); await idle(p);
await p.click("[data-act=gengine][data-e=upstream]"); await idle(p);
console.log((await p.textContent("#gscore")).slice(0, 200));
await p.click("[data-act=gdial][data-r=indirection]"); await idle(p); console.log((await p.textContent("#gscore")).slice(0, 160));
await p.locator(".gc.caught").first().click(); await idle(p);
await p.screenshot({ path: "/tmp/u1.png" });
await done();
