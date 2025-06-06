# Text Highlighter

A Chrome extension that allows you to highlight and manage text on web pages.

## Features

- Text Highlighting: Select and highlight text on web pages with multiple colors
- Highlight Management: Manage and review highlighted text per page
- Minimap: View highlighted positions at a glance with a minimap on the right side of the page
- Multilingual Support: Available in English and Korean
- Keyboard Shortcuts: Quick highlighting with customizable keyboard shortcuts

## Getting Started

### Prerequisites

- Node.js 22.16.0 or higher
- npm 10.9.0 or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/text-highlighter.git
cd text-highlighter

# Install dependencies
npm install
```

## Development

### Testing

Run E2E tests using Playwright:

```bash
npx playwright test
```

### Deployment

Run the deployment script to copy only the required files to the dist directory for loading into Chrome:

```bash
npm run deploy
```

To load the deployed extension in Chrome:

1. Open `chrome://extensions` in Chrome browser
2. Enable "Developer mode" in the top right
3. Click "Load unpacked extension"
4. Select the generated `dist` directory

## Contribution

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
