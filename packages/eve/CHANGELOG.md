# @evlog/eve

## 1.0.0-beta.0

### Major Changes

- [#1134](https://github.com/evloghq/evlog/pull/1134) [`6e1b1ac`](https://github.com/evloghq/evlog/commit/6e1b1aca76ba20ed1fad78bf47c49226b8f83afc) Thanks [@HugoRCD](https://github.com/HugoRCD)! - New package: evlog for eve 1.0, mounted as an eve extension with `export { default } from '@evlog/eve'` in `agent/extensions/evlog.ts`. Each turn emits one wide event with the id `sessionId:turnId`, read from the session eve stores, so a turn resumed in another process is complete. Tools add fields with `useLogger()` from `@evlog/eve/logger`, and a thrown evlog error keeps its code, status, why and fix on the event. Records are redacted in every environment, and `record: 'minimal' | 'standard' | 'debug'` with per-tool rules decides what a turn carries.
