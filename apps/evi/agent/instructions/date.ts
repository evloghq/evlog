import { defineDynamic, defineInstructions } from 'eve/instructions'

/** After the static `instructions.md`, so the date never breaks the cached prefix. */
export default defineDynamic(() => defineInstructions({
  content: `**Today's date:** ${new Date().toISOString().slice(0, 10)} (UTC). Use it for anything time-relative: "latest", "this week", a release's age, a search query's year.`,
}))
