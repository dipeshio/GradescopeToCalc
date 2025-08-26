// Background service worker for Gradescope to Google Calendar extension

class TaskManager {
  constructor() {
    this.accessToken = null;
    this.taskListId = '@default'; // Use default task list
    this.syncedAssignments = new Map(); // Track synced assignments
    this.clientId = null;
  }

  // Set the client ID for OAuth
  setClientId(clientId) {
    this.clientId = clientId;
    console.log('Client ID set for authentication');
  }

  // Load stored access token
  async loadStoredToken() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['googleAccessToken', 'tokenTimestamp'], (result) => {
        if (result.googleAccessToken && result.tokenTimestamp) {
          // Check if token is less than 1 hour old (tokens typically last 1 hour)
          const tokenAge = Date.now() - result.tokenTimestamp;
          const oneHour = 60 * 60 * 1000;
          
          if (tokenAge < oneHour) {
            this.accessToken = result.googleAccessToken;
            console.log('Loaded stored access token');
            resolve(true);
          } else {
            console.log('Stored token expired, need to re-authenticate');
            resolve(false);
          }
        } else {
          console.log('No stored token found');
          resolve(false);
        }
      });
    });
  }

  // Authenticate with Google Tasks API
  async authenticate() {
    if (!this.clientId) {
      throw new Error('Client ID not configured. Please set up OAuth configuration first.');
    }

    // Try to load stored token first
    const hasValidToken = await this.loadStoredToken();
    if (hasValidToken) {
      console.log('Using stored access token');
      return this.accessToken;
    }

    console.log('Starting new authentication with Client ID:', this.clientId);
    console.log('Required scopes: tasks');

    return new Promise((resolve, reject) => {
      if (!chrome.identity) {
        reject(new Error('Chrome identity API not available. Make sure the extension has proper permissions.'));
        return;
      }

      // Use launchWebAuthFlow for dynamic OAuth with custom client ID
      const authUrl = this.buildAuthUrl();
      console.log('Auth URL:', authUrl);
      
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
          console.log('Successfully authenticated with Google Tasks');
          
          // Store token persistently
          chrome.storage.local.set({ 
            googleAccessToken: token,
            tokenTimestamp: Date.now()
          });
          
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
      scope: 'https://www.googleapis.com/auth/tasks',
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

  // Create or update a task
  async createOrUpdateTask(assignment) {
    if (!this.accessToken) {
      await this.authenticate();
    }

    const taskId = this.generateTaskId(assignment);
    console.log(`Processing assignment: ${assignment.title} (ID: ${assignment.id})`);
    console.log(`Found stored task ID: ${taskId}`);
    
    if (taskId && taskId.trim() !== '') {
      // Validate task ID format (Google Tasks IDs are typically alphanumeric)
      if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
        console.warn(`Invalid task ID format: ${taskId}, creating new task`);
        this.clearTaskId(assignment.id);
        return await this.createTask(assignment);
      }
      
      // Try to get the existing task first
      console.log(`Checking if task ${taskId} exists...`);
      const existingTask = await this.getTask(taskId);
      if (existingTask) {
        console.log(`Updating existing task ${taskId} for assignment: ${assignment.title}`);
        try {
          return await this.updateTask(taskId, assignment);
        } catch (error) {
          console.log(`Failed to update task ${taskId}, error:`, error.message);
          console.log(`Creating new task for: ${assignment.title}`);
          // Clear the invalid task ID and create a new task
          this.clearTaskId(assignment.id);
          return await this.createTask(assignment);
        }
      } else {
        console.log(`Task ID ${taskId} found in storage but task doesn't exist, creating new task: ${assignment.title}`);
        // Task ID exists in our records but task was deleted, clear it and create new one
        this.clearTaskId(assignment.id);
        return await this.createTask(assignment);
      }
    } else {
      console.log(`No valid task ID found, creating new task: ${assignment.title}`);
      return await this.createTask(assignment);
    }
  }

  // Create a new task
  async createTask(assignment) {
    const task = this.buildTaskObject(assignment);
    
    const response = await fetch(
      `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(task)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Task creation failed:', response.status, response.statusText, errorText);
      
      // Handle authentication errors
      if (response.status === 401) {
        console.log('Access token expired, clearing stored token');
        chrome.storage.local.remove(['googleAccessToken', 'tokenTimestamp']);
        this.accessToken = null;
        throw new Error('Authentication expired. Please reconnect to Google Tasks.');
      }
      
      throw new Error(`Failed to create task: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const createdTask = await response.json();
    
    // Store the mapping between assignment and task
    this.syncedAssignments.set(assignment.id, {
      taskId: createdTask.id,
      lastStatus: assignment.statusAbbr,
      lastSync: new Date().toISOString()
    });

    // Save to storage
    await this.saveSyncedAssignments();
    
    console.log('Created task:', createdTask);
    console.log('Task due at:', task.due);
    return createdTask;
  }

  // Update an existing task
  async updateTask(taskId, assignment) {
    if (!taskId || taskId.trim() === '') {
      throw new Error('Valid Task ID is required for update');
    }
    
    // Validate task ID format
    if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
      throw new Error(`Invalid task ID format: ${taskId}`);
    }
    
    const task = this.buildTaskObject(assignment);
    
    console.log(`Updating task ${taskId} with data:`, JSON.stringify(task, null, 2));
    
    const response = await fetch(
      `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks/${taskId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(task)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Task update failed:', response.status, response.statusText, errorText);
      
      // Handle authentication errors
      if (response.status === 401) {
        console.log('Access token expired, clearing stored token');
        chrome.storage.local.remove(['googleAccessToken', 'tokenTimestamp']);
        this.accessToken = null;
        throw new Error('Authentication expired. Please reconnect to Google Tasks.');
      }
      
      throw new Error(`Failed to update task: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const updatedTask = await response.json();
    
    // Update the stored mapping
    this.syncedAssignments.set(assignment.id, {
      taskId: updatedTask.id,
      lastStatus: assignment.statusAbbr,
      lastSync: new Date().toISOString()
    });

    await this.saveSyncedAssignments();
    
    console.log('Updated task:', updatedTask);
    return updatedTask;
  }

  // Get an existing task by ID
  async getTask(taskId) {
    if (!taskId) return null;

    try {
      const response = await fetch(
        `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks/${taskId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          }
        }
      );

      if (response.status === 404) {
        console.log(`Task ${taskId} not found (404)`);
        return null; // Task doesn't exist
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to get task:', response.status, response.statusText, errorText);
        throw new Error(`Failed to get task: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting task:', error);
      return null;
    }
  }

  // Build task object for Google Tasks API
  buildTaskObject(assignment) {
    const title = assignment.fullTitle;
    
    // Format due date and time for Tasks API
    let due = null;
    let notes = `Assignment from ${assignment.courseName}\n\nStatus: ${assignment.status}\n\nSynced from Gradescope`;
    
    if (assignment.dueDate) {
      const dueDate = new Date(assignment.dueDate);
      // Ensure the date is valid
      if (!isNaN(dueDate.getTime())) {
        // Google Tasks API only accepts date (no time), so extract date only
        // Format: YYYY-MM-DD (RFC 3339 date format)
        due = dueDate.toISOString().split('T')[0];
        
        // Add the time information to the notes since Tasks API doesn't support specific times
        const timeString = dueDate.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        notes += `\n\n⏰ Due Time: ${timeString}`;
        
        console.log('Formatted due date:', due, 'time:', timeString, 'from original:', assignment.dueDate);
      } else {
        console.warn('Invalid due date for assignment:', assignment.title, assignment.dueDate);
      }
    }

    console.log('Building task object:', {
      title,
      originalDueDate: assignment.dueDate,
      formattedDue: due,
      status: assignment.statusAbbr === 'SUBMITTED' ? 'completed' : 'needsAction'
    });

    const task = {
      title: title,
      notes: notes,
      status: assignment.statusAbbr === 'SUBMITTED' ? 'completed' : 'needsAction'
    };

    // Add due date if available
    if (due) {
      task.due = due;
    }

    console.log('Final task object:', JSON.stringify(task, null, 2));
    return task;
  }

  // Generate consistent task ID from assignment
  generateTaskId(assignment) {
    const syncData = this.syncedAssignments.get(assignment.id);
    const taskId = syncData ? syncData.taskId : null;
    console.log(`Generated task ID for assignment ${assignment.id}: ${taskId}`);
    return taskId;
  }

  // Clear stored task ID for an assignment (when task is deleted or invalid)
  clearTaskId(assignmentId) {
    console.log(`Clearing task ID for assignment: ${assignmentId}`);
    console.log(`Before clearing - stored data:`, this.syncedAssignments.get(assignmentId));
    this.syncedAssignments.delete(assignmentId);
    this.saveSyncedAssignments();
    console.log(`Cleared stored task ID for assignment: ${assignmentId}`);
  }

  // Debug function to inspect current storage state
  debugStorageState() {
    console.log('=== STORAGE DEBUG ===');
    console.log('Synced assignments count:', this.syncedAssignments.size);
    console.log('All stored assignments:');
    for (const [assignmentId, data] of this.syncedAssignments.entries()) {
      console.log(`  Assignment ${assignmentId}:`, data);
    }
    console.log('=== END DEBUG ===');
  }

  // Sync all assignments to tasks with duplicate prevention
  async syncAssignments(assignments) {
    const results = [];
    
    console.log(`Starting sync for ${assignments.length} assignments`);
    this.debugStorageState();
    
    for (const assignment of assignments) {
      try {
        // Skip assignments without due dates
        if (!assignment.dueDate) {
          console.log(`Skipping assignment "${assignment.title}" - no due date`);
          results.push({ assignment: assignment.title, success: true, skipped: 'no_due_date' });
          continue;
        }

        console.log(`Processing assignment: ${assignment.title} (ID: ${assignment.id})`);
        
        // Check if assignment needs updating
        if (!this.needsUpdate(assignment)) {
          console.log(`Assignment "${assignment.title}" is up to date - skipping`);
          results.push({ assignment: assignment.title, success: true, skipped: 'up_to_date' });
          continue;
        }

        // Check for duplicates before processing
        const duplicates = await this.checkForDuplicateTasks(assignment);
        if (duplicates.length > 0) {
          console.log(`Handling duplicates for: ${assignment.title}`);
          await this.handleDuplicateTasks(duplicates, assignment);
        }

        const result = await this.createOrUpdateTask(assignment);
        results.push({ assignment: assignment.title, success: true, task: result });
        
      } catch (error) {
        console.error(`Failed to sync assignment "${assignment.title}":`, error);
        console.error('Assignment data:', assignment);
        console.error('Full error:', error);
        this.debugStorageState(); // Debug storage state on error
        results.push({ assignment: assignment.title, success: false, error: error.message });
      }
    }

    console.log(`Sync completed. Results:`, results);
    return results;
  }

  // Handle duplicate tasks by removing extras and keeping the most recent
  async handleDuplicateTasks(duplicates, assignment) {
    console.log(`Removing ${duplicates.length} duplicate tasks for: ${assignment.title}`);
    
    for (const duplicate of duplicates) {
      try {
        // Delete the duplicate task
        const response = await fetch(
          `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks/${duplicate.id}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
            }
          }
        );

        if (response.ok) {
          console.log(`Deleted duplicate task: ${duplicate.id}`);
        } else {
          console.error(`Failed to delete duplicate task ${duplicate.id}:`, response.status);
        }
      } catch (error) {
        console.error(`Error deleting duplicate task ${duplicate.id}:`, error);
      }
    }
  }

  // Clean up orphaned tasks (tasks that no longer have corresponding assignments)
  async cleanupOrphanedTasks(currentAssignments) {
    try {
      console.log('Checking for orphaned tasks...');
      
      // Get all current tasks
      const response = await fetch(
        `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          }
        }
      );

      if (!response.ok) {
        console.log('Could not fetch tasks for cleanup');
        return;
      }

      const data = await response.json();
      const allTasks = data.items || [];
      
      // Get current assignment titles for comparison
      const currentTitles = new Set(currentAssignments.map(a => a.fullTitle));
      
      // Find tasks that are synced from Gradescope but no longer exist in current assignments
      const orphanedTasks = allTasks.filter(task => 
        task.notes && 
        task.notes.includes('Synced from Gradescope') && 
        !currentTitles.has(task.title)
      );

      if (orphanedTasks.length > 0) {
        console.log(`Found ${orphanedTasks.length} orphaned tasks to clean up`);
        
        for (const orphan of orphanedTasks) {
          try {
            console.log(`Deleting orphaned task: ${orphan.title}`);
            
            const deleteResponse = await fetch(
              `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks/${orphan.id}`,
              {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${this.accessToken}`,
                }
              }
            );

            if (deleteResponse.ok) {
              console.log(`Successfully deleted orphaned task: ${orphan.title}`);
              
              // Remove from our storage as well
              for (const [assignmentId, syncData] of this.syncedAssignments.entries()) {
                if (syncData.taskId === orphan.id) {
                  this.syncedAssignments.delete(assignmentId);
                  break;
                }
              }
            }
          } catch (error) {
            console.error(`Error deleting orphaned task ${orphan.title}:`, error);
          }
        }
        
        // Save updated storage
        await this.saveSyncedAssignments();
      } else {
        console.log('No orphaned tasks found');
      }
    } catch (error) {
      console.error('Error during orphaned task cleanup:', error);
    }
  }

  // Load synced assignments from storage
  async loadSyncedAssignments() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['syncedAssignments'], (result) => {
        if (result.syncedAssignments) {
          this.syncedAssignments = new Map(Object.entries(result.syncedAssignments));
          console.log('Loaded synced assignments:', this.syncedAssignments.size);
          console.log('Synced assignments data:', Array.from(this.syncedAssignments.entries()));
        } else {
          console.log('No synced assignments found in storage');
        }
        resolve();
      });
    });
  }

  // Save synced assignments to storage
  async saveSyncedAssignments() {
    const data = Object.fromEntries(this.syncedAssignments);
    console.log('Saving synced assignments to storage:', data);
    return new Promise((resolve) => {
      chrome.storage.local.set({ syncedAssignments: data }, resolve);
    });
  }

  // Check if assignment needs update
  needsUpdate(assignment) {
    const syncData = this.syncedAssignments.get(assignment.id);
    
    if (!syncData) {
      console.log(`Assignment ${assignment.title} is new - needs sync`);
      return true; // New assignment
    }

    // Check if status changed
    if (!syncData.lastStatus) {
      console.log(`Assignment ${assignment.title} has no previous status - needs sync`);
      return true; // No previous status recorded
    }
    
    const statusChanged = syncData.lastStatus !== assignment.statusAbbr;
    const hasValidTaskId = syncData.taskId && syncData.taskId.trim() !== '';
    
    if (statusChanged) {
      console.log(`Assignment ${assignment.title} status changed: ${syncData.lastStatus} → ${assignment.statusAbbr}`);
      return true;
    }
    
    if (!hasValidTaskId) {
      console.log(`Assignment ${assignment.title} has invalid task ID - needs sync`);
      return true;
    }
    
    console.log(`Assignment ${assignment.title} is up to date - skipping`);
    return false; // No changes needed
  }

  // Check if this assignment is already synced and valid
  isAlreadySynced(assignment) {
    const syncData = this.syncedAssignments.get(assignment.id);
    
    if (!syncData || !syncData.taskId) {
      return false;
    }
    
    // Check if status matches and task ID exists
    return syncData.lastStatus === assignment.statusAbbr && 
           syncData.taskId && 
           syncData.taskId.trim() !== '';
  }

  // Prevent duplicate task creation by checking existing tasks
  async checkForDuplicateTasks(assignment) {
    try {
      // Search for tasks with the same title to detect duplicates
      const response = await fetch(
        `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        const tasks = data.items || [];
        
        // Look for tasks with matching title
        const duplicates = tasks.filter(task => 
          task.title === assignment.fullTitle && 
          task.id !== this.generateTaskId(assignment)
        );
        
        if (duplicates.length > 0) {
          console.warn(`Found ${duplicates.length} duplicate tasks for: ${assignment.title}`);
          console.log('Duplicate task IDs:', duplicates.map(t => t.id));
          return duplicates;
        }
      }
    } catch (error) {
      console.error('Error checking for duplicates:', error);
    }
    
    return [];
  }
}

// Initialize task manager
const taskManager = new TaskManager();

// Auto-sync timer
let autoSyncTimer = null;

// Load stored data on startup
async function initializeExtension() {
  // Load synced assignments
  await taskManager.loadSyncedAssignments();
  
  // Load stored client ID and token
  chrome.storage.local.get(['googleClientId'], (result) => {
    if (result.googleClientId) {
      taskManager.setClientId(result.googleClientId);
      console.log('Loaded stored Client ID');
      
      // Also try to load stored access token
      taskManager.loadStoredToken();
    }
  });

  // Set up auto-sync (default: every 5 minutes)
  await setupAutoSync();
}

// Set up automatic syncing using chrome.alarms API (more reliable in Manifest V3)
async function setupAutoSync() {
  // Get sync interval from storage (default: 5 minutes)
  const result = await new Promise((resolve) => {
    chrome.storage.local.get(['syncInterval'], (result) => {
      resolve(result);
    });
  });

  const syncInterval = result.syncInterval || 5; // Default 5 minutes
  console.log(`Setting up auto-sync every ${syncInterval} minutes using chrome.alarms`);

  // Clear existing alarms
  chrome.alarms.clear('autoSync');

  // Create a new alarm for auto-sync
  chrome.alarms.create('autoSync', {
    delayInMinutes: syncInterval,
    periodInMinutes: syncInterval
  });

  // Also set up a backup timer for immediate testing
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
  }

  autoSyncTimer = setInterval(async () => {
    console.log('Timer-based auto-sync triggered');
    await performAutoSync();
  }, syncInterval * 60 * 1000);

  console.log(`Auto-sync configured: alarm every ${syncInterval} minutes + timer backup`);

  // Also set the default value in storage if not set
  if (!result.syncInterval) {
    chrome.storage.local.set({ syncInterval: 5 });
  }

  // Log the next expected sync time
  const nextSync = new Date(Date.now() + syncInterval * 60 * 1000);
  console.log(`Next auto-sync scheduled for: ${nextSync.toLocaleString()}`);
}

// Perform automatic sync
async function performAutoSync() {
  const currentTime = new Date().toLocaleString();
  console.log(`🔄 Auto-sync triggered at: ${currentTime}`);

  try {
    // Check if we have a client ID first
    if (!taskManager.clientId) {
      console.log('⚠️ No client ID configured - skipping auto-sync');
      return;
    }

    // Check if we have authentication
    if (!taskManager.accessToken) {
      console.log('🔑 No access token, attempting to load stored token...');
      const hasValidToken = await taskManager.loadStoredToken();
      if (!hasValidToken) {
        console.log('❌ No valid token available for auto-sync');
        return;
      } else {
        console.log('✅ Successfully loaded stored access token');
      }
    }

    // Get the latest assignments data
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(['latestAssignments'], (result) => {
        resolve(result);
      });
    });

    if (result.latestAssignments && result.latestAssignments.assignments) {
      console.log(`📚 Auto-syncing ${result.latestAssignments.assignments.length} assignments from ${result.latestAssignments.courseName}`);
      
      // First, clean up any orphaned tasks
      await taskManager.cleanupOrphanedTasks(result.latestAssignments.assignments);
      
      // Then sync current assignments
      const syncResults = await taskManager.syncAssignments(result.latestAssignments.assignments);
      console.log('📊 Auto-sync results:', syncResults);

      // Update last sync time with detailed info
      const syncTime = new Date().toISOString();
      chrome.storage.local.set({ 
        lastSyncTime: syncTime,
        lastAutoSyncTime: syncTime,
        lastSyncType: 'auto'
      });
      
      console.log(`✅ Auto-sync completed successfully at ${currentTime}`);
    } else {
      console.log('📭 No assignments data available for auto-sync');
      console.log('💡 Visit a Gradescope course page to populate assignment data');
    }
  } catch (error) {
    console.error('❌ Auto-sync failed:', error);
    
    // Store error info
    chrome.storage.local.set({ 
      lastSyncError: error.message,
      lastSyncErrorTime: new Date().toISOString()
    });
  }
}

// Handle chrome.alarms events
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log(`🚨 Alarm triggered: ${alarm.name}`);
  
  if (alarm.name === 'autoSync') {
    console.log('⏰ Auto-sync alarm fired');
    performAutoSync();
  }
});

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
        syncToTasks(request.assignments, sendResponse);
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

      case 'UPDATE_SYNC_INTERVAL':
        updateSyncInterval(request.interval, sendResponse);
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

    // Always auto-sync assignments when they are found/updated
    console.log('Auto-syncing assignments for course:', data.courseName);
    
    // Check if we have authentication
    if (!taskManager.accessToken) {
      // Try to load stored token first
      const hasValidToken = await taskManager.loadStoredToken();
      if (!hasValidToken) {
        console.log('No valid token available for auto-sync');
        sendResponse({ success: false, error: 'Authentication required' });
        return;
      }
    }

    const results = await taskManager.syncAssignments(data.assignments);
    console.log('Auto-sync results:', results);

    // Store last sync time
    chrome.storage.local.set({ lastSyncTime: new Date().toISOString() });

    sendResponse({ success: true, results });
  } catch (error) {
    console.error('Error handling assignments data:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Sync assignments to tasks
async function syncToTasks(assignments, sendResponse) {
  try {
    console.log('Starting manual sync with cleanup...');
    
    // First, clean up any orphaned tasks
    await taskManager.cleanupOrphanedTasks(assignments);
    
    // Then sync current assignments
    const results = await taskManager.syncAssignments(assignments);
    
    sendResponse({ success: true, results: results });
  } catch (error) {
    console.error('Error syncing to tasks:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Get sync status
async function getSyncStatus(sendResponse) {
  try {
    const syncedCount = taskManager.syncedAssignments.size;
    const lastSync = await new Promise((resolve) => {
      chrome.storage.local.get(['lastSyncTime'], (result) => {
        resolve(result.lastSyncTime);
      });
    });

    const response = {
      success: true,
      syncedCount: syncedCount,
      lastSync: lastSync,
      isAuthenticated: !!taskManager.accessToken
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
    const token = await taskManager.authenticate();
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
    taskManager.setClientId(clientId);
    
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

// Update sync interval
async function updateSyncInterval(interval, sendResponse) {
  try {
    console.log('Updating sync interval to:', interval, 'minutes');
    
    // Store the new interval
    await new Promise((resolve) => {
      chrome.storage.local.set({ syncInterval: interval }, resolve);
    });
    
    // Restart auto-sync with new interval
    await setupAutoSync();
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error updating sync interval:', error);
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

