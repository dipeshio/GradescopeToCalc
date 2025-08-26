// Background service worker for Gradescope to Google Calendar extension

class TaskManager {
  constructor() {
    this.accessToken = null;
    this.taskListId = '@default'; // Will be updated to actual list ID
    this.syncedAssignments = new Map(); // Track synced assignments
    this.clientId = null;
  }

  // Set the client ID for OAuth
  setClientId(clientId) {
    this.clientId = clientId;
    console.log('Client ID set for authentication');
  }

  // Get the correct task list ID (find default or first available)
  async ensureCorrectTaskListId() {
    try {
      console.log('🔍 Ensuring correct task list ID...');
      
      const response = await fetch(
        'https://www.googleapis.com/tasks/v1/users/@me/lists',
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
          // Try to find a list with ID '@default' first
          let targetList = data.items.find(list => list.id === '@default');
          
          // If no @default, use the first available list
          if (!targetList) {
            targetList = data.items[0];
            console.log(`📝 No @default list found, using first list: "${targetList.title}" (${targetList.id})`);
          } else {
            console.log(`📝 Found @default list: "${targetList.title}"`);
          }
          
          // Update the task list ID
          const oldId = this.taskListId;
          this.taskListId = targetList.id;
          
          if (oldId !== this.taskListId) {
            console.log(`🔄 Updated task list ID: "${oldId}" → "${this.taskListId}"`);
          }
          
          return true;
        } else {
          console.error('❌ No task lists found in account');
          return false;
        }
      } else {
        const errorText = await response.text();
        console.error('❌ Failed to fetch task lists:', response.status, errorText);
        return false;
      }
    } catch (error) {
      console.error('❌ Error ensuring task list ID:', error);
      return false;
    }
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
            
            // Ensure we have the correct task list ID
            this.ensureCorrectTaskListId().then(() => {
              resolve(true);
            }).catch((listError) => {
              console.warn('Warning: Could not update task list ID:', listError);
              resolve(true); // Still resolve true even if list update fails
            });
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
          
          // Ensure we have the correct task list ID after authentication
          this.ensureCorrectTaskListId().then(() => {
            resolve(token);
          }).catch((listError) => {
            console.warn('Warning: Could not update task list ID:', listError);
            resolve(token); // Still resolve with token even if list update fails
          });
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
    
