import type { ArgsDef } from 'citty'
import { cliErrors } from './errors'

function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/gi, (_, char: string) => char.toUpperCase())
}

function looksLikeFlag(arg: string): boolean {
  return /^--|^-[a-z]/i.test(arg)
}

/**
 * Check `rawArgs` against the flags a command declares, and return them ready
 * for citty to parse.
 *
 * citty parses leniently: a flag it does not know becomes a boolean with its
 * value left behind as a positional, and a value flag with nothing after it
 * reads as unset. Both let a mistyped gate run the command without the gate, so
 * both are refused here.
 *
 * @param bare - Value flags that also work alone, like `--baseline`. One that
 * is last or followed by another flag is rewritten to `--flag=`, which keeps
 * citty from reading the next flag as its value.
 * @throws `cli.UNKNOWN_FLAG` or `cli.FLAG_NEEDS_VALUE`.
 */
export function checkFlags(rawArgs: readonly string[], args: ArgsDef, bare: readonly string[] = []): string[] {
  const declared = new Map<string, { key: string, takesValue: boolean }>()
  for (const [key, def] of Object.entries(args)) {
    if (def.type === 'positional') continue
    const flag = { key, takesValue: def.type === 'string' || def.type === 'enum' }
    declared.set(key, flag)
    for (const alias of 'alias' in def ? [def.alias ?? []].flat() : []) declared.set(alias, flag)
  }
  const find = (name: string) => declared.get(name) ?? declared.get(camelCase(name))

  const end = rawArgs.indexOf('--')
  const checked = [...rawArgs]

  /* citty lifts every `--no-x` out before it pairs a flag with its value, so
     the pairing below runs on what is left. */
  const rest: number[] = []
  for (let index = 0; index < (end === -1 ? rawArgs.length : end); index++) {
    const arg = rawArgs[index]!
    if (!arg.startsWith('--no-')) rest.push(index)
    else if (!find(arg.slice(5)) && !find(arg.slice(2))) throw cliErrors.UNKNOWN_FLAG({ flag: arg })
  }

  for (let at = 0; at < rest.length; at++) {
    const index = rest[at]!
    const arg = rawArgs[index]!
    if (!looksLikeFlag(arg)) continue

    const long = arg.startsWith('--')
    const names = long ? [arg.slice(2).split('=')[0]!] : [...arg.slice(1)]
    for (const [position, name] of names.entries()) {
      const flag = long ? find(name) : declared.get(name)
      if (!flag) throw cliErrors.UNKNOWN_FLAG({ flag: long ? `--${name}` : `-${name}` })
      if (!flag.takesValue || arg.includes('=') || position < names.length - 1) continue

      const next = rest[at + 1] === undefined ? undefined : rawArgs[rest[at + 1]!]
      if (next !== undefined && !looksLikeFlag(next)) at++
      else if (bare.includes(flag.key)) checked[index] = `${arg}=`
      else throw cliErrors.FLAG_NEEDS_VALUE({ flag: arg })
    }
  }

  return checked
}
