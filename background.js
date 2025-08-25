// Background service worker for Gradescope to Google Calendar extension

class CalendarManager {
  constructor() {
    this.accessToken = null;
    this.calendarId = 'primary'; // Use primary calendar
    this.syncedAssignments = new Map(); // Track synced assignments
    this.clientId = null;
  }

  // Set the client ID for OAuth
  setClientId(clientId) {
    this.clientId = clientId;
    console.log('Client ID set for authentication');
  }

  // Authenticate with Google Calendar API
  async authenticate() {
    if (!this.clientId) {
      throw new Error('Client ID not configured. Please set up OAuth configuration first.');
    }

    return new Promise((resolve, reject) => {
      if (!chrome.identity) {
        reject(new Error('Chrome identity API not available. Make sure the extension has proper permissions.'));
        return;
      }

      // Use launchWebAuthFlow for dynamic OAuth with custom client ID
      const authUrl = this.buildAuthUrl();
      
      chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
      }, (responseUrl) => {
        if (chrome.runtime.lastError) {
          console.error('Authentication failed:', chrome.runtime.lastError);
          let errorMessage = chrome.runtime.lastError.message;
          
          // Provide more helpful error messages
          if (errorMessage.includes('OAuth2 not granted or revoked')) {
            errorMessage = 'Google Calendar access was denied. Please try again and grant permissions.';
          } else if (errorMessage.includes('invalid_client')) {
            errorMessage = 'Invalid OAuth client configuration. Check your Client ID.';
          } else if (errorMessage.includes('redirect_uri_mismatch')) {
            errorMessage = 'OAuth redirect URI mismatch. Make sure to add your Extension ID to Google Cloud Console.';
          }
          
          reject(new Error(errorMessage));
          return;
        }
        
        if (!responseUrl) {
          reject(new Error('No authentication response received'));
          return;
        }

        // Extract access token from response URL
        try {
          const token = this.extractTokenFromUrl(responseUrl);
          if (!token) {
            throw new Error('No access token found in response');
          }
          
          this.accessToken = token;
          console.log('Successfully authenticated with Google Calendar');
          resolve(token);
        } catch (error) {
          reject(new Error('Failed to extract access token: ' + error.message));
        }
      });
    });
  }

  // Build OAuth authorization URL
  buildAuthUrl() {
    const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
    console.log('OAuth Redirect URI:', redirectUri);
    console.log('Extension ID:', chrome.runtime.id);
    
    const baseUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'token',
      redirect_uri: redirectUri,
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
      access_type: 'online'
    });
    
    return `${baseUrl}?${params.toString()}`;
  }

  // Extract access token from OAuth response URL
  extractTokenFromUrl(url) {
    const urlObj = new URL(url);
    const fragment = urlObj.hash.substring(1);
    const params = new URLSearchParams(fragment);
    return params.get('access_token');
  }

  // Create or update a calendar event
  async createOrUpdateEvent(assignment) {
    if (!this.accessToken) {
      await this.authenticate();
    }

    const eventId = this.generateEventId(assignment);
    const existingEvent = await this.getEvent(eventId);

    if (existingEvent) {
      return await this.updateEvent(eventId, assignment);
    } else {
      return await this.createEvent(assignment);
    }
  }

  // Create a new calendar event
  async createEvent(assignment) {
    const event = this.buildEventObject(assignment);
    
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event)
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to create event: ${response.statusText}`);
    }

    const createdEvent = await response.json();
    
    // Store the mapping between assignment and event
    this.syncedAssignments.set(assignment.id, {
      eventId: createdEvent.id,
      lastStatus: assignment.statusAbbr,
      lastSync: new Date().toISOString()
    });

    // Save to storage
    await this.saveSyncedAssignments();
    
    console.log('Created calendar event:', createdEvent);
    return createdEvent;
  }

  // Update an existing calendar event
  async updateEvent(eventId, assignment) {
    const event = this.buildEventObject(assignment);
    
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events/${eventId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event)
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to update event: ${response.statusText}`);
    }

    const updatedEvent = await response.json();
    
    // Update the stored mapping
    this.syncedAssignments.set(assignment.id, {
      eventId: updatedEvent.id,
      lastStatus: assignment.statusAbbr,
      lastSync: new Date().toISOString()
    });

    await this.saveSyncedAssignments();
    
    console.log('Updated calendar event:', updatedEvent);
    return updatedEvent;
  }

  // Get an existing event by ID
  async getEvent(eventId) {
    if (!eventId) return null;

    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${this.calendarId}/events/${eventId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          }
        }
      );

      if (response.status === 404) {
        return null; // Event doesn't exist
      }

      if (!response.ok) {
        throw new Error(`Failed to get event: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting event:', error);
      return null;
    }
  }

  // Build event object for Google Calendar API
  buildEventObject(assignment) {
    const title = assignment.fullTitle;
    const description = `Assignment from ${assignment.courseName}\n\nStatus: ${assignment.status}\n\nSynced from Gradescope`;
    
    // Set due date as end time, start time 1 hour before
    const dueDate = new Date(assignment.dueDate);
    const startDate = new Date(dueDate.getTime() - 60 * 60 * 1000); // 1 hour before

    return {
      summary: title,
      description: description,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      end: {
        dateTime: dueDate.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      colorId: this.getColorForStatus(assignment.statusAbbr),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 }, // 1 hour before
          { method: 'popup', minutes: 1440 } // 1 day before
        ]
      }
    };
  }

  // Get color ID based on assignment status
  getColorForStatus(status) {
    switch (status) {
      case 'SUBMITTED':
        return '10'; // Green
      case 'IP':
        return '5'; // Yellow/Orange
      default:
        return '1'; // Default blue
    }
  }

  // Generate consistent event ID from assignment
  generateEventId(assignment) {
    const syncData = this.syncedAssignments.get(assignment.id);
    return syncData ? syncData.eventId : null;
  }

  // Sync all assignments to calendar
  async syncAssignments(assignments) {
    const results = [];
    
    for (const assignment of assignments) {
      try {
        // Skip assignments without due dates
        if (!assignment.dueDate) {
          console.log(`Skipping assignment "${assignment.title}" - no due date`);
          continue;
        }

        const result = await this.createOrUpdateEvent(assignment);
        results.push({ assignment: assignment.title, success: true, event: result });
      } catch (error) {
        console.error(`Failed to sync assignment "${assignment.title}":`, error);
        results.push({ assignment: assignment.title, success: false, error: error.message });
      }
    }

    return results;
  }

  // Load synced assignments from storage
  async loadSyncedAssignments() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['syncedAssignments'], (result) => {
        if (result.syncedAssignments) {
          this.syncedAssignments = new Map(Object.entries(result.syncedAssignments));
        }
        resolve();
      });
    });
  }

  // Save synced assignments to storage
  async saveSyncedAssignments() {
    const data = Object.fromEntries(this.syncedAssignments);
    return new Promise((resolve) => {
      chrome.storage.local.set({ syncedAssignments: data }, resolve);
    });
  }

  // Check if assignment needs update
  needsUpdate(assignment) {
    const syncData = this.syncedAssignments.get(assignment.id);
    if (!syncData) return true; // New assignment
    
    return syncData.lastStatus !== assignment.statusAbbr; // Status changed
  }
}

// Initialize calendar manager
const calendarManager = new CalendarManager();

// Load stored data on startup
async function initializeExtension() {
  // Load synced assignments
  await calendarManager.loadSyncedAssignments();
  
  // Load stored client ID
  chrome.storage.local.get(['googleClientId'], (result) => {
    if (result.googleClientId) {
      calendarManager.setClientId(result.googleClientId);
      console.log('Loaded stored Client ID');
    }
  });
}

initializeExtension();

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.type);
  
  try {
    switch (request.type) {
      case 'ASSIGNMENTS_FOUND':
      case 'ASSIGNMENTS_UPDATED':
        handleAssignmentsData(request.data, sendResponse);
        return true; // Keep message channel open for async response

      case 'SYNC_TO_CALENDAR':
        syncToCalendar(request.assignments, sendResponse);
        return true;

      case 'GET_SYNC_STATUS':
        getSyncStatus(sendResponse);
        return true;

      case 'AUTHENTICATE':
        authenticateUser(sendResponse);
        return true;

      case 'SET_CLIENT_ID':
        setClientId(request.clientId, sendResponse);
        return true;

      default:
        console.warn('Unknown message type:', request.type);
        sendResponse({ success: false, error: 'Unknown message type' });
        return false;
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
    return false;
  }
});

// Handle assignments data from content script
async function handleAssignmentsData(data, sendResponse) {
  try {
    console.log('Received assignments data:', data);
    
    // Store the latest assignments data
    await new Promise((resolve) => {
      chrome.storage.local.set({ latestAssignments: data }, resolve);
    });

    // Check if auto-sync is enabled
    const settings = await new Promise((resolve) => {
      chrome.storage.local.get(['autoSync'], (result) => {
        resolve(result.autoSync || false);
      });
    });

    if (settings) {
      // Auto-sync assignments
      const results = await calendarManager.syncAssignments(data.assignments);
      console.log('Auto-sync results:', results);
    }

    sendResponse({ success: true });
  } catch (error) {
    console.error('Error handling assignments data:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Sync assignments to calendar
async function syncToCalendar(assignments, sendResponse) {
  try {
    const results = await calendarManager.syncAssignments(assignments);
    sendResponse({ success: true, results: results });
  } catch (error) {
    console.error('Error syncing to calendar:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Get sync status
async function getSyncStatus(sendResponse) {
  try {
    const syncedCount = calendarManager.syncedAssignments.size;
    const lastSync = await new Promise((resolve) => {
      chrome.storage.local.get(['lastSyncTime'], (result) => {
        resolve(result.lastSyncTime);
      });
    });

    const response = {
      success: true,
      syncedCount: syncedCount,
      lastSync: lastSync,
      isAuthenticated: !!calendarManager.accessToken
    };

    console.log('Sending sync status:', response);
    sendResponse(response);
  } catch (error) {
    console.error('Error getting sync status:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Authenticate user
async function authenticateUser(sendResponse) {
  try {
    console.log('Starting authentication...');
    const token = await calendarManager.authenticate();
    console.log('Authentication successful');
    sendResponse({ success: true, token: token });
  } catch (error) {
    console.error('Authentication error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Set client ID for OAuth
async function setClientId(clientId, sendResponse) {
  try {
    console.log('Setting client ID:', clientId);
    calendarManager.setClientId(clientId);
    
    // Store in extension storage as well
    await new Promise((resolve) => {
      chrome.storage.local.set({ googleClientId: clientId }, resolve);
    });
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error setting client ID:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Gradescope to Calendar extension installed');
  
  // Set default settings
  chrome.storage.local.set({
    autoSync: false,
    syncInterval: 60 // minutes
  });
});
