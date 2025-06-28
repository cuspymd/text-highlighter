const fs = require('fs');
const path = require('path');

const sourceDir = path.resolve(__dirname, '..');
const deployDir = path.join(sourceDir, 'dist');
const firefoxDeployDir = path.join(sourceDir, 'dist-firefox');

// Get target browser from command line args
const targetBrowser = process.argv[2] || 'chrome';

// 배포에 필요한 파일 목록
const filesToCopy = [
  'background.js',
  'content.js',
  'minimap.js',
  'popup.html',
  'popup.js',
  'styles.css',
  'pages-list.html',
  'pages-list.js',
  'constants.js',
  'controls.js'
];

// Manifest file selection based on target browser
const manifestFile = targetBrowser === 'firefox' ? 'manifest-firefox.json' : 'manifest.json';

const directoriesToCopy = [
  '_locales',
  'images'
];

// Select deployment directory based on target browser
const currentDeployDir = targetBrowser === 'firefox' ? firefoxDeployDir : deployDir;

// 이전 배포 디렉토리 삭제
if (fs.existsSync(currentDeployDir)) {
  fs.rmSync(currentDeployDir, { recursive: true, force: true });
}

// 배포 디렉토리 생성
fs.mkdirSync(currentDeployDir);

// 파일 복사 함수
function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
  console.log(`Copied: ${path.relative(sourceDir, dest)}`);
}

// 디렉토리 복사 함수
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

// Copy manifest file
const manifestSrc = path.join(sourceDir, manifestFile);
const manifestDest = path.join(currentDeployDir, 'manifest.json');
if (fs.existsSync(manifestSrc)) {
  copyFile(manifestSrc, manifestDest);
} else {
  console.warn(`Warning: ${manifestFile} not found`);
}

// 파일 복사
for (const file of filesToCopy) {
  const src = path.join(sourceDir, file);
  const dest = path.join(currentDeployDir, file);
  if (fs.existsSync(src)) {
    copyFile(src, dest);
  } else {
    console.warn(`Warning: ${file} not found`);
  }
}

// 디렉토리 복사
for (const dir of directoriesToCopy) {
  const src = path.join(sourceDir, dir);
  const dest = path.join(currentDeployDir, dir);
  if (fs.existsSync(src)) {
    copyDir(src, dest);
  } else {
    console.warn(`Warning: ${dir} directory not found`);
  }
}

console.log(`\nDeploy completed to: ${path.relative(sourceDir, currentDeployDir)}`);
if (targetBrowser === 'firefox') {
  console.log('You can now load the extension from the "dist-firefox" directory in Firefox');
  console.log('Go to about:debugging -> This Firefox -> Load Temporary Add-on');
} else {
  console.log('You can now load the extension from the "dist" directory in Chrome');
  console.log('Go to chrome://extensions -> Enable Developer mode -> Load unpacked');
}
