import { beforeEach, expect, it, vi } from 'vitest';

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

import { revalidatePublicPages } from './revalidate';

beforeEach(() => revalidatePath.mockReset());

it('revalidates every public page under the root layout exactly once', () => {
  revalidatePublicPages();
  expect(revalidatePath).toHaveBeenCalledTimes(1);
  expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
});
