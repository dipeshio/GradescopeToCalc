// Popup script for Gradescope to Google Calendar extension

class PopupManager {
  constructor() {
    this.isAuthenticated = false;
    this.currentAssignments = [];
    this.syncInProgress = false;
    this.clientId = null;
    this.isConfigured = false;
    
    this.initializeElements();
    this.setupEventListeners();
    this.loadInitialData();
  }

  initializeElements() {
    // Configuration elements
    this.configSection = document.getElementById('configSection');
    this.clientIdInput = document.getElementById('clientIdInput');
    this.saveConfigButton = document.getElementById('saveConfigButton');
    this.setupGuideLink = document.getElementById('setupGuideLink');

    // Authentication elements
    this.authSection = document.getElementById('authSection');
    this.authStatus = document.getElementById('authStatus');
    this.authDot = document.getElementById('authDot');
    this.authText = document.getElementById('authText');
    this.authButton = document.getElementById('authButton');
    this.reconfigureButton = document.getElementById('reconfigureButton');

    // Course elements
    this.courseSection = document.getElementById('courseSection');
    this.courseName = document.getElementById('courseName');

    // Assignments elements
    this.assignmentsSection = document.getElementById('assignmentsSection');
    this.assignmentsList = document.getElementById('assignmentsList');

    // Sync elements
    this.syncButton = document.getElementById('syncButton');
    this.syncIcon = document.getElementById('syncIcon');
    this.syncText = document.getElementById('syncText');
    this.syncStatus = document.getElementById('syncStatus');
    this.syncProgress = document.getElementById('syncProgress');
    this.syncProgressFill = document.getElementById('syncProgressFill');
    this.syncMessage = document.getElementById('syncMessage');

    // Results elements
    this.resultsSection = document.getElementById('resultsSection');
    this.syncResults = document.getElementById('syncResults');

    // Settings elements
    this.autoSyncToggle = document.getElementById('autoSyncToggle');
    this.syncInterval = document.getElementById('syncInterval');
    this.syncedCount = document.getElementById('syncedCount');
    this.lastSync = document.getElementById('lastSync');
    this.autoSyncStatus = document.getElementById('autoSyncStatus');
    this.debugAutoSync = document.getElementById('debugAutoSync');
    this.testAutoSync = document.getElementById('testAutoSync');
  }

