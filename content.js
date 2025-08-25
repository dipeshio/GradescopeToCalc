// Content script for parsing Gradescope assignments
class GradescopeParser {
  constructor() {
    this.assignments = [];
    this.courseName = '';
  }

  // Extract course name from the page
  extractCourseName() {
    const courseHeader = document.querySelector('.courseHeader--title');
    if (courseHeader) {
      const fullTitle = courseHeader.textContent.trim();
      // Extract just the course code (e.g., "MATH 303" from "MATH 303: 02 (12pm)")
      const match = fullTitle.match(/^([A-Z]+ \d+)/);
      this.courseName = match ? match[1] : fullTitle;
    }
    return this.courseName;
  }

  // Parse all assignments from the table
  parseAssignments() {
    const assignments = [];
    const rows = document.querySelectorAll('#assignments-student-table tbody tr[role="row"]');
    
    rows.forEach(row => {
      const assignment = this.parseAssignmentRow(row);
      if (assignment) {
        assignments.push(assignment);
      }
    });

    this.assignments = assignments;
    return assignments;
  }

  // Parse individual assignment row
  parseAssignmentRow(row) {
    try {
      // Get assignment name from data-assignment-title attribute
      const assignmentButton = row.querySelector('.js-submitAssignment');
      if (!assignmentButton) return null;

      const assignmentTitle = assignmentButton.getAttribute('data-assignment-title');
      if (!assignmentTitle) return null;

      // Get submission status
      const statusElement = row.querySelector('.submissionStatus--text');
      const status = statusElement ? statusElement.textContent.trim() : 'Unknown';
      
      // Determine status abbreviation
      let statusAbbr = 'IP'; // In Progress
      if (status.toLowerCase().includes('submitted') || status.toLowerCase().includes('complete')) {
        statusAbbr = 'SUBMITTED';
      } else if (status.toLowerCase().includes('no submission')) {
        statusAbbr = 'IP';
      }

      // Get due date
      const dueDateElement = row.querySelector('.submissionTimeChart--dueDate');
      let dueDate = null;
      if (dueDateElement) {
        const dateTimeAttr = dueDateElement.getAttribute('datetime');
        if (dateTimeAttr) {
          dueDate = new Date(dateTimeAttr);
        }
      }

      // Get assignment ID for tracking
      const assignmentId = assignmentButton.getAttribute('data-assignment-id');

      return {
        id: assignmentId,
        title: assignmentTitle,
        status: status,
        statusAbbr: statusAbbr,
        dueDate: dueDate,
        courseName: this.courseName,
        fullTitle: `${this.courseName}: ${assignmentTitle} (${statusAbbr})`
      };
    } catch (error) {
      console.error('Error parsing assignment row:', error);
      return null;
    }
  }

  // Get all parsed data
  getAllData() {
    this.extractCourseName();
    this.parseAssignments();
    
    return {
      courseName: this.courseName,
      assignments: this.assignments
    };
  }

  // Monitor for changes in assignment status
  startMonitoring() {
    // Create observer to watch for changes in the assignments table
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      
      mutations.forEach((mutation) => {
        // Check if assignment status or table content changed
        if (mutation.target.classList.contains('submissionStatus--text') ||
            mutation.target.closest('#assignments-student-table')) {
          shouldUpdate = true;
        }
      });

      if (shouldUpdate) {
        this.handleAssignmentChanges();
      }
    });

    // Start observing the assignments table
    const assignmentsTable = document.querySelector('#assignments-student-table');
    if (assignmentsTable) {
      observer.observe(assignmentsTable, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }
  }

  // Handle changes in assignments
  handleAssignmentChanges() {
    const newData = this.getAllData();
    
    // Send updated data to background script
    chrome.runtime.sendMessage({
      type: 'ASSIGNMENTS_UPDATED',
      data: newData
    });
  }
}

// Initialize parser when page loads
let parser = null;

// Function to initialize the parser
function initializeParser() {
  // Check if we're on a Gradescope course dashboard
  if (window.location.pathname.match(/^\/courses\/\d+\/?$/) && 
      document.querySelector('#assignments-student-table')) {
    
    parser = new GradescopeParser();
    const data = parser.getAllData();
    
    // Send initial data to background script
    chrome.runtime.sendMessage({
      type: 'ASSIGNMENTS_FOUND',
      data: data
    });

    // Start monitoring for changes
    parser.startMonitoring();
    
    console.log('Gradescope assignments parsed:', data);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeParser);
} else {
  initializeParser();
}

// Re-initialize if page content changes (for SPA navigation)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    setTimeout(initializeParser, 1000); // Wait for content to load
  }
}).observe(document, { subtree: true, childList: true });

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_ASSIGNMENTS') {
    if (parser) {
      const data = parser.getAllData();
      sendResponse({ success: true, data: data });
    } else {
      sendResponse({ success: false, error: 'Parser not initialized' });
    }
  }
});
