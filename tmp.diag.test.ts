import { it, expect } from "vitest";
import { ScentField } from "@/particles/scent/ScentField";
it("diag", () => {
  const f = new ScentField(24, 12);
  f.deposit(0, 0, 0, 1);
  let sum = 0, max = 0, maxi = -1;
  for (let i = 0; i < f.data.length; i++) { sum += f.data[i]; if (f.data[i] > max) { max = f.data[i]; maxi = i; } }
  const n = 24;
  const x = maxi % n, y = Math.floor(maxi / n) % n, z = Math.floor(maxi / (n * n));
  console.log(`sum=${sum} max=${max} cell=(${x},${y},${z}) sample(0,0,0)=${f.sample(0, 0, 0)}`);
  expect(true).toBe(true);
});