    console.log('🔍 DETAILED CREATE REQUEST DEBUG:');
    console.log('  Assignment data:', JSON.stringify(assignment, null, 2));
    console.log('  Task object:', JSON.stringify(task, null, 2));
    console.log('  API URL:', `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks`);
    console.log('  Task list ID:', this.taskListId);
    console.log('  Access token (first 20 chars):', this.accessToken ? this.accessToken.substring(0, 20) + '...' : 'null');
    
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
      console.error('❌ Task creation failed:', {
        status: response.status,
        statusText: response.statusText,
        url: `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks`,
        taskListId: this.taskListId,
        errorResponse: errorText,
        requestBody: JSON.stringify(task, null, 2),
        headers: {
          'Authorization': `Bearer ${this.accessToken ? this.accessToken.substring(0, 20) + '...' : 'null'}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Handle specific error cases
      if (response.status === 401) {
        console.log('🔑 Access token expired, clearing stored token');
        chrome.storage.local.remove(['googleAccessToken', 'tokenTimestamp']);
        this.accessToken = null;
        throw new Error('Authentication expired. Please reconnect to Google Tasks.');
      } else if (response.status === 400) {
        console.log('⚠️ Bad request - likely invalid due date format or missing required field');
        throw new Error(`Invalid request format: ${errorText}`);
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
    
    // Validate task ID format (Google Tasks IDs are typically longer and contain various characters)
    if (!taskId || taskId.length < 5) {
      throw new Error(`Invalid task ID format: ${taskId}`);
    }
    
    const task = this.buildTaskObject(assignment);
    // Add the ID to the task object for update requests
    task.id = taskId;
    
    console.log(`🔄 Updating task ${taskId} with data:`, JSON.stringify(task, null, 2));
    
    const response = await fetch(
      `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks/${taskId}`,
      {
        method: 'PATCH', // Use PATCH for partial updates
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(task)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Task update failed:', {
        status: response.status,
        statusText: response.statusText,
        url: `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks/${taskId}`,
        taskListId: this.taskListId,
        taskId: taskId,
        errorResponse: errorText,
        requestBody: JSON.stringify(task, null, 2),
        headers: {
          'Authorization': `Bearer ${this.accessToken ? this.accessToken.substring(0, 20) + '...' : 'null'}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Handle specific error cases
      if (response.status === 401) {
        console.log('🔑 Access token expired, clearing stored token');
        chrome.storage.local.remove(['googleAccessToken', 'tokenTimestamp']);
        this.accessToken = null;
        throw new Error('Authentication expired. Please reconnect to Google Tasks.');
      } else if (response.status === 404) {
        console.log('📭 Task not found, may have been deleted externally');
        throw new Error(`Task ${taskId} not found. It may have been deleted.`);
      } else if (response.status === 400) {
        console.log('⚠️ Bad request - likely invalid due date format or missing required field');
        throw new Error(`Invalid request format: ${errorText}`);
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
    
    console.log('✅ Task updated successfully:', updatedTask.title);
    return updatedTask;
  }

  // Get an existing task by ID
  async getTask(taskId) {
    if (!taskId) return null;

    try {
      const url = `https://www.googleapis.com/tasks/v1/lists/${this.taskListId}/tasks/${taskId}`;
      console.log(`🔍 Fetching task ${taskId} from: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`📡 Task fetch response status: ${response.status}`);
      
      if (response.status === 404) {
        console.log(`❌ Task ${taskId} not found (404)`);
        return null; // Task doesn't exist
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to get task ${taskId}:`, response.status, response.statusText, errorText);
        throw new Error(`Failed to get task: ${response.status} ${response.statusText}`);
      }

      const task = await response.json();
      console.log(`✅ Task ${taskId} found:`, task);
      return task;
    } catch (error) {
      console.error(`❌ Error getting task ${taskId}:`, error);
      return null;
    }
  }

  // Build task object for Google Tasks API
  buildTaskObject(assignment) {
    console.log('🔧 Building task object from assignment:', {
      id: assignment.id,
      title: assignment.title,
      fullTitle: assignment.fullTitle,
      status: assignment.status,
      statusAbbr: assignment.statusAbbr,
      courseName: assignment.courseName,
      dueDate: assignment.dueDate,
      dueDateType: typeof assignment.dueDate
    });

    // Validate required fields
    if (!assignment.fullTitle || assignment.fullTitle.trim() === '') {
      throw new Error('Assignment title is required but empty');
    }

    const title = assignment.fullTitle.trim();
    
    // Build notes with safe string handling
    const courseName = assignment.courseName || 'Unknown Course';
    const status = assignment.status || 'Unknown Status';
    let notes = `Assignment from ${courseName}\n\nStatus: ${status}\n\nSynced from Gradescope`;
    
    // Format due date and time for Tasks API
    let due = null;
    if (assignment.dueDate) {
      try {
        const dueDate = new Date(assignment.dueDate);
        console.log('Processing due date:', {
          original: assignment.dueDate,
          parsed: dueDate,
          isValid: !isNaN(dueDate.getTime()),
          timestamp: dueDate.getTime()
        });
        
        // Ensure the date is valid
        if (!isNaN(dueDate.getTime())) {
          // Google Tasks API requires RFC3339 format with timezone
          due = dueDate.toISOString();
          
          // Add the time information to the notes for better visibility
          const timeString = dueDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
          });
          notes += `\n\n⏰ Due Time: ${timeString}`;
          
          console.log('✅ Due date formatted successfully:', {
            rfc3339: due,
            displayTime: timeString,
            originalInput: assignment.dueDate
          });
        } else {
          console.warn('⚠️ Invalid due date detected:', assignment.dueDate);
          // Don't include due date if invalid
        }
      } catch (dateError) {
        console.error('❌ Error processing due date:', dateError, 'for date:', assignment.dueDate);
        // Don't include due date if there's an error
      }
    } else {
      console.log('ℹ️ No due date provided for assignment');
    }

    // Determine task status
    let taskStatus = 'needsAction'; // default
    if (assignment.statusAbbr === 'SUBMITTED' || assignment.statusAbbr === 'COMPLETE') {
      taskStatus = 'completed';
    }

    console.log('Task status determination:', {
      originalStatus: assignment.status,
      originalStatusAbbr: assignment.statusAbbr,
      taskStatus: taskStatus
    });

    // Build the task object with validation
    const task = {
      title: title,
      notes: notes,
      status: taskStatus
    };

    // Only add due date if it's valid
    if (due) {
      task.due = due;
    }

    console.log('✅ Final task object created:', JSON.stringify(task, null, 2));
    
    // Validate the final task object
    if (!task.title || task.title.length === 0) {
      throw new Error('Task title cannot be empty');
    }
    if (task.title.length > 1024) {
      console.warn('⚠️ Task title is very long, truncating...');
      task.title = task.title.substring(0, 1021) + '...';
    }
    if (task.notes && task.notes.length > 8192) {
      console.warn('⚠️ Task notes are very long, truncating...');
      task.notes = task.notes.substring(0, 8189) + '...';
    }

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
  async syncAssignments(assignments, forceSync = false) {
    const results = [];
    
    console.log(`Starting sync for ${assignments.length} assignments ${forceSync ? '(FORCE MODE)' : ''}`);
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
        
        // Check if assignment needs updating (now async) - unless force mode
        if (!forceSync) {
          const needsUpdate = await this.needsUpdate(assignment);
          if (!needsUpdate) {
            console.log(`Assignment "${assignment.title}" is up to date - skipping`);
            results.push({ assignment: assignment.title, success: true, skipped: 'up_to_date' });
            continue;
          }
        } else {
          console.log(`🔄 FORCE MODE: Processing ${assignment.title} regardless of status`);
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
        console.error(`❌ Failed to sync assignment "${assignment.title}":`, error);
        console.error('📋 Assignment data details:', {
          id: assignment.id,
          title: assignment.title,
          fullTitle: assignment.fullTitle,
          status: assignment.status,
          statusAbbr: assignment.statusAbbr,
          courseName: assignment.courseName,
          dueDate: assignment.dueDate,
          dueDateType: typeof assignment.dueDate,
          allFields: Object.keys(assignment)
        });
        console.error('🔍 Full error object:', {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
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
  async needsUpdate(assignment) {
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
    
    // NEW: Verify the task still exists in Google Calendar
    console.log(`🔍 Verifying task ${syncData.taskId} still exists for: ${assignment.title}`);
    try {
      const existingTask = await this.getTask(syncData.taskId);
      if (!existingTask) {
        console.log(`📭 Task ${syncData.taskId} no longer exists in Google Calendar - needs recreation for: ${assignment.title}`);
        // Clear the invalid task ID from storage
        this.clearTaskId(assignment.id);
        return true; // Task was deleted externally, needs recreation
      }
      console.log(`✅ Task ${syncData.taskId} exists in Google Calendar`);
    } catch (error) {
      console.warn(`⚠️ Error checking task existence for ${assignment.title}:`, error.message);
      // If we can't verify, assume it needs recreation to be safe
      this.clearTaskId(assignment.id);
      return true;
    }
    
    console.log(`✅ Assignment ${assignment.title} is up to date and task exists - skipping`);
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

// Debug function to check auto-sync status
async function debugAutoSync() {
  console.log('=== AUTO-SYNC DEBUG ===');
  
  // Check alarms
  const alarms = await chrome.alarms.getAll();
  console.log('Active alarms:', alarms);
  
  // Check stored data
  chrome.storage.local.get([
    'syncInterval', 
    'lastSyncTime', 
    'lastAutoSyncTime', 
    'latestAssignments',
    'googleClientId',
    'googleAccessToken'
  ], (result) => {
    console.log('Storage data:', {
      syncInterval: result.syncInterval,
      lastSyncTime: result.lastSyncTime,
      lastAutoSyncTime: result.lastAutoSyncTime,
      hasAssignments: !!(result.latestAssignments && result.latestAssignments.assignments),
      assignmentCount: result.latestAssignments?.assignments?.length || 0,
      courseName: result.latestAssignments?.courseName,
      hasClientId: !!result.googleClientId,
      hasToken: !!result.googleAccessToken
    });
    
    console.log('Task manager state:', {
      hasClientId: !!taskManager.clientId,
      hasToken: !!taskManager.accessToken,
      syncedCount: taskManager.syncedAssignments.size
    });
    
    console.log('=== END AUTO-SYNC DEBUG ===');
  });
}

// Test auto-sync manually
async function testAutoSync() {
  console.log('🧪 Testing auto-sync manually...');
  await performAutoSync();
}

// List all task lists available to the user
async function listTaskLists() {
  console.log('📋 Listing all task lists...');
  
  try {
    if (!taskManager.accessToken) {
      console.log('🔑 No access token, attempting to authenticate...');
      await taskManager.authenticate();
    }
    
    const response = await fetch(
      'https://www.googleapis.com/tasks/v1/users/@me/lists',
      {
        headers: {
          'Authorization': `Bearer ${taskManager.accessToken}`
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Available task lists:', data);
      
      if (data.items && data.items.length > 0) {
        console.log(`📊 Found ${data.items.length} task lists:`);
        data.items.forEach((list, index) => {
          console.log(`  ${index + 1}. "${list.title}" (ID: ${list.id})`);
          console.log(`     Kind: ${list.kind}, Updated: ${list.updated}`);
          if (list.id === '@default') {
            console.log('     ⭐ This is the @default list');
          }
          if (list.id === taskManager.taskListId) {
            console.log('     🎯 This is the list we\'re using');
          }
        });
        
        console.log(`🎯 Extension is using list ID: "${taskManager.taskListId}"`);
        
        // Check if our list exists
        const ourList = data.items.find(list => list.id === taskManager.taskListId);
        if (ourList) {
          console.log(`✅ Our task list "${ourList.title}" exists`);
        } else {
          console.error(`❌ Our task list "${taskManager.taskListId}" NOT FOUND!`);
          console.log('💡 Available list IDs:', data.items.map(l => l.id));
        }
        
      } else {
        console.log('📭 No task lists found');
      }
    } else {
      const errorText = await response.text();
      console.error('❌ Failed to list task lists:', response.status, errorText);
    }
    
  } catch (error) {
    console.error('❌ Error listing task lists:', error);
  }
}

  // List all tasks to see what's actually in Google Tasks
  async function listAllTasks() {
    console.log('📋 Listing all tasks in Google Tasks...');
    
    try {
      if (!taskManager.accessToken) {
        console.log('🔑 No access token, attempting to authenticate...');
        await taskManager.authenticate();
      }
      
             const url = `https://www.googleapis.com/tasks/v1/lists/${taskManager.taskListId}/tasks?maxResults=100`;
      console.log(`📋 Fetching all tasks from: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${taskManager.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`📡 List tasks response status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ All tasks in Google Tasks:', data);
        console.log(`📊 Raw API response:`, data);
        
        if (data.items && data.items.length > 0) {
                 console.log(`📊 Found ${data.items.length} tasks:`);
       data.items.forEach((task, index) => {
         console.log(`  ${index + 1}. "${task.title}" (ID: ${task.id})`);
         console.log(`     Status: ${task.status}, Due: ${task.due || 'No due date'}`);
         console.log(`     Updated: ${task.updated}`);
         if (task.notes) {
           console.log(`     Notes: ${task.notes.substring(0, 100)}...`);
         }
         console.log('     ---');
       });
       
       // Check if our test task exists by ID
       const testTaskId = 'NGJiNjM0a05PUXpBODVLRw';
       const testTask = data.items.find(task => task.id === testTaskId);
       if (testTask) {
         console.log(`✅ Test task found in list: "${testTask.title}" (ID: ${testTask.id})`);
       } else {
         console.log(`❌ Test task NOT found in list (ID: ${testTaskId})`);
         console.log('🔍 This suggests the task was created but is being filtered out');
       }
          
          // Check for our specific tasks
          const gradescopeTasks = data.items.filter(task => 
            task.notes && task.notes.includes('Synced from Gradescope')
          );
          console.log(`🎓 Gradescope tasks found: ${gradescopeTasks.length}`);
          gradescopeTasks.forEach(task => {
            console.log(`  - "${task.title}" (Due: ${task.due})`);
          });
          
          return data.items;
        } else {
          console.log('📭 No tasks found in Google Tasks');
          return [];
        }
      } else {
        const errorText = await response.text();
        console.error('❌ Failed to list tasks:', response.status, errorText);
        return [];
      }
    } catch (error) {
      console.error('❌ Error listing tasks:', error);
      return [];
    }
  }

// Test task creation with minimal and full sample assignments
async function testTaskCreation() {
  console.log('🧪 Testing task creation with different data formats...');
  
  // Test 1: Minimal valid task
  const minimalTask = {
    title: 'Minimal Test Task'
  };
  
  // Test 2: Sample assignment matching our format
  const sampleAssignment = {
    id: 'test-assignment-' + Date.now(),
    title: 'Test Assignment',
    fullTitle: 'TEST 101: Test Assignment (TEST)',
    status: 'Not Submitted',
    statusAbbr: 'NS',
    courseName: 'TEST 101',
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // Tomorrow
  };
  
  console.log('Sample assignment data:', sampleAssignment);
  
  try {
    if (!taskManager.accessToken) {
      console.log('🔑 No access token, attempting to authenticate...');
      await taskManager.authenticate();
    }
    
    console.log('🧪 Test 1: Creating minimal task directly...');
    // Test direct API call with minimal data
    const minimalResponse = await fetch(
      `https://www.googleapis.com/tasks/v1/lists/${taskManager.taskListId}/tasks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${taskManager.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(minimalTask)
      }
    );
    
    if (minimalResponse.ok) {
      const minimalResult = await minimalResponse.json();
      console.log('✅ Minimal task created successfully:', minimalResult);
      
      // Clean up minimal task
      await fetch(
        `https://www.googleapis.com/tasks/v1/lists/${taskManager.taskListId}/tasks/${minimalResult.id}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${taskManager.accessToken}` }
        }
      );
      console.log('🗑️ Minimal task cleaned up');
    } else {
      const errorText = await minimalResponse.text();
      console.error('❌ Minimal task creation failed:', minimalResponse.status, errorText);
    }
    
         console.log('🧪 Test 2: Creating task through our buildTaskObject function...');
     const result = await taskManager.createTask(sampleAssignment);
     console.log('✅ Full task created successfully:', result);
     
     // DON'T clean up - let's see if the task persists
     console.log('🔍 Test task created - check if it persists in the next List Tasks call');
     console.log('💡 Task ID to look for:', result.id);
    
  } catch (error) {
    console.error('❌ Test task creation failed:', error);
  }
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
        syncToTasks(request.assignments, sendResponse, false);
        return true;

      case 'FORCE_SYNC_TO_CALENDAR':
        syncToTasks(request.assignments, sendResponse, true);
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

      case 'DEBUG_AUTO_SYNC':
        debugAutoSync();
        sendResponse({ success: true });
        return true;

      case 'TEST_AUTO_SYNC':
        testAutoSync();
        sendResponse({ success: true });
        return true;

      case 'TEST_TASK_CREATION':
        testTaskCreation();
        sendResponse({ success: true });
        return true;

      case 'LIST_ALL_TASKS':
        listAllTasks();
        sendResponse({ success: true });
        return true;

      case 'LIST_TASK_LISTS':
        listTaskLists();
        sendResponse({ success: true });
        return true;

      case 'FIX_TASK_LIST_ID':
        taskManager.ensureCorrectTaskListId().then(() => {
          sendResponse({ success: true, message: 'Task list ID updated successfully' });
        }).catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
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
async function syncToTasks(assignments, sendResponse, forceSync = false) {
  try {
    console.log(`Starting ${forceSync ? 'FORCE' : 'manual'} sync with cleanup...`);
    
    // First, clean up any orphaned tasks
    await taskManager.cleanupOrphanedTasks(assignments);
    
    // Then sync current assignments (with optional force mode)
    const results = await taskManager.syncAssignments(assignments, forceSync);
    
    // Update last sync time
    chrome.storage.local.set({ 
      lastSyncTime: new Date().toISOString(),
      lastSyncType: forceSync ? 'force_manual' : 'manual'
    });
    
    sendResponse({ 
      success: true, 
      results: results,
      message: `${forceSync ? 'Force s' : 'S'}ynced ${results.length} assignments to Google Tasks`
    });
  } catch (error) {
    console.error('Error syncing to tasks:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Get sync status
async function getSyncStatus(sendResponse) {
  try {
    const syncedCount = taskManager.syncedAssignments.size;
    
    // Get detailed sync information
    const syncData = await new Promise((resolve) => {
      chrome.storage.local.get([
        'lastSyncTime', 
        'lastAutoSyncTime', 
        'lastSyncType',
        'syncInterval',
        'latestAssignments',
        'lastSyncError',
        'lastSyncErrorTime'
      ], (result) => {
        resolve(result);
      });
    });

    // Get alarm information
    const alarms = await chrome.alarms.getAll();
    const autoSyncAlarm = alarms.find(alarm => alarm.name === 'autoSync');

    const response = {
      success: true,
      syncedCount: syncedCount,
      lastSync: syncData.lastSyncTime,
      lastAutoSync: syncData.lastAutoSyncTime,
      lastSyncType: syncData.lastSyncType || 'unknown',
      syncInterval: syncData.syncInterval || 5,
      isAuthenticated: !!taskManager.accessToken,
      hasClientId: !!taskManager.clientId,
      hasAssignments: !!(syncData.latestAssignments && syncData.latestAssignments.assignments),
      assignmentCount: syncData.latestAssignments?.assignments?.length || 0,
      courseName: syncData.latestAssignments?.courseName,
      autoSyncEnabled: !!autoSyncAlarm,
      nextAutoSync: autoSyncAlarm?.scheduledTime,
      lastError: syncData.lastSyncError,
      lastErrorTime: syncData.lastSyncErrorTime
    };

    console.log('Sending detailed sync status:', response);
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

