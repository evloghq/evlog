import type { InjectionKey } from 'vue'

/** Provided by a tab group so the code blocks inside it render without their own frame. */
export const DOCS_CODE_GROUP: InjectionKey<boolean> = Symbol('docs-code-group')
