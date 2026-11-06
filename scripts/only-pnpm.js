#!/usr/bin/env node
'use strict';

// The preinstall guard. Not `npx only-allow pnpm`: that fetches
// only-allow@latest through npm on every cold install, outside pnpm's
// minimumReleaseAge and trustPolicy. Same check, nothing to fetch: package
// managers name themselves first in npm_config_user_agent.
const agent = process.env.npm_config_user_agent;
const name = agent && agent.split(' ')[0].split('/')[0];

if (name && name !== 'pnpm') {
  console.error(`This project installs with pnpm, not ${name}. See https://pnpm.io/installation.`);
  process.exit(1);
}
