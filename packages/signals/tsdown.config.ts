import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', testing: 'src/testing.ts' },
  format: 'esm',
  dts: true,
  clean: true,
  fixedExtension: true,
})
