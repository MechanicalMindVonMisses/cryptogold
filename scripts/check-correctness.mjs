// G3 / NFR-7: compares the live BTC/gold ratio from /api/spot with XAUS's own btc_gold_oz (±0.5 %),
// and checks the gram conversion. Needs a running server: BASE_URL (default http://localhost:3000).
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const TOLERANCE_PCT = 0.5;
const GRAMS_PER_OZ = 31.1034768;

const [ours, ref] = await Promise.all([
  fetch(`${BASE_URL}/api/spot?ids=bitcoin`).then((r) => {
    if (!r.ok) throw new Error(`/api/spot answered ${r.status}`);
    return r.json();
  }),
  fetch("https://xaus.com/api/v1/spot?unit=oz&currency=USD&compact=1").then((r) => r.json()),
]);

const btc = ours.coins.find((c) => c.id === "bitcoin");
const reference = ref.btc_gold_oz;
// XAUS rounds btc_gold_oz to 2 decimals, so also compare with its unrounded inputs.
const exactReference = ref.btc_usd / ref.xau.price;
const diff = (a, b) => (Math.abs(a / b - 1) * 100).toFixed(3);

console.log(
  `AuRatio:  1 BTC = ${btc.ratioOz.toFixed(4)} oz (BTC $${btc.usd}, gold $${ours.gold.usdPerOz} via ${ours.gold.source})`,
);
console.log(
  `XAUS:     btc_gold_oz = ${reference} (unrounded ${exactReference.toFixed(4)} from BTC $${ref.btc_usd})`,
);
console.log(
  `Difference: ${diff(btc.ratioOz, reference)} % vs btc_gold_oz, ${diff(btc.ratioOz, exactReference)} % vs unrounded`,
);

const grams = btc.ratioOz * GRAMS_PER_OZ;
const gramError = Math.abs(grams / GRAMS_PER_OZ / btc.ratioOz - 1);
console.log(
  `Grams: ${grams.toFixed(3)} g (relative conversion error ${gramError.toExponential(1)})`,
);

const ok = Math.abs(btc.ratioOz / reference - 1) * 100 <= TOLERANCE_PCT && gramError < 1e-9;
console.log(ok ? `PASS (within ±${TOLERANCE_PCT} %)` : "FAIL");
process.exit(ok ? 0 : 1);
