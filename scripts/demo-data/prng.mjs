// Deterministic pseudo-random numbers for the demo dataset. Integer output only:
// callers never see a float, so money and dates stay in integer arithmetic.

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function hex2(byte) {
  return byte.toString(16).padStart(2, '0');
}

export function createRng(seed) {
  const next = mulberry32(seed);

  function int(minIncl, maxIncl) {
    if (!Number.isSafeInteger(minIncl) || !Number.isSafeInteger(maxIncl) || maxIncl < minIncl) {
      throw new RangeError(`invalid range ${minIncl}..${maxIncl}`);
    }
    const span = maxIncl - minIncl + 1;
    if (span > 0x100000000) throw new RangeError('range too wide');
    return minIncl + (next() % span);
  }

  function pick(arr) {
    if (arr.length === 0) throw new RangeError('pick from an empty array');
    return arr[int(0, arr.length - 1)];
  }

  function chance(numerator, denominator) {
    return next() % denominator < numerator;
  }

  function uuid() {
    const bytes = [];
    for (let i = 0; i < 4; i += 1) {
      const word = next();
      bytes.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = bytes.map(hex2).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function shuffle(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  return { int, pick, chance, uuid, shuffle };
}
