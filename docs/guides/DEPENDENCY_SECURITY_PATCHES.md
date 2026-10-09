# Temporary dependency security patches

The frontend and mobile app apply committed patches with `patch-package` during
`npm install` / `npm ci`. Installation fails if a patch cannot be applied. The
frontend Docker dependency stage copies the patches before installing packages.
Do not use `--ignore-scripts` for production or CI installs: it skips these fixes.

- **braces 3.0.3 — GHSA-vfj7-8cjw-p6xm:** cap parser and AST walker nesting at
  100 levels, including parentheses and caller-supplied ASTs. Deeply nested
  patterns fail with a controlled `SyntaxError` instead of exhausting the stack.
  Applies to both apps. See [upstream issue](https://github.com/micromatch/braces/issues/70).
- **node-forge 1.4.0 — GHSA-86w9-cpqp-85rv:** validate the nested DigestAlgorithm
  child count when verifying RSA PKCS#1 v1.5 signatures. Applies to the mobile
  app's Expo tooling. The fix follows the reviewed code change in
  [upstream PR #1152](https://github.com/digitalbazaar/forge/pull/1152).
- **query-string 7.1.3 compatibility:** accept the default export of the fixed
  `decode-uri-component` 0.5 release. This preserves query parsing in the Expo
  dependency tree while upgrading the vulnerable decoder; the test suite also
  checks Unicode query strings and Metro image decoding after dependency updates.
- **Metro 0.83.3 / Expo's Metro 0.83.7 compatibility:** read asset files into
  buffers before passing them to the fixed `image-size` 2.x API, which no longer
  accepts filesystem paths. Tests cover both buffer dimensions and file-based
  asset metadata in both Metro copies.

The first two packages currently lack a fixed npm release. Their original versions and
registry integrity hashes remain in the lockfiles, so version-based scanners
continue to report the advisories. These alerts must remain open until an
upstream fixed release replaces the patches; do not dismiss them as false positives.

Regression tests cover deep patterns, direct AST inputs, valid glob behavior,
and rejection of malformed RSA DigestInfo with extra nested children. Run the
normal frontend and mobile test commands after installing dependencies.