  setupEventListeners() {
    // Configuration buttons
    this.saveConfigButton.addEventListener('click', () => this.saveConfiguration());
    this.setupGuideLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.showSetupGuide();
    });

    // Authentication buttons
    this.authButton.addEventListener('click', () => this.authenticate());
    this.reconfigureButton.addEventListener('click', () => this.showConfiguration());

    // Sync button
    this.syncButton.addEventListener('click', () => this.syncAssignments());

    // Auto-sync toggle
    this.autoSyncToggle.addEventListener('change', (e) => {
      this.updateAutoSyncSetting(e.target.checked);
    });

    // Sync interval
    this.syncInterval.addEventListener('change', (e) => {
      this.updateSyncInterval(parseInt(e.target.value));
    });

    // Enter key on client ID input
    this.clientIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.saveConfiguration();
      }
    });
  }

  async loadInitialData() {
    try {
      // Check for stored configuration first
      await this.loadConfiguration();

      if (this.isConfigured) {
        // Ensure background script has the Client ID
        await this.sendMessage({ 
          type: 'SET_CLIENT_ID', 
          clientId: this.clientId 
        });

        // Check authentication status
        await this.checkAuthStatus();

        // Load settings
        await this.loadSettings();

        // Check for current assignments
        await this.checkCurrentPage();

        // Load sync stats
        await this.loadSyncStats();
      } else {
        // Show configuration screen
        this.showConfiguration();
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
      this.showError('Failed to load extension data');
    }
  }

  async checkAuthStatus() {
    try {
      const response = await this.sendMessage({ type: 'GET_SYNC_STATUS' });
      
      if (response && response.success) {
        this.isAuthenticated = response.isAuthenticated;
        this.updateAuthUI();
      } else {
        throw new Error(response?.error || 'Failed to check authentication status');
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      this.isAuthenticated = false;
      this.updateAuthUI(false, 'Not connected - Click to connect');
    }
  }

  updateAuthUI(authenticated = this.isAuthenticated, message = null) {
    if (authenticated) {
      this.authDot.className = 'status-dot connected';
      this.authText.textContent = message || 'Connected to Google Tasks';
      this.authButton.style.display = 'none';
    } else {
      this.authDot.className = 'status-dot error';
      this.authText.textContent = message || 'Not connected to Google Tasks';
      this.authButton.style.display = 'block';
    }
  }

  async authenticate() {
    try {
      this.authButton.disabled = true;
      this.authText.textContent = 'Connecting...';

      const response = await this.sendMessage({ type: 'AUTHENTICATE' });
      
      if (response && response.success) {
        this.isAuthenticated = true;
        this.updateAuthUI(true, 'Successfully connected!');
        setTimeout(() => this.updateAuthUI(), 2000);
      } else {
        throw new Error(response?.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Authentication error:', error);
      this.isAuthenticated = false;
      this.updateAuthUI(false, 'Connection failed - Check console for details');
      setTimeout(() => this.updateAuthUI(), 3000);
    } finally {
      this.authButton.disabled = false;
    }
  }

  async checkCurrentPage() {
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab || !tab.url || !tab.url.includes('gradescope.com/courses/')) {
        this.showNoGradescopePage();
        return;
      }

      // Try to get assignments from the current page
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ASSIGNMENTS' });
        
        if (response && response.success) {
          this.displayAssignments(response.data);
          return;
        }
      } catch (contentScriptError) {
        console.log('Content script not ready or not on Gradescope page:', contentScriptError.message);
      }

      // Try to get cached assignments as fallback
      const cachedData = await this.getCachedAssignments();
      if (cachedData) {
        this.displayAssignments(cachedData);
      } else {
        this.showNoAssignments();
      }
      
    } catch (error) {
      console.error('Error checking current page:', error);
      // Try cached data as final fallback
      try {
        const cachedData = await this.getCachedAssignments();
        if (cachedData) {
          this.displayAssignments(cachedData);
        } else {
          this.showNoGradescopePage();
        }
      } catch (cacheError) {
        console.error('Error loading cached data:', cacheError);
        this.showNoGradescopePage();
      }
    }
  }

  async getCachedAssignments() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['latestAssignments'], (result) => {
        resolve(result.latestAssignments || null);
      });
    });
  }

  displayAssignments(data) {
    if (!data || !data.assignments || data.assignments.length === 0) {
      this.showNoAssignments();
      return;
    }

    this.currentAssignments = data.assignments;

    // Show course info
    this.courseName.textContent = data.courseName || 'Unknown Course';
    this.courseSection.style.display = 'block';

    // Show assignments list
    this.assignmentsList.innerHTML = '';
    
    data.assignments.forEach(assignment => {
      const item = this.createAssignmentItem(assignment);
      this.assignmentsList.appendChild(item);
    });

    this.assignmentsSection.style.display = 'block';
    this.syncButton.disabled = false;
  }

  createAssignmentItem(assignment) {
    const item = document.createElement('div');
    item.className = 'assignment-item';

    const title = document.createElement('div');
    title.className = 'assignment-title';
    title.textContent = assignment.title;

    const status = document.createElement('span');
    status.className = `assignment-status ${assignment.statusAbbr.toLowerCase()}`;
    status.textContent = assignment.statusAbbr;

    const due = document.createElement('div');
    due.className = 'assignment-due';
    if (assignment.dueDate) {
      const dueDate = new Date(assignment.dueDate);
      due.textContent = dueDate.toLocaleDateString();
    } else {
      due.textContent = 'No due date';
    }

    item.appendChild(title);
    item.appendChild(status);
    item.appendChild(due);

    return item;
  }

  showNoGradescopePage() {
    this.courseSection.style.display = 'none';
    this.assignmentsSection.style.display = 'none';
    this.syncButton.disabled = true;
  }

  showNoAssignments() {
    this.courseSection.style.display = 'none';
    this.assignmentsSection.style.display = 'none';
    this.syncButton.disabled = true;
  }

  async syncAssignments() {
    if (this.syncInProgress || !this.isAuthenticated) {
      return;
    }

    if (this.currentAssignments.length === 0) {
      this.showError('No assignments to sync');
      return;
    }

    this.syncInProgress = true;
    this.updateSyncUI(true);

    try {
      const response = await this.sendMessage({
        type: 'SYNC_TO_CALENDAR',
        assignments: this.currentAssignments
      });

      if (response.success) {
        this.displaySyncResults(response.results);
        this.showSuccess(`Synced ${response.results.length} assignments`);
        await this.loadSyncStats(); // Refresh stats
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error('Sync error:', error);
      this.showError(`Sync failed: ${error.message}`);
    } finally {
      this.syncInProgress = false;
      this.updateSyncUI(false);
    }
  }

  updateSyncUI(syncing) {
    if (syncing) {
      this.syncButton.disabled = true;
      this.syncIcon.className = 'spinning';
      this.syncText.textContent = 'Syncing...';
      this.syncStatus.style.display = 'block';
      this.syncProgressFill.style.width = '0%';
      this.syncMessage.textContent = 'Preparing sync...';
      
      // Animate progress
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress > 90) progress = 90;
        this.syncProgressFill.style.width = `${progress}%`;
        
        if (!this.syncInProgress) {
          clearInterval(progressInterval);
          this.syncProgressFill.style.width = '100%';
        }
      }, 200);
    } else {
          this.syncButton.disabled = false;
    this.syncIcon.className = '';
    this.syncText.textContent = 'Sync to Tasks';
      setTimeout(() => {
        this.syncStatus.style.display = 'none';
      }, 2000);
    }
  }

  displaySyncResults(results) {
    this.syncResults.innerHTML = '';
    
    results.forEach(result => {
      const item = document.createElement('div');
      item.className = 'result-item';

      const assignment = document.createElement('span');
      assignment.textContent = result.assignment;

      const status = document.createElement('span');
      status.className = result.success ? 'result-success' : 'result-error';
      status.textContent = result.success ? '✓' : '✗';

      item.appendChild(assignment);
      item.appendChild(status);
      this.syncResults.appendChild(item);
    });

    this.resultsSection.style.display = 'block';
  }

  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['autoSync', 'syncInterval'], (result) => {
        this.autoSyncToggle.checked = result.autoSync || false;
        this.syncInterval.value = result.syncInterval || 5;
        resolve();
      });
    });
  }

  async updateAutoSyncSetting(enabled) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ autoSync: enabled }, resolve);
    });
  }

  async updateSyncInterval(minutes) {
    try {
      // Update local storage
      await new Promise((resolve) => {
        chrome.storage.local.set({ syncInterval: minutes }, resolve);
      });

      // Notify background script to update timer
      await this.sendMessage({ 
        type: 'UPDATE_SYNC_INTERVAL', 
        interval: minutes 
      });

      console.log(`Sync interval updated to ${minutes} minutes`);
    } catch (error) {
      console.error('Error updating sync interval:', error);
    }
  }

  async loadSyncStats() {
    try {
      const response = await this.sendMessage({ type: 'GET_SYNC_STATUS' });
      
      if (response && response.success) {
        this.syncedCount.textContent = response.syncedCount || 0;
        
        if (response.lastSync) {
          const lastSyncDate = new Date(response.lastSync);
          this.lastSync.textContent = lastSyncDate.toLocaleString();
        } else {
          this.lastSync.textContent = 'Never';
        }
      } else {
        // Set default values if we can't get stats
        this.syncedCount.textContent = '0';
        this.lastSync.textContent = 'Never';
      }
    } catch (error) {
      console.error('Error loading sync stats:', error);
      // Set default values on error
      this.syncedCount.textContent = '0';
      this.lastSync.textContent = 'Never';
    }
  }

  showSuccess(message) {
    this.syncMessage.textContent = message;
    this.syncMessage.style.color = '#28a745';
  }

  showError(message) {
    this.syncMessage.textContent = message;
    this.syncMessage.style.color = '#dc3545';
    this.syncStatus.style.display = 'block';
    
    setTimeout(() => {
      this.syncStatus.style.display = 'none';
    }, 3000);
  }

  // Configuration management methods
  async loadConfiguration() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['googleClientId'], (result) => {
        this.clientId = result.googleClientId;
        this.isConfigured = !!(this.clientId && this.clientId.trim() && this.validateClientId(this.clientId));
        
        if (this.clientId && this.clientId.trim()) {
          this.clientIdInput.value = this.clientId;
          
          // Re-validate stored Client ID
          if (!this.validateClientId(this.clientId)) {
            console.warn('Stored Client ID is invalid, will prompt for reconfiguration');
            this.isConfigured = false;
          }
        }
        
        console.log('Configuration loaded:', { 
          hasClientId: !!this.clientId, 
          isValid: this.isConfigured 
        });
        
        resolve();
      });
    });
  }

  async saveConfiguration() {
    const clientId = this.clientIdInput.value.trim();
    
    if (!clientId) {
      this.showConfigError('Please enter a Client ID');
      return;
    }

    if (!this.validateClientId(clientId)) {
      this.showConfigError('Invalid Client ID format. Should end with .apps.googleusercontent.com');
      return;
    }

    this.saveConfigButton.disabled = true;
    this.saveConfigButton.textContent = 'Saving...';

    try {
      // Save to storage
      await new Promise((resolve) => {
        chrome.storage.local.set({ googleClientId: clientId }, resolve);
      });

      // Send to background script
      await this.sendMessage({ type: 'SET_CLIENT_ID', clientId: clientId });

      this.clientId = clientId;
      this.isConfigured = true;
      
      this.showConfigSuccess('Configuration saved! You can now authenticate.');
      
      setTimeout(() => {
        this.showAuthentication();
      }, 1500);

    } catch (error) {
      console.error('Error saving configuration:', error);
      this.showConfigError('Failed to save configuration: ' + error.message);
    } finally {
      this.saveConfigButton.disabled = false;
      this.saveConfigButton.textContent = 'Save Configuration';
    }
  }

  validateClientId(clientId) {
    return clientId.endsWith('.apps.googleusercontent.com') && clientId.length > 30;
  }

  showConfiguration() {
    this.configSection.style.display = 'block';
    this.authSection.style.display = 'none';
    this.courseSection.style.display = 'none';
    this.assignmentsSection.style.display = 'none';
    this.clientIdInput.focus();
  }

  showAuthentication() {
    this.configSection.style.display = 'none';
    this.authSection.style.display = 'block';
    this.reconfigureButton.style.display = 'inline-block';
  }

  showConfigError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'config-error';
    errorDiv.textContent = message;
    errorDiv.style.cssText = 'color: #dc3545; font-size: 11px; margin-top: 4px;';
    
    // Remove existing error
    const existingError = this.configSection.querySelector('.config-error');
    if (existingError) existingError.remove();
    
    this.configSection.appendChild(errorDiv);
    
    setTimeout(() => errorDiv.remove(), 5000);
  }

  showConfigSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'config-success';
    successDiv.textContent = message;
    successDiv.style.cssText = 'color: #28a745; font-size: 11px; margin-top: 4px;';
    
    // Remove existing messages
    const existingMsg = this.configSection.querySelector('.config-error, .config-success');
    if (existingMsg) existingMsg.remove();
    
    this.configSection.appendChild(successDiv);
  }

  showSetupGuide() {
    const guideContent = `
📋 How to get your Google OAuth Client ID:

1. Go to Google Cloud Console (console.cloud.google.com)
2. Create a new project or select existing one
3. Enable Google Tasks API
4. Go to "APIs & Services" → "Credentials"
5. Click "Create Credentials" → "OAuth client ID"
6. Choose "Web application" as application type
7. Add your extension redirect URI to "Authorized redirect URIs"
8. Copy the Client ID (ends with .apps.googleusercontent.com)

Need detailed steps? Check the README.md file!
    `.trim();

    alert(guideContent);
  }

  // Helper method to send messages to background script
  sendMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Chrome runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response || { success: false, error: 'No response received' });
        });
      } catch (error) {
        console.error('Error sending message:', error);
        reject(error);
      }
    });
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
