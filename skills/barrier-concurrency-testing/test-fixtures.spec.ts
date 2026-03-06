import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createBarrier,
  createTestItems,
  createTrackedBarrier,
  getActiveBarrierCount,
  releaseAllBarriers,
} from "./test-fixtures.ts";

describe("createBarrier", () => {
  // Defect: without blocking, concurrent operations race through critical sections.
  it("blocks until released", async () => {
    const barrier = createBarrier();
    let resolved = false;

    const waiting = barrier.wait().then(() => {
      resolved = true;
    });

    // Flush microtask queue — if barrier.wait() resolved, the .then() would run
    await Promise.resolve();
    assert.equal(resolved, false);
    assert.equal(barrier.released, false);

    barrier.release();
    await waiting;
    assert.equal(resolved, true);
    assert.equal(barrier.released, true);
  });

  // Defect: if a barrier doesn't handle late arrivals, tests hang after early release.
  it("wait resolves immediately if already released", async () => {
    const barrier = createBarrier();
    barrier.release();
    await barrier.wait(); // Should not hang
    assert.equal(barrier.released, true);
  });
});

describe("createTrackedBarrier + releaseAllBarriers", () => {
  // slop-ignore: no_negative_test — lifecycle helpers expose non-throwing behavior; failure mode is blocked waiters.
  afterEach(() => releaseAllBarriers());

  // Defect: without tracking, getActiveBarrierCount can't detect leaked barriers.
  it("tracks active barriers", () => {
    const before = getActiveBarrierCount();
    createTrackedBarrier();
    createTrackedBarrier();
    assert.equal(getActiveBarrierCount(), before + 2);
  });

  // Defect: without bulk release, orphaned barriers from mid-test failures block teardown.
  it("releaseAllBarriers releases and clears all", () => {
    const b1 = createTrackedBarrier();
    const b2 = createTrackedBarrier();
    releaseAllBarriers();
    assert.equal(b1.released, true);
    assert.equal(b2.released, true);
    assert.equal(getActiveBarrierCount(), 0);
  });

  // Defect: releaseAll must unblock pending waiters, not just mark released — else operations freeze.
  it("releaseAllBarriers unblocks waiters", async () => {
    const barrier = createTrackedBarrier();
    let resolved = false;
    const waiting = barrier.wait().then(() => {
      resolved = true;
    });

    releaseAllBarriers();
    await waiting;
    assert.equal(resolved, true);
  });
});

describe("createTestItems", () => {
  // Defect: sequence gaps in test data produce false positives in continuity assertions.
  it("creates sequential items", () => {
    const items = createTestItems(5, 3);
    assert.equal(items.length, 3);
    assert.equal(items[0].sequenceNumber, 5);
    assert.equal(items[1].sequenceNumber, 6);
    assert.equal(items[2].sequenceNumber, 7);
  });

  it("assigns ids based on sequence", () => {
    const items = createTestItems(1, 2);
    assert.equal(items[0].id, "item-1");
    assert.equal(items[1].id, "item-2");
  });
});
