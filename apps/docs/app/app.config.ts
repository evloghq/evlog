export default defineAppConfig({
  navigation: {
    sub: 'header',
  },
  github: {
    rootDir: 'apps/docs',
  },
  seo: {
    titleTemplate: '%s - evlog',
    title: 'evlog',
    description: 'Wide events and structured errors for TypeScript. One log per request, full context, errors that explain why and how to fix.',
    // Answers "what is this site?" as a linked JSON-LD graph on the landing.
    // `sameAs` is the part that matters: it reconciles the site, the repository
    // and the package as one entity rather than three unrelated sources.
    schema: {
      type: 'SoftwareApplication',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Node.js, Bun, Deno, Cloudflare Workers, all major browsers',
      price: 0,
      priceCurrency: 'USD',
      sameAs: [
        'https://github.com/evloghq/evlog',
        'https://www.npmjs.com/package/evlog',
        'https://x.com/hugorcd',
      ],
    },
  },
  assistant: {
    icons: {
      trigger: 'i-custom:ai'
    },
    faqQuestions: [
      {
        category: 'Getting Started',
        items: [
          'What is evlog?',
          'How do I install evlog?',
          'How do I use useLogger?',
        ],
      },
      {
        category: 'Core Features',
        items: [
          'What are wide events?',
          'How do I create structured errors?',
          'How do I use parseError?',
        ],
      },
      {
        category: 'Production',
        items: [
          'How do I configure sampling?',
          'How do I send logs to Axiom?',
          'How do I send logs to PostHog?',
        ],
      },
    ],
  },
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'zinc',
    },
    sidebar: {
      slots: {
        container: 'fixed inset-y-0 z-50 hidden h-svh w-(--sidebar-width) lg:flex',
      },
    },
    prose: {
      pre: {
        slots: {
          // Scroll long lines instead of wrapping them: CLI output and check
          // matrices are column-aligned, and a soft wrap destroys the alignment.
          base: 'whitespace-pre wrap-normal',
        },
      },
    },
    button: {
      slots: {
        base: 'active:translate-y-px transition-transform duration-300',
      },
    },
    contentToc: {
      defaultVariants: {
        highlightVariant: 'circuit'
      }
    },
    contentSurround: {
      variants: {
        direction: {
          left: {
            linkLeadingIcon: ['group-active:translate-x-0',],
          },
          right: {
            linkLeadingIcon: ['group-active:translate-x-0',],
          },
        },
      },
    }
  },
})
