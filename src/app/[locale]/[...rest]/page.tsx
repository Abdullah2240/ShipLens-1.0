import { notFound } from 'next/navigation';

// Any URL under a locale that no route matches lands here, so the localised
// not-found page renders instead of the framework default.
export default function CatchAllPage() {
  notFound();
}
