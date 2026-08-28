#!/usr/bin/env node
// Links .claude/skills -> .agents/skills so Claude Code can discover the
// repository's skills without keeping a second copy of them.
// .agents/skills is the tracked source of truth; .claude/ is gitignored.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, '.agents', 'skills');
const link = path.join(root, '.claude', 'skills');

// Windows junctions store an absolute target, so moving or renaming the clone
// leaves a dangling entry behind. Probe with lstat rather than existsSync,
// which follows the link and reports a dangling one as missing.
function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function realpathOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function removeLink(target) {
  try {
    fs.unlinkSync(target);
  } catch (err) {
    // Windows reports directory reparse points as EPERM/EISDIR for unlink.
    if (err.code !== 'EPERM' && err.code !== 'EISDIR') throw err;
    fs.rmdirSync(target);
  }
}

if (!fs.existsSync(source)) {
  console.error(`Source not found: ${source}`);
  process.exit(1);
}

const existing = lstatOrNull(link);
if (existing && !existing.isSymbolicLink()) {
  console.error('.claude/skills exists as a real directory. Move its contents into .agents/skills and remove it first.');
  process.exit(1);
}

if (existing) {
  const current = realpathOrNull(link);
  if (current && current === fs.realpathSync(source)) {
    console.log('Already linked: .claude/skills -> .agents/skills');
    process.exit(0);
  }
  // Dangling, or pointing somewhere else: replace it.
  removeLink(link);
}

fs.mkdirSync(path.dirname(link), { recursive: true });
// 'junction' works on Windows without elevation and is ignored elsewhere.
fs.symlinkSync(source, link, process.platform === 'win32' ? 'junction' : 'dir');
console.log('Linked: .claude/skills -> .agents/skills');
