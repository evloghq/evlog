import { moveModules } from '../../rename-modules'

/** evlog 3 serves Nitro 3 from `evlog/nitro` and nitropack from `evlog/nitro/v2`. */
export default moveModules('v3/nitro-entry-points', {
  'evlog/nitro': { to: 'evlog/nitro/v2' },
  'evlog/nitro/v3': { to: 'evlog/nitro' },
})
