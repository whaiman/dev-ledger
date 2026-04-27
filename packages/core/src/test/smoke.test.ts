import { createEvent, hashLogChain, verifyChain, aggregate } from "../index.js";
import assert from "node:assert";

async function runTests() {
  console.log("Running DevLedger Core Tests...");

  // 1. Test Hashing
  const event1 = createEvent({ timestamp: 1000, type: "file_focus", project: "test" }, "genesis");
  const event2 = createEvent({ timestamp: 2000, type: "file_edit", project: "test" }, event1.hash);
  
  assert.strictEqual(event2.prevHash, event1.hash, "Hash chain link failed");
  console.log("✅ Hash chain integrity test passed");

  // 2. Test Verification
  const result = verifyChain([event1, event2]);
  assert.strictEqual(result.valid, true, "Verification should pass for valid chain");
  
  const brokenChain = [event1, { ...event2, prevHash: "malicious" }];
  const brokenResult = verifyChain(brokenChain);
  assert.strictEqual(brokenResult.valid, false, "Verification should fail for broken chain");
  console.log("✅ Verification engine test passed");

  // 3. Test Aggregation
  const stats = aggregate([event1, event2]);
  assert.strictEqual(stats.totalMs, 1000, "Aggregation sum failed");
  assert.strictEqual(stats.eventCount, 2, "Event counting failed");
  console.log("✅ Aggregation engine test passed");

  console.log("\nAll core tests passed successfully! 🚀");
}

runTests().catch(err => {
  console.error("Tests failed!", err);
  process.exit(1);
});
