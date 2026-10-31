// Route handlers call this after a successful publish or unpublish so cached public pages
// pick up the change at once. It is the only file in this module that imports next/*.
import { revalidatePath } from 'next/cache';

export function revalidatePublicPages(): void {
  revalidatePath('/', 'layout');
}
