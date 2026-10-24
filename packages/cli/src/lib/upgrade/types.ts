import type { Node, Program } from 'oxc-parser'

/** A byte range in the source a codemod reads. */
export interface Span {
  start: number
  end: number
}

/** Replace `start..end` with `text`. Every rewrite is one of these. */
export interface Edit extends Span {
  text: string
}

/**
 * One thing the upgrade found: `auto` when it carries the edits that fix it,
 * `report` when the user has to make the change.
 */
export interface UpgradeFinding {
  /** The codemod that found it, e.g. `v3/nitro-entry-points`. */
  id: string
  /** Relative to the project root, POSIX separators. */
  file: string
  line: number
  column: number
  mode: 'auto' | 'report'
  message: string
  docsUrl: string
  /** Against the file as this migration read it. Empty for `report`. */
  edits: readonly Edit[]
}

/** What a codemod sees for one file. Spans are relative to `source`. */
export interface CodemodContext {
  file: string
  source: string
  program: Program
  /** Record a finding. With `edits` it is fixed, without it the user acts on it. */
  finding: (at: Span, message: string, edits?: readonly Edit[]) => void
}

/** The node interface for a `type`, including interfaces shared by several types (`Class`, `Function`). */
export type NodeOfType<TType extends Node['type']> = Node extends infer TNode ? (TNode extends { type: infer TTypes } ? (TType extends TTypes ? TNode : never) : never) : never

/** Node-type listeners run during the single walk of a file, plus `onEnd` for whole-file decisions. */
export type CodemodVisitor = {
  [K in Node['type']]?: (node: NodeOfType<K>, parent: Node | null) => void
} & {
  onEnd?: () => void
}

/**
 * A rewrite or a check inside a migration.
 *
 * Every codemod of a migration reads the same parse and its edits are applied
 * together, so codemods never see each other's output and their order does
 * not matter.
 */
export interface Codemod {
  /** `v<major>/<slug>`, stable: it appears in output, `--json` and the guide anchor. */
  id: string
  /**
   * Strings at least one of which a file must contain for the codemod to run.
   * Files containing none are never parsed.
   */
  needles: readonly string[]
  create: (ctx: CodemodContext) => CodemodVisitor
}

/** Everything needed to move a project from the previous major to `to`. */
export interface Migration {
  to: number
  codemods: readonly Codemod[]
}
