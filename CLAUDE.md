# GradescopeToCalc Development Guide

## Build & Development Commands
- `npm install` - Install dependencies
- `npx tailwindcss -i ./src/input.css -o ./src/output.css --watch` - Build and watch TailwindCSS
- `npm run test` - Run tests (not configured yet)
- To test the extension, load it as an unpacked extension in Chrome from chrome://extensions

## Code Style Guidelines
- **File Structure**: Content scripts in `scripts/`, styles in `src/`
- **JavaScript**: Use CommonJS modules, modern ES6+ features
- **Formatting**: 2-space indentation, semicolons required
- **Naming**: camelCase for variables/functions, descriptive names
- **Error Handling**: Use try/catch blocks with appropriate error messages
- **DOM Manipulation**: Use querySelector/querySelectorAll for element selection
- **Chrome API**: Always check for API availability before use
- **Console**: Use console.log for debugging, remove before production

## Extension Development
- Extension manifest follows Chrome's v3 specification
- Update version in manifest.json when making significant changes
- Test on gradescope.com domains before submitting changes