#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 버전 인수 확인
const version = process.argv[2];
if (!version) {
  console.error('Error: Version argument is required');
  console.log('Usage: node scripts/version-deploy.js <version>');
  console.log('Example: node scripts/version-deploy.js 1.1.0');
  process.exit(1);
}

const sourceDir = path.resolve(__dirname, '..');
const manifestPath = path.join(sourceDir, 'manifest.json');
const outputsDir = path.join(sourceDir, 'outputs');
const zipFileName = `text-highlighter-${version}.zip`;

console.log(`Starting version deploy for version: ${version}`);

// 1. manifest.json 버전 업데이트
console.log('\n1. Updating manifest.json version...');
try {
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);
  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`✓ Updated manifest.json version to ${version}`);
} catch (error) {
  console.error('Error updating manifest.json:', error.message);
  process.exit(1);
}

// 2. DEBUG_MODE를 false로 변경
console.log('\n2. Setting DEBUG_MODE to false in JS files...');
const jsFiles = [
  'background.js',
  'content.js',
  'popup.js',
  'pages-list.js'
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
  execSync('node scripts/deploy.js', { 
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
const distDir = path.join(sourceDir, 'dist');
const zipPath = path.join(outputsDir, zipFileName);

if (!fs.existsSync(distDir)) {
  console.error('Error: dist directory not found');
  process.exit(1);
}

try {
  // outputs 디렉토리 생성
  if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir);
    console.log('✓ Created outputs directory');
  }
  
  // 기존 zip 파일이 있으면 삭제
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  
  // zip 명령어 실행
  execSync(`cd "${distDir}" && zip -r "../outputs/${zipFileName}" .`, { 
    stdio: 'inherit' 
  });
  
  console.log(`✓ Created outputs/${zipFileName}`);
} catch (error) {
  console.error('Error creating zip file:', error.message);
  console.log('Note: Make sure zip command is available on your system');
  process.exit(1);
}

console.log(`\n🎉 Version deploy completed successfully!`);
console.log(`📦 Extension package: outputs/${zipFileName}`);
console.log(`📁 Development files: dist/`);