/**
 * `createAppVuetify()` registers an explicit component list (#97). A `<v-*>`
 * tag missing from it renders as an inert element with no warning in a
 * production build, so this scans src for Vuetify tags and directives and
 * checks the registered list matches exactly.
 */
import fs from 'fs';
import path from 'path';
import { createApp } from 'vue';
import * as allComponents from 'vuetify/components';
import * as allDirectives from 'vuetify/directives';
import { createAppVuetify } from '@/options_page/vuetify';

const SRC = path.resolve(__dirname, '../../src');

const kebabCase = pascal => pascal.replace(/\B([A-Z])/g, '-$1').toLowerCase();

// src/statics holds vendored third-party libraries, not templates.
const sources = fs.readdirSync(SRC, { recursive: true })
  .filter(file => /\.(vue|js)$/.test(file) && !file.startsWith(`statics${path.sep}`))
  .map(file => fs.readFileSync(path.join(SRC, file), 'utf8'));

const usedTags = new Set(
  sources.flatMap(src => [...src.matchAll(/<(v-[a-z-]+|V[A-Z][A-Za-z]*)/g)].map(m => kebabCase(m[1])))
);

test('registers exactly the Vuetify components that src uses', () => {
  const app = createApp({}).use(createAppVuetify());
  const registeredTags = Object.keys(allComponents).filter(name => app.component(name)).map(kebabCase);

  expect(usedTags.size).toBeGreaterThan(0);
  expect(registeredTags.sort()).toEqual([...usedTags].sort());
});

test('no template uses a Vuetify directive, since none are registered', () => {
  const names = Object.keys(allDirectives).map(kebabCase);
  const pattern = new RegExp(`\\sv-(${names.join('|')})(?=[\\s=.:/>])`);

  expect(sources.filter(src => pattern.test(src))).toEqual([]);
});
