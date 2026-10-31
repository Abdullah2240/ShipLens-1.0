import { Figtree, Noto_Naskh_Arabic, Noto_Nastaliq_Urdu } from 'next/font/google';

// Fonts are fetched from Google Fonts at build time and self-hosted from the build
// output, so nothing is requested from Google at runtime. If a build environment has
// no network, switch these three to next/font/local with woff2 files under src/fonts/.
// Verified subset names: Naskh and Nastaliq both expose 'arabic' (plus latin, latin-ext).

const latin = Figtree({
  subsets: ['latin'],
  variable: '--font-latin',
  display: 'swap',
});

const naskh = Noto_Naskh_Arabic({
  subsets: ['arabic'],
  weight: ['400', '700'],
  variable: '--font-naskh',
  display: 'swap',
});

const nastaliq = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['600'],
  variable: '--font-nastaliq',
  display: 'swap',
  preload: false,
});

export const fontClassNames = `${latin.variable} ${naskh.variable}`;
export const nastaliqClassName = nastaliq.variable;
