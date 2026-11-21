import { eveChannel } from 'eve/channels/eve'
import { localDev, vercelOidc } from 'eve/channels/auth'

export default eveChannel({
  auth: [localDev(), vercelOidc()],
})
