import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBarrier,
  createTrackedBarrier,
  releaseAllBarriers,
  getActiveBarrierCount,
  createTestItems,
} from './test-fixtures.ts';

describe('createBarrier', () => {
  it('blocks until released', async () => {
    const barrier = createBarrier();
    let resolved = false;

    const waiting = barrier.wait().then(() => {
      resolved = true;
    });

    // Not yet resolved
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(resolved, false);
    assert.equal(barrier.released, false);

    barrier.release();
    await waiting;
    assert.equal(resolved, true);
    assert.equal(barrier.released, true);
  });

  it('wait resolves immediately if already released', async () => {
    const barrier = createBarrier();
    barrier.release();
    await barrier.wait(); // Should not hang
    assert.equal(barrier.released, true);
  });
});

describe('createTrackedBarrier + releaseAllBarriers', () => {
  afterEach(() => releaseAllBarriers());

  it('tracks active barriers', () => {
    const before = getActiveBarrierCount();
    createTrackedBarrier();
    createTrackedBarrier();
    assert.equal(getActiveBarrierCount(), before + 2);
  });

  it('releaseAllBarriers releases and clears all', () => {
    const b1 = createTrackedBarrier();
    const b2 = createTrackedBarrier();
    releaseAllBarriers();
    assert.equal(b1.released, true);
    assert.equal(b2.released, true);
    assert.equal(getActiveBarrierCount(), 0);
  });

  it('releaseAllBarriers unblocks waiters', async () => {
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

describe('createTestItems', () => {
  it('creates sequential items', () => {
    const items = createTestItems(5, 3);
    assert.equal(items.length, 3);
    assert.equal(items[0].sequenceNumber, 5);
    assert.equal(items[1].sequenceNumber, 6);
    assert.equal(items[2].sequenceNumber, 7);
  });

  it('assigns ids based on sequence', () => {
    const items = createTestItems(1, 2);
    assert.equal(items[0].id, 'item-1');
    assert.equal(items[1].id, 'item-2');
  });
});
