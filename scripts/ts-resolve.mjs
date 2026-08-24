/**
 * Lets `node` run the project's TypeScript sources directly, for `npm test`.
 *
 * Node strips the types by itself; what it does not do is guess file
 * extensions, and the source is written the way Vite resolves it -- without
 * them. This adds the ".ts" back for relative imports that would otherwise not
 * resolve, and nothing else: no transpiling, no path aliases, no config.
 */
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(candidate)) return next(candidate.href, context)
    }
    return next(specifier, context)
  },
})
