const fs = require('fs');
const path = require('path');

const sourceDir = path.resolve(__dirname, '..');
const deployDir = path.join(sourceDir, 'dist');

// 배포에 필요한 파일 목록
const filesToCopy = [
  'manifest.json',
  'background.js',
  'content.js',
  'minimap.js',
  'popup.html',
  'popup.js',
  'styles.css',
  'pages-list.html',
  'pages-list.js',
  'constants.js'
];

const directoriesToCopy = [
  '_locales',
  'images'
];

// 이전 배포 디렉토리 삭제
if (fs.existsSync(deployDir)) {
  fs.rmSync(deployDir, { recursive: true, force: true });
}

// 배포 디렉토리 생성
fs.mkdirSync(deployDir);

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

// 파일 복사
for (const file of filesToCopy) {
  const src = path.join(sourceDir, file);
  const dest = path.join(deployDir, file);
  if (fs.existsSync(src)) {
    copyFile(src, dest);
  } else {
    console.warn(`Warning: ${file} not found`);
  }
}

// 디렉토리 복사
for (const dir of directoriesToCopy) {
  const src = path.join(sourceDir, dir);
  const dest = path.join(deployDir, dir);
  if (fs.existsSync(src)) {
    copyDir(src, dest);
  } else {
    console.warn(`Warning: ${dir} directory not found`);
  }
}

console.log(`\nDeploy completed to: ${path.relative(sourceDir, deployDir)}`);
console.log('You can now load the extension from the "dist" directory in Chrome');
