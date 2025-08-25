# Setup Guide - Gradescope to Google Calendar Extension

## Prerequisites

### 1. Google Cloud Console Setup

1. **Create a Google Cloud Project**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Click "New Project" and give it a name (e.g., "Gradescope Calendar Sync")
   - Note your Project ID

2. **Enable Google Calendar API**:
   - In your project, go to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click on it and press "Enable"

3. **Create OAuth 2.0 Credentials**:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Select "Chrome Extension" as application type
   - Add your extension ID (you'll get this after loading the extension)
   - Download the credentials JSON file

4. **Configure OAuth Consent Screen**:
   - Go to "APIs & Services" > "OAuth consent screen"
   - Choose "External" user type
   - Fill in required fields:
     - App name: "Gradescope to Calendar"
     - User support email: Your email
     - Developer contact: Your email
   - Add scopes:
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/calendar.events`

### 2. Extension Configuration

1. **Update manifest.json**:
   - Replace `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID from step 3 above

2. **Get Extension ID**:
   - Load the extension in Chrome (chrome://extensions/)
   - Enable "Developer mode"
   - Click "Load unpacked" and select this directory
   - Note the Extension ID that appears
   - Go back to Google Cloud Console and add this Extension ID to your OAuth credentials

## Installation Steps

### 1. Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the folder containing this extension
5. The extension should now appear in your toolbar

### 2. First Time Setup

1. **Authenticate with Google**:
   - Click the extension icon
   - Click "Connect Google Calendar"
   - Sign in with your Google account
   - Grant calendar permissions

2. **Test on Gradescope**:
   - Navigate to a Gradescope course page (e.g., `https://www.gradescope.com/courses/123456`)
   - Click the extension icon
   - You should see detected assignments
   - Click "Sync to Calendar" to create calendar events

### 3. Configuration Options

- **Auto-sync**: Enable to automatically sync assignments when you visit Gradescope
- **Sync Interval**: Set how often to check for updates
- **Manual Sync**: Click "Sync to Calendar" anytime to update

## Testing with Sample Files

The extension includes test HTML files in the `testingSites/` directory:

1. **Test Parser Logic**:
   - Open `testingSites/MATH 303_ 02 (12pm) Dashboard _ Gradescope.html` in Chrome
   - Open browser console (F12)
   - Load and run `test-parser.js` to verify parsing works correctly

2. **Expected Results**:
   - Course: "MATH 303"
   - Assignment 1: "HW 01b: Introduction" (Due: Aug 29, 2025 at 5:00 PM)
   - Assignment 2: "HW 01a: Gradescope Trial" (Due: Aug 27, 2025 at 12:00 PM)

## Troubleshooting

### Common Issues

1. **"Client ID not found" Error**:
   - Verify the Client ID in `manifest.json` is correct
   - Make sure the Extension ID is added to Google Cloud Console

2. **"Access denied" Error**:
   - Check OAuth consent screen is configured
   - Verify calendar scopes are added
   - Try removing and re-adding permissions

3. **No assignments detected**:
   - Make sure you're on a Gradescope course dashboard page
   - Check browser console for JavaScript errors
   - Refresh the page and try again

4. **Calendar events not created**:
   - Verify Google Calendar API is enabled
   - Check that you have write permissions to your calendar
   - Look for error messages in the extension popup

### Debug Mode

1. **Enable Extension Debugging**:
   - Go to `chrome://extensions/`
   - Click "Details" on the extension
   - Click "Inspect views: service worker" to see background script logs
   - Click "Inspect views: popup.html" to debug the popup

2. **Check Console Logs**:
   - Content script logs appear in the page console (F12)
   - Background script logs appear in the service worker inspector
   - Popup logs appear in the popup inspector

## File Structure

```
gradescope-to-calendar/
├── manifest.json          # Extension configuration
├── content.js            # Parses Gradescope assignments
├── background.js         # Handles Google Calendar API
├── popup.html           # Extension popup interface
├── popup.css            # Popup styling
├── popup.js             # Popup functionality
├── icons/               # Extension icons (add your own)
├── testingSites/        # Sample HTML files for testing
├── test-parser.js       # Testing script
├── README.md           # Main documentation
├── SETUP.md            # This setup guide
└── .gitignore          # Git ignore file
```

## Security Notes

- The extension only accesses Gradescope when you navigate to course pages
- Authentication tokens are stored securely using Chrome's identity API
- No personal data is transmitted outside of Google's services
- All API calls use HTTPS encryption

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Verify your Google Cloud Console setup
3. Test with the provided sample HTML files
4. Check browser and extension console logs for errors

For additional help, create an issue in the project repository with:
- Error messages from console logs
- Steps to reproduce the problem
- Your Chrome version and operating system
