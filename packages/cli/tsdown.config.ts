import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: 'esm',
  sourcemap: false,
  dts: true,
  clean: true,
  fixedExtension: true,
})
