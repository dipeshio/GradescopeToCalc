# Troubleshooting Guide - Gradescope to Google Calendar Extension

## Common Error Messages and Solutions

### 1. "Authentication check failed" or "Connection failed"

**Symptoms:**
- Extension shows "Authentication check failed" when opened
- "Connect Google Calendar" button does nothing
- Console errors about message passing

**Causes & Solutions:**

#### A) **Missing or Invalid OAuth Client ID**
- **Error**: `invalid_client` or similar OAuth errors
- **Solution**: 
  1. Open `manifest.json`
  2. Replace `REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID from Google Cloud Console
  3. Reload the extension in Chrome

#### B) **Google Cloud Console Not Set Up**
- **Error**: Various OAuth-related errors
- **Solution**: Follow the complete setup in `SETUP.md`:
  1. Create Google Cloud Project
  2. Enable Google Calendar API
  3. Create OAuth 2.0 credentials
  4. Configure OAuth consent screen

#### C) **Extension ID Not Added to OAuth Credentials**
- **Error**: `redirect_uri_mismatch` or similar
- **Solution**:
  1. Load extension in Chrome and note the Extension ID
  2. Go to Google Cloud Console > Credentials
  3. Edit your OAuth client
  4. Add the Extension ID to authorized origins

### 2. "Could not establish connection. Receiving end does not exist."

**Symptoms:**
- Console error about connection not established
- Popup can't communicate with background script

**Causes & Solutions:**

#### A) **Background Script Not Loading**
- **Check**: Go to `chrome://extensions/` → Click "Details" on your extension → Click "Inspect views: service worker"
- **Solution**: Look for JavaScript errors in the service worker console

#### B) **Manifest Permissions Issues**
- **Check**: Verify `manifest.json` has all required permissions
- **Solution**: Ensure these permissions are present:
  ```json
  "permissions": [
    "activeTab",
    "storage", 
    "identity",
    "https://www.googleapis.com/*"
  ]
  ```

### 3. Content Script Issues

**Symptoms:**
- Extension doesn't detect assignments on Gradescope pages
- "No assignments found" even when on correct page

**Causes & Solutions:**

#### A) **Wrong Page URL**
- **Check**: Make sure you're on a Gradescope course dashboard (e.g., `https://www.gradescope.com/courses/123456`)
- **Not**: Assignment submission pages or other Gradescope pages

#### B) **Content Script Not Injected**
- **Check**: Open browser console (F12) on Gradescope page and look for extension messages
- **Solution**: Reload the page and check if content script loads

#### C) **Page Structure Changed**
- **Check**: Gradescope may have updated their HTML structure
- **Solution**: Check if assignments table exists with ID `assignments-student-table`

## Step-by-Step Debugging

### Step 1: Check Extension Loading
1. Go to `chrome://extensions/`
2. Find "Gradescope to Google Calendar"
3. Check for any error messages in red
4. Click "Details" → "Inspect views: service worker"
5. Look for errors in the console

### Step 2: Check OAuth Configuration
1. Open `manifest.json`
2. Verify `client_id` is not the placeholder text
3. Go to Google Cloud Console
4. Check OAuth 2.0 client configuration
5. Verify Extension ID is added

### Step 3: Test Message Passing
1. Open extension popup
2. Open browser console (F12)
3. Click "Connect Google Calendar"
4. Check for detailed error messages

### Step 4: Test on Gradescope
1. Navigate to a Gradescope course page
2. Open extension popup
3. Check if assignments are detected
4. Open page console (F12) to see content script logs

## Quick Fixes

### Fix 1: Reset Extension
1. Go to `chrome://extensions/`
2. Click "Remove" on the extension
3. Reload the extension from the folder
4. Try authentication again

### Fix 2: Clear Extension Data
```javascript
// Run in extension popup console
chrome.storage.local.clear(() => {
  console.log('Extension data cleared');
});
```

### Fix 3: Manual Token Refresh
1. Go to `chrome://settings/content/cookies`
2. Search for "accounts.google.com"
3. Remove cookies
4. Try authentication again

## Getting Help

### Information to Include
When reporting issues, please include:

1. **Chrome Version**: `chrome://version/`
2. **Extension Version**: Check `manifest.json`
3. **Error Messages**: From all consoles (popup, background, page)
4. **Steps Taken**: What you were trying to do
5. **OAuth Setup**: Whether Google Cloud Console is configured

### Console Locations
- **Popup Console**: Right-click extension popup → "Inspect"
- **Background Console**: `chrome://extensions/` → Extension details → "Inspect views: service worker"
- **Page Console**: F12 on Gradescope page

### Test with Sample Data
Use the test files in `testingSites/` folder:
1. Open `MATH 303_ 02 (12pm) Dashboard _ Gradescope.html`
2. Run `test-parser.js` in console
3. Verify parsing works correctly

## Error Code Reference

| Error | Meaning | Solution |
|-------|---------|----------|
| `invalid_client` | Wrong OAuth client ID | Update manifest.json |
| `redirect_uri_mismatch` | Extension ID not registered | Add Extension ID to OAuth config |
| `access_denied` | User denied permissions | Re-authenticate and grant permissions |
| `Could not establish connection` | Message passing failed | Check background script loading |
| `Cannot read properties of undefined` | Response object missing | Check message handling in code |

## Still Having Issues?

If none of these solutions work:

1. **Check Google Cloud Console Quotas**: Ensure Calendar API isn't rate limited
2. **Try Incognito Mode**: Test if extensions work in incognito
3. **Check Network**: Ensure no corporate firewall blocks Google APIs
4. **Browser Restart**: Sometimes Chrome needs a full restart
5. **Extension Reload**: Remove and re-add the extension

Remember: The most common issue is incomplete Google Cloud Console setup. Make sure to follow every step in the `SETUP.md` guide!
