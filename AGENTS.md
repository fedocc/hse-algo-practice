# Algo Practice — shared distribution

This repository is a local Python algorithms trainer. Start by reading README.md and GPT_INSTALL.md. No cloud deployment or paid AI API is required.

The committed catalog is a clean seed: 285 problems, zero solved/previously_solved/assisted. Never copy another person's data/state.json or browser settings into a fresh installation. On an existing installation, preserve the user's data/state.json, notes, drafts and progress. It is ignored by Git. Never reset an existing user unless they explicitly ask.

Run the app with Python3.11+; Monaco is already bundled. Node/npm are optional for development tests, not normal use. Do not install dependencies unless required and authorized. Use only127.0.0.1, never expose the execution server on a public network. This runs the learner's Python code on their own machine; it is not a hardened multi-user judge.

Run checks appropriate to changes. Backend: python3 -m unittest discover -s tests -v. Frontend: node tests/frontend-state-tests.mjs, node tests/frontend-result-tests.mjs, node tests/bridge-refresh-tests.mjs, node --check static/app.js. Extension: node extension/tests.mjs, node extension/tests-tabs.mjs, node extension/tests-worker.mjs, node extension/tests-submit.mjs.

Local Run's Accepted means the configured examples passed. LOCAL means the prepared local pack passed and uses manual progress credit. Official Accepted is recorded only from the browser bridge's new submission receipt. Do not make real official submissions while testing installation. Start extension verification in its default dry-run mode. Future user Submit authorizes one corresponding submission. Do not force Python into C++-only or closed contest forms.

Browser pairing is local and installation-specific: the user loads extension/, then runs bind_extension.py with their own extension ID. Never ship another installation's bridge-extension.json, cookies, credentials, browser profile or extension storage. Do not broaden permissions casually.

Third-party task statements, illustrations, Monaco and published test cases retain their source attribution. See THIRD_PARTY.md. Do not bundle private textbooks or claim a license to third-party course material.
