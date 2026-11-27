import type { ShjTheme, ShjThemePair } from 'rangi'

/**
 * Rangi's compact token set mapped to the live Geist syntax roles used by
 * Vercel docs sites. Keep these values in sync with the code-surface tokens in
 * `app/assets/css/theme.css`.
 */
export const geistLight = {
  name: 'comark-geist-light',
  scheme: 'light',
  bg: '#fff',
  fg: '#171717',
  numbers: '#a8a8a8',
  tokens: {
    kwd: '#c41562',
    oper: '#171717',
    class: '#7c00c9',
    func: '#7c00c9',
    type: '#7c00c9',
    cmnt: '#4d4d4d',
    bracket: '#171717',
    num: '#0064e2',
    bool: '#0064e2',
    section: '#0064e2',
    var: '#a64f00',
    str: '#107d32',
    insert: '#107d32',
    deleted: '#d60020',
    err: '#d60020',
  },
} satisfies ShjTheme

export const geistDark = {
  name: 'comark-geist-dark',
  scheme: 'dark',
  bg: '#000',
  fg: '#ededed',
  numbers: '#878787',
  tokens: {
    kwd: '#ff518d',
    oper: '#ededed',
    class: '#c472fb',
    func: '#c472fb',
    type: '#c472fb',
    cmnt: '#a0a0a0',
    bracket: '#ededed',
    num: '#50a8ff',
    bool: '#50a8ff',
    section: '#50a8ff',
    var: '#f90',
    str: '#00ca52',
    insert: '#00ca52',
    deleted: '#ff5e63',
    err: '#ff5e63',
  },
} satisfies ShjTheme

export const geistTheme = {
  light: geistLight,
  dark: geistDark,
} satisfies ShjThemePair
