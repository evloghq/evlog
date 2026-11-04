---
'evlog': minor
---

Add three opt-in redaction built-ins that detect credentials by value, under any key and inside longer strings. `apiKeys` masks GitHub, npm, Anthropic, OpenAI, Stripe and Slack tokens and AWS access key IDs to their prefix (`ghp_***`), `privateKey` masks a PEM private key block after its header, and `urlPassword` masks the password in a URL (`postgres://app:***@db`). They are off by default, so `redact: true` logs what it did before. `builtins` runs only the names it lists, so add them next to the defaults:

```ts
redact: {
  builtins: ['creditCard', 'email', 'ipv4', 'phone', 'jwt', 'bearer', 'iban', 'secrets', 'apiKeys', 'privateKey', 'urlPassword'],
}
```
