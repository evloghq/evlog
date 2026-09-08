import { defineMarkdownDocumentComponent } from '@comark/vue'
import LandingBadges from './LandingBadges.vue'
import LandingCtas from './LandingCtas.vue'
import LandingH1 from './LandingH1.vue'
import LandingH2 from './LandingH2.vue'
import LandingMidCta from './LandingMidCta.vue'
import LandingStats from './LandingStats.vue'

export default defineMarkdownDocumentComponent({
  name: 'LandingComark',
  components: {
    'h1': LandingH1,
    'h2': LandingH2,
    'landing-badges': LandingBadges,
    'landing-ctas': LandingCtas,
    'landing-mid-cta': LandingMidCta,
    'landing-stats': LandingStats,
  },
  class: 'landing-prose *:first:mt-0 *:last:mb-0',
})
