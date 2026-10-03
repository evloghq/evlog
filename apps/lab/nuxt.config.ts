import { fileURLToPath } from 'node:url'

const docs = fileURLToPath(new URL('../docs', import.meta.url))

const site = {
  name: 'Render labs',
  // The name and nothing else. `by evlog` rides along here rather than only in
  // `og:site_name`, which most surfaces never show — a tab, a SERP row and an
  // unfurl all carry the attribution this way. No tagline: it belongs in the
  // description, where there is room for it and where it is not competing with
  // the name for the few characters a tab or a card headline gets.
  title: 'Render labs by evlog',
  // Overridden on preview deployments so they never advertise production as
  // their canonical. Read at build time, which is all the head below needs.
  url: (process.env.NUXT_PUBLIC_SITE_URL || 'https://lab.evlog.dev').replace(/\/$/, ''),
  // Where the pitch lives. Deliberately about shots rather than videos: motion
  // is what it does today, stills come out of the same pipeline, and audio is on
  // the list — copy naming one output would need rewriting with every addition.
  description: 'Compose and render shots in the browser. Stage live components, media and type, work them through a camera and lens pipeline — tilt, depth of field, bloom, grade — then render a still, a micro-animation or a full take at any resolution.',
  // Borrowed from the product site for now: the card generated into `public/`
  // only resolves on the origin `NUXT_PUBLIC_SITE_URL` names, and the
  // production deployment is published under one that predates it. An image
  // that 404s ships a blank card, so the head points at a URL that does not
  // depend on this app's own origin until the two agree.
  image: 'https://www.evlog.dev/og.png',
  imageAlt: 'evlog, a modern TypeScript logger for everything you ship.',
  author: 'Hugo Richard',
  twitter: '@hugorcd',
}

/**
 * Everything a crawler or an unfurler reads.
 *
 * It all lives here rather than in `useSeoMeta` on the page because `ssr: false`
 * means the prerendered `index.html` is the app shell — the page component never
 * runs during prerender, so a page-level head only ever reaches a client that
 * executes JavaScript. Google would manage; Slack, Discord, iMessage and X
 * would show a bare link. `app.head` is the only head these actually get.
 */
