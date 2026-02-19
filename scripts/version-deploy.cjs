#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

// 버전 및 브라우저 인수 확인
const version = process.argv[2];
const browser = process.argv[3] || 'chrome';

if (!version) {
  console.error('Error: Version argument is required');
  console.log('Usage: node scripts/version-deploy.js <version> [browser]');
  console.log('Example: node scripts/version-deploy.js 1.1.0 chrome');
  console.log('Example: node scripts/version-deploy.js 1.1.0 firefox');
  process.exit(1);
}

if (!['chrome', 'firefox'].includes(browser)) {
  console.error('Error: Browser must be either "chrome" or "firefox"');
  process.exit(1);
}

const sourceDir = path.resolve(__dirname, '..');
const manifestFile = browser === 'firefox' ? 'manifest-firefox.json' : 'manifest.json';
const manifestPath = path.join(sourceDir, manifestFile);
const outputsDir = path.join(sourceDir, 'outputs');
const zipFileName = `text-highlighter-${version}-${browser}.zip`;

console.log(`Starting version deploy for version: ${version} (${browser})`);

// 1. manifest 파일 버전 업데이트
console.log(`\n1. Updating ${manifestFile} version...`);
try {
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);
  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`✓ Updated ${manifestFile} version to ${version}`);
} catch (error) {
  console.error(`Error updating ${manifestFile}:`, error.message);
  process.exit(1);
}

// 2. DEBUG_MODE를 false로 변경
console.log('\n2. Setting DEBUG_MODE to false in JS files...');
const jsFiles = [
  'shared/logger.js',  // background.js, popup.js, pages-list.js의 DEBUG_MODE 단일 소스
  'content-scripts/minimap.js',        // content script 인라인 복사본
];

for (const file of jsFiles) {
  const filePath = path.join(sourceDir, file);
  if (fs.existsSync(filePath)) {
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      const originalContent = content;

      // DEBUG_MODE = true를 DEBUG_MODE = false로 변경
      content = content.replace(/const DEBUG_MODE = true/g, 'const DEBUG_MODE = false');

      if (content !== originalContent) {
        fs.writeFileSync(filePath, content);
        console.log(`✓ Updated DEBUG_MODE in ${file}`);
      } else {
        console.log(`- No DEBUG_MODE changes needed in ${file}`);
      }
    } catch (error) {
      console.error(`Error updating ${file}:`, error.message);
      process.exit(1);
    }
  }
}

// 3. deploy.js 실행
console.log('\n3. Running deploy script...');
try {
  execSync(`node scripts/deploy.cjs ${browser}`, {
    cwd: sourceDir,
    stdio: 'inherit'
  });
  console.log('✓ Deploy script completed');
} catch (error) {
  console.error('Error running deploy script:', error.message);
  process.exit(1);
}

// 4. outputs 디렉토리 생성 및 zip 파일 생성
console.log('\n4. Creating outputs directory and zip file...');
const distDir = browser === 'firefox' ? path.join(sourceDir, 'dist-firefox') : path.join(sourceDir, 'dist');
const zipPath = path.join(outputsDir, zipFileName);

if (!fs.existsSync(distDir)) {
  console.error(`Error: ${browser === 'firefox' ? 'dist-firefox' : 'dist'} directory not found`);
  process.exit(1);
}

// outputs 디렉토리 생성
if (!fs.existsSync(outputsDir)) {
  fs.mkdirSync(outputsDir);
  console.log('✓ Created outputs directory');
}

// 기존 zip 파일이 있으면 삭제
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// archiver를 사용하여 zip 파일 생성
const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`✓ Created outputs/${zipFileName} (${archive.pointer()} bytes)`);
  console.log(`\n🎉 Version deploy completed successfully!`);
  console.log(`📦 Extension package: outputs/${zipFileName}`);
  console.log(`📁 Development files: ${browser === 'firefox' ? 'dist-firefox/' : 'dist/'}`);
});

archive.on('error', (err) => {
  console.error('Error creating zip file:', err.message);
  process.exit(1);
});

archive.pipe(output);
archive.directory(distDir, false);
archive.finalize();
