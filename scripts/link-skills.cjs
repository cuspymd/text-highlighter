#!/usr/bin/env node
// Links .claude/skills -> .agents/skills so Claude Code can discover the
// repository's skills without keeping a second copy of them.
// .agents/skills is the tracked source of truth; .claude/ is gitignored.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, '.agents', 'skills');
const link = path.join(root, '.claude', 'skills');

if (!fs.existsSync(source)) {
  console.error(`Source not found: ${source}`);
  process.exit(1);
}

const existing = fs.existsSync(link) && fs.lstatSync(link);
if (existing && existing.isSymbolicLink()) {
  if (path.resolve(fs.realpathSync(link)) === path.resolve(source)) {
    console.log('Already linked: .claude/skills -> .agents/skills');
    process.exit(0);
  }
  fs.unlinkSync(link);
} else if (existing) {
  console.error('.claude/skills exists as a real directory. Move its contents into .agents/skills and remove it first.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(link), { recursive: true });
// 'junction' works on Windows without elevation and is ignored elsewhere.
fs.symlinkSync(source, link, process.platform === 'win32' ? 'junction' : 'dir');
console.log('Linked: .claude/skills -> .agents/skills');