const head = {
  title: site.title,
  htmlAttrs: { lang: 'en' },
  link: [
    { rel: 'canonical', href: `${site.url}/` },
    // evlog's own mark, synced by `pnpm brand:assets`.
    //
    // Raster only, deliberately: `evlog.svg` exists but is a 36 kB mark with a
    // gaussian blur and an embedded grain bitmap, drawn at 378px. Chrome prefers
    // an SVG icon whenever one is declared, so declaring it would trade the
    // hand-tuned 16px raster for a blurred downscale of that.
    { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
    { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
    // The docs site declares no icon at all and relies on browsers guessing
    // `/favicon.ico`; naming it means crawlers that only read the head find it.
    { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
    { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
    { rel: 'manifest', href: '/site.webmanifest' },
  ],
  meta: [
    { name: 'description', content: site.description },
    { name: 'author', content: site.author },
    // Matches the app shell, so the browser chrome does not flash white before
    // the first paint on mobile. Still a single value even though the panel has
    // two themes: the document itself is permanently dark, and the panel's theme
    // is a client-side choice this tag is written long before anyone makes.
    { name: 'theme-color', content: '#000000' },
    // Home-screen and taskbar labels, where a long string is truncated rather
    // than wrapped — the short name only.
    { name: 'apple-mobile-web-app-title', content: site.name },
    { name: 'application-name', content: site.name },

    { property: 'og:type', content: 'website' },
    // evlog, not the app: an unfurl reads as "evlog / Render labs by evlog —
    // …", which puts the product above the tool it belongs to.
    { property: 'og:site_name', content: 'evlog' },
    { property: 'og:title', content: site.title },
    { property: 'og:description', content: site.description },
    { property: 'og:url', content: `${site.url}/` },
    { property: 'og:image', content: site.image },
    { property: 'og:image:type', content: 'image/png' },
    // The file's real dimensions, verified against what evlog.dev serves.
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '628' },
    { property: 'og:image:alt', content: site.imageAlt },
    { property: 'og:locale', content: 'en_US' },

    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:site', content: site.twitter },
    { name: 'twitter:creator', content: site.twitter },
    // X falls back to `og:image` but not to `og:image:alt`, so the alt text has
    // to be repeated here or the card ships without one.
    { name: 'twitter:image', content: site.image },
    { name: 'twitter:image:alt', content: site.imageAlt },
  ],
  script: [
    {
      type: 'application/ld+json',
      // `WebApplication` rather than `SoftwareApplication`: nothing is
      // installed, and free-and-no-signup are the facts worth stating.
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        'name': site.title,
        'alternateName': site.name,
        'url': `${site.url}/`,
        'description': site.description,
        'applicationCategory': 'MultimediaApplication',
        // Ties the tool to the product for anything reading the graph rather
        // than the title string.
        'publisher': { '@type': 'Organization', 'name': 'evlog', 'url': 'https://www.evlog.dev' },
        'isPartOf': { '@type': 'WebSite', 'name': 'evlog', 'url': 'https://www.evlog.dev' },
        // WebGL2 is the pipeline itself; WebCodecs only gates rendering motion,
        // so a browser without it still gets stills.
        'browserRequirements': 'Requires WebGL2. WebCodecs is needed to render motion.',
        'operatingSystem': 'Any',
        'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
        'author': { '@type': 'Person', 'name': site.author, 'url': 'https://hugorcd.com' },
      }),
    },
  ],
}

/**
 * Render labs: a rig for composing and rendering shots.
 *
 * What it films is configuration, not an assumption. The `stages` block below is
 * the only place that names another project — point it somewhere else and this
 * becomes a lab for that instead, with nothing in the source to edit.
 *
 * evlog's documentation is the source configured here, and the reason is worth
 * keeping: the components stay where they are maintained, so a component tweaked
 * for the site is the one that gets shot, with no copy left to drift.
 */
export default defineNuxtConfig({
  // Analytics is mounted as a component in `app.vue`, not listed here: the
  // module's plugin template did not survive this Nuxt version's build.
  modules: ['@nuxt/ui', '@nuxt/fonts', 'motion-v/nuxt'],

  // Client only. Every part of this touches the DOM, a canvas or a GPU, and
  // there is no reader to serve markup to. The one route is prerendered below,
  // so crawlers still get a real document with a full head.
  ssr: false,

  css: ['~/assets/css/main.css'],

  /**
   * What can be put on the stage.
   *
   * A source brings three things: the components, the stylesheet they are drawn
   * with, and the directory Tailwind has to scan to generate the utilities they
   * use. Filming a component out of its own app without the last two gives the
   * right layout in the wrong type and colours.
   */
  stages: {
    sources: [
      {
        glob: `${docs}/app/components/content/*.vue`,
        // The framework picker wraps fenced code from markdown; without a page
        // around it there is nothing to render.
        ignore: ['FrameworkTabs.vue'],
        group: 'content',
        css: `${docs}/app/assets/css/main.css`,
        source: `${docs}/app`,
      },
      {
        glob: `${docs}/app/components/features/*.vue`,
        group: 'features',
      },
    ],
  },

  /*
   * The document stays dark. Always, and not as a preference.
   *
   * The panel has a light theme, but this is not where it lives — see
   * `app/composables/useLabTheme.ts`. Colour mode is a property of the page, and
   * the page contains the stage: the live node the plate is rasterized from,
   * which has to keep the colours of the app it was copied out of. Letting this
   * follow the machine meant the same shot rendered differently at breakfast and
   * at midnight, which is the one thing a rig like this may never do.
   */
  colorMode: {
    preference: 'dark',
  },

  devServer: {
    port: 3000,
  },

  // The `robots.txt` and `sitemap.xml` handlers read the origin from here, so
  // it stays a single value shared with the canonical above.
  runtimeConfig: {
    public: { siteUrl: site.url },
  },

  app: { head },

  fonts: {
    defaults: {
      // Full variable axis — discrete weights render too thin on Chromium, and
      // the plate is rasterized from this exact text.
      weights: ['100 900'],
    },
    families: [
      { name: 'Geist', weights: ['100 900'], global: true },
      { name: 'Geist Mono', weights: ['100 900'], global: true },
      {
        name: 'Geist Pixel Line',
        src: '/fonts/GeistPixel-Line.woff2',
        weights: [400, 500],
        global: true,
      },
      /*
       * The rest of the catalogue a text layer can be set in.
       *
       * Downloaded and served from this origin rather than linked, which is not
       * a preference: the plate is rasterized through a sealed SVG, so every
       * face has to be inlined as a data URI, and `dom-texture` will only read a
       * file from the same origin. Linked from a CDN they would render in the
       * panel and fall back in the export.
       *
       * Variable where the family has one, so the weight control means
       * something across the whole range instead of snapping to two cuts.
       */
      { name: 'Inter', weights: ['100 900'], global: true },
      { name: 'Space Grotesk', weights: ['300 700'], global: true },
      { name: 'Bricolage Grotesque', weights: ['200 800'], global: true },
      { name: 'Archivo', weights: ['100 900'], global: true },
      { name: 'Instrument Serif', weights: [400], styles: ['normal', 'italic'], global: true },
      { name: 'Playfair Display', weights: ['400 900'], global: true },
      { name: 'JetBrains Mono', weights: ['100 800'], global: true },
    ],
  },

  nitro: {
    // The pixel font is a public asset of the docs app, and the capture inlines
    // whatever `@font-face` resolves to — so it has to be served from here too.
    //
    // Scoped to `fonts/` on purpose: mounting the whole directory also served
    // evlog's favicon, `og.png` and `site.webmanifest` from this origin, so the
    // lab shipped another product's identity in its own head.
    publicAssets: [{ dir: `${docs}/public/fonts`, baseURL: '/fonts', maxAge: 0 }],

    // The app is a single client-rendered route, so its shell is the same bytes
    // for everyone. Prerendering it means a deployment serves a static file
    // rather than waking a function for every visit — and it is what puts the
    // head tags in the HTML a crawler receives, given `ssr: false`.
    prerender: {
      routes: ['/', '/robots.txt', '/sitemap.xml'],
    },
  },

  icon: {
    customCollections: [{ prefix: 'custom', dir: `${docs}/app/assets/icons` }],
    clientBundle: { scan: true, includeCustomCollections: true },
    provider: 'iconify',
  },

})
