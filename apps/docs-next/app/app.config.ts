export default defineAppConfig({
  seo: {
    siteName: 'evlog',
  },
  // Docs sidebar: how to start, the path one event takes in the order evlog runs it, what is built on
  // events, then what you look up. A group with one section lists that section's pages; a group with
  // several lists one entry per section, with its pages nested under it while they are read. A catalogue
  // section nests only the page being read: its own page links the rest.
  sidebar: [
    { sections: ['start'] },
    {
      sections: ['integrations', 'events', 'errors', 'drains'],
      steps: ['integrations', 'events', 'errors', 'events/sampling', 'events/redaction', 'events/enrichers', 'drains'],
      catalogs: ['integrations', 'drains'],
    },
    { sections: ['audit', 'map', 'signals', 'skills', 'telemetry', 'extend'] },
    { sections: ['cli', 'reference', 'compare'], catalogs: ['cli', 'reference', 'compare'] },
  ],
  footer: {
    owner: 'Hugo Richard',
    links: [
      { icon: 'i-simple-icons-github', to: 'https://github.com/evloghq/evlog', target: '_blank', 'aria-label': 'GitHub' },
      { icon: 'i-simple-icons-npm', to: 'https://www.npmjs.com/package/evlog', target: '_blank', 'aria-label': 'npm' },
    ],
  },
  docs: {
    ogImage: {
      accent: '#2853ff',
    },
  },
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'zinc',
    },
    modal: {
      variants: {
        overlay: { true: { overlay: 'bg-black/60' } },
      },
    },
    contentSearch: {
      slots: {
        modal: 'rounded-(--d-r-lg) divide-(--d-line) ring-(--d-line-strong) sm:max-w-2xl',
      },
    },
    commandPalette: {
      slots: {
        root: 'divide-(--d-line)',
        close: 'rounded-(--d-r-md) text-dimmed hover:bg-transparent hover:text-highlighted',
        label: 'font-normal text-dimmed',
        item: 'before:rounded-(--d-r-md) data-highlighted:not-data-disabled:before:bg-(--d-raised-strong)',
        itemLeadingIcon: 'text-dimmed group-data-highlighted:text-highlighted',
        itemLabelSuffix: 'text-dimmed',
      },
      variants: {
        virtualize: { false: { viewport: 'divide-y divide-(--d-line)' } },
        size: {
          md: {
            label: 'px-2 pt-2 pb-1 text-[12px]/4',
            item: 'items-center gap-2.5 px-2 py-1.5 text-[13.5px]/5',
            itemLeadingIcon: 'size-4',
          },
        },
      },
    },
    prose: {
      codeGroup: {
        slots: {
          list: 'border-white/[0.075] bg-transparent rounded-t-[12px] px-2 py-1.5',
          indicator: 'bg-white/[0.06] shadow-none rounded-[8px] inset-y-1.5',
          trigger: 'font-mono text-[12.5px] px-2.5 py-1 text-dimmed data-[state=active]:text-highlighted hover:bg-transparent hover:text-highlighted',
          triggerIcon: 'hidden',
        },
      },
    },
  },
})
