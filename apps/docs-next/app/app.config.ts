export default defineAppConfig({
  seo: {
    siteName: 'evlog',
  },
  // Docs sidebar. A group with one section lists that section's pages; a group with several lists one
  // entry per section, with its pages nested under it while the reader is inside it.
  sidebar: [
    { sections: ['start'] },
    { label: 'Core', sections: ['events', 'errors', 'drains', 'audit'] },
    { label: 'Tools', sections: ['map', 'signals', 'skills', 'telemetry'] },
    { label: 'Integrations', sections: ['integrations'] },
    { label: 'Reference', sections: ['reference'] },
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
