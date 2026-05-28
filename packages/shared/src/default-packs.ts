import type { LanguagePack } from './types/language-pack.js';
import typescriptPack from './packs/typescript.js';
import pythonPack from './packs/python.js';
import goPack from './packs/go.js';
import csharpPack from './packs/csharp.js';
import vbnetPack from './packs/vbnet.js';
import sqlPack from './packs/sql.js';
import rustPack from './packs/rust.js';
import javaPack from './packs/java.js';
import jsonPack from './packs/json.js';
import markdownPack from './packs/markdown.js';
import htmlPack from './packs/html.js';
import cssPack from './packs/css.js';
import yamlPack from './packs/yaml.js';

export const DEFAULT_PACKS: LanguagePack[] = [
  typescriptPack,
  pythonPack,
  goPack,
  csharpPack,
  vbnetPack,
  sqlPack,
  rustPack,
  javaPack,
  jsonPack,
  markdownPack,
  htmlPack,
  cssPack,
  yamlPack,
];
