import { describe, expect, it } from 'vitest'
import { parseSource } from '../../src/lib/map/parse'

describe('parseSource', () => {
  it('reads a Vue script block whatever form its closing tag takes', () => {
    for (const close of ['</script>', '</SCRIPT>', '</script >', '</script\n>', '</script foo>']) {
      for (const open of ['<script setup lang="ts">', '<script lang="ts">']) {
        const result = parseSource('page.vue', `<template><div /></template>\n${open}\nconst answer = 42\n${close}\n`)
        expect(result?.errors, `${open} ${close}`).toEqual([])
        expect(result?.source, `${open} ${close}`).toBe('\n\nconst answer = 42\n')
      }
    }
  })

  it('reads JSX in a .js file', () => {
    const result = parseSource('app/page.js', 'export default function Page() { return <main>hi</main> }\n')
    expect(result?.errors).toEqual([])
    expect(result?.program.body).toHaveLength(1)
  })
})
