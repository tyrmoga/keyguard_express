import { secondsUntilTime } from "../utils"

function test(input: string, expH: number, expM: number) {
  const s = secondsUntilTime(input)
  const base = Date.now()
  const target = new Date(base + s * 1000 + 999)
  const h = target.getHours()
  const m = target.getMinutes()
  const ok = h === expH && m === expM
  if (!ok) {
    console.error(`FAIL ${input} → ${h}:${String(m).padStart(2,"0")}, expected ${expH}:${String(expM).padStart(2,"0")}`)
    process.exit(1)
  }
  console.log(`PASS secondsUntilTime("${input}") → ${expH}:${String(expM).padStart(2,"0")}`)
}
